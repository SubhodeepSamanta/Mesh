import { WebRTCTransport } from './webrtc.js'
import { MSG } from '../webrtc/protocol.js'

export const transferManager = {
  swarm: null,
  transports: new Map(),
  chunks: [],
  fileRef: null,
  indexRef: null,
  fileRefs: null,
  servedRef: new Set(),
  downloadGuard: false,
  receivedMeta: null,
  streamHandle: null,
  streamWriters: new Map(),
  pendingDials: 0,
  dialingPeers: new Set(),
  _peerCheckTimer: null,
  _relayHandler: null,
  _relayClient: null,

  startSeederListener(client, onOffer) {
    this.stopSeederListener()
    if (!client) return
    this._relayClient = client
    this._relayHandler = (event) => {
      const { fromPeerId, payload } = event.detail
      if (payload.kind !== 'offer') return
      if (this.transports.has(fromPeerId)) return
      onOffer(fromPeerId, payload)
    }
    client.addEventListener('relay', this._relayHandler)
  },

  stopSeederListener() {
    if (this._relayClient && this._relayHandler) {
      this._relayClient.removeEventListener('relay', this._relayHandler)
    }
    this._relayClient = null
    this._relayHandler = null
  },

  reset() {
    this.stopSeederListener()
    this.swarm = null
    this.transports.clear()
    this.chunks = []
    this.fileRef = null
    this.indexRef = null
    this.fileRefs = null
    this.servedRef = new Set()
    this.downloadGuard = false
    this.receivedMeta = null
    this.streamHandle = null
    this.streamWriters.clear()
    this.pendingDials = 0
    this.dialingPeers.clear()
    if (this._peerCheckTimer) { clearTimeout(this._peerCheckTimer); this._peerCheckTimer = null }
  },
}
