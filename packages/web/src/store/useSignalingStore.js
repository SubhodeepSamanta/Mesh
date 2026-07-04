import { create } from 'zustand'
import { SignalingClient } from '../webrtc/signalingClient.js'

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:8080'
const SESSION_KEY = 'mesh-signaling-session'

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s || !s.roomCode || !s.peerId || !s.rejoinToken) return null
    return s
  } catch { return null }
}

function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* storage full */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

// Exported so other stores (useTransferStore) can decide whether a reload
// is even worth attempting to resume, without importing this store directly.
export function hasPersistedSession() {
  return loadSession() != null
}

export { clearSession as clearPersistedSession }

export const useSignalingStore = create((set, get) => {
  function attachListeners(c) {
    c.addEventListener('peerJoined', (e) => {
      set((s) => ({ peers: [...s.peers, e.detail.peerId] }))
    })
    c.addEventListener('peerLeft', (e) => {
      set((s) => ({ peers: s.peers.filter((p) => p !== e.detail.peerId) }))
    })
    c.addEventListener('close', () => {
      set({ status: 'disconnected', peers: [] })
    })
    c.addEventListener('reconnect', (e) => {
      const existingPeers = e.detail?.existingPeers
      set((s) => ({ status: 'connected', peers: existingPeers ?? s.peers, roomCode: c.roomCode, peerId: c.peerId }))
      saveSession({ roomCode: c.roomCode, peerId: c.peerId, rejoinToken: c._rejoinToken })
    })
    c.addEventListener('reconnectFailed', () => {
      // Once retries are exhausted this client is permanently dead — drop it
      // from the store too (not just the UI-facing fields). Otherwise
      // connect()/resumeSession()'s "if (client) return client" guard would
      // hand back this same dead client on the next attempt, whose socket
      // is closed and isn't retrying anything, so a caller waiting on a
      // fresh 'reconnect'/'reconnectFailed' event would hang forever.
      try { c.close() } catch {}
      set((s) => ({
        ...(s.client === c ? { client: null } : {}),
        status: 'disconnected', peers: [], roomCode: null, peerId: null, error: 'Room connection lost',
      }))
      clearSession()
    })
  }

  return {
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
        attachListeners(c)
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
      saveSession({ roomCode: result.roomCode, peerId: result.peerId, rejoinToken: result.rejoinToken })
      return result
    },

    joinRoom: async (roomCode, password) => {
      const client = await get().connect()
      const result = await client.joinRoom(roomCode, password)
      set({ roomCode, peerId: result.peerId, peers: result.existingPeers || [] })
      saveSession({ roomCode, peerId: result.peerId, rejoinToken: result.rejoinToken })
      return result
    },

    // Used only by the reload-recovery path (useSessionResume): rebuilds a
    // SignalingClient seeded with a previously persisted session so the
    // existing REJOIN_ROOM handshake fires as soon as the socket opens —
    // the server doesn't distinguish "reload" from "network blip".
    resumeSession: async () => {
      const { client } = get()
      if (client) return client
      const saved = loadSession()
      if (!saved) return null
      set({ status: 'connecting', error: null })
      try {
        const c = new SignalingClient(SIGNALING_URL)
        c.peerId = saved.peerId
        c.roomCode = saved.roomCode
        c._rejoinToken = saved.rejoinToken
        attachListeners(c)
        await c.connect()
        set({ client: c, status: 'connected' })
        return c
      } catch (err) {
        set({ status: 'error', error: err.message || 'Connection failed' })
        return null
      }
    },

    disconnect: () => {
      const { client } = get()
      if (client) client.close()
      clearSession()
      set({ client: null, status: 'idle', roomCode: null, peerId: null, peers: [], error: null })
    },

    reset: () => {
      set({ status: 'idle', roomCode: null, peerId: null, peers: [], error: null })
    },
  }
})
