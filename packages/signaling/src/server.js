import { WebSocketServer } from 'ws';
import { randomBytes, createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { recordRoomCreated, recordRoomExpiredOrClosed, recordPeerJoined, recordPeerLeft } from './metrics.js';

export const MSG_TYPE = {
  CREATE_ROOM:  'CREATE_ROOM',
  ROOM_CREATED: 'ROOM_CREATED',
  JOIN_ROOM:    'JOIN_ROOM',
  ROOM_JOINED:  'ROOM_JOINED',
  PEER_JOINED:  'PEER_JOINED',
  PEER_LEFT:    'PEER_LEFT',
  RELAY:        'RELAY',
  ERROR:        'ERROR',
};

const ROOM_CODE_CHARS  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS      = 30 * 60 * 1000;
const RATE_WINDOW_MS   = 60 * 1000;
const MAX_CREATES_PER_MIN = 10;
const MAX_JOINS_PER_MIN   = 20;

function generateRoomCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[randomBytes(1)[0] % ROOM_CODE_CHARS.length];
  }
  return code;
}

function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

export class SignalingServer {
  constructor(opts = {}) {
    this.rooms        = new Map();
    this.wss          = null;
    this.rateLimits   = new Map();
    this.roomTtlMs    = opts.roomTtlMs    ?? ROOM_TTL_MS;
    this.maxCreates   = opts.maxCreates   ?? MAX_CREATES_PER_MIN;
    this.maxJoins     = opts.maxJoins     ?? MAX_JOINS_PER_MIN;
    this._expiryTimer = null;
  }

listen(port = 0) {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port });

      this.wss.once('error', reject);

      this.wss.once('listening', () => {
        this.wss.removeListener('error', reject);

        this.wss.on('error', (err) => {
          this.emit ? this.emit('error', err) : console.error('Signaling server error:', err.message);
        });

        this.wss.on('connection', (ws, req) => {
          ws._ip = req.socket.remoteAddress || '127.0.0.1';
          this._handleConnection(ws);
        });

        this._expiryTimer = setInterval(() => {
          this._expireRooms();
          this._pruneRateLimits();
        }, 60 * 1000);

        resolve(this.wss.address());
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      clearInterval(this._expiryTimer);
      if (!this.wss) { resolve(); return; }
      this.wss.close(() => resolve());
    });
  }

  _send(ws, msg) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

_checkRateLimit(ip, action) {
    const key  = `${ip}:${action}`;
    const now  = Date.now();
    const max  = action === 'create' ? this.maxCreates : this.maxJoins;
    const list = this.rateLimits.get(key) || [];

    const recent = list.filter(t => now - t < RATE_WINDOW_MS);
    recent.push(now);
    this.rateLimits.set(key, recent);

    return recent.length <= max;
  }

  _pruneRateLimits() {
    const now = Date.now();
    for (const [key, list] of this.rateLimits) {
      const recent = list.filter(t => now - t < RATE_WINDOW_MS);
      if (recent.length === 0) {
        this.rateLimits.delete(key);
      } else {
        this.rateLimits.set(key, recent);
      }
    }
  }

  _expireRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > this.roomTtlMs) {
        for (const ws of room.peers.values()) {
          this._send(ws, { type: MSG_TYPE.ERROR, message: 'Room expired' });
          ws.close();
        }
        this.rooms.delete(code);
        recordRoomExpiredOrClosed();
      }
    }
  }

  _handleConnection(ws) {
    ws.roomCode = null;
    ws.peerId   = randomBytes(8).toString('hex');

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        this._send(ws, { type: MSG_TYPE.ERROR, message: 'Invalid JSON' });
        return;
      }
      this._handleMessage(ws, msg);
    });

    ws.on('close', () => this._handleDisconnect(ws));
  }

  _handleMessage(ws, msg) {
    switch (msg.type) {
      case MSG_TYPE.CREATE_ROOM:
        this._createRoom(ws, msg.password);
        break;
      case MSG_TYPE.JOIN_ROOM:
        this._joinRoom(ws, msg.roomCode, msg.password);
        break;
      case MSG_TYPE.RELAY:
        this._relay(ws, msg);
        break;
      default:
        this._send(ws, { type: MSG_TYPE.ERROR, message: `Unknown message type: ${msg.type}` });
    }
  }

  _createRoom(ws, password) {
    if (!this._checkRateLimit(ws._ip, 'create')) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Rate limit exceeded: too many rooms created' });
      return;
    }

    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    this.rooms.set(roomCode, {
      peers:        new Map([[ws.peerId, ws]]),
      passwordHash: password ? hashPassword(password) : null,
      createdAt:    Date.now(),
      lastActivity: Date.now(),
    });

ws.roomCode = roomCode;
    recordRoomCreated();
    recordPeerJoined();
    this._send(ws, { type: MSG_TYPE.ROOM_CREATED, roomCode, peerId: ws.peerId });
  }

  _joinRoom(ws, roomCode, password) {
    if (!this._checkRateLimit(ws._ip, 'join')) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Rate limit exceeded: too many join attempts' });
      return;
    }

    const room = this.rooms.get(roomCode);

    if (!room) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Room not found' });
      return;
    }

    if (room.passwordHash) {
      if (!password || hashPassword(password) !== room.passwordHash) {
        this._send(ws, { type: MSG_TYPE.ERROR, message: 'Incorrect room password' });
        return;
      }
    }

    const existingPeerIds = [...room.peers.keys()];
    room.peers.set(ws.peerId, ws);
    room.lastActivity = Date.now();
    ws.roomCode = roomCode;
    recordPeerJoined();

    this._send(ws, {
      type: MSG_TYPE.ROOM_JOINED,
      roomCode,
      peerId: ws.peerId,
      existingPeers: existingPeerIds,
    });

    for (const [peerId, peerWs] of room.peers) {
      if (peerId !== ws.peerId) {
        this._send(peerWs, { type: MSG_TYPE.PEER_JOINED, peerId: ws.peerId });
      }
    }
  }

  _relay(ws, msg) {
    if (!ws.roomCode) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Not in a room' });
      return;
    }

    const room = this.rooms.get(ws.roomCode);
    if (!room) return;

    room.lastActivity = Date.now();

    const targetWs = room.peers.get(msg.targetPeerId);
    if (!targetWs) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Target peer not found' });
      return;
    }

    this._send(targetWs, {
      type: MSG_TYPE.RELAY,
      fromPeerId: ws.peerId,
      payload: msg.payload,
    });
  }

  _handleDisconnect(ws) {
    if (!ws.roomCode) return;

    const room = this.rooms.get(ws.roomCode);
    if (!room) return;

    room.peers.delete(ws.peerId);
    recordPeerLeft();

    for (const peerWs of room.peers.values()) {
      this._send(peerWs, { type: MSG_TYPE.PEER_LEFT, peerId: ws.peerId });
    }

    if (room.peers.size === 0) {
      this.rooms.delete(ws.roomCode);
      recordRoomExpiredOrClosed();
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 8080;
  const server = new SignalingServer();
  server.listen(PORT).then(() => {
    console.log(`Signaling server running on port ${PORT}`);
  });
}