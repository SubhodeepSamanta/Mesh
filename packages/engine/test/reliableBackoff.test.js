import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ReliableDatagramChannel } from '../src/net/reliableDatagram.js';

// A link with a switchable total blackout — models a mobile-hotspot stall
// (tower handoff, uplink bufferbloat) where nothing gets through for a while.
function createBlackoutLink() {
  const state = { down: false };
  const aListeners = [];
  const bListeners = [];
  const endpoint = (mine, theirs) => ({
    send: (msg) => { if (!state.down) setTimeout(() => theirs.forEach((cb) => cb(msg)), 1); },
    on: (event, cb) => { if (event === 'message') mine.push(cb); },
    removeListener: (event, cb) => {
      const idx = mine.indexOf(cb);
      if (idx !== -1) mine.splice(idx, 1);
    },
    close: () => {},
  });
  return { state, endpointA: endpoint(aListeners, bListeners), endpointB: endpoint(bListeners, aListeners) };
}

describe('reliableDatagram retransmit backoff', () => {
  test('survives a blackout longer than fixed-RTO patience would allow', async () => {
    const { state, endpointA, endpointB } = createBlackoutLink();
    // With a FIXED 20ms RTO, 6 retries = ~120ms of patience — the 400ms
    // blackout below would kill the channel. Exponential backoff
    // (20,40,80,160,200,200 = 700ms) rides it out.
    const a = new ReliableDatagramChannel(endpointA, { mtu: 64, rtoMs: 20, maxRetries: 6, maxRtoMs: 200 });
    const b = new ReliableDatagramChannel(endpointB, { mtu: 64, rtoMs: 20, maxRetries: 6, maxRtoMs: 200 });

    let failed = null;
    a.on('error', (e) => { failed = e; });

    const payload = Buffer.from('data sent into a stalled network, delivered after recovery. '.repeat(10));
    const done = new Promise((resolve) => {
      let total = 0;
      b.on('data', (chunk) => {
        total += chunk.length;
        if (total >= payload.length) resolve();
      });
    });

    state.down = true;
    a.write(payload);
    setTimeout(() => { state.down = false; }, 400);

    await done;
    assert.equal(failed, null, 'channel must not fail during a survivable blackout');
    a.destroy();
    b.destroy();
  });

  test('still gives up when the blackout outlasts all backed-off retries', async () => {
    const { state, endpointA } = createBlackoutLink();
    const a = new ReliableDatagramChannel(endpointA, { mtu: 64, rtoMs: 10, maxRetries: 3, maxRtoMs: 40 });

    const failure = new Promise((resolve) => a.on('error', resolve));
    state.down = true;
    a.write(Buffer.from('never delivered'));

    const err = await failure;
    assert.match(err.message, /max retransmit/);
  });
});
