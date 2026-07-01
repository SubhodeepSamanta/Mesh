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
    if (get().client) return get().client
    set({ status: 'connecting', error: null })
    const client = new SignalingClient(SIGNALING_URL)

    client.addEventListener('peerJoined', (e) => {
      set((state) => ({ peers: [...state.peers, e.detail.peerId] }))
    })
    client.addEventListener('peerLeft', (e) => {
      set((state) => ({ peers: state.peers.filter((id) => id !== e.detail.peerId) }))
    })
    client.addEventListener('signalingError', (e) => {
      set({ error: e.detail.message })
    })
    client.addEventListener('close', () => {
      set({ status: 'idle' })
    })

    try {
      await client.connect()
      set({ client, status: 'connected' })
      return client
    } catch (err) {
      set({ status: 'error', error: err.message })
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
    set({ roomCode: result.roomCode, peerId: result.peerId, peers: result.existingPeers })
    return result
  },

  disconnect: () => {
    const client = get().client
    if (client) client.close()
    set({ client: null, status: 'idle', roomCode: null, peerId: null, peers: [], error: null })
  },
}))