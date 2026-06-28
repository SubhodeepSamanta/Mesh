import net from 'net';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { basename, resolve } from 'path';
import { sha256, buildMerkleTree, getMerkleProof } from './src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from './src/protocol.js';
import { DEFAULT_CHUNK_SIZE } from './src/chunker.js';

const FILE_PATH = resolve(process.argv[2]);
const PORT = parseInt(process.argv[3] || '9000');

if (!process.argv[2]) {
  console.error('Usage: node sender.js <filepath> [port]');
  process.exit(1);
}

async function buildFileIndex(filePath) {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;
  const hashes = [];
  const stream = createReadStream(filePath, { highWaterMark: DEFAULT_CHUNK_SIZE });
  for await (const chunk of stream) {
    hashes.push(sha256(Buffer.from(chunk)));
  }
  const tree = buildMerkleTree(hashes);
  return { fileSize, hashes, tree, merkleRoot: tree.root, totalChunks: hashes.length };
}

async function readChunk(filePath, index, chunkSize = DEFAULT_CHUNK_SIZE) {
  return new Promise((resolve, reject) => {
    const start = index * chunkSize;
    const stream = createReadStream(filePath, { start, end: start + chunkSize - 1, highWaterMark: chunkSize });
    const buffers = [];
    stream.on('data', d => buffers.push(Buffer.from(d)));
    stream.on('end', () => resolve(Buffer.concat(buffers)));
    stream.on('error', reject);
  });
}

async function main() {
  console.log(`Indexing ${FILE_PATH}...`);
  const { fileSize, hashes, tree, merkleRoot, totalChunks } = await buildFileIndex(FILE_PATH);
  console.log(`Ready: ${totalChunks} chunks, root: ${merkleRoot.slice(0, 16)}...`);
  console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

  const server = net.createServer((socket) => {
    socket.setMaxListeners(0);
    socket.setNoDelay(true);
    console.log(`Receiver connected from ${socket.remoteAddress}`);

    const framer = createFramer(async (body) => {
      const msg = parseMessage(body);
      if (msg.type !== TYPE.JSON) return;
      const { data } = msg;

      if (data.type === MSG.CHUNK_REQUEST) {
        const { index } = data;
        if (index < 0 || index >= totalChunks) return;
        const chunkData = await readChunk(FILE_PATH, index);
        const proof = getMerkleProof(tree, index);
        await sendChunk(socket, index, hashes[index], proof, chunkData);
      }

      if (data.type === MSG.TRANSFER_COMPLETE) {
        console.log('Transfer confirmed complete');
        server.close();
      }
    });

    socket.on('data', framer);
    socket.on('error', (e) => {
      if (e.code !== 'ECONNRESET') console.error('Socket error:', e.message);
    });
    socket.on('close', () => console.log('Connection closed'));

    sendJSON(socket, {
      type: MSG.FILE_OFFER,
      fileName: basename(FILE_PATH),
      fileSize,
      totalChunks,
      chunkSize: DEFAULT_CHUNK_SIZE,
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