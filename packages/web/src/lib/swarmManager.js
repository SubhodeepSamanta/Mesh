import { sha256Hex, verifyChunk } from './browserCrypto.js';

export const MAX_CONSECUTIVE_FAILURES = 5;
const CHUNK_TIMEOUT = 30000;
const MAX_OUTSTANDING_GLOBAL = 20;
// Per-peer adaptive pipeline depth (§7): AIMD, same principle as TCP
// congestion control — grow the outstanding-request window on every
// verified chunk from a peer, halve it on any failure/timeout from that
// peer. A fast, reliable peer's window grows toward MAX_PIPELINE; a slow
// or lossy one settles at a smaller depth — instead of every peer sharing
// one fixed pipelineSize regardless of how well it's actually keeping up.
const MIN_PIPELINE = 2;
const MAX_PIPELINE = 32;

const P = 'pending';
const R = 'requested';
const V = 'verified';
const X = 'excluded';
const COMPACT_THRESHOLD = 1000;

export class SwarmManager extends EventTarget {
  constructor(totalChunks, merkleRoot, chunkSize, alreadyVerified = [], excludedChunks = []) {
    super();
    this.totalChunks = totalChunks;
    this.merkleRoot = merkleRoot;
    this.chunkSize = chunkSize;
    this.chunkState = new Array(totalChunks).fill(P);
    this.chunkPeer = new Array(totalChunks).fill(null);
    this.verifiedCount = 0;
    this.peers = new Map();
    this.done = false;
    this.aborted = false;
    this._chunkTimeouts = new Map();
    this._outstandingCount = 0;
    // Chunks belonging to files the receiver deselected before starting —
    // never enqueued, never requested from any peer (saves bandwidth rather
    // than just hiding the result at save time).
    this.excluded = new Set();

    const vs = new Set(alreadyVerified);
    for (const idx of vs) {
      if (idx >= 0 && idx < totalChunks && this.chunkState[idx] !== V) {
        this.chunkState[idx] = V;
        this.verifiedCount++;
      }
    }

    for (const idx of excludedChunks) {
      if (idx >= 0 && idx < totalChunks && this.chunkState[idx] !== V) {
        this.chunkState[idx] = X;
        this.excluded.add(idx);
      }
    }

    this.pendingQueue = [];
    for (let i = 0; i < totalChunks; i++) {
      if (this.chunkState[i] !== V && this.chunkState[i] !== X) this.pendingQueue.push(i);
    }
    this.queueHead = 0;

    // "Needed" excludes deselected chunks from the completion target — a
    // partial-manifest download is still a complete transfer once every
    // *selected* chunk has verified, not every chunk that ever existed.
    this.neededCount = totalChunks - this.excluded.size;

    if (totalChunks > 0 && this.verifiedCount === this.neededCount) {
      this.done = true;
    }
  }

  // Called once, before any peers are added, when a reload-resume preflight
  // (Stage C) has independently verified — via CHUNK_PROOF_REQUEST/CHUNK_PROOF,
  // proof-checked against this.merkleRoot — that specific chunks are already
  // correctly written to disk from before the reload. Unlike a chunk arriving
  // over the wire, this never dispatches 'chunkVerified' (there's no new data
  // to write; the caller is responsible for its own bookkeeping for these
  // indices) — only 'complete' if this finishes the transfer outright.
  markAlreadyVerified(indices) {
    let changed = false;
    for (const idx of indices) {
      if (idx < 0 || idx >= this.totalChunks) continue;
      if (this.chunkState[idx] === V || this.chunkState[idx] === X) continue;
      this.chunkState[idx] = V;
      this.verifiedCount++;
      changed = true;
    }
    if (!changed) return;
    this.pendingQueue = this.pendingQueue.filter((i) => this.chunkState[i] !== V);
    if (this.totalChunks > 0 && this.verifiedCount === this.neededCount && !this.done) {
      this.done = true;
      this.dispatchEvent(new CustomEvent('complete'));
    }
  }

  // Called once, before any peers are added (i.e. before the receiver clicks
  // "Begin Transfer"), to bake in a file-selection choice made after the
  // swarm was already constructed from the incoming FILE_OFFER.
  applySelection(excludedIndices) {
    let changed = false;
    for (const idx of excludedIndices) {
      if (idx < 0 || idx >= this.totalChunks) continue;
      if (this.chunkState[idx] === V || this.chunkState[idx] === X) continue;
      this.chunkState[idx] = X;
      this.excluded.add(idx);
      changed = true;
    }
    if (!changed) return;
    this.pendingQueue = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (this.chunkState[i] !== V && this.chunkState[i] !== X) this.pendingQueue.push(i);
    }
    this.queueHead = 0;
    this.neededCount = this.totalChunks - this.excluded.size;
    if (this.totalChunks > 0 && this.verifiedCount === this.neededCount && !this.done) {
      this.done = true;
      this.dispatchEvent(new CustomEvent('complete'));
    }
  }

  addPeer(peerId, requestChunkFn) {
    this.peers.set(peerId, {
      id: peerId,
      requestChunk: requestChunkFn,
      pending: new Set(),
      failed: false,
      consecutiveFailures: 0,
      chunksServed: 0,
      pipelineSize: MIN_PIPELINE,
      avgRttMs: null,
      requestedAt: new Map(),
    });
    this._fillPipeline(peerId);
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    for (const ci of peer.pending) {
      this._clearChunkTimeout(ci);
      if (this.chunkState[ci] === R) {
        this._outstandingCount--;
        this._requeueChunk(ci);
      }
    }
    this.peers.delete(peerId);
    this.dispatchEvent(new CustomEvent('peerRemoved', { detail: peerId }));
    for (const id of this.peers.keys()) this._fillPipeline(id);
  }

  abort() {
    this.aborted = true;
    for (const [ci, t] of this._chunkTimeouts) { clearTimeout(t); }
    this._chunkTimeouts.clear();
    this._outstandingCount = 0;
  }

  _markPeerFailed(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed) return;
    peer.failed = true;
    this.removePeer(peerId);
    this.dispatchEvent(new CustomEvent('peerFailed', { detail: { peerId, reason: 'too_many_consecutive_failures' } }));
  }

  _requeueChunk(idx) {
    this.chunkState[idx] = P;
    this.chunkPeer[idx] = null;
    this.pendingQueue.push(idx);
  }

  _compactQueue() {
    if (this.queueHead > COMPACT_THRESHOLD && this.queueHead > this.pendingQueue.length / 2) {
      this.pendingQueue = this.pendingQueue.slice(this.queueHead);
      this.queueHead = 0;
    }
  }

  _fillPipeline(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed || this.done || this.aborted) return;
    const peerCount = this.peers.size
    const effectivePipeline = Math.max(1, Math.min(peer.pipelineSize, Math.floor(MAX_OUTSTANDING_GLOBAL / Math.max(1, peerCount))))
    while (peer.pending.size < effectivePipeline && this.queueHead < this.pendingQueue.length && this._outstandingCount < MAX_OUTSTANDING_GLOBAL) {
      const i = this.pendingQueue[this.queueHead++];
      if (this.chunkState[i] !== P) continue;
      this.chunkState[i] = R;
      this.chunkPeer[i] = peerId;
      peer.pending.add(i);
      peer.requestedAt.set(i, Date.now());
      this._outstandingCount++;
      this._chunkTimeouts.set(i, setTimeout(() => this._handleChunkTimeout(peerId, i), CHUNK_TIMEOUT));
      const p = peer.requestChunk(i)
      if (p && typeof p.catch === 'function') p.catch(() => this._handleChunkFailure(peerId, i))
    }
    this._compactQueue();
  }

  _clearChunkTimeout(ci) {
    const t = this._chunkTimeouts.get(ci);
    if (t) { clearTimeout(t); this._chunkTimeouts.delete(ci); }
  }

  _handleChunkTimeout(peerId, ci) {
    this._chunkTimeouts.delete(ci);
    this._handleChunkFailure(peerId, ci);
  }

  _handleChunkFailure(peerId, ci) {
    this._clearChunkTimeout(ci);
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pending.delete(ci);
      peer.requestedAt.delete(ci);
      peer.consecutiveFailures++;
      // Multiplicative decrease — a timeout or bad chunk is a signal this
      // peer (or the path to it) can't sustain as many outstanding requests.
      peer.pipelineSize = Math.max(MIN_PIPELINE, Math.floor(peer.pipelineSize / 2));
    }
    if (this.chunkState[ci] === R) {
      this._outstandingCount--;
      this._requeueChunk(ci);
    }
    if (peer && peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this._markPeerFailed(peerId);
      return;
    }
    if (peer) this._fillPipeline(peerId);
  }

  async onChunkReceived(peerId, ci, data, expectedHash, proof) {
    this._clearChunkTimeout(ci);
    if (this.aborted) return false;
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    const wasPending = peer.pending.has(ci)
    peer.pending.delete(ci);
    if (wasPending) this._outstandingCount--;
    if (this.chunkState[ci] === V) {
      this._fillPipeline(peerId);
      return true;
    }
    const actualHash = await sha256Hex(data);
    if (this.aborted) return false;
    if (actualHash !== expectedHash) {
      peer.consecutiveFailures++;
      this.dispatchEvent(new CustomEvent('chunkFailed', { detail: { peerId, chunkIndex: ci, reason: 'hash_mismatch' } }));
      this._requeueChunk(ci);
      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }
    // Proof against the trusted merkleRoot is mandatory for every chunk, including
    // single-chunk files — otherwise a malicious peer can supply data alongside a
    // self-reported hash that trivially matches, bypassing integrity checks entirely.
    if (!proof || !Array.isArray(proof)) {
      peer.consecutiveFailures++;
      this.dispatchEvent(new CustomEvent('chunkFailed', { detail: { peerId, chunkIndex: ci, reason: 'missing_proof' } }));
      this._requeueChunk(ci);
      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }
    if (!(await verifyChunk(data, proof, this.merkleRoot))) {
      peer.consecutiveFailures++;
      this.dispatchEvent(new CustomEvent('chunkFailed', { detail: { peerId, chunkIndex: ci, reason: 'proof_invalid' } }));
      this._requeueChunk(ci);
      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }
    const requestedAt = peer.requestedAt.get(ci);
    peer.requestedAt.delete(ci);
    if (requestedAt != null) {
      const rtt = Date.now() - requestedAt;
      peer.avgRttMs = peer.avgRttMs == null ? rtt : peer.avgRttMs * 0.75 + rtt * 0.25;
    }
    // Additive increase — a clean verify is a signal this peer can sustain
    // (at least) one more outstanding request.
    peer.pipelineSize = Math.min(MAX_PIPELINE, peer.pipelineSize + 1);

    peer.consecutiveFailures = 0;
    this.chunkState[ci] = V;
    this.verifiedCount++;
    peer.chunksServed++;
    this.dispatchEvent(new CustomEvent('chunkVerified', {
      detail: { peerId, chunkIndex: ci, chunkData: data, total: this.neededCount, verified: this.verifiedCount }
    }));
    if (this.verifiedCount === this.neededCount) {
      this.done = true;
      this.dispatchEvent(new CustomEvent('complete'));
    } else {
      this._fillPipeline(peerId);
    }
    return true;
  }

  progress() {
    return {
      verified: this.verifiedCount,
      total: this.neededCount,
      percent: this.neededCount > 0 ? (this.verifiedCount / this.neededCount) * 100 : 100,
    };
  }

  getVerifiedChunkIndices() {
    const out = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (this.chunkState[i] === V) out.push(i);
    }
    return out;
  }

  getPeerStats() {
    return [...this.peers.values()].map(p => ({
      id: p.id,
      pending: p.pending.size,
      chunksServed: p.chunksServed,
      failed: p.failed,
      consecutiveFailures: p.consecutiveFailures,
      pipelineSize: p.pipelineSize,
      avgRttMs: p.avgRttMs,
    }));
  }

  isComplete() {
    return this.done;
  }
}
