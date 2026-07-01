import { sha256Hex, buildMerkleTree } from './browserCrypto.js'

const DEFAULT_CHUNK_SIZE = 65536
const MAX_CHUNK_SIZE = 262144
const TARGET_CHUNK_COUNT = 50000

export function computeChunkSize(fileSize) {
  if (fileSize <= DEFAULT_CHUNK_SIZE * TARGET_CHUNK_COUNT) return DEFAULT_CHUNK_SIZE
  const raw = Math.ceil(fileSize / TARGET_CHUNK_COUNT)
  let size = DEFAULT_CHUNK_SIZE
  while (size < raw && size < MAX_CHUNK_SIZE) size *= 2
  return size
}

export async function indexFiles(files) {
  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const chunkSize = computeChunkSize(totalSize)
  const allHashes = []
  const fileEntries = []
  let globalIdx = 0

  for (const file of files) {
    const fileChunks = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize)
    const hashes = []
    for (let i = 0; i < fileChunks; i++) {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const buf = await file.slice(start, end).arrayBuffer()
      hashes.push(await sha256Hex(buf))
    }
    fileEntries.push({
      path: file.relativePath || file.webkitRelativePath || file.name,
      name: file.name,
      size: file.size,
      startChunk: globalIdx,
      chunkCount: fileChunks,
    })
    allHashes.push(...hashes)
    globalIdx += fileChunks
  }

  const tree = allHashes.length > 0
    ? await buildMerkleTree(allHashes)
    : { root: await sha256Hex(new ArrayBuffer(0)), levels: [] }

  const folderLabel = files[0].webkitRelativePath?.split('/')[0] || files[0].relativePath?.split('/')[0]
  const rootName = files.length === 1
    ? files[0].name
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

export async function indexFile(file) {
  return indexFiles([file])
}

export async function readChunk(file, index, chunkSize) {
  const start = index * chunkSize
  const end = Math.min(start + chunkSize, file.size)
  return file.slice(start, end).arrayBuffer()
}

export function getFileForChunk(fileEntries, globalIndex) {
  for (const entry of fileEntries) {
    if (globalIndex >= entry.startChunk && globalIndex < entry.startChunk + entry.chunkCount) {
      return { fileEntry: entry, localIndex: globalIndex - entry.startChunk }
    }
  }
  return null
}
