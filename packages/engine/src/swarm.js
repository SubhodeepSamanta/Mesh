import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { verifyChunk } from './crypto.js';

export const PIPELINE_SIZE = 16;

const CHUNK_STATE = {
  PENDING:   'pending',
  REQUESTED: 'requested',
  VERIFIED:  'verified',
};

export class SwarmManager extends EventEmitter {
  constructor(totalChunks, merkleRoot) {
    super();
    this.totalChunks = totalChunks;
    this.merkleRoot  = merkleRoot;
    this.chunkState  = new Array(totalChunks).fill(CHUNK_STATE.PENDING);
    this.chunkPeer   = new Array(totalChunks).fill(null);
    this.received    = new Map();
    this.peers       = new Map();
    this.done        = false;
  }

  addPeer(peerId, requestChunkFn) {
    this.peers.set(peerId, {
      id: peerId,
      requestChunk: requestChunkFn,
      pending: new Set(),
      failed: false,
      chunksServed: 0,
    });
    this._fillPipeline(peerId);
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    for (const chunkIdx of peer.pending) {
      if (this.chunkState[chunkIdx] === CHUNK_STATE.REQUESTED) {
        this.chunkState[chunkIdx] = CHUNK_STATE.PENDING;
        this.chunkPeer[chunkIdx] = null;
      }
    }

    this.peers.delete(peerId);
    this.emit('peerRemoved', peerId);

    for (const id of this.peers.keys()) {
      this._fillPipeline(id);
    }
  }

  _fillPipeline(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed || this.done) return;

    for (let i = 0; i < this.totalChunks; i++) {
      if (peer.pending.size >= PIPELINE_SIZE) break;
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
    if (peer) peer.pending.delete(chunkIndex);

    if (this.chunkState[chunkIndex] === CHUNK_STATE.REQUESTED) {
      this.chunkState[chunkIndex] = CHUNK_STATE.PENDING;
      this.chunkPeer[chunkIndex] = null;
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
      this.emit('chunkFailed', { peerId, chunkIndex, reason: 'hash_mismatch' });
      this.chunkState[chunkIndex] = CHUNK_STATE.PENDING;
      this.chunkPeer[chunkIndex] = null;
      this._fillPipeline(peerId);
      return false;
    }

    if (proof && !verifyChunk(chunkData, proof, this.merkleRoot)) {
      this.emit('chunkFailed', { peerId, chunkIndex, reason: 'proof_invalid' });
      this.chunkState[chunkIndex] = CHUNK_STATE.PENDING;
      this.chunkPeer[chunkIndex] = null;
      this._fillPipeline(peerId);
      return false;
    }

    this.chunkState[chunkIndex] = CHUNK_STATE.VERIFIED;
    this.received.set(chunkIndex, chunkData);
    peer.chunksServed++;

    this.emit('chunkVerified', { peerId, chunkIndex, total: this.totalChunks, verified: this.received.size });

    if (this.received.size === this.totalChunks) {
      this.done = true;
      this.emit('complete');
    } else {
      this._fillPipeline(peerId);
    }

    return true;
  }

  getProgress() {
    return {
      verified: this.received.size,
      total: this.totalChunks,
      percent: (this.received.size / this.totalChunks) * 100,
    };
  }

  getPeerStats() {
    return [...this.peers.values()].map(p => ({
      id: p.id,
      pending: p.pending.size,
      chunksServed: p.chunksServed,
      failed: p.failed,
    }));
  }

  isComplete() {
    return this.done;
  }

  assemble() {
    if (!this.done) throw new Error('Transfer not complete');
    const ordered = [];
    for (let i = 0; i < this.totalChunks; i++) {
      ordered.push(this.received.get(i));
    }
    return Buffer.concat(ordered);
  }
}