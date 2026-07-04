import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebRTCTransport, CONNECT_TIMEOUT_MS } from '../src/lib/webrtc.js';
import { buildJSONBody, parseMessage } from '../src/webrtc/protocol.js';

class FakeDataChannel extends EventTarget {
  constructor() {
    super();
    this.readyState = 'connecting';
    this.peer = null;
    this.binaryType = 'arraybuffer';
  }

  dispatchEvent(ev) {
    if (ev.type === 'open' && this.onopen) this.onopen(ev);
    if (ev.type === 'message' && this.onmessage) this.onmessage(ev);
    return super.dispatchEvent(ev);
  }

  send(data) {
    if (this.peer) {
      this.peer.dispatchEvent(new MessageEvent('message', { data }));
    }
  }

  open() {
    this.readyState = 'open';
    this.dispatchEvent(new Event('open'));
  }

  close() {
    this.readyState = 'closed';
  }
}

function linkChannels(a, b) {
  a.peer = b;
  b.peer = a;
}

class FakeRTCPeerConnection extends EventTarget {
  constructor() {
    super();
    this.connectionState = 'new';
    this.signalingState = 'stable';
    this.channel = null;
    this.localDescription = null;
    this.remoteDescription = null;
  }

  dispatchEvent(ev) {
    if (ev.type === 'datachannel' && this.ondatachannel) this.ondatachannel(ev);
    return super.dispatchEvent(ev);
  }

  createDataChannel() {
    this.channel = new FakeDataChannel();
    return this.channel;
  }

  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'fake-offer-sdp' });
  }

  createAnswer() {
    return Promise.resolve({ type: 'answer', sdp: 'fake-answer-sdp' });
  }

  setLocalDescription(desc) {
    this.localDescription = desc;
    if (desc && desc.type === 'offer') {
      this.signalingState = 'have-local-offer';
    } else if (desc && desc.type === 'answer') {
      this.signalingState = 'stable';
    }
    return Promise.resolve();
  }

  setRemoteDescription(desc) {
    this.remoteDescription = desc;
    if (desc && desc.type === 'offer') {
      this.signalingState = 'have-remote-offer';
    } else if (desc && desc.type === 'answer') {
      this.signalingState = 'stable';
    }
    return Promise.resolve();
  }

  addIceCandidate() {
    return Promise.resolve();
  }

  close() {
    this.connectionState = 'closed';
  }
}

class FakeSignalingClient extends EventTarget {
  constructor(peerId) {
    super();
    this.peerId = peerId;
    this.partner = null;
    this.sentPayloads = [];
  }

  relay(targetPeerId, payload) {
    this.sentPayloads.push(payload);
    queueMicrotask(() => {
      this.partner?.dispatchEvent(new CustomEvent('relay', {
        detail: { fromPeerId: this.peerId, payload },
      }));
    });
  }
}

function linkSignaling(a, b) {
  a.partner = b;
  b.partner = a;
}

async function flush(times = 10) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('WebRTCTransport', () => {
  let originalRTCPeerConnection;

  beforeEach(() => {
    originalRTCPeerConnection = global.RTCPeerConnection;
  });

  afterEach(() => {
    global.RTCPeerConnection = originalRTCPeerConnection;
    vi.useRealTimers();
  });

  it('establishes a data channel and exchanges a message end to end', async () => {
    const pcA = new FakeRTCPeerConnection();
    const pcB = new FakeRTCPeerConnection();
    global.RTCPeerConnection = vi.fn()
      .mockImplementationOnce(function () { return pcA; })
      .mockImplementationOnce(function () { return pcB; });

    const sigA = new FakeSignalingClient('peerA');
    const sigB = new FakeSignalingClient('peerB');
    linkSignaling(sigA, sigB);

    const transportA = new WebRTCTransport(sigA, 'peerB', { initiator: true });
    const transportB = new WebRTCTransport(sigB, 'peerA', { initiator: false });

    const connectA = transportA.connect();
    const connectB = transportB.connect();

    await flush();

    const channelB = new FakeDataChannel();
    linkChannels(pcA.channel, channelB);
    pcB.dispatchEvent(Object.assign(new Event('datachannel'), { channel: channelB }));

    pcA.channel.open();
    channelB.open();

    await expect(connectA).resolves.toBeUndefined();
    await expect(connectB).resolves.toBeUndefined();

    const received = new Promise((resolve) => {
      transportB.onJSON((data) => resolve(data));
    });
    transportA.sendJSON({ hello: 'world' });
    await expect(received).resolves.toEqual({ hello: 'world' });

    expect(pcB.remoteDescription.sdp).toBe('fake-offer-sdp');
    expect(pcA.remoteDescription.sdp).toBe('fake-answer-sdp');
  }, 10000);

  it('ignores relay messages from peers other than the remote peer', async () => {
    const pcA = new FakeRTCPeerConnection();
    global.RTCPeerConnection = vi.fn().mockImplementationOnce(function () { return pcA; });

    const sigA = new FakeSignalingClient('peerA');
    sigA.partner = sigA;

    const transportA = new WebRTCTransport(sigA, 'peerB', { initiator: true });
    transportA.connect().catch(() => {});

    await flush();

    sigA.dispatchEvent(new CustomEvent('relay', {
      detail: { fromPeerId: 'someOtherPeer', payload: { kind: 'answer', sdp: 'should-be-ignored' } },
    }));

    await flush();

    expect(pcA.remoteDescription).toBeNull();
    transportA.close();
  });

  it('rejects if the data channel never opens before the timeout', async () => {
    vi.useFakeTimers();

    const pcA = new FakeRTCPeerConnection();
    const pcB = new FakeRTCPeerConnection();
    global.RTCPeerConnection = vi.fn()
      .mockImplementationOnce(function () { return pcA; })
      .mockImplementationOnce(function () { return pcB; });

    const sigA = new FakeSignalingClient('peerA');
    const sigB = new FakeSignalingClient('peerB');
    linkSignaling(sigA, sigB);

    const transportA = new WebRTCTransport(sigA, 'peerB', { initiator: true });
    const connectA = transportA.connect();

    const assertion = expect(connectA).rejects.toThrow('Connection timeout');
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 100);
    await assertion;
  });

  it('surfaces the connection timeout via visibilitychange even if the setTimeout itself never fires (throttled/backgrounded tab)', async () => {
    vi.useFakeTimers();
    const originalDocument = global.document;

    class FakeDocument extends EventTarget {
      constructor() { super(); this.visibilityState = 'visible'; }
      setVisibility(state) {
        this.visibilityState = state;
        this.dispatchEvent(new Event('visibilitychange'));
      }
    }
    global.document = new FakeDocument();

    try {
      const pcA = new FakeRTCPeerConnection();
      global.RTCPeerConnection = vi.fn().mockImplementationOnce(function () { return pcA; });
      const sigA = new FakeSignalingClient('peerA');

      const transportA = new WebRTCTransport(sigA, 'peerB', { initiator: true });
      const connectA = transportA.connect();
      const assertion = expect(connectA).rejects.toThrow('Connection timeout');

      // Move the clock past the deadline WITHOUT advancing the fake timer
      // queue — this is what a throttled/paused setTimeout in a backgrounded
      // tab looks like from the code's perspective: time has passed, but the
      // timer callback never got to run.
      vi.setSystemTime(Date.now() + CONNECT_TIMEOUT_MS + 500);
      global.document.setVisibility('visible');

      await assertion;
    } finally {
      global.document = originalDocument;
      vi.useRealTimers();
    }
  });
});
