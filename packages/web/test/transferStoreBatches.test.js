import { describe, it, expect, beforeEach } from 'vitest'

class FakeStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
}
global.localStorage = new FakeStorage()

const { useTransferStore } = await import('../src/store/useTransferStore.js')

const fileMeta = { fileName: 'extra.txt', fileSize: 100, totalChunks: 2, chunkSize: 65536, merkleRoot: 'b'.repeat(64) }

describe('useTransferStore extra-batch actions', () => {
  beforeEach(() => {
    useTransferStore.setState({ extraBatches: [] })
  })

  it('addExtraBatchOffer adds a receiver-side pending offer, deduped by batchId', () => {
    useTransferStore.getState().addExtraBatchOffer({ batchId: 1, fileMeta, fromPeerId: 'peerA' })
    useTransferStore.getState().addExtraBatchOffer({ batchId: 1, fileMeta, fromPeerId: 'peerA' })

    const batches = useTransferStore.getState().extraBatches
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ batchId: 1, role: 'receiver', status: 'offered', fromPeerId: 'peerA' })
  })

  it('addExtraBatchSent adds a sender-side entry with an empty acceptedBy list', () => {
    useTransferStore.getState().addExtraBatchSent({ batchId: 2, fileMeta })
    const batches = useTransferStore.getState().extraBatches
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ batchId: 2, role: 'sender', status: 'offered', acceptedBy: [] })
  })

  it('updateExtraBatch merges a patch into the matching batch only', () => {
    useTransferStore.getState().addExtraBatchOffer({ batchId: 1, fileMeta, fromPeerId: 'peerA' })
    useTransferStore.getState().addExtraBatchOffer({ batchId: 2, fileMeta, fromPeerId: 'peerA' })

    useTransferStore.getState().updateExtraBatch(1, { status: 'transferring' })

    const batches = useTransferStore.getState().extraBatches
    expect(batches.find((b) => b.batchId === 1).status).toBe('transferring')
    expect(batches.find((b) => b.batchId === 2).status).toBe('offered')
  })

  it('removeExtraBatch drops a declined offer', () => {
    useTransferStore.getState().addExtraBatchOffer({ batchId: 1, fileMeta, fromPeerId: 'peerA' })
    useTransferStore.getState().removeExtraBatch(1)
    expect(useTransferStore.getState().extraBatches).toHaveLength(0)
  })

  it('markExtraBatchAcceptedBy records each accepting peer once and flips status to transferring', () => {
    useTransferStore.getState().addExtraBatchSent({ batchId: 3, fileMeta })

    useTransferStore.getState().markExtraBatchAcceptedBy(3, 'peerA')
    useTransferStore.getState().markExtraBatchAcceptedBy(3, 'peerA')
    useTransferStore.getState().markExtraBatchAcceptedBy(3, 'peerB')

    const batch = useTransferStore.getState().extraBatches.find((b) => b.batchId === 3)
    expect(batch.status).toBe('transferring')
    expect(batch.acceptedBy).toEqual(['peerA', 'peerB'])
  })

  it('markExtraBatchAcceptedBy is a no-op for a receiver-role batch', () => {
    useTransferStore.getState().addExtraBatchOffer({ batchId: 4, fileMeta, fromPeerId: 'peerA' })
    useTransferStore.getState().markExtraBatchAcceptedBy(4, 'peerZ')
    const batch = useTransferStore.getState().extraBatches.find((b) => b.batchId === 4)
    expect(batch.status).toBe('offered')
    expect(batch.acceptedBy).toBeUndefined()
  })

  it('reset() clears extraBatches', () => {
    useTransferStore.getState().addExtraBatchOffer({ batchId: 1, fileMeta, fromPeerId: 'peerA' })
    useTransferStore.getState().reset()
    expect(useTransferStore.getState().extraBatches).toEqual([])
  })
})

describe('useTransferStore downloaded-path tracking (§4 selective download)', () => {
  beforeEach(() => {
    useTransferStore.setState({ downloadedPaths: [] })
  })

  it('markFileDownloaded adds a path once, deduped', () => {
    useTransferStore.getState().markFileDownloaded('a.txt')
    useTransferStore.getState().markFileDownloaded('a.txt')
    useTransferStore.getState().markFileDownloaded('b.txt')
    expect(useTransferStore.getState().downloadedPaths).toEqual(['a.txt', 'b.txt'])
  })

  it('unmarkFileDownloaded removes a path so it can be redownloaded', () => {
    useTransferStore.getState().markFileDownloaded('a.txt')
    useTransferStore.getState().markFileDownloaded('b.txt')
    useTransferStore.getState().unmarkFileDownloaded('a.txt')
    expect(useTransferStore.getState().downloadedPaths).toEqual(['b.txt'])
  })

  it('reset() clears downloadedPaths', () => {
    useTransferStore.getState().markFileDownloaded('a.txt')
    useTransferStore.getState().reset()
    expect(useTransferStore.getState().downloadedPaths).toEqual([])
  })
})
