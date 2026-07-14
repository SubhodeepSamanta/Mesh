import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DHTNode, generateNodeId, PEER_TTL_MS } from '../src/dht.js';
import { sha256 } from '../src/crypto.js';

describe('dht announce and get peers', () => {
  it('a single node can announce and find its own file', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    const fileHash = sha256(Buffer.from('test file contents'));
    await nodeA.announceFile(fileHash, 9999);

    const peers = await nodeA.getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 9999));

    await nodeA.close();
  });
it('an announcing node remains discoverable directly even after the peer it replicated to goes offline', async () => {
    const seeder = new DHTNode();
    const relay = new DHTNode();
    const finder = new DHTNode();
    await seeder.listen();
    await relay.listen();
    await finder.listen();

    seeder.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });
    finder.routingTable.addPeer({ id: seeder.nodeId, addr: '127.0.0.1', port: seeder.port });

    const fileHash = sha256(Buffer.from('offline relay test'));
    await seeder.announceFile(fileHash, 6100);

    await relay.close();

    const peers = await finder.getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 6100));

    await seeder.close();
    await finder.close();
  }, { timeout: 10000 });
  it('peer announces, different peer finds it across the network', async () => {
    const seeder   = new DHTNode();
    const finder   = new DHTNode();
    const relay    = new DHTNode();
    await seeder.listen();
    await finder.listen();
    await relay.listen();

    seeder.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });
    finder.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });

    const fileHash = sha256(Buffer.from('shared file data'));
    await seeder.announceFile(fileHash, 8888);

    const peers = await finder.getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 8888));

    await seeder.close();
    await finder.close();
    await relay.close();
  });

  it('multiple seeders for the same file are all discoverable', async () => {
    const seederA = new DHTNode();
    const seederB = new DHTNode();
    const finder  = new DHTNode();
    const relay   = new DHTNode();
    await seederA.listen();
    await seederB.listen();
    await finder.listen();
    await relay.listen();

    seederA.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });
    seederB.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });
    finder.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });

    const fileHash = sha256(Buffer.from('a file with multiple seeders'));
    await seederA.announceFile(fileHash, 7001);
    await seederB.announceFile(fileHash, 7002);

    const peers = await finder.getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 7001));
    assert.ok(peers.some(p => p.port === 7002));

    await seederA.close();
    await seederB.close();
    await finder.close();
    await relay.close();
  });

  it('getPeers for a file nobody announced returns empty array', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    nodeA.routingTable.addPeer({ id: nodeB.nodeId, addr: '127.0.0.1', port: nodeB.port });

    const fileHash = sha256(Buffer.from('nobody has this file'));
    const peers = await nodeA.getPeersForFile(fileHash);
    assert.deepEqual(peers, []);

    await nodeA.close();
    await nodeB.close();
  });

  it('re-announcing the same file updates timestamp not duplicates entry', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    const fileHash = sha256(Buffer.from('re-announce test'));
    await nodeA.announceFile(fileHash, 6000);
    await nodeA.announceFile(fileHash, 6000);

    const peers = await nodeA.getPeersForFile(fileHash);
    const matching = peers.filter(p => p.port === 6000);
    assert.equal(matching.length, 1);

    await nodeA.close();
  });

  it('peer entries expire once the seeder stops re-announcing', async () => {
    const store = new DHTNode();
    const seeder = new DHTNode();
    const finder = new DHTNode();
    await store.listen();
    await seeder.listen();
    await finder.listen();

    seeder.routingTable.addPeer({ id: store.nodeId, addr: '127.0.0.1', port: store.port });
    finder.routingTable.addPeer({ id: store.nodeId, addr: '127.0.0.1', port: store.port });

    const fileHash = sha256(Buffer.from('ttl expiry test'));
    await seeder.announceFile(fileHash, 6200);

    assert.ok((await finder.getPeersForFile(fileHash)).some(p => p.port === 6200), 'fresh announce is discoverable');

    // Simulate the seeder dying: age the announcement everywhere it is stored
    // (a live seeder would keep refreshing both via its re-announce timer).
    for (const node of [store, seeder]) {
      for (const peers of node.fileStore.values()) {
        for (const p of peers) p.announcedAt = Date.now() - PEER_TTL_MS - 1;
      }
    }

    const stale = await finder.getPeersForFile(fileHash);
    assert.equal(stale.filter(p => p.port === 6200).length, 0, 'expired announce is no longer served');
    assert.equal(store.fileStore.size, 0, 'store compacts fully-expired entries');

    await store.close();
    await seeder.close();
    await finder.close();
  });

  it('a re-announce within the TTL keeps the seeder discoverable', async () => {
    const store = new DHTNode();
    const seeder = new DHTNode();
    await store.listen();
    await seeder.listen();

    seeder.routingTable.addPeer({ id: store.nodeId, addr: '127.0.0.1', port: store.port });

    const fileHash = sha256(Buffer.from('ttl refresh test'));
    await seeder.announceFile(fileHash, 6300);

    // Age the entry close to expiry, then re-announce — the refreshed
    // timestamp must reset the clock.
    for (const peers of store.fileStore.values()) {
      for (const p of peers) p.announcedAt = Date.now() - PEER_TTL_MS + 1000;
    }
    await seeder.announceFile(fileHash, 6300);

    for (const peers of store.fileStore.values()) {
      for (const p of peers) {
        assert.ok(Date.now() - p.announcedAt < 5000, 're-announce refreshed the timestamp');
      }
    }

    await store.close();
    await seeder.close();
  });

  it('announce and getPeers work across a five node mesh', async () => {
    const nodes = [];
    for (let i = 0; i < 5; i++) {
      const n = new DHTNode();
      await n.listen();
      nodes.push(n);
    }

    for (let i = 0; i < nodes.length; i++) {
      const next = nodes[(i + 1) % nodes.length];
      nodes[i].routingTable.addPeer({ id: next.nodeId, addr: '127.0.0.1', port: next.port });
    }

    const fileHash = sha256(Buffer.from('mesh network file'));
    await nodes[0].announceFile(fileHash, 5500);

    const peers = await nodes[3].getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 5500));

    for (const n of nodes) await n.close();
  });
});