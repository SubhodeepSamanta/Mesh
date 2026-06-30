import { randomBytes } from 'crypto';
import dgram from 'dgram';
import { EventEmitter } from 'events';

export const DHT_K = 20;
export const ID_BYTES = 20;
export const ALPHA = 3;
export const REQUEST_TIMEOUT_MS = 3000;

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

export const DHT_MSG = {
  PING:        'DHT_PING',
  PONG:        'DHT_PONG',
  FIND_NODE:   'DHT_FIND_NODE',
  FOUND_NODE:  'DHT_FOUND_NODE',
};

export class DHTNode extends EventEmitter {
  constructor(nodeId = generateNodeId()) {
    super();
    this.nodeId = nodeId;
    this.routingTable = new RoutingTable(nodeId);
    this.socket = dgram.createSocket('udp4');
    this.pending = new Map();
    this.port = null;
    this.address = null;
  }

  listen(port = 0) {
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(port, () => {
        const addr = this.socket.address();
        this.port = addr.port;
        this.address = addr.address;
        this.socket.removeListener('error', reject);
        this.socket.on('message', (msg, rinfo) => this._handleMessage(msg, rinfo));
        this.socket.on('error', (e) => this.emit('error', e));
        resolve(addr);
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      this.socket.close(resolve);
    });
  }

  _msgId() {
    return randomBytes(4).toString('hex');
  }

  _send(addr, port, obj) {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    return new Promise((resolve, reject) => {
      this.socket.send(buf, port, addr, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  _handleMessage(msgBuf, rinfo) {
    let msg;
    try {
      msg = JSON.parse(msgBuf.toString('utf8'));
    } catch {
      return;
    }

    if (msg.nodeId && msg.nodeId !== this.nodeId) {
      this.routingTable.addPeer({ id: msg.nodeId, addr: rinfo.address, port: rinfo.port });
    }

    if (msg.type === DHT_MSG.PING) {
      this._send(rinfo.address, rinfo.port, {
        type: DHT_MSG.PONG, msgId: msg.msgId, nodeId: this.nodeId,
      });
      return;
    }

    if (msg.type === DHT_MSG.FIND_NODE) {
      const closest = this.routingTable.getClosest(msg.targetId, DHT_K);
      this._send(rinfo.address, rinfo.port, {
        type: DHT_MSG.FOUND_NODE,
        msgId: msg.msgId,
        nodeId: this.nodeId,
        closest: closest.map(p => ({ id: p.id, addr: p.addr, port: p.port })),
      });
      return;
    }

    if (msg.type === DHT_MSG.PONG || msg.type === DHT_MSG.FOUND_NODE) {
      const handler = this.pending.get(msg.msgId);
      if (handler) {
        clearTimeout(handler.timeout);
        this.pending.delete(msg.msgId);
        handler.resolve(msg);
      }
      return;
    }
  }

  ping(addr, port) {
    return new Promise((resolve, reject) => {
      const msgId = this._msgId();
      const timeout = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error('PING timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(msgId, { resolve, reject, timeout });
      this._send(addr, port, { type: DHT_MSG.PING, msgId, nodeId: this.nodeId }).catch(reject);
    });
  }

  findNode(addr, port, targetId) {
    return new Promise((resolve, reject) => {
      const msgId = this._msgId();
      const timeout = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error('FIND_NODE timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(msgId, {
        resolve: (msg) => resolve(msg.closest || []),
        reject,
        timeout,
      });
      this._send(addr, port, {
        type: DHT_MSG.FIND_NODE, msgId, nodeId: this.nodeId, targetId,
      }).catch(reject);
    });
  }

async bootstrap(addr, port) {
  const closest = await this.findNode(addr, port, this.nodeId);
  closest.forEach(peer => this.routingTable.addPeer(peer));
  return closest;
}

async iterativeFindNode(targetId) {
  const queried = new Set();
  let closest = this.routingTable.getClosest(targetId, DHT_K);

  if (closest.length === 0) return [];

  while (true) {
    const toQuery = closest
      .filter(peer => peer.id && !queried.has(peer.id))
      .slice(0, ALPHA);

    if (toQuery.length === 0) break;

    const results = await Promise.allSettled(
      toQuery.map(async (peer) => {
        queried.add(peer.id);
        try {
          const found = await this.findNode(peer.addr, peer.port, targetId);
          found.forEach(p => this.routingTable.addPeer(p));
          return found;
        } catch {
          this.routingTable.removePeer(peer.id);
          return [];
        }
      })
    );

    const newPeers = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    const candidateMap = new Map();
    [...closest, ...newPeers].forEach(p => {
      if (p.id) candidateMap.set(p.id, p);
    });

    closest = [...candidateMap.values()]
      .map(peer => ({ peer, dist: xorDistance(peer.id, targetId) }))
      .sort((a, b) => compareDistance(a.dist, b.dist))
      .slice(0, DHT_K)
      .map(x => x.peer);

    const allQueried = closest.every(p => queried.has(p.id));
    if (allQueried) break;
  }

  return closest;
}

async iterativeFindNode(targetId) {
  const queried = new Set();
  let closest = this.routingTable.getClosest(targetId, DHT_K);

  if (closest.length === 0) return [];

  while (true) {
    const toQuery = closest
      .filter(peer => peer.id && !queried.has(peer.id))
      .slice(0, ALPHA);

    if (toQuery.length === 0) break;

    const results = await Promise.allSettled(
      toQuery.map(async (peer) => {
        queried.add(peer.id);
        try {
          const found = await this.findNode(peer.addr, peer.port, targetId);
          found.forEach(p => this.routingTable.addPeer(p));
          return found;
        } catch {
          this.routingTable.removePeer(peer.id);
          return [];
        }
      })
    );

    const newPeers = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    const candidateMap = new Map();
    [...closest, ...newPeers].forEach(p => {
      if (p.id) candidateMap.set(p.id, p);
    });

    closest = [...candidateMap.values()]
      .map(peer => ({ peer, dist: xorDistance(peer.id, targetId) }))
      .sort((a, b) => compareDistance(a.dist, b.dist))
      .slice(0, DHT_K)
      .map(x => x.peer);

    const allQueried = closest.every(p => queried.has(p.id));
    if (allQueried) break;
  }

  return closest;
}
}