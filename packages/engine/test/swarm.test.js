import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'crypto';
import { SwarmManager } from '../src/swarm.js';
import { buildMerkleTree, getMerkleProof, sha256 } from '../src/crypto.js';

function buildTestFile(numChunks, chunkSize = 1024) {
  const chunks = [];
  const hashes = [];
  for (let i = 0; i < numChunks; i++) {
    const chunk = randomBytes(chunkSize);
    chunks.push(chunk);
    hashes.push(sha256(chunk));
  }
  const tree = buildMerkleTree(hashes);
  return { chunks, hashes, tree, merkleRoot: tree.root };
}

function mockPeer(chunks, hashes, tree, opts = {}) {
  const { failRate = 0, delay = 0 } = opts;
  return (chunkIndex) => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() < failRate) {
          reject(new Error('mock peer failure'));
          return;
        }
        resolve();
      }, delay);
    });
  };
}

describe('swarm manager', () => {
  it('completes a transfer with a single reliable peer', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    let completed = false;
    swarm.on('complete', () => { completed = true; });

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => {
      swarm.on('complete', resolve);
    });

    assert.equal(completed, true);
    assert.equal(swarm.isComplete(), true);
    assert.equal(swarm.getProgress().verified, 10);
  });

  it('assembled buffer matches original chunks in order', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(5);
    const swarm = new SwarmManager(5, merkleRoot);

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const assembled = swarm.assemble();
    const expected = Buffer.concat(chunks);
    assert.deepEqual(assembled, expected);
  });

  it('distributes chunks across multiple peers', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(20);
    const swarm = new SwarmManager(20, merkleRoot);

    const servedBy = { peerA: 0, peerB: 0 };

    const makeHandler = (peerId) => (idx) => {
      setImmediate(() => {
        servedBy[peerId]++;
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived(peerId, idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    };

    swarm.addPeer('peerA', makeHandler('peerA'));
    swarm.addPeer('peerB', makeHandler('peerB'));

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.equal(servedBy.peerA + servedBy.peerB, 20);
    assert.ok(servedBy.peerA > 0);
    assert.ok(servedBy.peerB > 0);
  });

  it('rejects a chunk with wrong hash and re-requests it', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(3);
    const swarm = new SwarmManager(3, merkleRoot);

    let attempt = 0;
    const failedEvents = [];
    swarm.on('chunkFailed', (e) => failedEvents.push(e));

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        attempt++;
        if (idx === 0 && attempt === 1) {
          swarm.onChunkReceived('peerA', idx, Buffer.from('wrong data'), hashes[idx], null);
        } else {
          const proof = getMerkleProof(tree, idx);
          swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
        }
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.ok(failedEvents.some(e => e.reason === 'hash_mismatch'));
    assert.equal(swarm.isComplete(), true);
  });

  it('re-queues chunks when a peer is removed mid-transfer', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    swarm.addPeer('peerA', () => new Promise(() => {}));
    swarm.addPeer('peerB', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerB', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    swarm.removePeer('peerA');

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.equal(swarm.isComplete(), true);
  });

  it('does not exceed pipeline size per peer', async () => {
    const { merkleRoot } = buildTestFile(100);
    const swarm = new SwarmManager(100, merkleRoot);

    let maxPending = 0;
    swarm.addPeer('peerA', () => {
      const peer = swarm.peers.get('peerA');
      maxPending = Math.max(maxPending, peer.pending.size);
      return new Promise(() => {});
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    assert.ok(maxPending <= 16);
  });

  it('getProgress reports correct percentage', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(4);
    const swarm = new SwarmManager(4, merkleRoot);

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const progress = swarm.getProgress();
    assert.equal(progress.percent, 100);
  });

  it('getPeerStats reports chunks served per peer', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(6);
    const swarm = new SwarmManager(6, merkleRoot);

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const stats = swarm.getPeerStats();
    assert.equal(stats.length, 1);
    assert.equal(stats[0].chunksServed, 6);
  });

  it('assemble throws if called before completion', () => {
    const { merkleRoot } = buildTestFile(5);
    const swarm = new SwarmManager(5, merkleRoot);
    assert.throws(() => swarm.assemble(), /not complete/);
  });
});