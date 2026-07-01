import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DHTNode, generateNodeId } from '../src/dht.js';

describe('dht node networking', () => {
  it('two nodes can ping each other', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    const result = await nodeA.ping('127.0.0.1', nodeB.port);
    assert.equal(result.type, 'DHT_PONG');
    assert.equal(result.nodeId, nodeB.nodeId);

    await nodeA.close();
    await nodeB.close();
  });

  it('ping adds the responding peer to routing table', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    await nodeA.ping('127.0.0.1', nodeB.port);
    await new Promise(r => setTimeout(r, 50));

    const peers = nodeA.routingTable.getAllPeers();
    assert.equal(peers.length, 1);
    assert.equal(peers[0].id, nodeB.nodeId);

    await nodeA.close();
    await nodeB.close();
  });

  it('ping times out for unreachable peer', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    await assert.rejects(
      () => nodeA.ping('127.0.0.1', 1),
      /timeout/
    );

    await nodeA.close();
  });

  it('findNode returns closest known peers from target node', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    const nodeC = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();
    await nodeC.listen();

    nodeB.routingTable.addPeer({ id: nodeC.nodeId, addr: '127.0.0.1', port: nodeC.port });

    const closest = await nodeA.findNode('127.0.0.1', nodeB.port, nodeC.nodeId);
    assert.ok(closest.some(p => p.id === nodeC.nodeId));

    await nodeA.close();
    await nodeB.close();
    await nodeC.close();
  });
it('survives a valid-JSON packet with a malformed nodeId without crashing', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    const dgram = await import('dgram');
    const sender = dgram.default.createSocket('udp4');
    const badPacket = Buffer.from(JSON.stringify({
      type: 'DHT_PING', msgId: 'aaaa', nodeId: 'not-a-valid-hex-id',
    }));
    sender.send(badPacket, nodeA.port, '127.0.0.1');

    await new Promise(r => setTimeout(r, 100));

    const stillAlive = await nodeA.ping('127.0.0.1', nodeA.port).catch(() => 'survived');
    assert.ok(stillAlive);

    sender.close();
    await nodeA.close();
  });

  it('survives a FIND_NODE with a malformed targetId without crashing', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    const dgram = await import('dgram');
    const sender = dgram.default.createSocket('udp4');
    const badPacket = Buffer.from(JSON.stringify({
      type: 'DHT_FIND_NODE', msgId: 'bbbb', nodeId: nodeB.nodeId, targetId: 'short',
    }));
    sender.send(badPacket, nodeA.port, '127.0.0.1');

    await new Promise(r => setTimeout(r, 100));

    const stillAlive = await nodeA.ping('127.0.0.1', nodeA.port).catch(() => 'survived');
    assert.ok(stillAlive);

    sender.close();
    await nodeA.close();
    await nodeB.close();
  });
  it('bootstrap joins the network and populates routing table', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    nodeB.routingTable.addPeer({ id: nodeA.nodeId, addr: '127.0.0.1', port: nodeA.port });

    await nodeA.bootstrap('127.0.0.1', nodeB.port);
    await new Promise(r => setTimeout(r, 50));

    const peers = nodeA.routingTable.getAllPeers();
    assert.ok(peers.some(p => p.id === nodeB.nodeId));

    await nodeA.close();
    await nodeB.close();
  });

  it('iterativeFindNode converges and finds a target across three nodes', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    const nodeC = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();
    await nodeC.listen();

    nodeA.routingTable.addPeer({ id: nodeB.nodeId, addr: '127.0.0.1', port: nodeB.port });
    nodeB.routingTable.addPeer({ id: nodeC.nodeId, addr: '127.0.0.1', port: nodeC.port });

    const result = await nodeA.iterativeFindNode(nodeC.nodeId);
    assert.ok(result.some(p => p.id === nodeC.nodeId));

    await nodeA.close();
    await nodeB.close();
    await nodeC.close();
  });

it('iterativeFindNode handles a five node chain', { timeout: 15000 }, async () => {
  const nodes = [];
  for (let i = 0; i < 5; i++) {
    const n = new DHTNode();
    await n.listen();
    nodes.push(n);
  }

  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].routingTable.addPeer({
      id: nodes[i + 1].nodeId, addr: '127.0.0.1', port: nodes[i + 1].port,
    });
  }

  const target = nodes[4].nodeId;
  const result = await nodes[0].iterativeFindNode(target);
  assert.ok(result.some(p => p.id === target));

  for (const n of nodes) await n.close();
});

  it('handles malformed UDP packets without crashing', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    const dgram = await import('dgram');
    const sender = dgram.default.createSocket('udp4');
    sender.send(Buffer.from('not valid json {{{'), nodeA.port, '127.0.0.1');

    await new Promise(r => setTimeout(r, 100));

    const stillAlive = await nodeA.ping('127.0.0.1', nodeA.port).catch(() => 'survived');
    assert.ok(stillAlive);

    sender.close();
    await nodeA.close();
  });
});