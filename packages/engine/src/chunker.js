import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { sha256, buildMerkleTree } from './crypto.js';

export const DEFAULT_CHUNK_SIZE = 65536;

export async function indexFile(filePath, chunkSize = DEFAULT_CHUNK_SIZE) {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;
  const hashes = [];
  const stream = createReadStream(filePath, { highWaterMark: chunkSize });
  for await (const chunk of stream) {
    hashes.push(sha256(Buffer.from(chunk)));
  }
  const tree = buildMerkleTree(hashes);
  return { hashes, tree, merkleRoot: tree.root, totalChunks: hashes.length, fileSize, chunkSize };
}

export async function readChunk(filePath, index, chunkSize = DEFAULT_CHUNK_SIZE) {
  return new Promise((resolve, reject) => {
    const start  = index * chunkSize;
    const end    = start + chunkSize - 1;
    const stream = createReadStream(filePath, { start, end, highWaterMark: chunkSize });
    const buffers = [];
    stream.on('data',  d => buffers.push(Buffer.from(d)));
    stream.on('end',   () => resolve(Buffer.concat(buffers)));
    stream.on('error', reject);
  });
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