import { create } from 'zustand'
import { addHistoryEntry } from './useHistoryStore.js'
import { hasPersistedSession, clearPersistedSession } from './useSignalingStore.js'

const STORAGE_KEY = 'mesh-transfer-state'

const initial = {
  role: null,
  status: 'idle',
  fileMeta: null,
  progress: { verified: 0, total: 0, percent: 0 },
  chunkStates: [],
  peerStats: [],
  speedHistory: [],
  error: null,
  seeding: false,
  canReseed: true,
  saveMode: 'files',
  startTime: null,
  roomCode: '',
  // Mid-session "add another file" batches (see useTransfer.js's
  // addFilesToSession/acceptBatchOffer). Not persisted across reload —
  // an added batch that was still in flight is simply gone on resume,
  // same as any other in-memory transfer state that isn't the main swarm.
  extraBatches: [],
  // Paths (within the main transfer's manifest) that have actually landed
  // on disk / been downloaded — not persisted, same reasoning as above.
  downloadedPaths: [],
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || !saved.fileMeta) return null
    const total = saved.fileMeta.totalChunks || 0
    saved.chunkStates = new Array(total).fill('pending')
    if (saved.progress.verified > 0) {
      for (let i = 0; i < saved.progress.verified && i < total; i++) {
        saved.chunkStates[i] = 'verified'
      }
    }
    saved.peerStats = []
    saved.speedHistory = []
    saved.canReseed = saved.canReseed !== undefined ? saved.canReseed : true
    const liveStatuses = ['transferring', 'waiting-for-peer', 'waiting-for-file', 'file-offered']
    if (liveStatuses.includes(saved.status)) {
      // Receiver + a still-live signaling session means useSessionResume can attempt
      // an automatic rejoin-and-redial (Stage B/C).
      if (saved.role === 'receiver' && hasPersistedSession()) {
        saved.status = 'reconnecting'
        saved.error = null
      } else if (saved.role === 'sender' && hasPersistedSession()) {
        // Sender-side resume (Stage D) can't be automatic — the original
        // File handles are gone after a reload — so this just parks the UI
        // in a state that prompts the user to re-select the same file(s)
        // rather than hard-failing outright.
        saved.status = 'reconnecting-sender'
        saved.error = null
      } else {
        clearPersistedSession()
        saved.status = 'error'
        saved.error = 'Transfer interrupted — connection lost on refresh'
      }
    }
    return saved
  } catch { return null }
}

export const useTransferStore = create((set) => {
  const saved = loadSaved()
  return {
    ...initial,
    ...saved,

    startAsSender: (fileMeta) => set({
      role: 'sender',
      status: 'waiting-for-peer',
      seeding: true,
      canReseed: true,
      fileMeta,
      chunkStates: new Array(fileMeta.totalChunks).fill('pending'),
      progress: { verified: 0, total: fileMeta.totalChunks, percent: 0 },
      error: null, startTime: Date.now(),
    }),

    startAsReceiver: () => set({
      role: 'receiver',
      status: 'waiting-for-file',
      canReseed: false,
      fileMeta: null,
      progress: { verified: 0, total: 0, percent: 0 },
      chunkStates: [],
      peerStats: [],
      speedHistory: [],
      error: null, startTime: Date.now(),
    }),

    setIncomingFile: (fileMeta) => set({
      fileMeta,
      status: 'file-offered',
      canReseed: false,
      chunkStates: new Array(fileMeta.totalChunks).fill('pending'),
      progress: { verified: 0, total: fileMeta.totalChunks, percent: 0 },
    }),

    setTransferring: () => set({ status: 'transferring' }),
    updateProgress: (p) => set({ progress: p }),

    updateChunkState: (index, state) => set((s) => {
      const next = [...s.chunkStates]
      next[index] = state
      return { chunkStates: next }
    }),

    updatePeerStats: (peerStats) => set({ peerStats }),

    recordSpeedSample: (mbps) => set((s) => {
      const clean = typeof mbps === 'number' && isFinite(mbps) && mbps >= 0 ? mbps : 0
      return { speedHistory: [...s.speedHistory.slice(-59), { t: Date.now(), mbps: clean }] }
    }),

    setRoomCode: (roomCode) => set({ roomCode }),
    setSeeding: (seeding) => set({ seeding }),
    setSaveMode: (saveMode) => set({ saveMode }),

    // Receiver side: a sender broadcast an offer for a new batch of files.
    addExtraBatchOffer: ({ batchId, fileMeta, fromPeerId }) => set((s) => {
      if (s.extraBatches.some((b) => b.batchId === batchId)) return s
      return { extraBatches: [...s.extraBatches, {
        batchId, role: 'receiver', status: 'offered', fileMeta, fromPeerId,
        progress: { verified: 0, total: fileMeta.totalChunks, percent: 0 },
      }] }
    }),

    // Sender side: files were just added and broadcast to the room.
    addExtraBatchSent: ({ batchId, fileMeta }) => set((s) => ({
      extraBatches: [...s.extraBatches, {
        batchId, role: 'sender', status: 'offered', fileMeta, acceptedBy: [],
        progress: { verified: 0, total: fileMeta.totalChunks, percent: 0 },
      }],
    })),

    updateExtraBatch: (batchId, patch) => set((s) => ({
      extraBatches: s.extraBatches.map((b) => b.batchId === batchId ? { ...b, ...patch } : b),
    })),

    removeExtraBatch: (batchId) => set((s) => ({
      extraBatches: s.extraBatches.filter((b) => b.batchId !== batchId),
    })),

    markExtraBatchAcceptedBy: (batchId, peerId) => set((s) => ({
      extraBatches: s.extraBatches.map((b) => (
        b.batchId === batchId && b.role === 'sender' && !b.acceptedBy.includes(peerId)
          ? { ...b, status: 'transferring', acceptedBy: [...b.acceptedBy, peerId] }
          : b
      )),
    })),

    markFileDownloaded: (path) => set((s) => (
      s.downloadedPaths.includes(path) ? s : { downloadedPaths: [...s.downloadedPaths, path] }
    )),
    unmarkFileDownloaded: (path) => set((s) => ({
      downloadedPaths: s.downloadedPaths.filter((p) => p !== path),
    })),

    setComplete: (canSeed = true) => set((s) => {
      if (!s.fileMeta || s.role === null) return s
      if (s.status === 'complete') return s
      const meta = s.fileMeta
      const fileCount = meta?.files?.length || 1
      const totalChunks = meta?.totalChunks || s.progress.total
      const avgMbps = s.speedHistory.length > 0
        ? s.speedHistory.reduce((a, b) => a + b.mbps, 0) / s.speedHistory.length
        : 0
      addHistoryEntry({
        role: s.role,
        fileName: meta?.fileName || 'Unknown',
        fileSize: meta?.fileSize || 0,
        fileCount,
        totalChunks,
        chunkSize: meta?.chunkSize || 0,
        merkleRoot: meta?.merkleRoot || '',
        roomCode: s.roomCode || '',
        status: 'complete',
        duration: s.startTime ? Math.round((Date.now() - s.startTime) / 1000) : 0,
        avgSpeed: avgMbps,
        peers: s.peerStats.length,
      })
      return { status: 'complete', seeding: canSeed, canReseed: canSeed }
    }),
    setPaused: () => set({ status: 'paused' }),
    setError: (message) => set((s) => {
      if (!s.fileMeta || s.role === null) return s
      const meta = s.fileMeta
      addHistoryEntry({
        role: s.role,
        fileName: meta?.fileName || 'Unknown',
        fileSize: meta?.fileSize || 0,
        fileCount: meta?.files?.length || 1,
        totalChunks: meta?.totalChunks || 0,
        chunkSize: meta?.chunkSize || 0,
        merkleRoot: meta?.merkleRoot || '',
        roomCode: s.roomCode || '',
        status: 'failed',
        duration: s.startTime ? Math.round((Date.now() - s.startTime) / 1000) : 0,
        avgSpeed: 0,
        peers: s.peerStats.length,
      })
      return { status: 'error', error: message }
    }),

    reset: () => {
      localStorage.removeItem(STORAGE_KEY)
      set({ ...initial })
    },
  }
})

const KEY = STORAGE_KEY
let _persistTimer = null
useTransferStore.subscribe((state) => {
  if (state.status === 'idle') {
    localStorage.removeItem(KEY)
    return
  }
  const persistNow = state.status === 'complete' || state.status === 'error'
  const toSave = {
    role: state.role,
    status: state.status,
    error: state.error,
    fileMeta: state.fileMeta,
    progress: { verified: state.progress.verified, total: state.progress.total },
    saveMode: state.saveMode,
    seeding: state.seeding,
    canReseed: state.canReseed,
    roomCode: state.roomCode,
  }
  if (persistNow) {
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null }
    try { localStorage.setItem(KEY, JSON.stringify(toSave)) } catch { /* storage full */ }
    return
  }
  if (_persistTimer) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    try { localStorage.setItem(KEY, JSON.stringify(toSave)) } catch { /* storage full */ }
  }, 2000)
})
