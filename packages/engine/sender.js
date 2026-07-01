import { basename, resolve } from 'path';
import { open } from 'fs/promises';
import { indexFile } from './src/chunker.js';
import { DHTNode } from './src/dht.js';
import { createChunkServer } from './src/chunkServer.js';

const FILE_PATH       = resolve(process.argv[2]);
const PORT             = parseInt(process.argv[3] || '9000');
const BOOTSTRAP_HOST   = process.argv[4] || null;
const BOOTSTRAP_PORT   = process.argv[5] ? parseInt(process.argv[5]) : null;

if (!process.argv[2]) {
  console.error('Usage: node sender.js <filepath> [port] [bootstrapHost] [bootstrapPort]');
  process.exit(1);
}

async function main() {
  console.log(`Indexing ${FILE_PATH}...`);
  const { fileSize, hashes, tree, merkleRoot, totalChunks, chunkSize } = await indexFile(FILE_PATH);
  console.log(`Ready: ${totalChunks} chunks, root: ${merkleRoot.slice(0, 16)}...`);
  console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Chunk size: ${(chunkSize / 1024).toFixed(0)} KB`);

  const fileHandle = await open(FILE_PATH, 'r');

  const dhtNode = new DHTNode();
  await dhtNode.listen();
  if (BOOTSTRAP_HOST && BOOTSTRAP_PORT) {
    try {
      await dhtNode.bootstrap(BOOTSTRAP_HOST, BOOTSTRAP_PORT);
      console.log(`Bootstrapped into DHT via ${BOOTSTRAP_HOST}:${BOOTSTRAP_PORT}`);
    } catch (e) {
      console.warn(`DHT bootstrap failed: ${e.message}`);
    }
  }

  const server = createChunkServer({
    fileHandle, hashes, tree, merkleRoot,
    fileName: basename(FILE_PATH), fileSize, totalChunks, chunkSize,
  });

  server.on('peerError', (e) => console.error('Peer connection error:', e.message));

  server.listen(PORT, '127.0.0.1', async () => {
    console.log(`Sender listening on 127.0.0.1:${PORT}`);
    console.log(`Serves any number of peers concurrently. Run receiver: node packages/engine/receiver.js 127.0.0.1 ${PORT} ./received`);
    try {
      await dhtNode.announceFile(merkleRoot, PORT);
      console.log(`Announced to DHT. File id: ${merkleRoot}`);
    } catch (e) {
      console.warn(`DHT announce failed: ${e.message}`);
    }
  });

  server.on('error', (e) => {
    console.error('Server error:', e.message);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await new Promise((resolve) => server.close(resolve));
    await fileHandle.close().catch(() => {});
    await dhtNode.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});