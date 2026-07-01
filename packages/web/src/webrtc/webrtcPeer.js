export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
export const CONNECT_TIMEOUT_MS = 15000;

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
    this.channel.addEventListener('open', onOpen);
    this.channel.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      this.dispatchEvent(new CustomEvent('message', { detail: data }));
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

  send(obj) {
    this.channel.send(JSON.stringify(obj));
  }

  close() {
    this.signalingClient.removeEventListener('relay', this._relayHandler);
    if (this.channel) this.channel.close();
    if (this.pc) this.pc.close();
  }
}
