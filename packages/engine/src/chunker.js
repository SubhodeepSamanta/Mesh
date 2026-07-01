import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { sha256, buildMerkleTree } from './crypto.js';

export const DEFAULT_CHUNK_SIZE = 65536;
export const MAX_CHUNK_SIZE = 32 * 1024 * 1024;
export const TARGET_CHUNK_COUNT = 50000;

export const EMPTY_FILE_MERKLE_ROOT = sha256(Buffer.alloc(0));

export function computeChunkSize(fileSize) {
  if (fileSize <= DEFAULT_CHUNK_SIZE * TARGET_CHUNK_COUNT) {
    return DEFAULT_CHUNK_SIZE;
  }
  const raw = Math.ceil(fileSize / TARGET_CHUNK_COUNT);
  let size = DEFAULT_CHUNK_SIZE;
  while (size < raw && size < MAX_CHUNK_SIZE) {
    size *= 2;
  }
  return size;
}

export function computeCacheSize(chunkSize) {
  const TARGET_CACHE_BYTES = 64 * DEFAULT_CHUNK_SIZE;
  const raw = Math.floor(TARGET_CACHE_BYTES / chunkSize);
  return Math.max(8, Math.min(256, raw));
}

export function computeSwarmPipelineDepth(chunkSize) {
  const TARGET_INFLIGHT_BYTES = 16 * DEFAULT_CHUNK_SIZE;
  const raw = Math.floor(TARGET_INFLIGHT_BYTES / chunkSize);
  return Math.max(4, Math.min(16, raw));
}

export function computeSimplePipelineDepth(chunkSize) {
  const TARGET_INFLIGHT_BYTES = 32 * DEFAULT_CHUNK_SIZE;
  const raw = Math.floor(TARGET_INFLIGHT_BYTES / chunkSize);
  return Math.max(4, Math.min(32, raw));
}

export async function indexFile(filePath, chunkSize = null) {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;
  const effectiveChunkSize = chunkSize || computeChunkSize(fileSize);

  if (fileSize === 0) {
    return {
      hashes: [],
      tree: { root: EMPTY_FILE_MERKLE_ROOT, levels: [] },
      merkleRoot: EMPTY_FILE_MERKLE_ROOT,
      totalChunks: 0,
      fileSize,
      chunkSize: effectiveChunkSize,
    };
  }

  const hashes = [];
  const stream = createReadStream(filePath, { highWaterMark: effectiveChunkSize });
  for await (const chunk of stream) {
    hashes.push(sha256(Buffer.from(chunk)));
  }
  const tree = buildMerkleTree(hashes);
  return { hashes, tree, merkleRoot: tree.root, totalChunks: hashes.length, fileSize, chunkSize: effectiveChunkSize };
}

export async function readChunk(fileHandle, index, chunkSize = DEFAULT_CHUNK_SIZE) {
  const start = index * chunkSize;
  const buffer = Buffer.allocUnsafe(chunkSize);
  const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, start);
  return buffer.subarray(0, bytesRead);
}

export async function chunkFile(filePath, chunkSize = DEFAULT_CHUNK_SIZE) {
  const { hashes, tree, merkleRoot, totalChunks, fileSize } = await indexFile(filePath, chunkSize);
  const chunks = [];
  const stream = createReadStream(filePath, { highWaterMark: chunkSize });
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return { chunks, hashes, tree, merkleRoot, totalChunks, fileSize, chunkSize };
}

export function assembleChunks(chunks, totalChunks) {
  const ordered = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!chunks.has(i)) throw new Error(`Missing chunk ${i}`);
    ordered.push(chunks.get(i));
  }
  return Buffer.concat(ordered);
}