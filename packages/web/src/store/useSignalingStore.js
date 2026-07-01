import { create } from 'zustand'
import { SignalingClient } from '../webrtc/signalingClient.js'

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:8080'

export const useSignalingStore = create((set, get) => ({
  client: null,
  status: 'idle',
  roomCode: null,
  peerId: null,
  peers: [],
  error: null,

  connect: async () => {
    const { client } = get()
    if (client) return client
    set({ status: 'connecting', error: null })
    try {
      const c = new SignalingClient(SIGNALING_URL)
      c.addEventListener('peerJoined', (e) => {
        set((s) => ({ peers: [...s.peers, e.detail.peerId] }))
      })
      c.addEventListener('peerLeft', (e) => {
        set((s) => ({ peers: s.peers.filter((p) => p !== e.detail.peerId) }))
      })
      c.addEventListener('close', () => {
        const s = get()
        set({ client: null, status: 'disconnected', peerId: null, peers: [] })
        if (!s.roomCode) set({ roomCode: null })
      })
      await c.connect()
      set({ client: c, status: 'connected' })
      return c
    } catch (err) {
      set({ status: 'error', error: err.message || 'Connection failed' })
      throw err
    }
  },

  createRoom: async (password) => {
    const client = await get().connect()
    const result = await client.createRoom(password)
    set({ roomCode: result.roomCode, peerId: result.peerId, peers: [] })
    return result
  },

  joinRoom: async (roomCode, password) => {
    const client = await get().connect()
    const result = await client.joinRoom(roomCode, password)
    set({ roomCode, peerId: result.peerId, peers: result.existingPeers || [] })
    return result
  },

  disconnect: () => {
    const { client } = get()
    if (client) client.close()
    set({ client: null, status: 'idle', roomCode: null, peerId: null, peers: [], error: null })
  },

  reset: () => {
    set({ status: 'idle', roomCode: null, peerId: null, peers: [], error: null })
  },
}))
