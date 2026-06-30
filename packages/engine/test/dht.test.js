import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateNodeId,
  xorDistance,
  compareDistance,
  bucketIndex,
  RoutingTable,
  ID_BYTES,
  DHT_K,
} from '../src/dht.js';

describe('dht node id', () => {
  it('generates a 20 byte hex node id', () => {
    const id = generateNodeId();
    assert.equal(id.length, ID_BYTES * 2);
    assert.match(id, /^[0-9a-f]+$/);
  });

  it('generates different ids each time', () => {
    const id1 = generateNodeId();
    const id2 = generateNodeId();
    assert.notEqual(id1, id2);
  });
});

describe('xor distance', () => {
  it('distance from a node to itself is zero', () => {
    const id = generateNodeId();
    const dist = xorDistance(id, id);
    assert.ok(dist.every(byte => byte === 0));
  });

  it('distance is symmetric', () => {
    const idA = generateNodeId();
    const idB = generateNodeId();
    const distAB = xorDistance(idA, idB);
    const distBA = xorDistance(idB, idA);
    assert.deepEqual(distAB, distBA);
  });

  it('different ids produce nonzero distance', () => {
    const idA = generateNodeId();
    const idB = generateNodeId();
    const dist = xorDistance(idA, idB);
    assert.ok(dist.some(byte => byte !== 0));
  });

  it('throws on malformed node id length', () => {
    assert.throws(() => xorDistance('abc', generateNodeId()));
  });
});

describe('compare distance', () => {
  it('returns 0 for equal distances', () => {
    const id = generateNodeId();
    const dist = xorDistance(id, id);
    assert.equal(compareDistance(dist, dist), 0);
  });

  it('correctly orders by first differing byte', () => {
    const distA = Buffer.from('00'.repeat(19) + '01', 'hex');
    const distB = Buffer.from('00'.repeat(19) + '02', 'hex');
    assert.ok(compareDistance(distA, distB) < 0);
    assert.ok(compareDistance(distB, distA) > 0);
  });

  it('most significant byte dominates comparison', () => {
    const distA = Buffer.from('01' + 'ff'.repeat(19), 'hex');
    const distB = Buffer.from('02' + '00'.repeat(19), 'hex');
    assert.ok(compareDistance(distA, distB) < 0);
  });
});

describe('bucket index', () => {
  it('identical ids fall in the last bucket', () => {
    const id = generateNodeId();
    assert.equal(bucketIndex(id, id), ID_BYTES * 8 - 1);
  });

  it('ids differing only in the last bit fall in bucket 0', () => {
    const myId = '00'.repeat(ID_BYTES);
    const peerId = '00'.repeat(ID_BYTES - 1) + '01';
    assert.equal(bucketIndex(myId, peerId), 159);
  });

  it('ids differing in the first bit fall in bucket 0', () => {
    const myId = '00'.repeat(ID_BYTES);
    const peerId = '80' + '00'.repeat(ID_BYTES - 1);
    assert.equal(bucketIndex(myId, peerId), 0);
  });
});

describe('routing table', () => {
  it('does not add self', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    const added = table.addPeer({ id: myId, addr: '127.0.0.1', port: 9000 });
    assert.equal(added, false);
    assert.equal(table.size(), 0);
  });

  it('adds a peer successfully', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    const peerId = generateNodeId();
    const added = table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9001 });
    assert.equal(added, true);
    assert.equal(table.size(), 1);
  });

  it('updates lastSeen when adding an existing peer again', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    const peerId = generateNodeId();
    table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9001 });
    const idx = bucketIndex(myId, peerId);
    const firstSeen = table.getBucket(idx)[0].lastSeen;

    table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9001 });
    const secondSeen = table.getBucket(idx)[0].lastSeen;

    assert.ok(secondSeen >= firstSeen);
    assert.equal(table.size(), 1);
  });

it('rejects new peer when bucket is full', () => {
  const myId = '00'.repeat(ID_BYTES);
  const table = new RoutingTable(myId);

  for (let i = 0; i < DHT_K; i++) {
    const peerId = '80' + i.toString(16).padStart(2, '0') + '00'.repeat(ID_BYTES - 2);
    table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9000 + i });
  }
  assert.equal(table.getBucket(0).length, DHT_K);

  const overflowId = '80ff' + '00'.repeat(ID_BYTES - 2);
  const added = table.addPeer({ id: overflowId, addr: '127.0.0.1', port: 9999 });
  assert.equal(added, false);
  assert.equal(table.getBucket(0).length, DHT_K);
});

  it('removes a peer', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    const peerId = generateNodeId();
    table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9001 });
    assert.equal(table.size(), 1);
    const removed = table.removePeer(peerId);
    assert.equal(removed, true);
    assert.equal(table.size(), 0);
  });

  it('getClosest returns peers sorted by XOR distance to target', () => {
    const myId = '00'.repeat(ID_BYTES);
    const table = new RoutingTable(myId);

    const peerNear = '00'.repeat(ID_BYTES - 1) + '01';
    const peerFar  = 'ff'.repeat(ID_BYTES);
    const peerMid  = '0f'.repeat(ID_BYTES);

    table.addPeer({ id: peerFar,  addr: '1.1.1.1', port: 1 });
    table.addPeer({ id: peerNear, addr: '1.1.1.2', port: 2 });
    table.addPeer({ id: peerMid,  addr: '1.1.1.3', port: 3 });

    const target = '00'.repeat(ID_BYTES);
    const closest = table.getClosest(target, 3);

    assert.equal(closest[0].id, peerNear);
    assert.equal(closest[2].id, peerFar);
  });

  it('getClosest respects count limit', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    for (let i = 0; i < 10; i++) {
      table.addPeer({ id: generateNodeId(), addr: '127.0.0.1', port: 9000 + i });
    }
    const closest = table.getClosest(generateNodeId(), 5);
    assert.equal(closest.length, 5);
  });
});