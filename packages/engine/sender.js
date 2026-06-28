import net from 'net';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { sendJSON, createFramer, parseMessage, MSG, TYPE } from './src/protocol.js';
import { verifyChunk } from './src/crypto.js';
import { assembleChunks } from './src/chunker.js';

const SENDER_HOST = process.argv[2] || '127.0.0.1';
const SENDER_PORT = parseInt(process.argv[3] || '9000');
const OUTPUT_DIR  = process.argv[4] || './received';
const PIPELINE    = 32;

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  let metadata = null;
  const received = new Map();
  const inFlight = new Set();
  let nextRequest = 0;
  let startTime = null;

  const socket = net.createConnection({ host: SENDER_HOST, port: SENDER_PORT });
  socket.setNoDelay(true);

  function requestNext() {
    if (!metadata) return;
    while (inFlight.size < PIPELINE && nextRequest < metadata.totalChunks) {
      if (!received.has(nextRequest) && !inFlight.has(nextRequest)) {
        inFlight.add(nextRequest);
        sendJSON(socket, { type: MSG.CHUNK_REQUEST, index: nextRequest });
      }
      nextRequest++;
    }
  }

  async function finish() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const speedMB = (metadata.fileSize / 1024 / 1024 / elapsed).toFixed(2);
    process.stdout.write('\n');
    console.log(`All chunks received. Assembling...`);

    const assembled = assembleChunks(received, metadata.totalChunks);
    const outPath = join(OUTPUT_DIR, metadata.fileName);
    await writeFile(outPath, assembled);

    const fileHash = createHash('sha256').update(assembled).digest('hex');
    console.log(`Saved: ${outPath}`);
    console.log(`Size: ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Time: ${elapsed}s`);
    console.log(`Speed: ${speedMB} MB/s`);
    console.log(`SHA-256: ${fileHash}`);

    sendJSON(socket, { type: MSG.TRANSFER_COMPLETE });
  }

  const framer = createFramer(async (body) => {
    const msg = parseMessage(body);

    if (msg.type === TYPE.JSON && msg.data.type === MSG.FILE_OFFER) {
      metadata = msg.data;
      startTime = Date.now();
      console.log(`Incoming: ${metadata.fileName} (${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB)`);
      console.log(`Chunks: ${metadata.totalChunks}, Root: ${metadata.merkleRoot.slice(0, 16)}...`);
      sendJSON(socket, { type: MSG.FILE_ACCEPT });
      requestNext();
      return;
    }

    if (msg.type === TYPE.CHUNK) {
      const { chunkIndex, chunkHash, chunkData } = msg;
      inFlight.delete(chunkIndex);

      const valid = verifyChunk(chunkData, [], metadata.merkleRoot);
      const hashMatch = createHash('sha256').update(chunkData).digest('hex') === chunkHash;

      if (!hashMatch) {
        console.warn(`Chunk ${chunkIndex} hash mismatch, re-requesting`);
        inFlight.add(chunkIndex);
        sendJSON(socket, { type: MSG.CHUNK_REQUEST, index: chunkIndex });
        return;
      }

      received.set(chunkIndex, chunkData);

      const progress = ((received.size / metadata.totalChunks) * 100).toFixed(1);
      process.stdout.write(`\rProgress: ${progress}% (${received.size}/${metadata.totalChunks})`);

      if (received.size === metadata.totalChunks) {
        await finish();
        return;
      }

      if (nextRequest < metadata.totalChunks) {
        requestNext();
      } else {
        const missing = [];
        for (let i = 0; i < metadata.totalChunks; i++) {
          if (!received.has(i) && !inFlight.has(i)) missing.push(i);
        }
        for (const idx of missing) {
          inFlight.add(idx);
          sendJSON(socket, { type: MSG.CHUNK_REQUEST, index: idx });
        }
      }
    }
  });

  socket.on('connect', () => {
    console.log(`Connected to sender at ${SENDER_HOST}:${SENDER_PORT}`);
  });

  socket.on('data', framer);
  socket.on('error', (e) => console.error('Error:', e.message));
  socket.on('close', () => process.exit(0));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});