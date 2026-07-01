import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { DHTNode } from '../src/dht.js';
import { SeedManager } from '../src/seed.js';
import { indexFile } from '../src/chunker.js';
import { downloadFile } from '../src/transfer.js';

async function makeTempFile(size) {
  const filePath = join(tmpdir(), `mesh-seed-${Date.now()}.bin`);
  await writeFile(filePath, randomBytes(size));
  return filePath;
}

describe('seed manager', () => {
  it('seeds a file, announces it to the DHT, and a downloader can retrieve it', async () => {
    const filePath = await makeTempFile(40 * 1024);
    const { merkleRoot, totalChunks, chunkSize, fileSize } = await indexFile(filePath);

    const seederDht = new DHTNode();
    const downloaderDht = new DHTNode();
    await seederDht.listen();
    await downloaderDht.listen();

    downloaderDht.routingTable.addPeer({
      id: seederDht.nodeId, addr: '127.0.0.1', port: seederDht.port,
    });

    const seedManager = new SeedManager(seederDht);
    const seedEntry = await seedManager.seedFile(filePath);

    assert.equal(seedManager.isSeeding(merkleRoot), true);
    assert.equal(seedManager.getSeedingList().length, 1);

    const outputPath = join(tmpdir(), `mesh-seed-out-${Date.now()}.bin`);
    await downloadFile({
      fileHash: merkleRoot, fileSize, totalChunks, chunkSize,
      merkleRoot, outputPath, dhtNode: downloaderDht,
    });

    const original = await readFile(filePath);
    const downloaded = await readFile(outputPath);
    assert.deepEqual(downloaded, original);

    await unlink(outputPath);
    await unlink(filePath);
    await seedManager.stopAll();
    await seederDht.close();
    await downloaderDht.close();
  });

  it('stopSeeding closes the server so new connections fail', async () => {
    const filePath = await makeTempFile(20 * 1024);
    const { merkleRoot } = await indexFile(filePath);

    const dhtNode = new DHTNode();
    await dhtNode.listen();

    const seedManager = new SeedManager(dhtNode);
    const seedEntry = await seedManager.seedFile(filePath);
    const port = seedEntry.port;

    await seedManager.stopSeeding(merkleRoot);
    assert.equal(seedManager.isSeeding(merkleRoot), false);

    const net = await import('net');
    await assert.rejects(() => new Promise((resolve, reject) => {
      const socket = net.default.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', resolve);
      socket.once('error', reject);
    }));

    await unlink(filePath);
    await dhtNode.close();
  });

  it('calling seedFile twice for the same file reuses the existing seed entry', async () => {
    const filePath = await makeTempFile(15 * 1024);
    const dhtNode = new DHTNode();
    await dhtNode.listen();

    const seedManager = new SeedManager(dhtNode);
    const first = await seedManager.seedFile(filePath);
    const second = await seedManager.seedFile(filePath);

    assert.equal(first.port, second.port);
    assert.equal(seedManager.getSeedingList().length, 1);

    await unlink(filePath);
    await seedManager.stopAll();
    await dhtNode.close();
  });
});