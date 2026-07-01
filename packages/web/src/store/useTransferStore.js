import { create } from 'zustand'

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
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || !saved.fileMeta) return null
    if (saved.chunkStates) {
      saved.chunkStates = new Array(saved.fileMeta.totalChunks).fill('pending')
      if (saved.progress.verified > 0) {
        for (let i = 0; i < saved.progress.verified && i < saved.chunkStates.length; i++) {
          saved.chunkStates[i] = 'verified'
        }
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
      fileMeta,
      chunkStates: new Array(fileMeta.totalChunks).fill('pending'),
      progress: { verified: 0, total: fileMeta.totalChunks, percent: 0 },
      error: null,
    }),

    startAsReceiver: () => set({
      role: 'receiver',
      status: 'waiting-for-file',
      fileMeta: null,
      progress: { verified: 0, total: 0, percent: 0 },
      chunkStates: [],
      peerStats: [],
      speedHistory: [],
      error: null,
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

    recordSpeedSample: (mbps) => set((s) => ({
      speedHistory: [...s.speedHistory.slice(-59), { t: Date.now(), mbps }],
    })),

    setComplete: () => set({ status: 'complete' }),
    setPaused: () => set({ status: 'paused' }),
    setError: (message) => set({ status: 'error', error: message }),

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
      peerStats: state.peerStats,
      speedHistory: state.speedHistory,
      error: state.error,
    }
    localStorage.setItem(KEY, JSON.stringify(toSave))
  } catch { /* storage full */ }
})
