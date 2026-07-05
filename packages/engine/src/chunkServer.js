import net from 'net';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from './protocol.js';
import { generateKeyPair, exportPublicKey, deriveSharedKey, encrypt, getMerkleProof } from './crypto.js';
import { readChunk, computeCacheSize } from './chunker.js';

export function createChunkServer({ fileHandle, hashes, tree, merkleRoot, fileName, fileSize, totalChunks, chunkSize }) {
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

  function handleConnection(socket) {
    socket.setMaxListeners(0);
    socket.setNoDelay(true);

    const keyPair = generateKeyPair();
    let sharedKey = null;
    let peerAlive = true;

    const keepaliveCheck = setInterval(() => {
      if (!peerAlive) {
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

      if (data.type === MSG.KEEPALIVE) return;

      if (data.type === MSG.KEY_EXCHANGE) {
        const theirPublicKeyDER = Buffer.from(data.publicKey, 'base64');
        sharedKey = deriveSharedKey(keyPair.privateKey, theirPublicKeyDER);
        const myPublicKey = exportPublicKey(keyPair).toString('base64');
        sendJSON(socket, { type: MSG.KEY_EXCHANGE, publicKey: myPublicKey });
        return;
      }

      if (data.type === MSG.CHUNK_REQUEST) {
        const { index } = data;
        if (index < 0 || index >= totalChunks) return;
        if (!sharedKey) return;
        const chunkData = await readChunkCached(index);
        const encryptedData = encrypt(chunkData, sharedKey);
        const proof = getMerkleProof(tree, index);
        await sendChunk(socket, index, hashes[index], proof, encryptedData);
        return;
      }

      if (data.type === MSG.TRANSFER_COMPLETE) {
        clearInterval(keepaliveCheck);
      }
    });

    socket.on('data', framer);
    socket.on('error', (e) => {
      clearInterval(keepaliveCheck);
      if (e.code !== 'ECONNRESET') server.emit('peerError', e);
    });
    socket.on('close', () => clearInterval(keepaliveCheck));

    sendJSON(socket, {
      type: MSG.FILE_OFFER,
      fileName, fileSize, totalChunks, chunkSize, merkleRoot,
    });
  }

  const server = net.createServer(handleConnection);
  server.handleRelayConnection = handleConnection;
  return server;
}