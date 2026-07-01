export const MSG_TYPE = {
  CREATE_ROOM:  'CREATE_ROOM',
  ROOM_CREATED: 'ROOM_CREATED',
  JOIN_ROOM:    'JOIN_ROOM',
  ROOM_JOINED:  'ROOM_JOINED',
  PEER_JOINED:  'PEER_JOINED',
  PEER_LEFT:    'PEER_LEFT',
  RELAY:        'RELAY',
  ERROR:        'ERROR',
  PONG:         'PONG',
};

export class SignalingClient extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.peerId = null;
    this.roomCode = null;
    this._pending = null;
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

      const onOpen = () => {
        this._reconnectAttempts = 0;
        this._startHeartbeat();
        if (this.peerId) {
          this.dispatchEvent(new Event('reconnect'));
        }
        resolve(this);
      };
      this.ws.addEventListener('open', onOpen, { once: true });
      this.ws.addEventListener('error', () => {
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
      if (this._pending) {
        this._pending.resolve(msg);
        this._pending = null;
      }
      return;
    }

    if (msg.type === MSG_TYPE.ERROR) {
      if (this._pending) {
        this._pending.reject(new Error(msg.message));
        this._pending = null;
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

  createRoom(password) {
    return new Promise((resolve, reject) => {
      if (this._pending) this._pending.reject(new Error('Request cancelled'));
      this._pending = { resolve, reject };
      this._send({ type: MSG_TYPE.CREATE_ROOM, password });
    });
  }

  joinRoom(roomCode, password) {
    return new Promise((resolve, reject) => {
      if (this._pending) this._pending.reject(new Error('Request cancelled'));
      this._pending = { resolve, reject };
      this._send({ type: MSG_TYPE.JOIN_ROOM, roomCode, password });
    });
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
