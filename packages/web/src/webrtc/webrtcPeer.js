import { TYPE, MSG, buildJSONBody, buildChunkBody, parseMessage } from './protocol.js';

export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
export const CONNECT_TIMEOUT_MS = 15000;
export const CHUNK_REQUEST_TIMEOUT_MS = 30000;

export class WebRTCPeer extends EventTarget {
  constructor(signalingClient, remotePeerId, { initiator }) {
    super();
    this.signalingClient = signalingClient;
    this.remotePeerId = remotePeerId;
    this.initiator = initiator;
    this.pc = null;
    this.channel = null;
    this._remoteDescSet = false;
    this._pendingCandidates = [];
    this._relayHandler = (event) => this._handleRelay(event);
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('WebRTC connection timeout'));
      }, CONNECT_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        this.signalingClient.removeEventListener('relay', this._relayHandler);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(this);
      };

      const fail = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      this.pc.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
          this.signalingClient.relay(this.remotePeerId, {
            kind: 'ice-candidate',
            candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
          });
        }
      });

      this.pc.addEventListener('connectionstatechange', () => {
        if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
          fail(new Error(`WebRTC connection ${this.pc.connectionState}`));
        }
      });

      if (this.initiator) {
        this.channel = this.pc.createDataChannel('mesh');
        this._bindChannel(succeed);
        this.pc.createOffer()
          .then((offer) => this.pc.setLocalDescription(offer).then(() => offer))
          .then((offer) => {
            this.signalingClient.relay(this.remotePeerId, { kind: 'offer', sdp: offer.sdp });
          })
          .catch(fail);
      } else {
        this.pc.addEventListener('datachannel', (event) => {
          this.channel = event.channel;
          this._bindChannel(succeed);
        });
      }

      this.signalingClient.addEventListener('relay', this._relayHandler);
    });
  }

  _bindChannel(onOpen) {
    this.channel.binaryType = 'arraybuffer';

    this.channel.addEventListener('open', onOpen);

    this.channel.addEventListener('message', (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      let msg;
      try {
        msg = parseMessage(new Uint8Array(event.data));
      } catch {
        return;
      }

      if (msg.type === TYPE.JSON) {
        this.dispatchEvent(new CustomEvent('jsonMessage', { detail: msg.data }));
        return;
      }

      if (msg.type === TYPE.CHUNK) {
        this.dispatchEvent(new CustomEvent('chunkMessage', { detail: msg }));
      }
    });

    this.channel.addEventListener('close', () => {
      this.dispatchEvent(new Event('close'));
    });
  }

  async _handleRelay(event) {
    const { fromPeerId, payload } = event.detail;
    if (fromPeerId !== this.remotePeerId) return;

    if (payload.kind === 'offer') {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
      this._remoteDescSet = true;
      await this._flushCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.signalingClient.relay(this.remotePeerId, { kind: 'answer', sdp: answer.sdp });
      return;
    }

    if (payload.kind === 'answer') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      this._remoteDescSet = true;
      await this._flushCandidates();
      return;
    }

    if (payload.kind === 'ice-candidate') {
      if (this._remoteDescSet) {
        await this.pc.addIceCandidate(payload.candidate).catch(() => {});
      } else {
        this._pendingCandidates.push(payload.candidate);
      }
    }
  }

  async _flushCandidates() {
    const candidates = this._pendingCandidates;
    this._pendingCandidates = [];
    for (const candidate of candidates) {
      await this.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  sendJSON(obj) {
    this.channel.send(buildJSONBody(obj).buffer);
  }

  sendChunk(chunkIndex, chunkHashHex, proof, chunkData) {
    this.channel.send(buildChunkBody(chunkIndex, chunkHashHex, proof, chunkData).buffer);
  }

  send(obj) {
    this.sendJSON(obj);
  }

  close() {
    this.signalingClient.removeEventListener('relay', this._relayHandler);
    if (this.channel) this.channel.close();
    if (this.pc) this.pc.close();
  }
}

export class WebRTCPeerConnection {
  constructor(signalingClient, remotePeerId, { initiator }) {
    this.peer = new WebRTCPeer(signalingClient, remotePeerId, { initiator });
    this.pendingRequests = new Map();
    this.metadata = null;

    this.peer.addEventListener('jsonMessage', (event) => this._handleJSON(event.detail));
    this.peer.addEventListener('chunkMessage', (event) => this._handleChunk(event.detail));
    this.peer.addEventListener('close', () => {
      for (const { reject } of this.pendingRequests.values()) {
        reject(new Error('Data channel closed'));
      }
      this.pendingRequests.clear();
    });
  }

  async connect() {
    await this.peer.connect();
    return this;
  }

  _handleJSON(data) {
    if (data.type === MSG.FILE_OFFER) {
      this.metadata = data;
    }
  }

  _handleChunk(msg) {
    const handler = this.pendingRequests.get(msg.chunkIndex);
    if (!handler) return;
    clearTimeout(handler.timeout);
    this.pendingRequests.delete(msg.chunkIndex);
    handler.resolve(msg);
  }

  requestChunk(index) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(index);
        reject(new Error(`Chunk ${index} request timeout`));
      }, CHUNK_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(index, { resolve, reject, timeout });
      this.peer.sendJSON({ type: MSG.CHUNK_REQUEST, index });
    });
  }

  serveChunks(getChunk) {
    this._serveHandler = (event) => {
      const data = event.detail;
      if (data.type !== MSG.CHUNK_REQUEST) return;
      Promise.resolve(getChunk(data.index))
        .then(({ hash, proof, data: chunkData }) => {
          this.peer.sendChunk(data.index, hash, proof, chunkData);
        })
        .catch(() => {});
    };
    this.peer.addEventListener('jsonMessage', this._serveHandler);
  }

  close() {
    this.peer.close();
  }
}