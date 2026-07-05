import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/crypto.js';
import { DHTNode } from '../src/dht.js';

describe('dht relay signaling', () => {
  it('announceFile propagates relay info and the announcing node dht endpoint through getPeersForFile', async () => {
    const seeder = new DHTNode();
    const finder = new DHTNode();
    await seeder.listen();
    await finder.listen();

    finder.routingTable.addPeer({ id: seeder.nodeId, addr: '127.0.0.1', port: seeder.port });

    const fileHash = sha256(Buffer.from('relay-announce test'));
    await seeder.announceFile(fileHash, 4321, { addr: '203.0.113.9', port: 55000 });

    const peers = await finder.getPeersForFile(fileHash);
    const peer = peers.find(p => p.port === 4321);

    assert.ok(peer);
    assert.deepEqual(peer.relay, { addr: '203.0.113.9', port: 55000 });
    assert.equal(peer.dhtAddr, '127.0.0.1');
    assert.equal(peer.dhtPort, seeder.port);

    await seeder.close();
    await finder.close();
  });

  it('requestRelayPermission triggers every registered handler and resolves once acked', async () => {
    const seeder = new DHTNode();
    const requester = new DHTNode();
    await seeder.listen();
    await requester.listen();

    const seenPeers = [];
    seeder.addRelayPermissionHandler(async (addr, port) => {
      seenPeers.push(`${addr}:${port}`);
    });

    let secondCalled = false;
    seeder.addRelayPermissionHandler(async () => {
      secondCalled = true;
    });

    await requester.requestRelayPermission('127.0.0.1', seeder.port, { timeoutMs: 2000 });

    assert.equal(seenPeers.length, 1);
    assert.match(seenPeers[0], /^127\.0\.0\.1:\d+$/);
    assert.equal(secondCalled, true);

    await seeder.close();
    await requester.close();
  });

  it('requestRelayPermission still resolves even if a handler throws', async () => {
    const seeder = new DHTNode();
    const requester = new DHTNode();
    await seeder.listen();
    await requester.listen();

    seeder.addRelayPermissionHandler(async () => {
      throw new Error('permission backend unavailable');
    });

    await assert.doesNotReject(requester.requestRelayPermission('127.0.0.1', seeder.port, { timeoutMs: 2000 }));

    await seeder.close();
    await requester.close();
  });

  it('requestRelayPermission times out when the target node never responds', async () => {
    const requester = new DHTNode();
    await requester.listen();

    await assert.rejects(
      requester.requestRelayPermission('127.0.0.1', 1, { timeoutMs: 200 }),
      /timeout/
    );

    await requester.close();
  });

  it('removeRelayPermissionHandler stops a handler from being invoked', async () => {
    const seeder = new DHTNode();
    const requester = new DHTNode();
    await seeder.listen();
    await requester.listen();

    let calls = 0;
    const handler = async () => { calls++; };
    seeder.addRelayPermissionHandler(handler);
    seeder.removeRelayPermissionHandler(handler);

    await requester.requestRelayPermission('127.0.0.1', seeder.port, { timeoutMs: 2000 });
    assert.equal(calls, 0);

    await seeder.close();
    await requester.close();
  });
});
