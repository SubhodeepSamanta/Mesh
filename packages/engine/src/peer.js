import net from 'net';
import { sendJSON, createFramer, parseMessage, MSG, TYPE } from './protocol.js';
import { generateKeyPair, exportPublicKey, deriveSharedKey, encrypt, decrypt } from './crypto.js';

export const PEER_TIMEOUT_MS = 30000;
export const HANDSHAKE_TIMEOUT_MS = 5000;
export const METADATA_TIMEOUT_MS = 10000;

export class PeerConnection {
  constructor(addr, port, { transport = null } = {}) {
    this.addr = addr;
    this.port = port;
    this.socket = null;
    this.transport = transport;
    this.metadata = null;
    this.pendingRequests = new Map();
    this.keyPair = generateKeyPair();
    this.sharedKey = null;
    this._handshakeResolve = null;
    this._handshakeReject = null;
    this._metadataWaiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = this.transport || net.createConnection({ host: this.addr, port: this.port });
      this.socket.setNoDelay(true);
      this.socket.setMaxListeners(0);

      const framer = createFramer((body) => this._handleMessage(body));

      const onReady = async () => {
        try {
          await this._performHandshake();
          resolve(this);
        } catch (e) {
          reject(e);
        }
      };

      if (this.transport) {
        onReady();
      } else {
        this.socket.once('connect', onReady);
      }

      this.socket.once('error', reject);
      this.socket.on('data', framer);

      this.socket.on('close', () => {
        for (const { reject: rej, timeout } of this.pendingRequests.values()) {
          clearTimeout(timeout);
          rej(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
        for (const { reject: rej } of this._metadataWaiters) {
          rej(new Error('Connection closed'));
        }
        this._metadataWaiters = [];
      });
    });
  }

  _performHandshake() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Key exchange handshake timeout'));
      }, HANDSHAKE_TIMEOUT_MS);

      this._handshakeResolve = () => { clearTimeout(timeout); resolve(); };
      this._handshakeReject = (e) => { clearTimeout(timeout); reject(e); };

      const myPublicKey = exportPublicKey(this.keyPair).toString('base64');
      sendJSON(this.socket, { type: MSG.KEY_EXCHANGE, publicKey: myPublicKey }).catch(reject);
    });
  }

  waitForMetadata(timeoutMs = METADATA_TIMEOUT_MS) {
    if (this.metadata) return Promise.resolve(this.metadata);
    return new Promise((resolve, reject) => {
      const entry = { resolve: null, reject: null };
      const timeout = setTimeout(() => {
        const idx = this._metadataWaiters.indexOf(entry);
        if (idx !== -1) this._metadataWaiters.splice(idx, 1);
        reject(new Error('Timed out waiting for file metadata'));
      }, timeoutMs);
      entry.resolve = (data) => { clearTimeout(timeout); resolve(data); };
      entry.reject = (e) => { clearTimeout(timeout); reject(e); };
      this._metadataWaiters.push(entry);
    });
  }

  _handleMessage(body) {
    const msg = parseMessage(body);

    if (msg.type === TYPE.JSON && msg.data.type === MSG.KEY_EXCHANGE) {
      try {
        const theirPublicKeyDER = Buffer.from(msg.data.publicKey, 'base64');
        this.sharedKey = deriveSharedKey(this.keyPair.privateKey, theirPublicKeyDER);
        if (this._handshakeResolve) this._handshakeResolve();
      } catch (e) {
        if (this._handshakeReject) this._handshakeReject(e);
      }
      return;
    }

    if (msg.type === TYPE.JSON && msg.data.type === MSG.FILE_OFFER) {
      this.metadata = msg.data;
      const waiters = this._metadataWaiters;
      this._metadataWaiters = [];
      for (const { resolve } of waiters) resolve(msg.data);
      return;
    }

    if (msg.type === TYPE.CHUNK) {
      const handler = this.pendingRequests.get(msg.chunkIndex);
      if (handler) {
        clearTimeout(handler.timeout);
        this.pendingRequests.delete(msg.chunkIndex);

        if (this.sharedKey) {
          try {
            const decrypted = decrypt(msg.chunkData, this.sharedKey);
            handler.resolve({ ...msg, chunkData: decrypted });
          } catch (e) {
            handler.reject(new Error('Chunk decryption failed: ' + e.message));
          }
        } else {
          handler.resolve(msg);
        }
      }
      return;
    }
  }

  requestChunk(index) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(index);
        reject(new Error(`Chunk ${index} request timeout`));
      }, PEER_TIMEOUT_MS);

      this.pendingRequests.set(index, { resolve, reject, timeout });
      sendJSON(this.socket, { type: MSG.CHUNK_REQUEST, index }).catch(reject);
    });
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
  }
}