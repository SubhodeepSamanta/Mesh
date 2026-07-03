export function indexFilesAsync(files, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/indexWorker.js', import.meta.url), { type: 'module' })
    const cleanup = () => worker.terminate()

    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress?.(msg.hashed, msg.total)
      } else if (msg.type === 'done') {
        cleanup()
        resolve(msg.result)
      } else if (msg.type === 'error') {
        cleanup()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      cleanup()
      reject(e.error || new Error(e.message || 'Indexing worker failed'))
    }

    // relativePath is an expando property on File and does not survive
    // structured clone, so it must be sent as a sibling field.
    const entries = files.map((file) => ({ file, relativePath: file.relativePath || file.webkitRelativePath || null }))
    worker.postMessage({ files: entries })
  })
}
