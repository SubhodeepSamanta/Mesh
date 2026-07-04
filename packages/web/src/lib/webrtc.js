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

// A malformed ICE server entry (e.g. turn::3478 — no host, which happens if
// the signaling server's EXTERNAL_IP env var is unset/blank) makes
// `new RTCPeerConnection(...)` throw *synchronously*. That exception used to
// happen in code paths with no try/catch around them at all, silently
// killing the connection attempt before it even started — no console
// output, no error, just a permanently stuck peer with no explanation.
// Filter out anything malformed instead, so a broken TURN config degrades
// to "STUN-only, some networks might not connect" rather than "nothing
// works for anyone, ever, with zero diagnostic trace."
const VALID_ICE_URL = /^(stun|turns?):[^\s:,][^\s,]*$/i;

export function isValidIceUrl(url) {
  return typeof url === 'string' && VALID_ICE_URL.test(url.trim());
}

export function sanitizeIceServers(iceServers) {
  const fallback = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (!Array.isArray(iceServers)) return fallback;
  const cleaned = [];
  for (const entry of iceServers) {
    if (!entry || !entry.urls) continue;
    
    let urls;
    if (Array.isArray(entry.urls)) {
      urls = entry.urls;
    } else if (typeof entry.urls === 'string') {
      urls = entry.urls.includes(',') ? entry.urls.split(',') : [entry.urls];
    } else {
      urls = [entry.urls];
    }

    const validUrls = urls
      .map(u => typeof u === 'string' ? u.trim() : '')
      .filter(u => u && isValidIceUrl(u));

    if (validUrls.length === 0) {
      console.warn('[mesh] dropping malformed ICE server entry:', entry);
      continue;
    }
    cleaned.push({ ...entry, urls: validUrls.length === 1 ? validUrls[0] : validUrls });
  }
  if (cleaned.length === 0) {
    console.warn('[mesh] no valid ICE servers remained after sanitizing — falling back to public STUN only');
    return fallback;
  }
  return cleaned;
}

export class WebRTCTransport {
  constructor(signalingClient, remotePeerId, { initiator }) {
    this.signalingClient = signalingClient;
    this.remotePeerId = remotePeerId;
    this.initiator = initiator;
    const rawIceServers = (signalingClient && signalingClient.iceServers) || ICE_SERVERS;
    const iceServers = sanitizeIceServers(rawIceServers);
    this.pc = new RTCPeerConnection({ iceServers });
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

    this._relayHandler = (event) => {
      this._handleSignal(event.detail).catch((err) => {
        console.warn(`[mesh] failed to process a ${event.detail?.payload?.kind || 'signal'} message from ${this.remotePeerId}:`, err)
      })
    };
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
      if (this._remoteDescSet || this.pc.signalingState !== 'stable') return;
      this._remoteDescSet = true;
      await this.pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      await this._flushIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.signalingClient.relay(this.remotePeerId, { kind: 'answer', sdp: answer.sdp });
    } else if (p.kind === 'answer') {
      if (this._remoteDescSet || this.pc.signalingState !== 'have-local-offer') return;
      this._remoteDescSet = true;
      await this.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
      await this._flushIce();
    } else if (p.kind === 'ice-candidate') {
      if (this._remoteDescSet) {
        await this.pc.addIceCandidate(p.candidate).catch((err) => {
          console.warn(`[mesh] addIceCandidate failed for ${this.remotePeerId}:`, err)
        });
      } else {
        this._pendingIce.push(p.candidate);
      }
    }
  }

  async _flushIce() {
    const cs = this._pendingIce;
    this._pendingIce = [];
    for (const c of cs) {
      await this.pc.addIceCandidate(c).catch((err) => {
        console.warn(`[mesh] addIceCandidate (flushed) failed for ${this.remotePeerId}:`, err)
      });
    }
  }

  connect(offerPayload) {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      const deadline = Date.now() + CONNECT_TIMEOUT_MS;
      const fail = () => {
        if (this._reject) {
          this._reject(new Error('Connection timeout'));
          this._reject = null;
          this.close();
        }
      };
      const timeout = setTimeout(fail, CONNECT_TIMEOUT_MS);
      // A backgrounded tab (screen locked, user switched away) throttles or
      // fully pauses setTimeout, so this plain timer alone can silently
      // never fire — leaving connect() hanging forever with no error, no
      // matter how long the real handshake has actually been dead. Re-check
      // the deadline the moment the tab is visible again so a stuck
      // connection always surfaces an error instead of hanging silently.
      const onVisible = () => {
        if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
        if (Date.now() >= deadline) {
          clearTimeout(timeout);
          fail();
        }
      };
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', onVisible);
      }
      const orig = this._resolve;
      this._resolve = () => {
        clearTimeout(timeout);
        if (typeof document !== 'undefined' && document.removeEventListener) {
          document.removeEventListener('visibilitychange', onVisible);
        }
        orig();
      };
      const origReject = this._reject;
      this._reject = (err) => {
        clearTimeout(timeout);
        if (typeof document !== 'undefined' && document.removeEventListener) {
          document.removeEventListener('visibilitychange', onVisible);
        }
        origReject(err);
      };
      if (this.initiator) {
        this.pc.createOffer().then((offer) => {
          this.pc.setLocalDescription(offer);
          this.signalingClient.relay(this.remotePeerId, { kind: 'offer', sdp: offer.sdp });
        }).catch((err) => {
          console.warn(`[mesh] createOffer failed for ${this.remotePeerId}:`, err)
        });
      } else if (offerPayload) {
        this._handleSignal({ fromPeerId: this.remotePeerId, payload: offerPayload }).catch((err) => {
          console.warn(`[mesh] failed to handle incoming offer from ${this.remotePeerId}:`, err)
        });
      }
      // ICE connection state is the single most useful signal for diagnosing
      // a stuck handshake — log every transition so "stuck with no error" is
      // never the only information available (e.g. 'checking' stuck forever
      // means no usable candidate pair was found; 'failed' means ICE gave up).
      this.pc.addEventListener('iceconnectionstatechange', () => {
        console.info(`[mesh] ICE connection state (${this.remotePeerId}):`, this.pc.iceConnectionState)
      });
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
