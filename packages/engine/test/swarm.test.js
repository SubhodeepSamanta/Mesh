import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'crypto';
import { SwarmManager } from '../src/swarm.js';
import { buildMerkleTree, getMerkleProof, sha256 } from '../src/crypto.js';
import { assembleChunks } from '../src/chunker.js';

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

    const collected = new Map();
    swarm.on('chunkVerified', ({ chunkIndex, chunkData }) => {
      collected.set(chunkIndex, chunkData);
    });

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const assembled = assembleChunks(collected, 5);
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

    assert.ok(maxPending <= swarm.pipelineSize);
  });

  it('scales pipeline depth down for large chunk sizes', async () => {
    const { merkleRoot } = buildTestFile(100);
    const largeChunkSwarm = new SwarmManager(100, merkleRoot, 32 * 1024 * 1024);

    assert.ok(largeChunkSwarm.pipelineSize < 16);
    assert.ok(largeChunkSwarm.pipelineSize >= 4);
  });
it('resumes with pre-verified chunks skipped and not re-requested', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(10);
    const requested = [];
    const swarm = new SwarmManager(10, merkleRoot, 1024, [0, 1, 2]);

    assert.equal(swarm.getProgress().verified, 3);

    swarm.addPeer('peerA', (idx) => {
      requested.push(idx);
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.equal(swarm.isComplete(), true);
    assert.ok(!requested.includes(0));
    assert.ok(!requested.includes(1));
    assert.ok(!requested.includes(2));
    assert.equal(requested.length, 7);
  });

  it('reports already complete immediately when all chunks are pre-verified', () => {
    const { merkleRoot } = buildTestFile(5);
    const swarm = new SwarmManager(5, merkleRoot, 1024, [0, 1, 2, 3, 4]);
    assert.equal(swarm.isComplete(), true);
    assert.equal(swarm.getProgress().verified, 5);
  });

  it('getVerifiedChunkIndices returns exactly the verified set', async () => {
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

    const verified = swarm.getVerifiedChunkIndices();
    assert.deepEqual(verified.sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  it('abort() stops issuing new chunk requests but keeps prior state', async () => {
    const { merkleRoot } = buildTestFile(50);
    const swarm = new SwarmManager(50, merkleRoot);

    let requestCount = 0;
    swarm.addPeer('peerA', () => {
      requestCount++;
      return new Promise(() => {});
    });

    const countAfterStart = requestCount;
    swarm.abort();
    swarm.addPeer('peerB', () => {
      requestCount++;
      return new Promise(() => {});
    });

    assert.equal(requestCount, countAfterStart);
  });

  it('compacts pendingQueue after heavy retries instead of growing unboundedly', async () => {
    const { merkleRoot } = buildTestFile(2000, 16);
    const swarm = new SwarmManager(2000, merkleRoot, 16);

    let calls = 0;
    swarm.addPeer('flakyPeer', () => {
      calls++;
      if (calls < 5000) {
        return Promise.reject(new Error('simulated failure'));
      }
      return new Promise(() => {});
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.ok(swarm.pendingQueue.length < 20000, `pendingQueue grew to ${swarm.pendingQueue.length}, compaction likely not working`);
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

  it('marks a peer as failed after too many consecutive chunk failures', async () => {
    const { merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    const failedEvents = [];
    swarm.on('peerFailed', (e) => failedEvents.push(e));

    swarm.addPeer('badPeer', () => Promise.reject(new Error('always fails')));

    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(failedEvents.length, 1);
    assert.equal(failedEvents[0].peerId, 'badPeer');
    assert.equal(swarm.peers.has('badPeer'), false);
  });

  it('recovers and completes when a bad peer is replaced by a good one', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    swarm.addPeer('badPeer', () => Promise.reject(new Error('always fails')));

    swarm.addPeer('goodPeer', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('goodPeer', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.equal(swarm.isComplete(), true);
  });

  it('peers.size reflects the failed peer being removed by the time peerFailed fires', async () => {
    const { merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    swarm.addPeer('onlyPeer', () => Promise.reject(new Error('always fails')));

    const result = await new Promise((resolve) => {
      swarm.on('complete', () => resolve('complete'));
      swarm.on('peerFailed', () => {
        if (swarm.peers.size === 0 && !swarm.isComplete()) {
          resolve('all_failed_detected');
        } else {
          resolve(`race_bug_size_${swarm.peers.size}`);
        }
      });
    });

    assert.equal(result, 'all_failed_detected');
  });

  it('handles a large number of chunks efficiently without O(n^2) blowup', { timeout: 20000 }, async () => {
    const numChunks = 50000;
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(numChunks, 16);
    const swarm = new SwarmManager(numChunks, merkleRoot);

    const start = Date.now();

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const elapsedMs = Date.now() - start;
    assert.equal(swarm.isComplete(), true);
    assert.ok(
      elapsedMs < 10000,
      `expected the pipeline to fill in under 10s, took ${elapsedMs}ms — possible O(n^2) regression in _fillPipeline`
    );
  });
});