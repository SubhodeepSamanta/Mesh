import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes, createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { chunkFile, assembleChunks } from '../src/chunker.js';
import { sha256, buildMerkleRoot, buildMerkleTree, getMerkleProof, verifyChunk } from '../src/crypto.js';

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

  it('merkle root changes when any chunk is modified', () => {
    const hashes = ['aaa', 'bbb', 'ccc', 'ddd'];
    const root1 = buildMerkleRoot([...hashes]);
    const tampered = [...hashes];
    tampered[2] = 'TAMPERED';
    const root2 = buildMerkleRoot(tampered);
    assert.notEqual(root1, root2);
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