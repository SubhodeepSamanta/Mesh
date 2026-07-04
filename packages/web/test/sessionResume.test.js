import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MSG_TYPE } from '../src/webrtc/signalingClient.js'

class FakeWebSocket extends EventTarget {
  constructor(url) {
    super()
    this.url = url
    this.sent = []
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.dispatchEvent(new Event('close')) }
  emitServerMessage(obj) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(obj) }))
  }
}
FakeWebSocket.instances = []

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

class FakeStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
}

describe('signaling session persistence + resume', () => {
  let originalWebSocket
  let originalLocalStorage

  beforeEach(() => {
    originalWebSocket = global.WebSocket
    originalLocalStorage = global.localStorage
    global.WebSocket = FakeWebSocket
    global.localStorage = new FakeStorage()
    FakeWebSocket.instances = []
    vi.resetModules()
  })

  afterEach(() => {
    global.WebSocket = originalWebSocket
    global.localStorage = originalLocalStorage
  })

  it('persists the session after createRoom and exposes it via hasPersistedSession', async () => {
    const { useSignalingStore, hasPersistedSession } = await import('../src/store/useSignalingStore.js')
    expect(hasPersistedSession()).toBe(false)

    const createPromise = useSignalingStore.getState().createRoom()
    const socket = FakeWebSocket.instances[0]
    await flush()
    socket.emitServerMessage({ type: MSG_TYPE.ROOM_CREATED, roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' })
    await createPromise

    expect(hasPersistedSession()).toBe(true)
    const raw = JSON.parse(global.localStorage.getItem('mesh-signaling-session'))
    expect(raw).toEqual({ roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' })
  })

  it('clearPersistedSession removes the stored session', async () => {
    const { useSignalingStore, hasPersistedSession, clearPersistedSession } = await import('../src/store/useSignalingStore.js')
    const createPromise = useSignalingStore.getState().createRoom()
    const socket = FakeWebSocket.instances[0]
    await flush()
    socket.emitServerMessage({ type: MSG_TYPE.ROOM_CREATED, roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' })
    await createPromise

    expect(hasPersistedSession()).toBe(true)
    clearPersistedSession()
    expect(hasPersistedSession()).toBe(false)
  })

  it('disconnect() clears the persisted session', async () => {
    const { useSignalingStore, hasPersistedSession } = await import('../src/store/useSignalingStore.js')
    const createPromise = useSignalingStore.getState().createRoom()
    const socket = FakeWebSocket.instances[0]
    await flush()
    socket.emitServerMessage({ type: MSG_TYPE.ROOM_CREATED, roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' })
    await createPromise

    useSignalingStore.getState().disconnect()
    expect(hasPersistedSession()).toBe(false)
  })

  it('resumeSession() seeds a fresh client from the saved session and auto-sends REJOIN_ROOM', async () => {
    global.localStorage.setItem('mesh-signaling-session', JSON.stringify({ roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' }))
    const { useSignalingStore } = await import('../src/store/useSignalingStore.js')

    const client = await useSignalingStore.getState().resumeSession()
    expect(client).not.toBeNull()

    const socket = FakeWebSocket.instances[0]
    expect(socket.sent[0]).toEqual({
      type: MSG_TYPE.REJOIN_ROOM,
      roomCode: 'ABCD',
      peerId: 'peer1',
      rejoinToken: 'tok-1',
    })

    const reconnectDetail = new Promise((resolve) => {
      client.addEventListener('reconnect', (e) => resolve(e.detail))
    })
    socket.emitServerMessage({
      type: MSG_TYPE.ROOM_REJOINED,
      roomCode: 'ABCD',
      peerId: 'peer1',
      existingPeers: ['peer2'],
      rejoinToken: 'tok-1',
    })

    await expect(reconnectDetail).resolves.toEqual({ existingPeers: ['peer2'] })
    expect(useSignalingStore.getState().status).toBe('connected')
    expect(useSignalingStore.getState().peers).toEqual(['peer2'])
  })

  it('resumeSession() returns null when there is no persisted session', async () => {
    const { useSignalingStore } = await import('../src/store/useSignalingStore.js')
    const client = await useSignalingStore.getState().resumeSession()
    expect(client).toBeNull()
  })

  it('reconnectFailed clears the persisted session', async () => {
    global.localStorage.setItem('mesh-signaling-session', JSON.stringify({ roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' }))
    const { useSignalingStore, hasPersistedSession } = await import('../src/store/useSignalingStore.js')

    await useSignalingStore.getState().resumeSession()
    const socket = FakeWebSocket.instances[0]
    socket.emitServerMessage({ type: MSG_TYPE.ERROR, message: 'Cannot rejoin room' })

    await vi.waitFor(() => expect(hasPersistedSession()).toBe(false))
  })

  it('reconnectFailed drops the dead client so a later retry builds a fresh one instead of hanging on the stale client', async () => {
    global.localStorage.setItem('mesh-signaling-session', JSON.stringify({ roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' }))
    const { useSignalingStore } = await import('../src/store/useSignalingStore.js')

    const firstClient = await useSignalingStore.getState().resumeSession()
    expect(useSignalingStore.getState().client).toBe(firstClient)

    const socket = FakeWebSocket.instances[0]
    socket.emitServerMessage({ type: MSG_TYPE.ERROR, message: 'Cannot rejoin room' })
    await flush()

    // The dead client must be gone — otherwise connect()/resumeSession()'s
    // "if (client) return client" guard would hand it back forever.
    expect(useSignalingStore.getState().client).toBeNull()

    // A retry (e.g. the user re-picking files in SenderResumePrompt) must be
    // able to build and use a brand-new client rather than getting stuck.
    global.localStorage.setItem('mesh-signaling-session', JSON.stringify({ roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' }))
    const secondClient = await useSignalingStore.getState().resumeSession()
    expect(secondClient).not.toBeNull()
    expect(secondClient).not.toBe(firstClient)
    expect(FakeWebSocket.instances.length).toBe(2)
  })
})

describe('useTransferStore reload handling', () => {
  beforeEach(() => {
    global.localStorage = new FakeStorage()
    vi.resetModules()
  })

  it('marks a live receiver transfer as reconnecting when a signaling session is persisted', async () => {
    global.localStorage.setItem('mesh-signaling-session', JSON.stringify({ roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' }))
    global.localStorage.setItem('mesh-transfer-state', JSON.stringify({
      role: 'receiver',
      status: 'transferring',
      fileMeta: { fileName: 'movie.mp4', fileSize: 1024, totalChunks: 4, chunkSize: 256, merkleRoot: 'a'.repeat(64) },
      progress: { verified: 1, total: 4 },
      saveMode: 'files',
      seeding: false,
      canReseed: false,
      roomCode: 'ABCD',
    }))

    const { useTransferStore } = await import('../src/store/useTransferStore.js')
    expect(useTransferStore.getState().status).toBe('reconnecting')
    expect(useTransferStore.getState().error).toBeNull()
  })

  it('marks a live sender transfer as reconnecting-sender when a signaling session is persisted (Stage D prompt)', async () => {
    global.localStorage.setItem('mesh-signaling-session', JSON.stringify({ roomCode: 'ABCD', peerId: 'peer1', rejoinToken: 'tok-1' }))
    global.localStorage.setItem('mesh-transfer-state', JSON.stringify({
      role: 'sender',
      status: 'transferring',
      fileMeta: { fileName: 'movie.mp4', fileSize: 1024, totalChunks: 4, chunkSize: 256, merkleRoot: 'a'.repeat(64) },
      progress: { verified: 1, total: 4 },
      saveMode: 'files',
      seeding: true,
      canReseed: true,
      roomCode: 'ABCD',
    }))

    const { useTransferStore } = await import('../src/store/useTransferStore.js')
    expect(useTransferStore.getState().status).toBe('reconnecting-sender')
    expect(useTransferStore.getState().error).toBeNull()
  })

  it('hard-fails a live sender transfer on reload when there is no persisted signaling session', async () => {
    global.localStorage.setItem('mesh-transfer-state', JSON.stringify({
      role: 'sender',
      status: 'transferring',
      fileMeta: { fileName: 'movie.mp4', fileSize: 1024, totalChunks: 4, chunkSize: 256, merkleRoot: 'a'.repeat(64) },
      progress: { verified: 1, total: 4 },
      saveMode: 'files',
      seeding: true,
      canReseed: true,
      roomCode: 'ABCD',
    }))

    const { useTransferStore } = await import('../src/store/useTransferStore.js')
    expect(useTransferStore.getState().status).toBe('error')
  })

  it('hard-fails a live receiver transfer on reload when there is no persisted signaling session', async () => {
    global.localStorage.setItem('mesh-transfer-state', JSON.stringify({
      role: 'receiver',
      status: 'transferring',
      fileMeta: { fileName: 'movie.mp4', fileSize: 1024, totalChunks: 4, chunkSize: 256, merkleRoot: 'a'.repeat(64) },
      progress: { verified: 1, total: 4 },
      saveMode: 'files',
      seeding: false,
      canReseed: false,
      roomCode: 'ABCD',
    }))

    const { useTransferStore } = await import('../src/store/useTransferStore.js')
    expect(useTransferStore.getState().status).toBe('error')
  })
})
