// Persists a single FileSystemDirectoryHandle across a page reload so a
// disk-streamed ("Specific folder") download can potentially resume writing
// into the same destination — FileSystemDirectoryHandle is structured-
// cloneable, so IndexedDB (unlike localStorage) can actually hold it.
const DB_NAME = 'mesh-resume'
const STORE_NAME = 'handles'
const KEY = 'streamDirHandle'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveDirHandle(handle) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(handle, KEY)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch { /* best-effort — a failed save just means no disk-level resume later */ }
}

export async function loadDirHandle() {
  try {
    const db = await openDb()
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return handle
  } catch {
    return null
  }
}

export async function clearDirHandle() {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(KEY)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch { /* best-effort */ }
}
