import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { open } from 'fs/promises';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { PeerConnection } from '../src/peer.js';
import { createChunkServer } from '../src/chunkServer.js';
import { indexFile } from '../src/chunker.js';

async function makeTempFile(size) {
  const filePath = join(tmpdir(), `mesh-cs-${Date.now()}.bin`);
  await writeFile(filePath, randomBytes(size));
  return filePath;
}

describe('chunk server', () => {
  it('serves a correct encrypted chunk with valid proof to a connecting peer', async () => {
    const filePath = await makeTempFile(50 * 1024);
    const { fileSize, hashes, tree, merkleRoot, totalChunks, chunkSize } = await indexFile(filePath);
    const fileHandle = await open(filePath, 'r');

    const server = createChunkServer({
      fileHandle, hashes, tree, merkleRoot,
      fileName: 'test.bin', fileSize, totalChunks, chunkSize,
    });

    const port = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });

    const conn = new PeerConnection('127.0.0.1', port);
    await conn.connect();
    assert.ok(conn.metadata);
    assert.equal(conn.metadata.merkleRoot, merkleRoot);

    const chunkMsg = await conn.requestChunk(0);
    assert.equal(chunkMsg.chunkHash, hashes[0]);

    conn.close();
    await new Promise((resolve) => server.close(resolve));
    await fileHandle.close();
    await unlink(filePath);
  });

  it('serves multiple concurrent peers to completion without shutting down after the first', async () => {
    const filePath = await makeTempFile(30 * 1024);
    const { fileSize, hashes, tree, merkleRoot, totalChunks, chunkSize } = await indexFile(filePath);
    const fileHandle = await open(filePath, 'r');

    const server = createChunkServer({
      fileHandle, hashes, tree, merkleRoot,
      fileName: 'test.bin', fileSize, totalChunks, chunkSize,
    });

    const port = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });

    const connA = new PeerConnection('127.0.0.1', port);
    const connB = new PeerConnection('127.0.0.1', port);
    await connA.connect();
    await connB.connect();

    const chunkA = await connA.requestChunk(0);
    assert.equal(chunkA.chunkHash, hashes[0]);

    const chunkB = await connB.requestChunk(0);
    assert.equal(chunkB.chunkHash, hashes[0]);

    assert.equal(server.listening, true);

    connA.close();
    connB.close();
    await new Promise((resolve) => server.close(resolve));
    await fileHandle.close();
    await unlink(filePath);
  });
});