import { describe, it, expect, beforeEach } from 'vitest'
import { SwarmManager } from '../src/lib/swarmManager.js'
import { transferManager as M } from '../src/lib/transferManager.js'
import { sha256Hex, buildMerkleTree, getMerkleProof } from '../src/lib/browserCrypto.js'
import { MSG } from '../src/webrtc/protocol.js'

class FakeStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
}
global.localStorage = new FakeStorage()

// useTransfer.js transitively imports useTransferStore.js, which touches
// localStorage at import time — dynamic import so the fake above is in
// place first (static imports are hoisted ahead of this file's own code).
const { runDiskResumePreflight } = await import('../src/hooks/useTransfer.js')

const CHUNK_SIZE = 64

function makeFile(bytes) {
  return {
    size: bytes.byteLength,
    slice(start, end) {
      const region = bytes.slice(start, end)
      return { arrayBuffer: async () => region.buffer.slice(region.byteOffset, region.byteOffset + region.byteLength) }
    },
  }
}

function makeFakeDirHandle(filesByPath) {
  return {
    async getFileHandle(name) {
      if (!filesByPath.has(name)) throw new Error('not found')
      return { getFile: async () => filesByPath.get(name) }
    },
    async getDirectoryHandle() { throw new Error('no subdirectories in this fake') },
  }
}

class FakeTransport {
  constructor() {
    this.jsonHandler = null
    this.sent = []
    this.offeredRoot = null
  }
  onJSON(handler) { this.jsonHandler = handler }
  sendJSON(msg) {
    this.sent.push(msg)
    if (this._responder) this._responder(msg)
  }
  respondWith(fn) { this._responder = fn }
  receive(msg) { this.jsonHandler?.(msg) }
}

describe('runDiskResumePreflight (Stage C)', () => {
  beforeEach(() => {
    M.reset()
  })

  it('marks on-disk chunks verified only after proof-checking them against the trusted merkleRoot', async () => {
    // Two whole chunks already on disk from before a reload.
    const chunk0 = new Uint8Array(CHUNK_SIZE).fill(1)
    const chunk1 = new Uint8Array(CHUNK_SIZE).fill(2)
    const hashes = [await sha256Hex(chunk0), await sha256Hex(chunk1)]
    const tree = await buildMerkleTree(hashes)

    const meta = {
      merkleRoot: tree.root,
      chunkSize: CHUNK_SIZE,
      totalChunks: 2,
      files: [{ path: 'a.bin', name: 'a.bin', size: CHUNK_SIZE * 2, startChunk: 0, chunkCount: 2 }],
    }

    const onDiskBytes = new Uint8Array(CHUNK_SIZE * 2)
    onDiskBytes.set(chunk0, 0)
    onDiskBytes.set(chunk1, CHUNK_SIZE)
    const dirHandle = makeFakeDirHandle(new Map([['a.bin', makeFile(onDiskBytes)]]))
    M.streamHandle = { dirHandle }
    M.chunks = new Array(2)
    M.fileRemaining = new Map([['a.bin', 2]])

    const swarm = new SwarmManager(2, tree.root, CHUNK_SIZE)
    const transport = new FakeTransport()
    transport.respondWith((msg) => {
      if (msg.type !== MSG.CHUNK_PROOF_REQUEST) return
      const proof = getMerkleProof(tree, msg.index)
      transport.receive({ type: MSG.CHUNK_PROOF, index: msg.index, hash: hashes[msg.index], proof })
    })

    await runDiskResumePreflight(transport, swarm, meta)

    expect(swarm.verifiedCount).toBe(2)
    expect(swarm.isComplete()).toBe(true)
    expect(M.chunks[0]).toBe(true)
    expect(M.chunks[1]).toBe(true)
    expect(M.fileRemaining.get('a.bin')).toBe(0)
  })

  it('rejects on-disk bytes that do not match the peer-supplied proof (corrupted/incomplete write)', async () => {
    const chunk0 = new Uint8Array(CHUNK_SIZE).fill(1)
    const hashes = [await sha256Hex(chunk0)]
    const tree = await buildMerkleTree(hashes)

    const meta = {
      merkleRoot: tree.root,
      chunkSize: CHUNK_SIZE,
      totalChunks: 1,
      files: [{ path: 'a.bin', name: 'a.bin', size: CHUNK_SIZE, startChunk: 0, chunkCount: 1 }],
    }

    // On-disk bytes are corrupted relative to what the sender actually sent.
    const corrupted = new Uint8Array(CHUNK_SIZE).fill(9)
    const dirHandle = makeFakeDirHandle(new Map([['a.bin', makeFile(corrupted)]]))
    M.streamHandle = { dirHandle }
    M.chunks = new Array(1)
    M.fileRemaining = new Map([['a.bin', 1]])

    const swarm = new SwarmManager(1, tree.root, CHUNK_SIZE)
    const transport = new FakeTransport()
    transport.respondWith((msg) => {
      if (msg.type !== MSG.CHUNK_PROOF_REQUEST) return
      const proof = getMerkleProof(tree, msg.index)
      transport.receive({ type: MSG.CHUNK_PROOF, index: msg.index, hash: hashes[msg.index], proof })
    })

    await runDiskResumePreflight(transport, swarm, meta)

    expect(swarm.verifiedCount).toBe(0)
    expect(M.chunks[0]).toBeUndefined()
  })

  it('also verifies a file\'s last (short) chunk once the whole file is present on disk', async () => {
    // File is 100 bytes over 64-byte chunks: chunk 0 is a full 64 bytes,
    // chunk 1 is only 36 bytes — naive floor(fileSize/chunkSize) math would
    // exclude chunk 1 from candidacy even though it's fully written.
    const chunk0 = new Uint8Array(64).fill(1)
    const chunk1 = new Uint8Array(36).fill(2)
    const hashes = [await sha256Hex(chunk0), await sha256Hex(chunk1)]
    const tree = await buildMerkleTree(hashes)

    const meta = {
      merkleRoot: tree.root,
      chunkSize: CHUNK_SIZE,
      totalChunks: 2,
      files: [{ path: 'a.bin', name: 'a.bin', size: 100, startChunk: 0, chunkCount: 2 }],
    }

    const onDiskBytes = new Uint8Array(100)
    onDiskBytes.set(chunk0, 0)
    onDiskBytes.set(chunk1, 64)
    const dirHandle = makeFakeDirHandle(new Map([['a.bin', makeFile(onDiskBytes)]]))
    M.streamHandle = { dirHandle }
    M.chunks = new Array(2)
    M.fileRemaining = new Map([['a.bin', 2]])

    const swarm = new SwarmManager(2, tree.root, CHUNK_SIZE)
    const transport = new FakeTransport()
    transport.respondWith((msg) => {
      if (msg.type !== MSG.CHUNK_PROOF_REQUEST) return
      const proof = getMerkleProof(tree, msg.index)
      transport.receive({ type: MSG.CHUNK_PROOF, index: msg.index, hash: hashes[msg.index], proof })
    })

    await runDiskResumePreflight(transport, swarm, meta)

    expect(swarm.verifiedCount).toBe(2)
    expect(M.chunks[1]).toBe(true)
    expect(M.fileRemaining.get('a.bin')).toBe(0)
  })

  it('is a no-op when there is no streamed directory handle', async () => {
    const meta = { merkleRoot: 'a'.repeat(64), chunkSize: CHUNK_SIZE, totalChunks: 1, files: [{ path: 'a.bin', name: 'a.bin', size: CHUNK_SIZE, startChunk: 0, chunkCount: 1 }] }
    M.streamHandle = null
    const swarm = new SwarmManager(1, meta.merkleRoot, CHUNK_SIZE)
    const transport = new FakeTransport()
    await runDiskResumePreflight(transport, swarm, meta)
    expect(swarm.verifiedCount).toBe(0)
    expect(transport.sent).toHaveLength(0)
  })

  it('skips files that do not exist on disk yet', async () => {
    const meta = {
      merkleRoot: 'a'.repeat(64),
      chunkSize: CHUNK_SIZE,
      totalChunks: 1,
      files: [{ path: 'missing.bin', name: 'missing.bin', size: CHUNK_SIZE, startChunk: 0, chunkCount: 1 }],
    }
    M.streamHandle = { dirHandle: makeFakeDirHandle(new Map()) }
    M.chunks = new Array(1)
    const swarm = new SwarmManager(1, meta.merkleRoot, CHUNK_SIZE)
    const transport = new FakeTransport()
    await runDiskResumePreflight(transport, swarm, meta)
    expect(swarm.verifiedCount).toBe(0)
    expect(transport.sent).toHaveLength(0)
  })
})
