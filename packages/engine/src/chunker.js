import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { sha256, buildMerkleTree, getMerkleProof } from './crypto.js';

export const DEFAULT_CHUNK_SIZE = 65536;

export async function chunkFile(filePath, chunkSize = DEFAULT_CHUNK_SIZE) {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;
  const chunks = [];
  const hashes = [];

  const stream = createReadStream(filePath, { highWaterMark: chunkSize });

  for await (const chunk of stream) {
    const buf = Buffer.from(chunk);
    chunks.push(buf);
    hashes.push(sha256(buf));
  }

  const tree = buildMerkleTree(hashes);

  return {
    chunks,
    hashes,
    tree,
    merkleRoot: tree.root,
    totalChunks: chunks.length,
    fileSize,
    chunkSize,
  };
}

export function getChunkProof(tree, index) {
  return getMerkleProof(tree, index);
}

export function assembleChunks(chunks, totalChunks) {
  const ordered = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!chunks.has(i)) throw new Error(`Missing chunk ${i}`);
    ordered.push(chunks.get(i));
  }
  return Buffer.concat(ordered);
}