import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { SignalingServer, MSG_TYPE } from '../src/server.js';

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

describe('signaling server', () => {
  it('creates a room and returns a room code', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    send(ws, { type: MSG_TYPE.CREATE_ROOM });
    const msg = await nextMessage(ws);

    assert.equal(msg.type, MSG_TYPE.ROOM_CREATED);
    assert.match(msg.roomCode, /^[A-Z2-9]{6}$/);
    assert.ok(msg.peerId);

    ws.close();
    await server.close();
  });

  it('a second peer can join an existing room', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });
    const joined = await nextMessage(ws2);

    assert.equal(joined.type, MSG_TYPE.ROOM_JOINED);
    assert.equal(joined.roomCode, created.roomCode);
    assert.deepEqual(joined.existingPeers, [created.peerId]);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('existing peer is notified when a new peer joins', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    const peerJoinedPromise = nextMessage(ws1);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });

    const peerJoinedMsg = await peerJoinedPromise;
    assert.equal(peerJoinedMsg.type, MSG_TYPE.PEER_JOINED);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('joining a nonexistent room returns an error', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    send(ws, { type: MSG_TYPE.JOIN_ROOM, roomCode: 'NOTREAL' });
    const msg = await nextMessage(ws);

    assert.equal(msg.type, MSG_TYPE.ERROR);

    ws.close();
    await server.close();
  });

  it('relays a message from one peer to another by peerId', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });

    const [joined] = await Promise.all([
      nextMessage(ws2),
      nextMessage(ws1),
    ]);

    const relayPromise = nextMessage(ws1);
    send(ws2, {
      type: MSG_TYPE.RELAY,
      targetPeerId: created.peerId,
      payload: { sdp: 'fake-offer-data' },
    });

    const relayed = await relayPromise;
    assert.equal(relayed.type, MSG_TYPE.RELAY);
    assert.equal(relayed.fromPeerId, joined.peerId);
    assert.deepEqual(relayed.payload, { sdp: 'fake-offer-data' });

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('notifies remaining peer when one peer disconnects', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });
    await nextMessage(ws2);
    await nextMessage(ws1);

    const peerLeftPromise = nextMessage(ws1);
    ws2.close();

    const leftMsg = await peerLeftPromise;
    assert.equal(leftMsg.type, MSG_TYPE.PEER_LEFT);

    ws1.close();
    await server.close();
  });

  it('removes the room entirely once all peers disconnect', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    await nextMessage(ws1);

    assert.equal(server.rooms.size, 1);

    ws1.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(server.rooms.size, 0);

    await server.close();
  });

  it('relay to an unknown peerId returns an error', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    send(ws, { type: MSG_TYPE.CREATE_ROOM });
    await nextMessage(ws);

    send(ws, { type: MSG_TYPE.RELAY, targetPeerId: 'nonexistent', payload: {} });
    const msg = await nextMessage(ws);

    assert.equal(msg.type, MSG_TYPE.ERROR);

    ws.close();
    await server.close();
  });

  it('sending malformed JSON does not crash the server', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    ws.send('not valid json {{{');
    const msg = await nextMessage(ws);

    assert.equal(msg.type, MSG_TYPE.ERROR);

    ws.close();
    await server.close();
  });

  it('password protected room rejects wrong password', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM, password: 'secret123' });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode, password: 'wrongpass' });
    const msg = await nextMessage(ws2);

    assert.equal(msg.type, MSG_TYPE.ERROR);
    assert.match(msg.message, /password/i);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('password protected room accepts correct password', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM, password: 'secret123' });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode, password: 'secret123' });
    const joined = await nextMessage(ws2);

    assert.equal(joined.type, MSG_TYPE.ROOM_JOINED);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('joining without password when room has one returns error', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM, password: 'secret' });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });
    const msg = await nextMessage(ws2);

    assert.equal(msg.type, MSG_TYPE.ERROR);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('rate limits room creation per IP', async () => {
    const server = new SignalingServer({ maxCreates: 3 });
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    let lastMsg;

    for (let i = 0; i < 4; i++) {
      send(ws, { type: MSG_TYPE.CREATE_ROOM });
      lastMsg = await nextMessage(ws);
    }

    assert.equal(lastMsg.type, MSG_TYPE.ERROR);
    assert.match(lastMsg.message, /rate limit/i);

    ws.close();
    await server.close();
  });

  it('rate limits join attempts per IP', async () => {
    const server = new SignalingServer({ maxJoins: 2 });
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    let lastMsg;

    for (let i = 0; i < 3; i++) {
      send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });
      lastMsg = await nextMessage(ws2);
    }

    assert.equal(lastMsg.type, MSG_TYPE.ERROR);
    assert.match(lastMsg.message, /rate limit/i);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('expired rooms are cleaned up automatically', async () => {
    const server = new SignalingServer({ roomTtlMs: 100 });
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    send(ws, { type: MSG_TYPE.CREATE_ROOM });
    await nextMessage(ws);

    assert.equal(server.rooms.size, 1);

    server._expireRooms();
    await new Promise(r => setTimeout(r, 150));
    server._expireRooms();

    assert.equal(server.rooms.size, 0);

    ws.close();
    await server.close();
  });
});