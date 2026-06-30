import net from 'net';
import { basename, resolve } from 'path';
import { getMerkleProof } from './src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from './src/protocol.js';
import { indexFile, readChunk } from './src/chunker.js';
import { generateKeyPair, exportPublicKey, deriveSharedKey, encrypt } from './src/crypto.js';

const FILE_PATH = resolve(process.argv[2]);
const PORT      = parseInt(process.argv[3] || '9000');

if (!process.argv[2]) {
  console.error('Usage: node sender.js <filepath> [port]');
  process.exit(1);
}

const chunkCache = new Map();
const CACHE_MAX  = 64;

async function readChunkCached(filePath, index, chunkSize) {
  if (chunkCache.has(index)) return chunkCache.get(index);
  const data = await readChunk(filePath, index, chunkSize);
  if (chunkCache.size >= CACHE_MAX) {
    chunkCache.delete(chunkCache.keys().next().value);
  }
  chunkCache.set(index, data);
  return data;
}

async function main() {
  console.log(`Indexing ${FILE_PATH}...`);
  const { fileSize, hashes, tree, merkleRoot, totalChunks, chunkSize } = await indexFile(FILE_PATH);
  console.log(`Ready: ${totalChunks} chunks, root: ${merkleRoot.slice(0, 16)}...`);
  console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

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
  const chunkData = await readChunkCached(FILE_PATH, index, chunkSize);
  const encryptedData = encrypt(chunkData, sharedKey);
  const proof = getMerkleProof(tree, index);
  await sendChunk(socket, index, hashes[index], proof, encryptedData);
}

      if (data.type === MSG.TRANSFER_COMPLETE) {
        console.log('Transfer confirmed complete');
        clearInterval(keepaliveCheck);
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

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Sender listening on 127.0.0.1:${PORT}`);
    console.log(`Run receiver: node packages/engine/receiver.js 127.0.0.1 ${PORT} ./received`);
  });

  server.on('error', (e) => {
    console.error('Server error:', e.message);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});