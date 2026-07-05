import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { ReliableDatagramChannel } from '../src/net/reliableDatagram.js';

function createLossyLink({ dropRate = 0, duplicateRate = 0, maxDelayMs = 5 } = {}) {
  const aListeners = [];
  const bListeners = [];

  function deliver(listeners, msg) {
    const jitter = Math.random() * maxDelayMs;
    setTimeout(() => {
      for (const cb of listeners) cb(msg);
    }, jitter);
  }

  function maybeSend(listeners, msg) {
    if (Math.random() < dropRate) return;
    deliver(listeners, msg);
    if (Math.random() < duplicateRate) deliver(listeners, msg);
  }

  const endpointA = {
    send: (msg) => maybeSend(bListeners, msg),
    on: (event, cb) => { if (event === 'message') aListeners.push(cb); },
    removeListener: (event, cb) => {
      if (event !== 'message') return;
      const idx = aListeners.indexOf(cb);
      if (idx !== -1) aListeners.splice(idx, 1);
    },
    close: () => {},
  };
  const endpointB = {
    send: (msg) => maybeSend(aListeners, msg),
    on: (event, cb) => { if (event === 'message') bListeners.push(cb); },
    removeListener: (event, cb) => {
      if (event !== 'message') return;
      const idx = bListeners.indexOf(cb);
      if (idx !== -1) bListeners.splice(idx, 1);
    },
    close: () => {},
  };

  return { endpointA, endpointB };
}

describe('reliableDatagram', () => {
  test('delivers a small payload in order over a perfect link', async () => {
    const { endpointA, endpointB } = createLossyLink();
    const a = new ReliableDatagramChannel(endpointA, { mtu: 64 });
    const b = new ReliableDatagramChannel(endpointB, { mtu: 64 });

    const payload = Buffer.from('the quick brown fox jumps over the lazy dog, repeated for length. '.repeat(5));
    const received = [];
    const done = new Promise((resolve) => {
      let total = 0;
      b.on('data', (chunk) => {
        received.push(chunk);
        total += chunk.length;
        if (total >= payload.length) resolve();
      });
    });

    a.write(payload);
    await done;

    assert.ok(Buffer.concat(received).equals(payload));
    a.destroy();
    b.destroy();
  });

  test('reassembles a large payload correctly despite loss, duplication, and reordering', { timeout: 20000 }, async () => {
    const { endpointA, endpointB } = createLossyLink({ dropRate: 0.15, duplicateRate: 0.1, maxDelayMs: 20 });
    const a = new ReliableDatagramChannel(endpointA, { mtu: 200, rtoMs: 60, windowSize: 8 });
    const b = new ReliableDatagramChannel(endpointB, { mtu: 200, rtoMs: 60, windowSize: 8 });

    const payload = randomBytes(60000);
    const received = [];
    const done = new Promise((resolve) => {
      let total = 0;
      b.on('data', (chunk) => {
        received.push(chunk);
        total += chunk.length;
        if (total >= payload.length) resolve();
      });
    });

    a.write(payload);
    await done;

    assert.ok(Buffer.concat(received).equals(payload));
    a.destroy();
    b.destroy();
  });

  test('write() reports backpressure and emits drain once the window clears', async () => {
    const { endpointA, endpointB } = createLossyLink();
    const a = new ReliableDatagramChannel(endpointA, { mtu: 16, windowSize: 2, highWaterMark: 40 });
    const b = new ReliableDatagramChannel(endpointB, { mtu: 16, windowSize: 2 });
    b.on('data', () => {});

    const ok = a.write(Buffer.alloc(200, 7));
    assert.equal(ok, false);

    await new Promise((resolve) => a.once('drain', resolve));
    a.destroy();
    b.destroy();
  });

  test('gives up and emits error after exceeding max retransmit attempts on a dead link', { timeout: 10000 }, async () => {
    const deadChannel = {
      send: () => {},
      on: () => {},
      removeListener: () => {},
      close: () => {},
    };
    const a = new ReliableDatagramChannel(deadChannel, { rtoMs: 20, maxRetries: 3 });

    const failure = new Promise((resolve) => a.once('error', resolve));
    a.write(Buffer.from('hello'));
    const err = await failure;
    assert.match(err.message, /max retransmit/);
  });
});
