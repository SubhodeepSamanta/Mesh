import { computeChunkSize } from '../lib/fileChunker.js'
import { sha256Hex, buildMerkleTree } from '../lib/browserCrypto.js'

const CONCURRENCY = 8
const PROGRESS_CHUNK_INTERVAL = 100
const PROGRESS_TIME_INTERVAL_MS = 200

async function hashFile(file, chunkSize, startChunk, allHashes, onProgress) {
  const fileChunks = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize)
  let next = 0
  async function worker() {
    while (next < fileChunks) {
      const i = next++
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const buf = await file.slice(start, end).arrayBuffer()
      allHashes[startChunk + i] = await sha256Hex(buf)
      onProgress()
    }
  }
  const poolSize = Math.min(CONCURRENCY, fileChunks) || 0
  await Promise.all(Array.from({ length: poolSize }, () => worker()))
  return fileChunks
}

async function indexEntries(entries) {
  const totalSize = entries.reduce((s, { file }) => s + file.size, 0)
  const chunkSize = computeChunkSize(totalSize)
  const totalChunks = entries.reduce((s, { file }) => s + (file.size === 0 ? 0 : Math.ceil(file.size / chunkSize)), 0)

  const allHashes = new Array(totalChunks)
  const fileEntries = []
  let globalIdx = 0
  let hashedCount = 0
  let lastProgressAt = Date.now()

  const reportProgress = () => {
    hashedCount++
    const now = Date.now()
    if (hashedCount % PROGRESS_CHUNK_INTERVAL === 0 || now - lastProgressAt >= PROGRESS_TIME_INTERVAL_MS) {
      lastProgressAt = now
      self.postMessage({ type: 'progress', hashed: hashedCount, total: totalChunks })
    }
  }

  for (const { file, relativePath } of entries) {
    const startChunk = globalIdx
    const fileChunks = await hashFile(file, chunkSize, startChunk, allHashes, reportProgress)
    fileEntries.push({
      path: relativePath || file.name,
      name: file.name,
      size: file.size,
      startChunk,
      chunkCount: fileChunks,
    })
    globalIdx += fileChunks
  }

  self.postMessage({ type: 'progress', hashed: totalChunks, total: totalChunks })

  const tree = allHashes.length > 0
    ? await buildMerkleTree(allHashes)
    : { root: await sha256Hex(new ArrayBuffer(0)), levels: [] }

  const folderLabel = entries[0]?.relativePath?.split('/')[0]
  const rootName = entries.length === 1
    ? entries[0].file.name
    : (folderLabel || `files-${new Date().toISOString().slice(0, 10)}`)

  return {
    fileName: rootName,
    fileSize: totalSize,
    chunkSize,
    totalChunks: allHashes.length,
    hashes: allHashes,
    tree,
    merkleRoot: tree.root,
    files: fileEntries,
  }
}

self.onmessage = async (e) => {
  const { files } = e.data
  try {
    const result = await indexEntries(files)
    self.postMessage({ type: 'done', result })
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) })
  }
}
