import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { verifyChunk } from './crypto.js';
import { computeSwarmPipelineDepth, DEFAULT_CHUNK_SIZE } from './chunker.js';

export const PIPELINE_SIZE = 16;
export const MAX_CONSECUTIVE_FAILURES = 5;

const CHUNK_STATE = {
  PENDING:   'pending',
  REQUESTED: 'requested',
  VERIFIED:  'verified',
};

export class SwarmManager extends EventEmitter {
  constructor(totalChunks, merkleRoot, chunkSize = DEFAULT_CHUNK_SIZE) {
    super();
    this.totalChunks   = totalChunks;
    this.merkleRoot    = merkleRoot;
    this.chunkSize     = chunkSize;
    this.pipelineSize  = computeSwarmPipelineDepth(chunkSize);
    this.chunkState    = new Array(totalChunks).fill(CHUNK_STATE.PENDING);
    this.chunkPeer     = new Array(totalChunks).fill(null);
    this.pendingQueue  = Array.from({ length: totalChunks }, (_, i) => i);
    this.queueHead     = 0;
    this.verifiedCount = 0;
    this.peers         = new Map();
    this.done          = false;
  }

  addPeer(peerId, requestChunkFn) {
    this.peers.set(peerId, {
      id: peerId,
      requestChunk: requestChunkFn,
      pending: new Set(),
      failed: false,
      consecutiveFailures: 0,
      chunksServed: 0,
    });
    this._fillPipeline(peerId);
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    for (const chunkIdx of peer.pending) {
      if (this.chunkState[chunkIdx] === CHUNK_STATE.REQUESTED) {
        this._requeueChunk(chunkIdx);
      }
    }

    this.peers.delete(peerId);
    this.emit('peerRemoved', peerId);

    for (const id of this.peers.keys()) {
      this._fillPipeline(id);
    }
  }

  _markPeerFailed(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed) return;
    peer.failed = true;
    this.removePeer(peerId);
    this.emit('peerFailed', { peerId, reason: 'too_many_consecutive_failures' });
  }

  _requeueChunk(chunkIndex) {
    this.chunkState[chunkIndex] = CHUNK_STATE.PENDING;
    this.chunkPeer[chunkIndex] = null;
    this.pendingQueue.push(chunkIndex);
  }

  _fillPipeline(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed || this.done) return;

    while (peer.pending.size < this.pipelineSize && this.queueHead < this.pendingQueue.length) {
      const i = this.pendingQueue[this.queueHead++];
      if (this.chunkState[i] !== CHUNK_STATE.PENDING) continue;

      this.chunkState[i] = CHUNK_STATE.REQUESTED;
      this.chunkPeer[i]  = peerId;
      peer.pending.add(i);

      peer.requestChunk(i).catch(() => {
        this._handleChunkFailure(peerId, i);
      });
    }
  }

  _handleChunkFailure(peerId, chunkIndex) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pending.delete(chunkIndex);
      peer.consecutiveFailures++;
    }

    if (this.chunkState[chunkIndex] === CHUNK_STATE.REQUESTED) {
      this._requeueChunk(chunkIndex);
    }

    if (peer && peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this._markPeerFailed(peerId);
      return;
    }

    if (peer) this._fillPipeline(peerId);
  }

  onChunkReceived(peerId, chunkIndex, chunkData, expectedHash, proof) {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    peer.pending.delete(chunkIndex);

    if (this.chunkState[chunkIndex] === CHUNK_STATE.VERIFIED) {
      this._fillPipeline(peerId);
      return true;
    }

    const actualHash = createHash('sha256').update(chunkData).digest('hex');
    if (actualHash !== expectedHash) {
      peer.consecutiveFailures++;
      this.emit('chunkFailed', { peerId, chunkIndex, reason: 'hash_mismatch' });
      this._requeueChunk(chunkIndex);

      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }

    if (proof && !verifyChunk(chunkData, proof, this.merkleRoot)) {
      peer.consecutiveFailures++;
      this.emit('chunkFailed', { peerId, chunkIndex, reason: 'proof_invalid' });
      this._requeueChunk(chunkIndex);

      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }

    peer.consecutiveFailures = 0;
    this.chunkState[chunkIndex] = CHUNK_STATE.VERIFIED;
    this.verifiedCount++;
    peer.chunksServed++;

    this.emit('chunkVerified', {
      peerId, chunkIndex, chunkData,
      total: this.totalChunks,
      verified: this.verifiedCount,
    });

    if (this.verifiedCount === this.totalChunks) {
      this.done = true;
      this.emit('complete');
    } else {
      this._fillPipeline(peerId);
    }

    return true;
  }

  getProgress() {
    return {
      verified: this.verifiedCount,
      total: this.totalChunks,
      percent: (this.verifiedCount / this.totalChunks) * 100,
    };
  }

  getPeerStats() {
    return [...this.peers.values()].map(p => ({
      id: p.id,
      pending: p.pending.size,
      chunksServed: p.chunksServed,
      failed: p.failed,
      consecutiveFailures: p.consecutiveFailures,
    }));
  }

  isComplete() {
    return this.done;
  }
}