import { create } from 'zustand'
import { addHistoryEntry } from './useHistoryStore.js'

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
  saveMode: 'files',
  startTime: null,
  roomCode: '',
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
      fileMeta,
      chunkStates: new Array(fileMeta.totalChunks).fill('pending'),
      progress: { verified: 0, total: fileMeta.totalChunks, percent: 0 },
      error: null, startTime: Date.now(),
    }),

    startAsReceiver: () => set({
      role: 'receiver',
      status: 'waiting-for-file',
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

    setComplete: () => set((s) => {
      if (!s.fileMeta || s.role === null) return s
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
      return { status: 'complete', seeding: true }
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
useTransferStore.subscribe((state) => {
  if (state.status === 'idle') {
    localStorage.removeItem(KEY)
    return
  }
  try {
    const toSave = {
      role: state.role,
      status: state.status,
      fileMeta: state.fileMeta,
      progress: state.progress,
      chunkStates: state.chunkStates,
      peerStats: state.peerStats,
      speedHistory: state.speedHistory,
      error: state.error,
      seeding: state.seeding,
      saveMode: state.saveMode,
      roomCode: state.roomCode,
    }
    localStorage.setItem(KEY, JSON.stringify(toSave))
  } catch { /* storage full */ }
})
