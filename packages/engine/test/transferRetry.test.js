import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdtemp, rm, open } from 'fs/promises';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { randomBytes, createHash } from 'crypto';
import { indexFile } from '../src/chunker.js';
import { createChunkServer } from '../src/chunkServer.js';
import { downloadFile } from '../src/transfer.js';

function startServer(filePath, indexed, fileHandle, port) {
  const server = createChunkServer({
    fileHandle,
    hashes: indexed.hashes,
    tree: indexed.tree,
    merkleRoot: indexed.merkleRoot,
    fileName: basename(filePath),
    fileSize: indexed.fileSize,
    totalChunks: indexed.totalChunks,
    chunkSize: indexed.chunkSize,
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

describe('transfer retry after total peer loss', () => {
  test('recovers when the only seeder dies mid-transfer and comes back', { timeout: 60000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mesh-retry-'));
    const srcPath = join(dir, 'src.bin');
    const outPath = join(dir, 'out.bin');
    const content = randomBytes(40 * 1024);
    await writeFile(srcPath, content);

    const indexed = await indexFile(srcPath, 1024); // 40 chunks — room to die mid-way
    const fh1 = await open(srcPath, 'r');
    const server1 = await startServer(srcPath, indexed, fh1, 0);
    const port = server1.address().port;
    const liveSockets = [];
    server1.on('connection', (s) => liveSockets.push(s));

    // Fake DHT: always points at the (current) seeder address.
    const dhtNode = {
      getPeersForFile: async () => [{
        addr: '127.0.0.1', port,
        candidates: [{ addr: '127.0.0.1', port }],
        relay: null,
      }],
    };

    // Kill the seeder after the first few verified chunks, then resurrect it
    // on the SAME port after a moment — like a hotspot stall ending.
    let killed = false;
    let server2 = null;
    let fh2 = null;

    const result = await downloadFile({
      fileHash: indexed.merkleRoot,
      fileSize: indexed.fileSize,
      totalChunks: indexed.totalChunks,
      chunkSize: indexed.chunkSize,
      merkleRoot: indexed.merkleRoot,
      outputPath: outPath,
      dhtNode,
      retryDelayMs: 1500, // faster than the 5s default; seeder resurrects at 1s
      onSwarmReady: (swarm) => {
        swarm.on('chunkVerified', ({ verified }) => {
          if (verified >= 3 && !killed) {
            killed = true;
            // Hard-kill: stop the listener and destroy live sockets so every
            // pending request rejects, evicting the peer. (The file handle is
            // closed at the end — yanking it mid-read would just error reads.)
            server1.close();
            for (const s of liveSockets) s.destroy();
            setTimeout(async () => {
              fh2 = await open(srcPath, 'r');
              server2 = await startServer(srcPath, indexed, fh2, port);
            }, 1000);
          }
        });
      },
    });

    assert.equal(result.status, 'complete');
    assert.equal(killed, true, 'the mid-transfer kill must actually have happened');

    const out = await readFile(outPath);
    assert.equal(
      createHash('sha256').update(out).digest('hex'),
      createHash('sha256').update(content).digest('hex'),
      'received file must be byte-identical despite the seeder dying mid-transfer'
    );

    if (server2) await new Promise((r) => server2.close(r));
    if (fh2) await fh2.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
});
