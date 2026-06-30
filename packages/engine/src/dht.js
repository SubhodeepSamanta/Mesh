import { randomBytes } from 'crypto';

export const DHT_K = 20;
export const ID_BYTES = 20;

export function generateNodeId() {
  return randomBytes(ID_BYTES).toString('hex');
}

export function xorDistance(idA, idB) {
  const a = Buffer.from(idA, 'hex');
  const b = Buffer.from(idB, 'hex');
  if (a.length !== ID_BYTES || b.length !== ID_BYTES) {
    throw new Error('Node IDs must be 20 bytes');
  }
  const result = Buffer.allocUnsafe(ID_BYTES);
  for (let i = 0; i < ID_BYTES; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

export function compareDistance(distA, distB) {
  for (let i = 0; i < ID_BYTES; i++) {
    if (distA[i] !== distB[i]) return distA[i] - distB[i];
  }
  return 0;
}

export function bucketIndex(myId, peerId) {
  const dist = xorDistance(myId, peerId);
  for (let byteIdx = 0; byteIdx < ID_BYTES; byteIdx++) {
    if (dist[byteIdx] === 0) continue;
    for (let bit = 7; bit >= 0; bit--) {
      if ((dist[byteIdx] >> bit) & 1) {
        return byteIdx * 8 + (7 - bit);
      }
    }
  }
  return ID_BYTES * 8 - 1;
}

export class RoutingTable {
  constructor(myId) {
    this.myId = myId;
    this.buckets = Array.from({ length: ID_BYTES * 8 }, () => []);
  }

  addPeer(peer) {
    if (peer.id === this.myId) return false;

    const idx = bucketIndex(this.myId, peer.id);
    const bucket = this.buckets[idx];
    const existingIdx = bucket.findIndex(p => p.id === peer.id);

    if (existingIdx !== -1) {
      bucket.splice(existingIdx, 1);
      bucket.push({ ...peer, lastSeen: Date.now() });
      return true;
    }

    if (bucket.length < DHT_K) {
      bucket.push({ ...peer, lastSeen: Date.now() });
      return true;
    }

    return false;
  }

  removePeer(peerId) {
    const idx = bucketIndex(this.myId, peerId);
    const bucket = this.buckets[idx];
    const existingIdx = bucket.findIndex(p => p.id === peerId);
    if (existingIdx !== -1) {
      bucket.splice(existingIdx, 1);
      return true;
    }
    return false;
  }

  getBucket(idx) {
    return this.buckets[idx];
  }

  getAllPeers() {
    return this.buckets.flat();
  }

  getClosest(targetId, count = DHT_K) {
    const all = this.getAllPeers();
    return all
      .map(peer => ({ peer, dist: xorDistance(peer.id, targetId) }))
      .sort((a, b) => compareDistance(a.dist, b.dist))
      .slice(0, count)
      .map(x => x.peer);
  }

  size() {
    return this.getAllPeers().length;
  }
}