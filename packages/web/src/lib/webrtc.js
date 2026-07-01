import { buildJSONBody, buildChunkBody, parseMessage } from '../webrtc/protocol.js';

function buildIceServers() {
  const servers = [{ urls: import.meta.env.VITE_STUN_URL || 'stun:stun.l.google.com:19302' }]
  const turnUrl = import.meta.env.VITE_TURN_URL
  const turnUser = import.meta.env.VITE_TURN_USERNAME
  const turnCred = import.meta.env.VITE_TURN_CREDENTIAL
  if (turnUrl) {
    const entry = { urls: turnUrl }
    if (turnUser && turnCred) {
      entry.username = turnUser
      entry.credential = turnCred
    }
    servers.push(entry)
  }
  return servers
}

export const ICE_SERVERS = buildIceServers();
export const CONNECT_TIMEOUT_MS = 15000;

export class WebRTCTransport {
  constructor(signalingClient, remotePeerId, { initiator }) {
    this.signalingClient = signalingClient;
    this.remotePeerId = remotePeerId;
    this.initiator = initiator;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = null;
    this.jsonHandler = null;
    this.chunkHandler = null;
    this._pendingIce = [];
    this._remoteDescSet = false;
    this._closed = false;
    this._resolve = null;
    this._reject = null;

    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.signalingClient.relay(this.remotePeerId, {
        kind: 'ice-candidate',
        candidate: e.candidate.toJSON(),
      });
    };

    this._relayHandler = (event) => { this._handleSignal(event.detail).catch(() => {}) };
    this.signalingClient.addEventListener('relay', this._relayHandler);

    if (initiator) {
      this.channel = this.pc.createDataChannel('mesh');
      this.channel.binaryType = 'arraybuffer';
      this._bindChannel();
    } else {
      this.pc.ondatachannel = (e) => {
        this.channel = e.channel;
        this.channel.binaryType = 'arraybuffer';
        this._bindChannel();
      };
    }
  }

  _bindChannel() {
    this.channel.onopen = () => {
      if (this._resolve) {
        this._resolve();
        this._resolve = null;
      }
    };
    this.channel.onmessage = (e) => {
      try {
        const msg = parseMessage(new Uint8Array(e.data));
        if (msg.type === 0x00 && this.jsonHandler) Promise.resolve(this.jsonHandler(msg.data)).catch(() => {});
        else if (msg.type === 0x01 && this.chunkHandler) Promise.resolve(this.chunkHandler(msg)).catch(() => {});
      } catch (_) {}
    };
  }

  async _handleSignal(detail) {
    if (detail.fromPeerId !== this.remotePeerId || this._closed) return;
    const p = detail.payload;
    if (p.kind === 'offer') {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      this._remoteDescSet = true;
      await this._flushIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.signalingClient.relay(this.remotePeerId, { kind: 'answer', sdp: answer.sdp });
    } else if (p.kind === 'answer') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
      this._remoteDescSet = true;
      await this._flushIce();
    } else if (p.kind === 'ice-candidate') {
      if (this._remoteDescSet) {
        await this.pc.addIceCandidate(p.candidate).catch(() => {});
      } else {
        this._pendingIce.push(p.candidate);
      }
    }
  }

  async _flushIce() {
    const cs = this._pendingIce;
    this._pendingIce = [];
    for (const c of cs) {
      await this.pc.addIceCandidate(c).catch(() => {});
    }
  }

  connect(offerPayload) {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      const timeout = setTimeout(() => {
        if (this._reject) {
          this._reject(new Error('Connection timeout'));
          this._reject = null;
          this.close();
        }
      }, CONNECT_TIMEOUT_MS);
      const orig = this._resolve;
      this._resolve = () => { clearTimeout(timeout); orig(); };
      if (this.initiator) {
        this.pc.createOffer().then((offer) => {
          this.pc.setLocalDescription(offer);
          this.signalingClient.relay(this.remotePeerId, { kind: 'offer', sdp: offer.sdp });
        });
      } else if (offerPayload) {
        this._handleSignal({ fromPeerId: this.remotePeerId, payload: offerPayload }).catch(() => {});
      }
    });
  }

  sendJSON(obj) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(buildJSONBody(obj));
    }
  }

  async sendChunk(index, hashHex, proof, data) {
    if (!this.channel || this.channel.readyState !== 'open') return
    if (this.pc.sctp && typeof this.pc.sctp.maxMessageSize === 'number') {
      const payloadSize = data.byteLength || data.length || 0
      if (this.pc.sctp.maxMessageSize < payloadSize) {
        console.warn(`SCTP maxMessageSize (${this.pc.sctp.maxMessageSize}) is lower than chunk size (${payloadSize}). Large chunk transfers may fail.`)
      }
    }
    const HIGH_WATER = 8 * 1024 * 1024
    if (this.channel.bufferedAmount > HIGH_WATER) {
      this.channel.bufferedAmountLowThreshold = 1024 * 1024
      await new Promise(resolve => {
        const handler = () => {
          this.channel.removeEventListener('bufferedamountlow', handler)
          resolve()
        }
        this.channel.addEventListener('bufferedamountlow', handler)
      })
    }
    if (!this.channel || this.channel.readyState !== 'open') return
    this.channel.send(buildChunkBody(index, hashHex, proof, data))
  }

  onJSON(handler) { this.jsonHandler = handler; }
  onChunk(handler) { this.chunkHandler = handler; }

  close() {
    if (this._closed) return;
    this._closed = true;
    this.signalingClient.removeEventListener('relay', this._relayHandler);
    if (this.channel) this.channel.close();
    this.pc.close();
    if (this._reject) {
      this._reject(new Error('Transport closed'));
      this._reject = null;
    }
  }
}
