import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes, createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { chunkFile, assembleChunks, computeChunkSize, computeCacheSize, computeSwarmPipelineDepth, computeSimplePipelineDepth } from '../src/chunker.js';
import { sha256, buildMerkleTree, getMerkleProof, verifyChunk } from '../src/crypto.js';

async function makeTempFile(size) {
  const filePath = join(tmpdir(), `mesh-test-${Date.now()}.bin`);
  await writeFile(filePath, randomBytes(size));
  return filePath;
}

describe('chunker', () => {
  it('reassembles chunks to produce identical bytes to original', async () => {
    const filePath = await makeTempFile(500 * 1024);
    const { chunks, totalChunks } = await chunkFile(filePath);
    const chunkMap = new Map(chunks.map((c, i) => [i, c]));
    const reassembled = assembleChunks(chunkMap, totalChunks);
    const original = await import('fs/promises').then(fs => fs.readFile(filePath));
    assert.equal(
      createHash('sha256').update(reassembled).digest('hex'),
      createHash('sha256').update(original).digest('hex')
    );
    await unlink(filePath);
  });

  it('produces correct number of chunks for file size', async () => {
    const filePath = await makeTempFile(200 * 1024);
    const { totalChunks, chunkSize } = await chunkFile(filePath, 65536);
    assert.equal(totalChunks, Math.ceil(200 * 1024 / 65536));
    await unlink(filePath);
  });
it('computeChunkSize keeps small files at the default chunk size', () => {
    assert.equal(computeChunkSize(1024), 65536);
    assert.equal(computeChunkSize(500 * 1024 * 1024), 65536);
    assert.equal(computeChunkSize(3 * 1024 * 1024 * 1024), 65536);
  });

  it('computeChunkSize scales up for large files and stays under the protocol message ceiling', () => {
    const size100GB = 100 * 1024 * 1024 * 1024;
    const size1TB = 1024 * 1024 * 1024 * 1024;

    const chunk100GB = computeChunkSize(size100GB);
    const chunk1TB = computeChunkSize(size1TB);

    assert.ok(chunk100GB > 65536);
    assert.ok(chunk1TB >= chunk100GB);
    assert.ok(chunk1TB <= 32 * 1024 * 1024);

    const totalChunks100GB = Math.ceil(size100GB / chunk100GB);
    const totalChunks1TB = Math.ceil(size1TB / chunk1TB);

    assert.ok(totalChunks100GB < 100000);
    assert.ok(totalChunks1TB < 100000);
  });

  it('computeChunkSize never exceeds MAX_CHUNK_SIZE even for extreme file sizes', () => {
    const size10TB = 10 * 1024 * 1024 * 1024 * 1024;
    assert.equal(computeChunkSize(size10TB), 32 * 1024 * 1024);
  });

  it('computeCacheSize and pipeline depth shrink as chunk size grows', () => {
    const smallChunkCache = computeCacheSize(65536);
    const largeChunkCache = computeCacheSize(32 * 1024 * 1024);
    assert.ok(largeChunkCache < smallChunkCache);
    assert.ok(largeChunkCache >= 8);

    const smallChunkSwarmDepth = computeSwarmPipelineDepth(65536);
    const largeChunkSwarmDepth = computeSwarmPipelineDepth(32 * 1024 * 1024);
    assert.equal(smallChunkSwarmDepth, 16);
    assert.ok(largeChunkSwarmDepth < smallChunkSwarmDepth);
    assert.ok(largeChunkSwarmDepth >= 4);

    const smallChunkSimpleDepth = computeSimplePipelineDepth(65536);
    assert.equal(smallChunkSimpleDepth, 32);
  });

  it('indexFile picks the adaptive chunk size automatically when none is given', async () => {
    const filePath = await makeTempFile(200 * 1024);
    const { indexFile } = await import('../src/chunker.js');
    const result = await indexFile(filePath);
    assert.equal(result.chunkSize, 65536);
    await unlink(filePath);
  });

  it('readChunk reads the correct byte range using a persistent file handle', async () => {
    const filePath = await makeTempFile(200 * 1024);
    const { readChunk } = await import('../src/chunker.js');
    const { open } = await import('fs/promises');
    const handle = await open(filePath, 'r');
    const chunk0 = await readChunk(handle, 0, 65536);
    const chunk1 = await readChunk(handle, 1, 65536);
    assert.equal(chunk0.length, 65536);
    assert.equal(chunk1.length, 65536);
    assert.notDeepEqual(chunk0, chunk1);
    await handle.close();
    await unlink(filePath);
  });
it('merkle root changes when any chunk is modified', () => {
    const hashes = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32), 'dd'.repeat(32)];
    const root1 = buildMerkleTree([...hashes]).root;
    const tampered = [...hashes];
    tampered[2] = 'ee'.repeat(32);
    const root2 = buildMerkleTree(tampered).root;
    assert.notEqual(root1, root2);
  });
it('handles a 0-byte file without crashing', async () => {
    const filePath = join(tmpdir(), `mesh-empty-${Date.now()}.bin`);
    await import('fs/promises').then(fs => fs.writeFile(filePath, Buffer.alloc(0)));
    const { totalChunks, fileSize, merkleRoot } = await import('../src/chunker.js').then(m => m.indexFile(filePath));
    assert.equal(totalChunks, 0);
    assert.equal(fileSize, 0);
    assert.equal(typeof merkleRoot, 'string');
    await unlink(filePath);
  });
  it('merkle proof verification passes for valid chunk', async () => {
    const filePath = await makeTempFile(300 * 1024);
    const { chunks, tree } = await chunkFile(filePath);
    const proof = getMerkleProof(tree, 0);
    const valid = verifyChunk(chunks[0], proof, tree.root);
    assert.equal(valid, true);
    await unlink(filePath);
  });

  it('merkle proof verification fails for tampered chunk', async () => {
    const filePath = await makeTempFile(300 * 1024);
    const { chunks, tree } = await chunkFile(filePath);
    const proof = getMerkleProof(tree, 0);
    const tampered = Buffer.from(chunks[0]);
    tampered[0] = tampered[0] ^ 0xff;
    const valid = verifyChunk(tampered, proof, tree.root);
    assert.equal(valid, false);
    await unlink(filePath);
  });

  it('does not crash on a large file', async () => {
    const filePath = await makeTempFile(50 * 1024 * 1024);
    const { totalChunks, merkleRoot } = await chunkFile(filePath);
    assert.ok(totalChunks > 0);
    assert.equal(typeof merkleRoot, 'string');
    assert.equal(merkleRoot.length, 64);
    await unlink(filePath);
  });
});