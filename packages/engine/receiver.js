import net from 'net';
import { mkdir, open } from 'fs/promises';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { sendJSON, createFramer, parseMessage, MSG, TYPE } from './src/protocol.js';
import { verifyChunk } from './src/crypto.js';
import { computeSimplePipelineDepth } from './src/chunker.js';

const SENDER_HOST  = process.argv[2] || '127.0.0.1';
const SENDER_PORT  = parseInt(process.argv[3] || '9000');
const OUTPUT_DIR   = resolve(process.argv[4] || './received');
const DEFAULT_PIPELINE = 32;
const TIMEOUT_MS   = 30000;
const KEEPALIVE_MS = 10000;

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  let metadata         = null;
  let fileHandle        = null;
  const received        = new Set();
  const inFlight         = new Set();
  const pending          = new Set();
  let nextRequest        = 0;
  let startTime          = null;
  let done               = false;
  let finishing          = false;
  let timeoutHandle      = null;
  let keepaliveHandle    = null;
  let pipeline           = DEFAULT_PIPELINE;

  const socket = net.createConnection({ host: SENDER_HOST, port: SENDER_PORT });
  socket.setMaxListeners(0);
  socket.setNoDelay(true);

  function resetTimeout() {
    clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(() => {
      if (!done) {
        console.error('\nTransfer timed out');
        cleanup();
        process.exit(1);
      }
    }, TIMEOUT_MS);
  }

  function startKeepalive() {
    keepaliveHandle = setInterval(() => {
      if (!done) sendJSON(socket, { type: MSG.KEEPALIVE });
    }, KEEPALIVE_MS);
  }

  function cleanup() {
    clearTimeout(timeoutHandle);
    clearInterval(keepaliveHandle);
    if (fileHandle) {
      fileHandle.close().catch(() => {});
      fileHandle = null;
    }
    if (!socket.destroyed) socket.destroy();
  }

  function requestNext() {
    if (!metadata || done || finishing) return;
    while (inFlight.size < pipeline && nextRequest < metadata.totalChunks) {
      if (!received.has(nextRequest)) {
        inFlight.add(nextRequest);
        sendJSON(socket, { type: MSG.CHUNK_REQUEST, index: nextRequest });
      }
      nextRequest++;
    }
    if (nextRequest >= metadata.totalChunks && inFlight.size < pipeline) {
      for (const idx of pending) {
        if (inFlight.size >= pipeline) break;
        inFlight.add(idx);
        pending.delete(idx);
        sendJSON(socket, { type: MSG.CHUNK_REQUEST, index: idx });
      }
    }
  }

  async function finish() {
    if (finishing || done) return;
    finishing = true;
    done = true;

    clearTimeout(timeoutHandle);
    clearInterval(keepaliveHandle);

    if (fileHandle) {
      await fileHandle.close();
      fileHandle = null;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const speedMB = (metadata.fileSize / 1024 / 1024 / parseFloat(elapsed)).toFixed(2);

    process.stdout.write('\n');
    console.log('All chunks received and verified.');
    console.log(`Saved:   ${join(OUTPUT_DIR, metadata.fileName)}`);
    console.log(`Size:    ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Time:    ${elapsed}s`);
    console.log(`Speed:   ${speedMB} MB/s`);

    sendJSON(socket, { type: MSG.TRANSFER_COMPLETE });
    socket.end();
    process.exit(0);
  }

  const framer = createFramer(async (body) => {
    if (done || finishing) return;
    resetTimeout();

    const msg = parseMessage(body);

    if (msg.type === TYPE.JSON && msg.data.type === MSG.FILE_OFFER) {
      metadata  = msg.data;
      startTime = Date.now();
      pipeline  = computeSimplePipelineDepth(metadata.chunkSize);

      const outPath = join(OUTPUT_DIR, metadata.fileName);
      fileHandle = await open(outPath, 'w');
      await fileHandle.truncate(metadata.fileSize);

      console.log(`Incoming: ${metadata.fileName}`);
      console.log(`Size:     ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Chunks:   ${metadata.totalChunks}`);
      console.log(`Chunk size: ${(metadata.chunkSize / 1024).toFixed(0)} KB`);
      console.log(`Root:     ${metadata.merkleRoot.slice(0, 32)}...`);

      for (let i = 0; i < metadata.totalChunks; i++) pending.add(i);

      sendJSON(socket, { type: MSG.FILE_ACCEPT });
      startKeepalive();

      if (metadata.totalChunks === 0) {
        await finish();
        return;
      }

      requestNext();
      return;
    }

    if (msg.type === TYPE.JSON && msg.data.type === MSG.KEEPALIVE) {
      return;
    }

    if (msg.type === TYPE.CHUNK) {
      const { chunkIndex, chunkHash, proof, chunkData } = msg;

      if (received.has(chunkIndex)) {
        requestNext();
        return;
      }

      inFlight.delete(chunkIndex);
      pending.delete(chunkIndex);

      const hashMatch = createHash('sha256').update(chunkData).digest('hex') === chunkHash;
      if (!hashMatch) {
        console.warn(`\nChunk ${chunkIndex} hash mismatch — re-requesting`);
        pending.add(chunkIndex);
        requestNext();
        return;
      }

      const proofValid = verifyChunk(chunkData, proof, metadata.merkleRoot);
      if (!proofValid) {
        console.warn(`\nChunk ${chunkIndex} Merkle proof invalid — re-requesting`);
        pending.add(chunkIndex);
        requestNext();
        return;
      }

      await fileHandle.write(chunkData, 0, chunkData.length, chunkIndex * metadata.chunkSize);
      received.add(chunkIndex);

      const pct = ((received.size / metadata.totalChunks) * 100).toFixed(1);
      process.stdout.write(`\rProgress: ${pct}% (${received.size}/${metadata.totalChunks}) — ${inFlight.size} in flight   `);

      if (received.size === metadata.totalChunks) {
        await finish();
        return;
      }

      requestNext();
    }
  });

  socket.on('connect', () => {
    console.log(`Connected to ${SENDER_HOST}:${SENDER_PORT}`);
    resetTimeout();
  });

  socket.on('data', framer);

  socket.on('error', (e) => {
    if (!done) {
      console.error('\nConnection error:', e.message);
      cleanup();
    }
  });

  socket.on('close', () => {
    if (!done) {
      console.error('\nConnection closed before transfer completed');
      cleanup();
    }
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});