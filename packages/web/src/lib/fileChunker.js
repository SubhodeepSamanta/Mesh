import { sha256Hex, buildMerkleTree } from './browserCrypto.js'

const DEFAULT_CHUNK_SIZE = 65536
const MAX_CHUNK_SIZE = 4 * 1024 * 1024
const TARGET_CHUNK_COUNT = 20000

export function computeChunkSize(fileSize) {
  if (fileSize <= DEFAULT_CHUNK_SIZE * TARGET_CHUNK_COUNT) return DEFAULT_CHUNK_SIZE
  const raw = Math.ceil(fileSize / TARGET_CHUNK_COUNT)
  let size = DEFAULT_CHUNK_SIZE
  while (size < raw && size < MAX_CHUNK_SIZE) size *= 2
  return size
}

export async function indexFile(file) {
  const chunkSize = computeChunkSize(file.size)
  const totalChunks = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize)
  const hashes = []

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    const buf = await file.slice(start, end).arrayBuffer()
    hashes.push(await sha256Hex(buf))
  }

  const tree = totalChunks > 0
    ? await buildMerkleTree(hashes)
    : { root: await sha256Hex(new ArrayBuffer(0)), levels: [] }

  return {
    fileName: file.name,
    fileSize: file.size,
    chunkSize,
    totalChunks,
    hashes,
    tree,
    merkleRoot: tree.root,
  }
}

export async function readChunk(file, index, chunkSize) {
  const start = index * chunkSize
  const end = Math.min(start + chunkSize, file.size)
  return file.slice(start, end).arrayBuffer()
}