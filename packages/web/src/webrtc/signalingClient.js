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
  PONG:          'PONG',
};

export const CONNECT_TIMEOUT_MS = 10000;
export const REQUEST_TIMEOUT_MS = 10000;

export class SignalingClient extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.peerId = null;
    this.roomCode = null;
    this._pending = null;
    this._pendingRejoin = null;
    this._rejoinToken = null;
    this._relayBuffer = [];
    this._intentionalClose = false;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._lastPing = 0;
    this._closed = false;
  }

  addEventListener(type, handler) {
    super.addEventListener(type, handler);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._intentionalClose = false;
      this._closed = false;
      this.ws = new WebSocket(this.url);

      const connectTimeout = setTimeout(() => {
        reject(new Error('Connection to signaling server timed out'));
        try { this.ws.close(); } catch {}
      }, CONNECT_TIMEOUT_MS);

      const onOpen = () => {
        clearTimeout(connectTimeout);
        this._reconnectAttempts = 0;
        this._startHeartbeat();
        if (this.peerId && this.roomCode && this._rejoinToken) {
          this._rejoinRoom().catch(() => {
            this.dispatchEvent(new CustomEvent('reconnectFailed', { detail: { message: 'Could not rejoin room' } }));
          });
        }
        resolve(this);
      };
      this.ws.addEventListener('open', onOpen, { once: true });
      this.ws.addEventListener('error', () => {
        clearTimeout(connectTimeout);
        this._stopHeartbeat();
        reject(new Error('Signaling connection failed'));
      }, { once: true });
      this.ws.addEventListener('message', (event) => this._handleMessage(event));
      this.ws.addEventListener('close', () => {
        this._stopHeartbeat();
        this.dispatchEvent(new Event('close'));
        if (!this._intentionalClose && !this._closed) this._scheduleReconnect();
      });
    });
  }

  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) return;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 15000);
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._lastPing = Date.now();
    this._heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify({ type: 'PING' })); } catch {}
      }
      if (Date.now() - this._lastPing > 45000) {
        if (this.ws) this.ws.close();
      }
    }, 15000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
  }

  _cleanup() {
    this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._pending) {
      this._pending.reject(new Error('Connection closed'));
      this._pending = null;
    }
    if (this._pendingRejoin) {
      this._pendingRejoin.reject(new Error('Connection closed'));
      this._pendingRejoin = null;
    }
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _handleMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === MSG_TYPE.PONG || msg.type === 'PONG') {
      this._lastPing = Date.now();
      return;
    }

    if (msg.type === MSG_TYPE.ROOM_CREATED || msg.type === MSG_TYPE.ROOM_JOINED) {
      this.peerId = msg.peerId;
      this.roomCode = msg.roomCode;
      this.iceServers = msg.iceServers;
      this._rejoinToken = msg.rejoinToken;
      if (this._pending) {
        this._pending.resolve(msg);
        this._pending = null;
      }
      return;
    }

    if (msg.type === MSG_TYPE.ROOM_REJOINED) {
      this.peerId = msg.peerId;
      this.roomCode = msg.roomCode;
      this.iceServers = msg.iceServers;
      this._rejoinToken = msg.rejoinToken;
      if (this._pendingRejoin) {
        this._pendingRejoin.resolve(msg);
        this._pendingRejoin = null;
      }
      this.dispatchEvent(new CustomEvent('reconnect', { detail: { existingPeers: msg.existingPeers } }));
      return;
    }

    if (msg.type === MSG_TYPE.ERROR) {
      if (this._pending) {
        this._pending.reject(new Error(msg.message));
        this._pending = null;
        return;
      }
      if (this._pendingRejoin) {
        this._pendingRejoin.reject(new Error(msg.message));
        this._pendingRejoin = null;
        this.dispatchEvent(new CustomEvent('reconnectFailed', { detail: msg }));
        return;
      }
      this.dispatchEvent(new CustomEvent('signalingError', { detail: msg }));
      return;
    }

    if (msg.type === MSG_TYPE.PEER_JOINED) {
      this.dispatchEvent(new CustomEvent('peerJoined', { detail: { peerId: msg.peerId } }));
      return;
    }

    if (msg.type === MSG_TYPE.PEER_LEFT) {
      this.dispatchEvent(new CustomEvent('peerLeft', { detail: { peerId: msg.peerId } }));
      return;
    }

    if (msg.type === MSG_TYPE.RELAY) {
      const detail = { fromPeerId: msg.fromPeerId, payload: msg.payload };
      this._relayBuffer.push(detail);
      if (this._relayBuffer.length > 20) this._relayBuffer.shift();
      this.dispatchEvent(new CustomEvent('relay', { detail }));
      return;
    }
  }

  // Wraps a request/reply round trip with a timeout, since a dropped reply
  // (message loss, server bug) would otherwise leave the caller hanging forever.
  _pendingRequest(pendingKey, sendFn) {
    return new Promise((resolve, reject) => {
      if (this[pendingKey]) this[pendingKey].reject(new Error('Request cancelled'));
      const timeout = setTimeout(() => {
        if (this[pendingKey] === entry) {
          this[pendingKey] = null;
          reject(new Error('Request timed out'));
        }
      }, REQUEST_TIMEOUT_MS);
      const entry = {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      };
      this[pendingKey] = entry;
      sendFn();
    });
  }

  createRoom(password) {
    return this._pendingRequest('_pending', () => this._send({ type: MSG_TYPE.CREATE_ROOM, password }));
  }

  joinRoom(roomCode, password) {
    return this._pendingRequest('_pending', () => this._send({ type: MSG_TYPE.JOIN_ROOM, roomCode, password }));
  }

  _rejoinRoom() {
    return this._pendingRequest('_pendingRejoin', () => this._send({ type: MSG_TYPE.REJOIN_ROOM, roomCode: this.roomCode, peerId: this.peerId, rejoinToken: this._rejoinToken }));
  }

  relay(targetPeerId, payload) {
    this._send({ type: MSG_TYPE.RELAY, targetPeerId, payload });
  }

  close() {
    this._intentionalClose = true;
    this._closed = true;
    this._cleanup();
    if (this.ws) this.ws.close();
  }
}
