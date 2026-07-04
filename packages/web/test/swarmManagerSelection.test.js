import { describe, it, expect, vi } from 'vitest'
import { SwarmManager } from '../src/lib/swarmManager.js'
import { sha256Hex, buildMerkleTree, getMerkleProof } from '../src/lib/browserCrypto.js'

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

describe('SwarmManager adaptive per-peer pipeline depth (§7)', () => {
  it('grows a reliable peer\'s pipeline with each verified chunk (additive increase)', async () => {
    const N = 10
    const chunks = await makeChunks(N)
    const { hashes, tree } = await makeTree(chunks)
    const swarm = new SwarmManager(N, tree.root, 64)

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('fast', reqFn)
    const initial = swarm.getPeerStats().find((p) => p.id === 'fast').pipelineSize

    for (let i = 0; i < N; i++) {
      const proof = getMerkleProof(tree, i)
      await swarm.onChunkReceived('fast', i, chunks[i], hashes[i], proof)
    }

    const grown = swarm.getPeerStats().find((p) => p.id === 'fast')
    expect(grown.pipelineSize).toBeGreaterThan(initial)
    expect(grown.avgRttMs).not.toBeNull()
  })

  it('shrinks a peer\'s pipeline on timeout/request failure (multiplicative decrease)', async () => {
    const chunks = await makeChunks(6)
    const { hashes, tree } = await makeTree(chunks)
    const swarm = new SwarmManager(6, tree.root, 64)

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('slow', reqFn)
    // Grow it first so there's something to shrink.
    for (let i = 0; i < 4; i++) {
      const proof = getMerkleProof(tree, i)
      await swarm.onChunkReceived('slow', i, chunks[i], hashes[i], proof)
    }
    const grown = swarm.getPeerStats().find((p) => p.id === 'slow').pipelineSize
    expect(grown).toBeGreaterThan(2)

    // Simulate a still-outstanding request timing out.
    const pendingIdx = [...swarm.peers.get('slow').pending][0]
    swarm._handleChunkTimeout('slow', pendingIdx)

    const shrunk = swarm.getPeerStats().find((p) => p.id === 'slow').pipelineSize
    expect(shrunk).toBeLessThan(grown)
    expect(shrunk).toBeGreaterThanOrEqual(2) // never below MIN_PIPELINE
  })

  it('gives independent, differently-sized windows to a fast and a lossy peer sharing the same swarm', async () => {
    const N = 20
    const chunks = await makeChunks(N)
    const { hashes, tree } = await makeTree(chunks)
    const swarm = new SwarmManager(N, tree.root, 64)

    const reqFast = vi.fn().mockResolvedValue()
    const reqLossy = vi.fn().mockResolvedValue()
    swarm.addPeer('fast', reqFast)
    swarm.addPeer('lossy', reqLossy)

    // Fast peer verifies everything offered to it cleanly.
    for (let i = 0; i < N; i += 2) {
      if (swarm.chunkState[i] !== 'requested') continue
      const proof = getMerkleProof(tree, i)
      await swarm.onChunkReceived('fast', i, chunks[i], hashes[i], proof)
    }
    // Lossy peer times out on everything outstanding to it, repeatedly.
    for (let round = 0; round < 3; round++) {
      const lossyPeer = swarm.peers.get('lossy')
      if (!lossyPeer) break
      for (const idx of [...lossyPeer.pending]) {
        swarm._handleChunkTimeout('lossy', idx)
      }
    }

    const fastSize = swarm.getPeerStats().find((p) => p.id === 'fast')?.pipelineSize
    const lossySize = swarm.getPeerStats().find((p) => p.id === 'lossy')?.pipelineSize
    expect(fastSize).toBeGreaterThan(lossySize)
  })
})

describe('SwarmManager chunk exclusion (selective download)', () => {
  it('never enqueues excluded chunks for any peer', async () => {
    const chunks = await makeChunks(4)
    const { tree } = await makeTree(chunks)
    const swarm = new SwarmManager(4, tree.root, 64, [], [2, 3])

    const requested = []
    const reqFn = vi.fn((i) => { requested.push(i); return Promise.resolve() })
    swarm.addPeer('p1', reqFn)

    expect(requested.sort()).toEqual([0, 1])
    expect(swarm.neededCount).toBe(2)
  })

  it('completes once every selected (non-excluded) chunk verifies, without waiting on excluded ones', async () => {
    const chunks = await makeChunks(4)
    const { hashes, tree } = await makeTree(chunks)
    const swarm = new SwarmManager(4, tree.root, 64, [], [2, 3])
    const complete = vi.fn()
    swarm.addEventListener('complete', complete)

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)

    for (const i of [0, 1]) {
      const proof = getMerkleProof(tree, i)
      await swarm.onChunkReceived('p1', i, chunks[i], hashes[i], proof)
    }

    expect(complete).toHaveBeenCalledTimes(1)
    expect(swarm.isComplete()).toBe(true)
  })

  it('applySelection excludes chunks after construction and completes immediately if already satisfied', async () => {
    const chunks = await makeChunks(4)
    const { hashes, tree } = await makeTree(chunks)
    const swarm = new SwarmManager(4, tree.root, 64)

    const proof0 = getMerkleProof(tree, 0)
    const proof1 = getMerkleProof(tree, 1)
    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)
    await swarm.onChunkReceived('p1', 0, chunks[0], hashes[0], proof0)
    await swarm.onChunkReceived('p1', 1, chunks[1], hashes[1], proof1)

    expect(swarm.isComplete()).toBe(false)

    const complete = vi.fn()
    swarm.addEventListener('complete', complete)
    swarm.applySelection([2, 3])

    expect(swarm.isComplete()).toBe(true)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(swarm.neededCount).toBe(2)
  })

  it('applySelection does not exclude a chunk that already verified', async () => {
    const chunks = await makeChunks(2)
    const { hashes, tree } = await makeTree(chunks)
    const swarm = new SwarmManager(2, tree.root, 64)
    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)
    const proof0 = getMerkleProof(tree, 0)
    await swarm.onChunkReceived('p1', 0, chunks[0], hashes[0], proof0)

    swarm.applySelection([0, 1])

    // chunk 0 was already verified — excluding chunk 1 alone is enough to complete
    expect(swarm.neededCount).toBe(1)
    expect(swarm.isComplete()).toBe(true)
  })

  it('markAlreadyVerified accepts pre-verified indices without dispatching chunkVerified, and requests only the rest', async () => {
    const chunks = await makeChunks(4)
    const { tree } = await makeTree(chunks)
    const swarm = new SwarmManager(4, tree.root, 64)
    const chunkVerified = vi.fn()
    swarm.addEventListener('chunkVerified', chunkVerified)

    swarm.markAlreadyVerified([0, 1])
    expect(swarm.verifiedCount).toBe(2)
    expect(chunkVerified).not.toHaveBeenCalled()

    const requested = []
    const reqFn = vi.fn((i) => { requested.push(i); return Promise.resolve() })
    swarm.addPeer('p1', reqFn)
    expect(requested.sort()).toEqual([2, 3])
  })

  it('markAlreadyVerified dispatches complete when it finishes the transfer', async () => {
    const chunks = await makeChunks(2)
    const { tree } = await makeTree(chunks)
    const swarm = new SwarmManager(2, tree.root, 64)
    const complete = vi.fn()
    swarm.addEventListener('complete', complete)

    swarm.markAlreadyVerified([0, 1])
    expect(swarm.isComplete()).toBe(true)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('progress() and chunkVerified events report against neededCount, not totalChunks', async () => {
    const chunks = await makeChunks(4)
    const { hashes, tree } = await makeTree(chunks)
    const swarm = new SwarmManager(4, tree.root, 64, [], [2, 3])
    const seen = []
    swarm.addEventListener('chunkVerified', (e) => seen.push(e.detail.total))

    const reqFn = vi.fn().mockResolvedValue()
    swarm.addPeer('p1', reqFn)
    const proof0 = getMerkleProof(tree, 0)
    await swarm.onChunkReceived('p1', 0, chunks[0], hashes[0], proof0)

    expect(seen).toEqual([2])
    expect(swarm.progress()).toEqual({ verified: 1, total: 2, percent: 50 })
  })
})
