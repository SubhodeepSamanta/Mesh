import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'dgram';
import { createHmac } from 'crypto';
import { TurnClient, generateTurnCredentials, createPeerChannel } from '../src/net/turn.js';
import { startFakeTurnServer } from './helpers/fakeTurnServer.js';

const SECRET = 'super-secret-turn-key';

function startServer(opts = {}) {
  return startFakeTurnServer({ secret: SECRET, ...opts });
}

describe('turn', () => {
  test('generateTurnCredentials matches the coturn static-auth-secret HMAC-SHA1 scheme', () => {
    const { username, credential } = generateTurnCredentials(SECRET, 'peer-42', 3600);
    const [expiry] = username.split(':');
    assert.ok(Number(expiry) > Math.floor(Date.now() / 1000));
    const expected = createHmac('sha1', SECRET).update(username).digest('base64');
    assert.equal(credential, expected);
  });

  test('allocate performs the 401 challenge -> authenticated retry handshake', async () => {
    const fake = startServer();
    const { host, port } = await fake.ready();
    const { username, credential } = generateTurnCredentials(SECRET, 'peer-a');
    const client = new TurnClient({ host, port, username, credential });

    try {
      const { relayedAddress, mappedAddress } = await client.allocate({ timeoutMs: 2000 });
      assert.equal(relayedAddress.address, '127.0.0.1');
      assert.ok(relayedAddress.port > 0);
      assert.equal(mappedAddress.address, '127.0.0.1');
    } finally {
      client.close();
      await fake.close();
    }
  });

  test('allocate recovers from a stale-nonce challenge by retrying with the fresh nonce', async () => {
    const fake = startServer({ forceStaleNonceOnce: true });
    const { host, port } = await fake.ready();
    const { username, credential } = generateTurnCredentials(SECRET, 'peer-b');
    const client = new TurnClient({ host, port, username, credential });

    try {
      const { relayedAddress } = await client.allocate({ timeoutMs: 2000 });
      assert.ok(relayedAddress.port > 0);
    } finally {
      client.close();
      await fake.close();
    }
  });

  test('allocate rejects with a wrong credential', async () => {
    const fake = startServer();
    const { host, port } = await fake.ready();
    const { username } = generateTurnCredentials(SECRET, 'peer-c');
    const client = new TurnClient({ host, port, username, credential: 'not-the-right-credential' });

    try {
      await assert.rejects(client.allocate({ timeoutMs: 2000 }));
    } finally {
      client.close();
      await fake.close();
    }
  });

  test('createPermission + send/data round-trips a datagram through the relay to a real UDP peer and back', async () => {
    const fake = startServer();
    const { host, port } = await fake.ready();
    const { username, credential } = generateTurnCredentials(SECRET, 'peer-d');
    const client = new TurnClient({ host, port, username, credential });

    const peerSocket = dgram.createSocket('udp4');
    await new Promise((resolve) => peerSocket.bind(0, '127.0.0.1', resolve));
    const peerPort = peerSocket.address().port;

    try {
      await client.allocate({ timeoutMs: 2000 });
      await client.createPermission('127.0.0.1', peerPort, { timeoutMs: 2000 });

      const echoed = new Promise((resolve) => {
        peerSocket.once('message', (msg, rinfo) => {
          peerSocket.send(msg, rinfo.port, rinfo.address);
          resolve();
        });
      });

      const dataBack = new Promise((resolve) => client.once('data', (addr, p, data) => resolve(data.toString('utf8'))));

      client.send('127.0.0.1', peerPort, Buffer.from('hello over turn'));
      await echoed;
      const result = await dataBack;
      assert.equal(result, 'hello over turn');
    } finally {
      client.close();
      peerSocket.close();
      await fake.close();
    }
  });

  test('createPeerChannel demuxes a specific peer and exposes send/on(message)', async () => {
    const fake = startServer();
    const { host, port } = await fake.ready();
    const { username, credential } = generateTurnCredentials(SECRET, 'peer-e');
    const client = new TurnClient({ host, port, username, credential });

    const peerSocket = dgram.createSocket('udp4');
    await new Promise((resolve) => peerSocket.bind(0, '127.0.0.1', resolve));
    const peerPort = peerSocket.address().port;

    try {
      await client.allocate({ timeoutMs: 2000 });
      await client.createPermission('127.0.0.1', peerPort, { timeoutMs: 2000 });
      const channel = createPeerChannel(client, '127.0.0.1', peerPort);

      const gotMessage = new Promise((resolve) => channel.on('message', (data) => resolve(data.toString('utf8'))));
      peerSocket.once('message', () => {});

      peerSocket.send(Buffer.from('from-peer'), client.relayedAddress.port, client.relayedAddress.address);
      const result = await gotMessage;
      assert.equal(result, 'from-peer');

      channel.close();
    } finally {
      client.close();
      peerSocket.close();
      await fake.close();
    }
  });
});
