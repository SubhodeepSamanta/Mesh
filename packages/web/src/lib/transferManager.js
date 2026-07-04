import { WebRTCTransport } from './webrtc.js'
import { MSG } from '../webrtc/protocol.js'

// Chunk indices for files added mid-session (see useTransfer.js's
// addFilesToSession/acceptBatchOffer) are offset by batchId * BATCH_STRIDE
// on the wire. This lets every batch share the original transfer's binary
// chunk framing (protocol.js) unchanged — no new wire format needed, just
// application-level divmod to recover { batchId, localIndex }. batchId 0 is
// always the original/main transfer.
export const BATCH_STRIDE = 1_000_000
// The binary CHUNK wire format (protocol.js) packs the index into a uint32,
// so batchId * BATCH_STRIDE + localIndex must never exceed 0xFFFFFFFF —
// otherwise it silently wraps and corrupts chunk routing. No legitimate
// session gets remotely close to this many added batches; it's just a
// sanity cap against a runaway/adversarial batchId.
export const MAX_BATCH_ID = Math.floor(0xFFFFFFFF / BATCH_STRIDE)

export const transferManager = {
  swarm: null,
  transports: new Map(),
  chunks: [],
  fileRef: null,
  indexRef: null,
  fileRefs: null,
  servedRef: new Set(),
  downloadGuard: false,
  autoDownloaded: false,
  receivedMeta: null,
  streamHandle: null,
  streamWriters: new Map(),
  pendingDials: 0,
  dialingPeers: new Set(),
  _peerCheckTimer: null,
  _relayHandler: null,
  _relayClient: null,

  // Extra batches added mid-session, keyed by batchId (>= 1).
  // Sender entries: { role: 'sender', fileRef, indexRef, fileRefs, servedRef }
  // Receiver entries: { role: 'receiver', swarm, meta, chunks, streamWriters, downloadGuard, offeredBy (transport) }
  extraBatches: new Map(),
  nextBatchId: 1,

  // Selective download (§4): file paths the receiver deselected before
  // clicking "Begin Transfer" — their chunks are excluded from the swarm
  // entirely, never requested from any peer.
  excludedPaths: new Set(),
  // Remaining chunk count per file path, decremented as chunks stream to
  // disk; hitting 0 means that file is fully written and can be marked
  // downloaded without waiting for the whole transfer to complete.
  fileRemaining: new Map(),

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
    this.autoDownloaded = false
    this.receivedMeta = null
    this.streamHandle = null
    this.streamWriters.clear()
    this.pendingDials = 0
    this.dialingPeers.clear()
    if (this._peerCheckTimer) { clearTimeout(this._peerCheckTimer); this._peerCheckTimer = null }
    this.extraBatches.clear()
    this.nextBatchId = 1
    this.excludedPaths.clear()
    this.fileRemaining.clear()
  },
}
