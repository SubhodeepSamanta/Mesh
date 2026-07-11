import { describe, it, expect } from 'vitest'

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
// place first.
const { entryAvailability } = await import('../src/hooks/useTransfer.js')

const entry = (startChunk, chunkCount) => ({ startChunk, chunkCount })
const bytes = () => new Uint8Array([1, 2, 3])

describe('entryAvailability', () => {
  it('reports memory when every chunk is buffered in the tab', () => {
    const chunks = [bytes(), bytes(), bytes()]
    expect(entryAvailability(chunks, entry(0, 3))).toBe('memory')
  })

  it('reports missing after a reload wiped the in-memory chunks (the 0.02KB corrupt-download bug)', () => {
    // This is exactly the state after closing and reopening the tab: the
    // store rehydrates status 'complete' from localStorage but M.chunks is
    // a fresh empty array.
    expect(entryAvailability([], entry(0, 3))).toBe('missing')
  })

  it('reports missing when any single chunk slot is empty', () => {
    const chunks = [bytes(), undefined, bytes()]
    expect(entryAvailability(chunks, entry(0, 3))).toBe('missing')
  })

  it('reports streamed when chunks were written straight to the picked folder', () => {
    expect(entryAvailability([true, true], entry(0, 2))).toBe('streamed')
  })

  it('reports streamed for a mix of streamed and buffered chunks', () => {
    expect(entryAvailability([true, bytes()], entry(0, 2))).toBe('streamed')
  })

  it('treats a zero-chunk (empty) file as downloadable', () => {
    expect(entryAvailability([], entry(0, 0))).toBe('memory')
  })

  it('only inspects the entry\'s own chunk range', () => {
    const chunks = [undefined, bytes(), bytes(), undefined]
    expect(entryAvailability(chunks, entry(1, 2))).toBe('memory')
  })
})
