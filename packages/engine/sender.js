import net from 'net';
import { basename, resolve } from 'path';
import { open } from 'fs/promises';
import { getMerkleProof } from './src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from './src/protocol.js';
import { indexFile, readChunk, computeCacheSize } from './src/chunker.js';
import { generateKeyPair, exportPublicKey, deriveSharedKey, encrypt } from './src/crypto.js';
import { DHTNode } from './src/dht.js';

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
  const chunkCache = new Map();
  const CACHE_MAX = computeCacheSize(chunkSize);

  async function readChunkCached(index) {
    if (chunkCache.has(index)) return chunkCache.get(index);
    const data = await readChunk(fileHandle, index, chunkSize);
    if (chunkCache.size >= CACHE_MAX) {
      chunkCache.delete(chunkCache.keys().next().value);
    }
    chunkCache.set(index, data);
    return data;
  }

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

  const server = net.createServer((socket) => {
    socket.setMaxListeners(0);
    socket.setNoDelay(true);
    console.log(`Receiver connected from ${socket.remoteAddress}`);
    const keyPair = generateKeyPair();
    let sharedKey = null;
    let peerAlive = true;
    const keepaliveCheck = setInterval(() => {
      if (!peerAlive) {
        console.log('Peer unresponsive — closing connection');
        clearInterval(keepaliveCheck);
        socket.destroy();
        return;
      }
      peerAlive = false;
    }, 35000);

    const framer = createFramer(async (body) => {
      peerAlive = true;
      const msg = parseMessage(body);
      if (msg.type !== TYPE.JSON) return;
      const { data } = msg;

      if (data.type === MSG.FILE_ACCEPT) {
        console.log('Receiver accepted transfer');
      }

      if (data.type === MSG.KEEPALIVE) {
        return;
      }

      if (data.type === MSG.KEY_EXCHANGE) {
        const theirPublicKeyDER = Buffer.from(data.publicKey, 'base64');
        sharedKey = deriveSharedKey(keyPair.privateKey, theirPublicKeyDER);
        const myPublicKey = exportPublicKey(keyPair).toString('base64');
        sendJSON(socket, { type: MSG.KEY_EXCHANGE, publicKey: myPublicKey });
      }

      if (data.type === MSG.CHUNK_REQUEST) {
        const { index } = data;
        if (index < 0 || index >= totalChunks) return;
        if (!sharedKey) return;
        const chunkData = await readChunkCached(index);
        const encryptedData = encrypt(chunkData, sharedKey);
        const proof = getMerkleProof(tree, index);
        await sendChunk(socket, index, hashes[index], proof, encryptedData);
      }

      if (data.type === MSG.TRANSFER_COMPLETE) {
        console.log('Transfer confirmed complete');
        clearInterval(keepaliveCheck);
        await fileHandle.close().catch(() => {});
        server.close(() => process.exit(0));
      }
    });

    socket.on('data',  framer);
    socket.on('error', (e) => {
      clearInterval(keepaliveCheck);
      if (e.code !== 'ECONNRESET') console.error('Socket error:', e.message);
    });
    socket.on('close', () => {
      clearInterval(keepaliveCheck);
      console.log('Connection closed');
    });

    sendJSON(socket, {
      type: MSG.FILE_OFFER,
      fileName: basename(FILE_PATH),
      fileSize,
      totalChunks,
      chunkSize,
      merkleRoot,
    });
  });

  server.listen(PORT, '127.0.0.1', async () => {
    console.log(`Sender listening on 127.0.0.1:${PORT}`);
    console.log(`Run receiver: node packages/engine/receiver.js 127.0.0.1 ${PORT} ./received`);
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
    await dhtNode.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});