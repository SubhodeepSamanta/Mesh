import { WebSocketServer } from 'ws';
import http from 'http';
import { randomBytes, createHash, createHmac } from 'crypto';
import { pathToFileURL } from 'url';
import { metrics, recordRoomCreated, recordRoomExpiredOrClosed, recordPeerJoined, recordPeerLeft } from './metrics.js';

export const MSG_TYPE = {
  CREATE_ROOM:   'CREATE_ROOM',
  ROOM_CREATED:  'ROOM_CREATED',
  JOIN_ROOM:     'JOIN_ROOM',
  ROOM_JOINED:   'ROOM_JOINED',
  REJOIN_ROOM:   'REJOIN_ROOM',
  ROOM_REJOINED: 'ROOM_REJOINED',
  PEER_JOINED:   'PEER_JOINED',
  PEER_LEFT:     'PEER_LEFT',
  RELAY:         'RELAY',
  ERROR:         'ERROR',
};

const ROOM_CODE_CHARS  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS      = 30 * 60 * 1000;
const RATE_WINDOW_MS   = 60 * 1000;
const MAX_CREATES_PER_MIN = 10;
const MAX_JOINS_PER_MIN   = 20;
const MAX_RELAY_PAYLOAD_BYTES = 16 * 1024;
const MAX_RELAY_PER_MIN = 300;

function generateRoomCode(length = 4) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[randomBytes(1)[0] % ROOM_CODE_CHARS.length];
  }
  return code;
}

function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

export function getIceServers(peerId) {
  const stunUrl = process.env.STUN_URL || 'stun:stun.l.google.com:19302';
  const iceServers = [{ urls: stunUrl }];

  const turnUrl = process.env.TURN_URL;
  const turnSecret = process.env.TURN_SECRET;
  const turnUser = process.env.TURN_USERNAME;
  const turnCred = process.env.TURN_CREDENTIAL;

  if (turnUrl) {
    if (turnSecret) {
      const expiry = Math.floor(Date.now() / 1000) + 24 * 3600;
      const username = `${expiry}:${peerId}`;
      const password = createHmac('sha1', turnSecret)
        .update(username)
        .digest('base64');

      iceServers.push({
        urls: turnUrl,
        username,
        credential: password,
      });
    } else if (turnUser && turnCred) {
      iceServers.push({
        urls: turnUrl,
        username: turnUser,
        credential: turnCred,
      });
    } else {
      iceServers.push({ urls: turnUrl });
    }
  }

  return iceServers;
}

export class SignalingServer {
  constructor(opts = {}) {
    this.rooms        = new Map();
    this.wss          = null;
    this._httpServer  = null;
    this.rateLimits   = new Map();
    this.roomTtlMs    = opts.roomTtlMs    ?? parseInt(process.env.ROOM_TTL_MS || '1800000', 10);
    this.maxCreates   = opts.maxCreates   ?? parseInt(process.env.MAX_CREATES_PER_MIN || '10', 10);
    this.maxJoins     = opts.maxJoins     ?? parseInt(process.env.MAX_JOINS_PER_MIN || '20', 10);
    this.maxRelays    = opts.maxRelays    ?? parseInt(process.env.MAX_RELAY_PER_MIN || '300', 10);
    this.maxRelayPayloadBytes = opts.maxRelayPayloadBytes ?? parseInt(process.env.MAX_RELAY_PAYLOAD_BYTES || '16384', 10);
    this.maxPeersPerRoom = opts.maxPeersPerRoom ?? parseInt(process.env.MAX_PEERS_PER_ROOM || '16', 10);
    this.maxRooms     = opts.maxRooms     ?? parseInt(process.env.MAX_ROOMS || '5000', 10);
    this.trustProxy   = opts.trustProxy   ?? (process.env.TRUST_PROXY === '1');
    this.allowedOrigins = opts.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : null);
    this.rejoinGraceMs = opts.rejoinGraceMs ?? parseInt(process.env.REJOIN_GRACE_MS || '30000', 10);
    this._expiryTimer = null;
  }

    listen(port = 0) {
    return new Promise((resolve, reject) => {
      let active = true;
      const errorHandler = (err) => {
        if (active) {
          active = false;
          reject(err);
        }
      };

      this._httpServer = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            uptime: process.uptime(),
            ...metrics,
          }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      this.wss = new WebSocketServer({
        server: this._httpServer,
        maxPayload: 64 * 1024,
      });

      this._httpServer.on('error', errorHandler);
      this.wss.on('error', errorHandler);

      this._httpServer.listen(port, '0.0.0.0', () => {
        active = false;
        this._httpServer.removeListener('error', errorHandler);
        this.wss.removeListener('error', errorHandler);

        this._httpServer.on('error', (err) => {
          this.emit ? this.emit('error', err) : console.error('Signaling HTTP server error:', err.message);
        });
        this.wss.on('error', (err) => {
          this.emit ? this.emit('error', err) : console.error('Signaling WS server error:', err.message);
        });

        this.wss.on('connection', (ws, req) => {
          ws._ip = this.trustProxy
            ? (req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1')
            : (req.socket.remoteAddress || '127.0.0.1');

          if (this.allowedOrigins) {
            const origin = req.headers.origin || '';
            if (!this.allowedOrigins.includes(origin)) {
              ws.close(4003, 'Origin not allowed'); 
              return;
            }
          }

          this._handleConnection(ws);
        });

        this._expiryTimer = setInterval(() => {
          this._expireRooms();
          this._pruneRateLimits();
        }, 60 * 1000);

        resolve(this._httpServer.address());
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      clearInterval(this._expiryTimer);
      if (!this._httpServer) { resolve(); return; }
      if (this.wss) {
        this.wss.close(() => {
          this._httpServer.close(() => resolve());
        });
      } else {
        this._httpServer.close(() => resolve());
      }
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
    const max  = action === 'create' ? this.maxCreates : (action === 'join' ? this.maxJoins : this.maxRelays);
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
        for (const entry of room.peers.values()) {
          clearTimeout(entry.disconnectTimer);
          if (entry.ws) {
            this._send(entry.ws, { type: MSG_TYPE.ERROR, message: 'Room expired' });
            entry.ws.close();
          }
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
      case MSG_TYPE.REJOIN_ROOM:
        this._rejoinRoom(ws, msg.roomCode, msg.peerId, msg.rejoinToken);
        break;
      case MSG_TYPE.RELAY:
        this._relay(ws, msg);
        break;
      case 'PING':
        this._send(ws, { type: 'PONG' });
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

    if (this.rooms.size >= this.maxRooms) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Server at capacity — try again later' });
      return;
    }

    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    const rejoinToken = randomBytes(16).toString('hex');
    this.rooms.set(roomCode, {
      peers:        new Map([[ws.peerId, { ws, rejoinToken, disconnectTimer: null }]]),
      passwordHash: password ? hashPassword(password) : null,
      createdAt:    Date.now(),
      lastActivity: Date.now(),
    });

    ws.roomCode = roomCode;
    recordRoomCreated();
    recordPeerJoined();
    this._send(ws, { type: MSG_TYPE.ROOM_CREATED, roomCode, peerId: ws.peerId, rejoinToken, iceServers: getIceServers(ws.peerId) });
  }

  _joinRoom(ws, roomCode, password) {
    if (!this._checkRateLimit(ws._ip, 'join')) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Rate limit exceeded: too many join attempts' });
      return;
    }

    if (!roomCode) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Room code required' });
      return;
    }
    const normalizedCode = roomCode.toUpperCase();
    const room = this.rooms.get(normalizedCode);

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

    if (room.peers.size >= this.maxPeersPerRoom) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Room is full' });
      return;
    }

    const existingPeerIds = [...room.peers.keys()];
    const rejoinToken = randomBytes(16).toString('hex');
    room.peers.set(ws.peerId, { ws, rejoinToken, disconnectTimer: null });
    room.lastActivity = Date.now();
    ws.roomCode = normalizedCode;
    recordPeerJoined();

    this._send(ws, {
      type: MSG_TYPE.ROOM_JOINED,
      roomCode: normalizedCode,
      peerId: ws.peerId,
      existingPeers: existingPeerIds,
      rejoinToken,
      iceServers: getIceServers(ws.peerId),
    });

    for (const [peerId, entry] of room.peers) {
      if (peerId !== ws.peerId && entry.ws) {
        this._send(entry.ws, { type: MSG_TYPE.PEER_JOINED, peerId: ws.peerId });
      }
    }
  }

  _rejoinRoom(ws, roomCode, peerId, rejoinToken) {
    if (!this._checkRateLimit(ws._ip, 'join')) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Rate limit exceeded: too many join attempts' });
      return;
    }

    const normalizedCode = (roomCode || '').toUpperCase();
    const room = this.rooms.get(normalizedCode);
    if (!room) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Room not found' });
      return;
    }

    const entry = room.peers.get(peerId);
    // entry.ws !== null is a security guard: only allow a rejoin while the
    // slot is actually disconnected/pending — prevents a leaked/replayed
    // token from hijacking an already-live connection.
    if (!entry || entry.ws !== null || !rejoinToken || entry.rejoinToken !== rejoinToken) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Cannot rejoin room' });
      return;
    }

    clearTimeout(entry.disconnectTimer);
    entry.disconnectTimer = null;
    entry.ws = ws;
    ws.roomCode = normalizedCode;
    ws.peerId = peerId;
    room.lastActivity = Date.now();

    const existingPeerIds = [...room.peers.keys()].filter(id => id !== peerId);
    this._send(ws, {
      type: MSG_TYPE.ROOM_REJOINED,
      roomCode: normalizedCode,
      peerId,
      existingPeers: existingPeerIds,
      rejoinToken: entry.rejoinToken,
      iceServers: getIceServers(peerId),
    });
  }

  _relay(ws, msg) {
    if (!ws.roomCode) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Not in a room' });
      return;
    }

    if (!this._checkRateLimit(ws._ip, 'relay')) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Rate limit exceeded: too many relay messages' });
      return;
    }

    const payloadStr = JSON.stringify(msg.payload);
    if (payloadStr.length > this.maxRelayPayloadBytes) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Relay payload too large' });
      return;
    }

    const room = this.rooms.get(ws.roomCode);
    if (!room) return;

    room.lastActivity = Date.now();

    const targetEntry = room.peers.get(msg.targetPeerId);
    if (!targetEntry || !targetEntry.ws) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Target peer not found' });
      return;
    }

    this._send(targetEntry.ws, {
      type: MSG_TYPE.RELAY,
      fromPeerId: ws.peerId,
      payload: msg.payload,
    });
  }

  _handleDisconnect(ws) {
    if (!ws.roomCode) return;

    const room = this.rooms.get(ws.roomCode);
    if (!room) return;

    const entry = room.peers.get(ws.peerId);
    // Stale-close guard: if this slot was already taken over by a rejoined
    // (new) ws by the time this fires, don't tear down the new connection.
    if (!entry || entry.ws !== ws) return;

    entry.ws = null;
    entry.disconnectTimer = setTimeout(() => {
      room.peers.delete(ws.peerId);
      recordPeerLeft();

      for (const peerEntry of room.peers.values()) {
        if (peerEntry.ws) this._send(peerEntry.ws, { type: MSG_TYPE.PEER_LEFT, peerId: ws.peerId });
      }

      if (room.peers.size === 0) {
        this.rooms.delete(ws.roomCode);
        recordRoomExpiredOrClosed();
      }
    }, this.rejoinGraceMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 8080;
  const server = new SignalingServer();
  server.listen(PORT).then((addr) => {
    console.log(`Signaling server running on 0.0.0.0:${addr.port}`);
    console.log(`Health check: http://localhost:${addr.port}/health`);
  });
}