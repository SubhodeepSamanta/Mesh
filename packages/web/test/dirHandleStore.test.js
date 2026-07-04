import { describe, it, expect, beforeEach } from 'vitest'

// Minimal fake IndexedDB — good enough to exercise dirHandleStore.js's
// save/load/clear round trip without pulling in a full IDB polyfill.
class FakeIDBRequest {
  constructor() { this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null; this.result = undefined; this.error = null }
  _succeed(result) {
    this.result = result
    queueMicrotask(() => { if (this.onsuccess) this.onsuccess({ target: this }) })
  }
}

class FakeObjectStore {
  constructor(data) { this._data = data }
  put(value, key) { const req = new FakeIDBRequest(); this._data.set(key, value); req._succeed(key); return req }
  get(key) { const req = new FakeIDBRequest(); req._succeed(this._data.get(key)); return req }
  delete(key) { const req = new FakeIDBRequest(); this._data.delete(key); req._succeed(undefined); return req }
}

class FakeTransaction {
  constructor(store) {
    this._store = store
    this.oncomplete = null
    this.onerror = null
    queueMicrotask(() => { if (this.oncomplete) this.oncomplete() })
  }
  objectStore() { return this._store }
}

class FakeIDBDatabase {
  constructor() { this._stores = new Map() }
  get objectStoreNames() { return { contains: (n) => this._stores.has(n) } }
  createObjectStore(name) { const store = new FakeObjectStore(new Map()); this._stores.set(name, store); return store }
  transaction(name) { return new FakeTransaction(this._stores.get(name)) }
  close() {}
}

function makeFakeIndexedDB() {
  let db = null
  return {
    open() {
      const req = new FakeIDBRequest()
      queueMicrotask(() => {
        const isNew = !db
        db = db || new FakeIDBDatabase()
        req.result = db
        if (isNew && req.onupgradeneeded) req.onupgradeneeded({ target: req })
        if (req.onsuccess) req.onsuccess({ target: req })
      })
      return req
    },
  }
}

describe('dirHandleStore', () => {
  let originalIndexedDB

  beforeEach(() => {
    originalIndexedDB = global.indexedDB
    global.indexedDB = makeFakeIndexedDB()
  })

  it('round-trips a handle through save/load', async () => {
    const { saveDirHandle, loadDirHandle } = await import('../src/lib/dirHandleStore.js')
    const fakeHandle = { name: 'my-folder', kind: 'directory' }

    await saveDirHandle(fakeHandle)
    const loaded = await loadDirHandle()

    expect(loaded).toEqual(fakeHandle)
  })

  it('loadDirHandle returns null when nothing was saved', async () => {
    const { loadDirHandle } = await import('../src/lib/dirHandleStore.js')
    const loaded = await loadDirHandle()
    expect(loaded).toBeNull()
  })

  it('clearDirHandle removes the saved handle', async () => {
    const { saveDirHandle, loadDirHandle, clearDirHandle } = await import('../src/lib/dirHandleStore.js')
    await saveDirHandle({ name: 'folder' })
    await clearDirHandle()
    expect(await loadDirHandle()).toBeNull()
  })

  it('save/load/clear resolve without throwing when indexedDB is unavailable', async () => {
    global.indexedDB = undefined
    const { saveDirHandle, loadDirHandle, clearDirHandle } = await import('../src/lib/dirHandleStore.js')
    await expect(saveDirHandle({ name: 'x' })).resolves.toBeUndefined()
    await expect(loadDirHandle()).resolves.toBeNull()
    await expect(clearDirHandle()).resolves.toBeUndefined()
  })
})
