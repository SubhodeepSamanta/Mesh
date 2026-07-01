import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignalingClient, MSG_TYPE } from '../src/webrtc/signalingClient.js';

class FakeWebSocket extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.dispatchEvent(new Event('close'));
  }

  emitServerMessage(obj) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(obj) }));
  }
}
FakeWebSocket.instances = [];

describe('SignalingClient', () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  it('connect resolves once the socket opens', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    const resolved = await client.connect();
    expect(resolved).toBe(client);
  });

  it('createRoom resolves with roomCode and peerId', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();

    const createPromise = client.createRoom();
    const socket = FakeWebSocket.instances[0];
    expect(socket.sent[0]).toEqual({ type: MSG_TYPE.CREATE_ROOM, password: undefined });

    socket.emitServerMessage({ type: MSG_TYPE.ROOM_CREATED, roomCode: 'ABC123', peerId: 'peer1' });

    const result = await createPromise;
    expect(result.roomCode).toBe('ABC123');
    expect(client.peerId).toBe('peer1');
  });

  it('joinRoom rejects when the server returns an error', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();

    const joinPromise = client.joinRoom('BADCOD');
    const socket = FakeWebSocket.instances[0];
    socket.emitServerMessage({ type: MSG_TYPE.ERROR, message: 'Room not found' });

    await expect(joinPromise).rejects.toThrow('Room not found');
  });

  it('dispatches peerJoined, peerLeft, and relay events', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();
    const socket = FakeWebSocket.instances[0];

    const peerJoined = new Promise((resolve) => {
      client.addEventListener('peerJoined', (e) => resolve(e.detail));
    });
    socket.emitServerMessage({ type: MSG_TYPE.PEER_JOINED, peerId: 'peer2' });
    await expect(peerJoined).resolves.toEqual({ peerId: 'peer2' });

    const peerLeft = new Promise((resolve) => {
      client.addEventListener('peerLeft', (e) => resolve(e.detail));
    });
    socket.emitServerMessage({ type: MSG_TYPE.PEER_LEFT, peerId: 'peer2' });
    await expect(peerLeft).resolves.toEqual({ peerId: 'peer2' });

    const relay = new Promise((resolve) => {
      client.addEventListener('relay', (e) => resolve(e.detail));
    });
    socket.emitServerMessage({ type: MSG_TYPE.RELAY, fromPeerId: 'peer2', payload: { sdp: 'x' } });
    await expect(relay).resolves.toEqual({ fromPeerId: 'peer2', payload: { sdp: 'x' } });
  });

  it('relay sends a RELAY message with targetPeerId and payload', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();
    const socket = FakeWebSocket.instances[0];

    client.relay('peer2', { kind: 'offer', sdp: 'fake' });

    expect(socket.sent[0]).toEqual({
      type: MSG_TYPE.RELAY,
      targetPeerId: 'peer2',
      payload: { kind: 'offer', sdp: 'fake' },
    });
  });
});