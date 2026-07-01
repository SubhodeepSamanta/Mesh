import { create } from 'zustand'

export const useTransferStore = create((set, get) => ({
  role: null,
  status: 'idle',
  fileMeta: null,
  progress: { verified: 0, total: 0, percent: 0 },
  peerStats: [],
  speedHistory: [],
  error: null,

  startAsSender: (fileMeta) => {
    set({ role: 'sender', status: 'waiting-for-peer', fileMeta, error: null })
  },

  startAsReceiver: () => {
    set({ role: 'receiver', status: 'waiting-for-file', fileMeta: null, error: null })
  },

  setIncomingFile: (fileMeta) => {
    set({ fileMeta, status: 'file-offered' })
  },

  setTransferring: () => {
    set({ status: 'transferring', speedHistory: [] })
  },

  updateProgress: (progress) => {
    set({ progress })
  },

  updatePeerStats: (peerStats) => {
    set({ peerStats })
  },

  recordSpeedSample: (mbps) => {
    set((state) => ({
      speedHistory: [...state.speedHistory.slice(-59), { t: Date.now(), mbps }],
    }))
  },

  setComplete: () => {
    set({ status: 'complete' })
  },

  setPaused: () => {
    set({ status: 'paused' })
  },

  setError: (message) => {
    set({ status: 'error', error: message })
  },

  reset: () => {
    set({
      role: null,
      status: 'idle',
      fileMeta: null,
      progress: { verified: 0, total: 0, percent: 0 },
      peerStats: [],
      speedHistory: [],
      error: null,
    })
  },
}))