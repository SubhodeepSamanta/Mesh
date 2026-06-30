import net from 'net';
import { sendJSON, createFramer, parseMessage, MSG, TYPE } from './protocol.js';
import { generateKeyPair, exportPublicKey, deriveSharedKey, encrypt, decrypt } from './crypto.js';

export const PEER_TIMEOUT_MS = 30000;
export const HANDSHAKE_TIMEOUT_MS = 5000;

export class PeerConnection {
  constructor(addr, port) {
    this.addr = addr;
    this.port = port;
    this.socket = null;
    this.metadata = null;
    this.pendingRequests = new Map();
    this.keyPair = generateKeyPair();
    this.sharedKey = null;
    this._handshakeResolve = null;
    this._handshakeReject = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.addr, port: this.port });
      this.socket.setNoDelay(true);
      this.socket.setMaxListeners(0);

      const framer = createFramer((body) => this._handleMessage(body));

      this.socket.once('connect', async () => {
        try {
          await this._performHandshake();
          resolve(this);
        } catch (e) {
          reject(e);
        }
      });

      this.socket.once('error', reject);
      this.socket.on('data', framer);

      this.socket.on('close', () => {
        for (const { reject: rej } of this.pendingRequests.values()) {
          rej(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
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