import { describe, it, expect, vi } from 'vitest'
import { SwarmManager, MAX_CONSECUTIVE_FAILURES } from '../src/lib/swarmManager.js'
import { sha256Hex, buildMerkleTree, getMerkleProof, verifyChunk } from '../src/lib/browserCrypto.js'

// --- helpers ---

async function makeChunks(count, size = 64) {
  const chunks = []
  for (let i = 0; i < count; i++) {
    const buf = new Uint8Array(size)
    buf.fill(i + 1)
    chunks.push(buf)
  }
  return chunks
}

async function makeTree(chunks) {
  const hashes = []
  for (const c of chunks) hashes.push(await sha256Hex(c))
  const tree = await buildMerkleTree(hashes)
  return { hashes, tree }
}

// --- tests ---

describe('SwarmManager proof enforcement', () => {
  it('rejects a chunk with null proof on a multi-chunk file', async () => {
    const chunks = await makeChunks(4)
    const { hashes, tree } = await makeTree(chunks)

    const swarm = new SwarmManager(4, tree.root, 64)
    const failed = vi.fn()
    swarm.addEventListener('chunkFailed', (e) => failed(e.detail))

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)

    // Send chunk 0 with correct hash but null proof
    const accepted = await swarm.onChunkReceived('p1', 0, chunks[0], hashes[0], null)
    expect(accepted).toBe(false)
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'missing_proof', chunkIndex: 0 })
    )
  })

  it('accepts a chunk with a valid proof on a multi-chunk file', async () => {
    const chunks = await makeChunks(4)
    const { hashes, tree } = await makeTree(chunks)

    const swarm = new SwarmManager(4, tree.root, 64)
    const verified = vi.fn()
    swarm.addEventListener('chunkVerified', (e) => verified(e.detail))

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)

    const proof = getMerkleProof(tree, 0)
    const accepted = await swarm.onChunkReceived('p1', 0, chunks[0], hashes[0], proof)
    expect(accepted).toBe(true)
    expect(verified).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIndex: 0 })
    )
  })

  it('accepts a single-chunk file with its proof (tree pads single element)', async () => {
    const chunks = await makeChunks(1)
    const { hashes, tree } = await makeTree(chunks)

    const swarm = new SwarmManager(1, tree.root, 64)
    const verified = vi.fn()
    swarm.addEventListener('chunkVerified', (e) => verified(e.detail))
    swarm.addEventListener('complete', () => {})

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)

    // Single-chunk: buildMerkleTree pads with a duplicate, so proof has 1 entry
    const proof = getMerkleProof(tree, 0)
    // Proof is an array (may be non-empty due to padding) — should still be accepted
    expect(Array.isArray(proof)).toBe(true)
    const accepted = await swarm.onChunkReceived('p1', 0, chunks[0], hashes[0], proof)
    expect(accepted).toBe(true)
  })

  it('rejects a single-chunk file with a null proof, even when the reported hash matches the data', async () => {
    const chunks = await makeChunks(1)
    const { hashes, tree } = await makeTree(chunks)

    const swarm = new SwarmManager(1, tree.root, 64)
    const failed = vi.fn()
    swarm.addEventListener('chunkFailed', (e) => failed(e.detail))

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)

    // A malicious peer can send correct-looking data/hash but omit the proof —
    // this must not be accepted just because there's only one chunk.
    const accepted = await swarm.onChunkReceived('p1', 0, chunks[0], hashes[0], null)
    expect(accepted).toBe(false)
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'missing_proof', chunkIndex: 0 })
    )
  })

  it('rejects a single-chunk file where data+hash agree with each other but not the trusted merkleRoot', async () => {
    const chunks = await makeChunks(1)
    const { tree } = await makeTree(chunks)

    const swarm = new SwarmManager(1, tree.root, 64)
    const failed = vi.fn()
    swarm.addEventListener('chunkFailed', (e) => failed(e.detail))

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)

    // Malicious peer swaps in different data and self-reports its own matching hash.
    const forgedData = new Uint8Array(64).fill(99)
    const forgedHash = await sha256Hex(forgedData)
    const accepted = await swarm.onChunkReceived('p1', 0, forgedData, forgedHash, [])
    expect(accepted).toBe(false)
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIndex: 0 })
    )
  })

  it('rejects a chunk with an invalid proof', async () => {
    const chunks = await makeChunks(4)
    const { hashes, tree } = await makeTree(chunks)

    const swarm = new SwarmManager(4, tree.root, 64)
    const failed = vi.fn()
    swarm.addEventListener('chunkFailed', (e) => failed(e.detail))

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)

    // Tamper with the proof
    const proof = getMerkleProof(tree, 0)
    proof[0].hash = 'ff'.repeat(32)
    const accepted = await swarm.onChunkReceived('p1', 0, chunks[0], hashes[0], proof)
    expect(accepted).toBe(false)
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'proof_invalid' })
    )
  })
})

describe('sha256Hex with subarrays (non-zero offset)', () => {
  it('hashes the view correctly, not the underlying buffer', async () => {
    // Create a larger buffer
    const big = new Uint8Array(256)
    for (let i = 0; i < 256; i++) big[i] = i

    // The "chunk" is a subarray at offset 100, length 50
    const sub = big.subarray(100, 150)
    expect(sub.byteOffset).toBe(100)
    expect(sub.buffer.byteLength).toBe(256)

    // Hash the subarray vs a standalone copy
    const standalone = new Uint8Array(sub)
    expect(standalone.byteOffset).toBe(0)

    const hashSub = await sha256Hex(sub)
    const hashStandalone = await sha256Hex(standalone)
    expect(hashSub).toBe(hashStandalone)
  })

  it('verifyChunk works with subarray data', async () => {
    const big = new Uint8Array(256)
    for (let i = 0; i < 256; i++) big[i] = i

    const chunk1 = big.subarray(0, 128)
    const chunk2 = big.subarray(128, 256)
    const chunks = [chunk1, chunk2]
    const { hashes, tree } = await makeTree(chunks.map(c => new Uint8Array(c)))

    // Verify using the original subarray (not a copy)
    const proof = getMerkleProof(tree, 0)
    const valid = await verifyChunk(chunk1, proof, tree.root)
    expect(valid).toBe(true)
  })
})

describe('Merkle tree round-trip', () => {
  it('rebuilds identical root from chunk hashes', async () => {
    const chunks = await makeChunks(8)
    const { hashes, tree } = await makeTree(chunks)

    // Simulate receiver rebuilding
    const rebuildHashes = []
    for (const c of chunks) rebuildHashes.push(await sha256Hex(c))
    const rebuilt = await buildMerkleTree(rebuildHashes)

    expect(rebuilt.root).toBe(tree.root)
  })
})
