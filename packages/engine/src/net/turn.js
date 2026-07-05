import dgram from 'dgram';
import { EventEmitter } from 'events';
import { createHmac } from 'crypto';
import {
  MESSAGE_TYPE,
  ATTR,
  UDP_TRANSPORT,
  encodeMessage,
  decodeMessage,
  findAttr,
  encodeXorAddress,
  decodeXorAddress,
  decodeErrorCode,
  longTermKey,
  appendMessageIntegrity,
  newTransactionId,
  uint32,
} from './stunMessage.js';

export const DEFAULT_ALLOCATION_LIFETIME_SEC = 600;

export function generateTurnCredentials(secret, identity, ttlSec = 24 * 3600) {
  const expiry = Math.floor(Date.now() / 1000) + ttlSec;
  const username = `${expiry}:${identity}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

export class TurnClient extends EventEmitter {
  constructor({ host, port, username, credential }) {
    super();
    this.host = host;
    this.port = port;
    this.username = username;
    this.credential = credential;
    this.socket = dgram.createSocket('udp4');
    this.pending = new Map();
    this.realm = null;
    this.nonce = null;
    this.relayedAddress = null;
    this.mappedAddress = null;
    this.socket.on('message', (msg) => this._onMessage(msg));
  }

  _onMessage(msg) {
    let message;
    try {
      message = decodeMessage(msg);
    } catch {
      return;
    }

    if (message.type === MESSAGE_TYPE.DATA_INDICATION) {
      const peerAttr = findAttr(message.attrs, ATTR.XOR_PEER_ADDRESS);
      const dataAttr = findAttr(message.attrs, ATTR.DATA);
      if (peerAttr && dataAttr) {
        const peer = decodeXorAddress(peerAttr);
        this.emit('data', peer.address, peer.port, Buffer.from(dataAttr));
      }
      return;
    }

    const key = message.transactionId.toString('hex');
    const pending = this.pending.get(key);
    if (pending) {
      this.pending.delete(key);
      clearTimeout(pending.timeout);
      pending.resolve(message);
    }
  }

  _transact(buffer, transactionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const key = transactionId.toString('hex');
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error('TURN request timed out'));
      }, timeoutMs);

      this.pending.set(key, { resolve, reject, timeout });
      this.socket.send(buffer, this.port, this.host, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pending.delete(key);
          reject(err);
        }
      });
    });
  }

  async _authenticatedRequest(type, extraAttrs, { timeoutMs = 5000, retriesOnStaleNonce = 2 } = {}) {
    if (!this.nonce) {
      const probeId = newTransactionId();
      const challenge = await this._transact(encodeMessage(type, probeId, extraAttrs), probeId, timeoutMs);
      const errorAttr = findAttr(challenge.attrs, ATTR.ERROR_CODE);
      if (!errorAttr) throw new Error('Expected TURN server to challenge with a nonce, got a direct response');
      const { code, reason } = decodeErrorCode(errorAttr);
      if (code !== 401) throw new Error(`TURN error ${code}: ${reason}`);
      this.realm = findAttr(challenge.attrs, ATTR.REALM).toString('utf8');
      this.nonce = findAttr(challenge.attrs, ATTR.NONCE).toString('utf8');
    }

    for (let attempt = 0; attempt <= retriesOnStaleNonce; attempt++) {
      const key = longTermKey(this.username, this.realm, this.credential);
      const baseAttrs = [
        ...extraAttrs,
        { type: ATTR.USERNAME, value: Buffer.from(this.username, 'utf8') },
        { type: ATTR.REALM, value: Buffer.from(this.realm, 'utf8') },
        { type: ATTR.NONCE, value: Buffer.from(this.nonce, 'utf8') },
      ];
      const transactionId = newTransactionId();
      const signedAttrs = appendMessageIntegrity(type, transactionId, baseAttrs, key);
      const buffer = encodeMessage(type, transactionId, signedAttrs);

      const response = await this._transact(buffer, transactionId, timeoutMs);
      const errorAttr = findAttr(response.attrs, ATTR.ERROR_CODE);
      if (!errorAttr) return response;

      const { code, reason } = decodeErrorCode(errorAttr);
      if (code === 438 && attempt < retriesOnStaleNonce) {
        this.nonce = findAttr(response.attrs, ATTR.NONCE).toString('utf8');
        const realmAttr = findAttr(response.attrs, ATTR.REALM);
        if (realmAttr) this.realm = realmAttr.toString('utf8');
        continue;
      }
      throw new Error(`TURN error ${code}: ${reason}`);
    }

    throw new Error('TURN authentication failed after retrying a stale nonce');
  }

  async allocate({ timeoutMs = 5000, lifetimeSec = DEFAULT_ALLOCATION_LIFETIME_SEC } = {}) {
    const transportValue = Buffer.alloc(4);
    transportValue.writeUInt8(UDP_TRANSPORT, 0);

    const response = await this._authenticatedRequest(
      MESSAGE_TYPE.ALLOCATE_REQUEST,
      [
        { type: ATTR.REQUESTED_TRANSPORT, value: transportValue },
        { type: ATTR.LIFETIME, value: uint32(lifetimeSec) },
      ],
      { timeoutMs }
    );

    const relayedAttr = findAttr(response.attrs, ATTR.XOR_RELAYED_ADDRESS);
    const mappedAttr = findAttr(response.attrs, ATTR.XOR_MAPPED_ADDRESS);
    this.relayedAddress = decodeXorAddress(relayedAttr);
    this.mappedAddress = mappedAttr ? decodeXorAddress(mappedAttr) : null;
    return { relayedAddress: this.relayedAddress, mappedAddress: this.mappedAddress };
  }

  async refresh({ timeoutMs = 5000, lifetimeSec = DEFAULT_ALLOCATION_LIFETIME_SEC } = {}) {
    await this._authenticatedRequest(MESSAGE_TYPE.REFRESH_REQUEST, [{ type: ATTR.LIFETIME, value: uint32(lifetimeSec) }], { timeoutMs });
  }

  async createPermission(peerAddress, peerPort, { timeoutMs = 5000 } = {}) {
    await this._authenticatedRequest(
      MESSAGE_TYPE.CREATE_PERMISSION_REQUEST,
      [{ type: ATTR.XOR_PEER_ADDRESS, value: encodeXorAddress(peerAddress, peerPort) }],
      { timeoutMs }
    );
  }

  send(peerAddress, peerPort, data) {
    const message = encodeMessage(MESSAGE_TYPE.SEND_INDICATION, newTransactionId(), [
      { type: ATTR.XOR_PEER_ADDRESS, value: encodeXorAddress(peerAddress, peerPort) },
      { type: ATTR.DATA, value: data },
    ]);
    this.socket.send(message, this.port, this.host);
  }

  close() {
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(new Error('TurnClient closed'));
    }
    this.pending.clear();
    this.socket.close();
  }
}

export function createPeerChannel(turnClient, peerAddress, peerPort) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const onData = (fromAddress, fromPort, data) => {
    if (fromAddress === peerAddress && fromPort === peerPort) emitter.emit('message', data);
  };
  turnClient.on('data', onData);

  return {
    send: (buffer) => turnClient.send(peerAddress, peerPort, buffer),
    on: (event, cb) => emitter.on(event, cb),
    removeListener: (event, cb) => emitter.removeListener(event, cb),
    close: () => turnClient.removeListener('data', onData),
  };
}

export function createRelayListener(turnClient, onNewSession) {
  const handlers = new Map();

  const onData = (address, port, data) => {
    let handlerRef = handlers.get(address);
    if (!handlerRef) {
      handlerRef = { current: null };
      handlers.set(address, handlerRef);

      const virtualChannel = {
        send: (buffer) => turnClient.send(address, port, buffer),
        on: (event, cb) => { if (event === 'message') handlerRef.current = cb; },
        removeListener: () => { handlerRef.current = null; },
        close: () => { handlers.delete(address); },
      };

      onNewSession(address, port, virtualChannel);
    }

    if (handlerRef.current) handlerRef.current(data);
  };

  turnClient.on('data', onData);
  return { close: () => turnClient.removeListener('data', onData) };
}
