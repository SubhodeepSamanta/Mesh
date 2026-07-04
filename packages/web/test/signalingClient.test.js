import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignalingClient, MSG_TYPE } from '../src/webrtc/signalingClient.js';

class FakeWebSocket extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    this.readyState = FakeWebSocket.CONNECTING;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  emitServerMessage(obj) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(obj) }));
  }
}
FakeWebSocket.instances = [];
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;

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

  it('captures rejoinToken from ROOM_CREATED and ROOM_JOINED responses', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();

    const createPromise = client.createRoom();
    const socket = FakeWebSocket.instances[0];
    socket.emitServerMessage({ type: MSG_TYPE.ROOM_CREATED, roomCode: 'ABC123', peerId: 'peer1', rejoinToken: 'tok-1' });
    await createPromise;
    expect(client._rejoinToken).toBe('tok-1');

    const joinPromise = client.joinRoom('XYZ999');
    socket.emitServerMessage({ type: MSG_TYPE.ROOM_JOINED, roomCode: 'XYZ999', peerId: 'peer1', existingPeers: [], rejoinToken: 'tok-2' });
    await joinPromise;
    expect(client._rejoinToken).toBe('tok-2');
  });

  it('_rejoinRoom sends REJOIN_ROOM and dispatches reconnect with existingPeers on ROOM_REJOINED', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();

    const createPromise = client.createRoom();
    const socket = FakeWebSocket.instances[0];
    socket.emitServerMessage({ type: MSG_TYPE.ROOM_CREATED, roomCode: 'ABC123', peerId: 'peer1', rejoinToken: 'tok-1' });
    await createPromise;

    const reconnectDetail = new Promise((resolve) => {
      client.addEventListener('reconnect', (e) => resolve(e.detail));
    });

    const rejoinPromise = client._rejoinRoom();
    expect(socket.sent.at(-1)).toEqual({
      type: MSG_TYPE.REJOIN_ROOM,
      roomCode: 'ABC123',
      peerId: 'peer1',
      rejoinToken: 'tok-1',
    });

    socket.emitServerMessage({
      type: MSG_TYPE.ROOM_REJOINED,
      roomCode: 'ABC123',
      peerId: 'peer1',
      existingPeers: ['peer2'],
      rejoinToken: 'tok-2',
    });

    await rejoinPromise;
    expect(client._rejoinToken).toBe('tok-2');
    await expect(reconnectDetail).resolves.toEqual({ existingPeers: ['peer2'] });
  });

  it('_rejoinRoom rejects and dispatches reconnectFailed on ERROR', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();

    const createPromise = client.createRoom();
    const socket = FakeWebSocket.instances[0];
    socket.emitServerMessage({ type: MSG_TYPE.ROOM_CREATED, roomCode: 'ABC123', peerId: 'peer1', rejoinToken: 'tok-1' });
    await createPromise;

    const failedEvent = new Promise((resolve) => {
      client.addEventListener('reconnectFailed', (e) => resolve(e.detail));
    });

    const rejoinPromise = client._rejoinRoom();
    socket.emitServerMessage({ type: MSG_TYPE.ERROR, message: 'Cannot rejoin room' });

    await expect(rejoinPromise).rejects.toThrow('Cannot rejoin room');
    await expect(failedEvent).resolves.toEqual({ type: MSG_TYPE.ERROR, message: 'Cannot rejoin room' });
  });

  it('automatically sends REJOIN_ROOM when the socket reopens with a stored session', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();

    const createPromise = client.createRoom();
    const socket1 = FakeWebSocket.instances[0];
    socket1.emitServerMessage({ type: MSG_TYPE.ROOM_CREATED, roomCode: 'ABC123', peerId: 'peer1', rejoinToken: 'tok-1' });
    await createPromise;

    await client.connect();
    const socket2 = FakeWebSocket.instances[1];

    expect(socket2.sent[0]).toEqual({
      type: MSG_TYPE.REJOIN_ROOM,
      roomCode: 'ABC123',
      peerId: 'peer1',
      rejoinToken: 'tok-1',
    });
  });
});

class FakeDocument extends EventTarget {
  constructor() { super(); this.visibilityState = 'visible' }
  setVisibility(state) {
    this.visibilityState = state
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

describe('SignalingClient visibilitychange handling (§7 tab-backgrounding)', () => {
  let originalWebSocket
  let originalDocument

  beforeEach(() => {
    originalWebSocket = global.WebSocket
    originalDocument = global.document
    global.WebSocket = FakeWebSocket
    global.document = new FakeDocument()
    FakeWebSocket.instances = []
  })

  afterEach(() => {
    global.WebSocket = originalWebSocket
    global.document = originalDocument
  })

  it('sends an immediate PING when the tab becomes visible again', async () => {
    const client = new SignalingClient('ws://localhost:8080')
    await client.connect()
    const socket = FakeWebSocket.instances[0]
    socket.sent.length = 0

    global.document.setVisibility('hidden')
    global.document.setVisibility('visible')

    expect(socket.sent).toContainEqual({ type: 'PING' })
    client.close()
  })

  it('closes a stale connection on visibility restore if no PONG was seen recently', async () => {
    const client = new SignalingClient('ws://localhost:8080')
    await client.connect()
    const socket = FakeWebSocket.instances[0]
    client._lastPing = Date.now() - 60000 // older than the 45s staleness threshold

    let closed = false
    socket.addEventListener('close', () => { closed = true })
    global.document.setVisibility('visible')

    expect(closed).toBe(true)
  })

  it('fires a pending reconnect immediately instead of waiting for its throttled timer', async () => {
    vi.useFakeTimers()
    try {
      const client = new SignalingClient('ws://localhost:8080')
      await client.connect()
      const socket = FakeWebSocket.instances[0]
      socket.close() // triggers _scheduleReconnect(), which sets a backoff timer

      expect(client._reconnectTimer).not.toBeNull()
      const instancesBefore = FakeWebSocket.instances.length

      global.document.setVisibility('visible')
      await vi.advanceTimersByTimeAsync(0)

      expect(FakeWebSocket.instances.length).toBeGreaterThan(instancesBefore)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removeEventListener is called on close so a closed client stops reacting to visibility changes', async () => {
    const client = new SignalingClient('ws://localhost:8080')
    await client.connect()
    const socket = FakeWebSocket.instances[0]
    client.close()
    socket.sent.length = 0

    global.document.setVisibility('hidden')
    global.document.setVisibility('visible')

    expect(socket.sent).toEqual([])
  })
})