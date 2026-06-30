import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink, mkdir, rm, open } from 'fs/promises';
import { randomBytes, createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'net';
import { chunkFile, assembleChunks } from '../src/chunker.js';
import { getMerkleProof, verifyChunk } from '../src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from '../src/protocol.js';

async function makeTempFile(size) {
  const filePath = join(tmpdir(), `mesh-transfer-${Date.now()}.bin`);
  await writeFile(filePath, randomBytes(size));
  return filePath;
}

function startMiniSender(filePath, port) {
  return new Promise(async (resolveSender, rejectSender) => {
    const { chunks, hashes, tree, merkleRoot, totalChunks, fileSize, chunkSize } = await chunkFile(filePath);

    const server = net.createServer((socket) => {
      socket.setNoDelay(true);
      socket.setMaxListeners(0);

      const framer = createFramer((body) => {
        const msg = parseMessage(body);
        if (msg.type !== TYPE.JSON) return;
        if (msg.data.type === MSG.KEEPALIVE) return;
        if (msg.data.type === MSG.CHUNK_REQUEST) {
          const { index } = msg.data;
          const proof = getMerkleProof(tree, index);
          sendChunk(socket, index, hashes[index], proof, chunks[index]);
        }
        if (msg.data.type === MSG.TRANSFER_COMPLETE) {
          server.close();
          socket.end();
          resolveSender();
        }
      });

      socket.on('data', framer);
      socket.on('error', (e) => {
        if (e.code !== 'ECONNRESET') rejectSender(e);
      });
      socket.on('close', () => resolveSender());

      sendJSON(socket, {
        type: MSG.FILE_OFFER,
        fileName: 'testfile.bin',
        fileSize,
        totalChunks,
        chunkSize,
        merkleRoot,
        hashes,
      });
    });

    server.listen(port, '127.0.0.1');
    server.on('error', rejectSender);
  });
}

function waitForPort(port, retries = 30, delay = 50) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        if (n <= 0) { reject(new Error(`Port ${port} not ready`)); return; }
        setTimeout(() => attempt(n - 1), delay);
      });
    }
    attempt(retries);
  });
}

function runMiniReceiver(port, outputDir) {
  return new Promise((resolve, reject) => {
    const received  = new Set();
    const inFlight  = new Set();
    const pending   = new Set();
    let metadata    = null;
    let fileHandle  = null;
    let nextRequest = 0;
    let done        = false;
    const PIPELINE  = 32;

    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setNoDelay(true);
    socket.setMaxListeners(0);

    function requestNext() {
      if (!metadata || done) return;
      while (inFlight.size < PIPELINE && nextRequest < metadata.totalChunks) {
        if (!received.has(nextRequest)) {
          inFlight.add(nextRequest);
          sendJSON(socket, { type: MSG.CHUNK_REQUEST, index: nextRequest });
        }
        nextRequest++;
      }
      if (nextRequest >= metadata.totalChunks) {
        for (const idx of pending) {
          if (inFlight.size >= PIPELINE) break;
          inFlight.add(idx);
          pending.delete(idx);
          sendJSON(socket, { type: MSG.CHUNK_REQUEST, index: idx });
        }
      }
    }

    const framer = createFramer(async (body) => {
      if (done) return;
      const msg = parseMessage(body);

      if (msg.type === TYPE.JSON && msg.data.type === MSG.FILE_OFFER) {
        metadata = msg.data;
        const outPath = join(outputDir, metadata.fileName);
        fileHandle = await open(outPath, 'w');
        await fileHandle.truncate(metadata.fileSize);
        for (let i = 0; i < metadata.totalChunks; i++) pending.add(i);
        sendJSON(socket, { type: MSG.FILE_ACCEPT });
        requestNext();
        return;
      }

      if (msg.type === TYPE.CHUNK) {
        const { chunkIndex, chunkHash, proof, chunkData } = msg;
        inFlight.delete(chunkIndex);
        pending.delete(chunkIndex);

        const hashMatch = createHash('sha256').update(chunkData).digest('hex') === chunkHash;
        if (!hashMatch) { pending.add(chunkIndex); requestNext(); return; }

        const proofValid = verifyChunk(chunkData, proof, metadata.merkleRoot);
        if (!proofValid) { pending.add(chunkIndex); requestNext(); return; }

        const offset = chunkIndex * metadata.chunkSize;
        await fileHandle.write(chunkData, 0, chunkData.length, offset);
        received.add(chunkIndex);

        if (received.size === metadata.totalChunks) {
          done = true;
          await fileHandle.close();
          const outPath = join(outputDir, metadata.fileName);
          sendJSON(socket, { type: MSG.TRANSFER_COMPLETE });
          socket.end();
          resolve(outPath);
          return;
        }

        requestNext();
      }
    });

    socket.on('data', framer);
    socket.on('error', (e) => {
      if (!done && e.code !== 'ECONNRESET') reject(e);
    });
  });
}

async function runTransferTest(sizeBytes, port) {
  const filePath = await makeTempFile(sizeBytes);
  const outDir   = join(tmpdir(), `mesh-out-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  const senderReady = startMiniSender(filePath, port);
  await waitForPort(port);
  const outPath = await runMiniReceiver(port, outDir);
  await senderReady;

  const original = await readFile(filePath);
  const received = await readFile(outPath);
  const match =
    createHash('sha256').update(original).digest('hex') ===
    createHash('sha256').update(received).digest('hex');

  await unlink(filePath);
  await rm(outDir, { recursive: true });
  return match;
}

describe('transfer', () => {
  it('transfers a 10MB file correctly with hash match', async () => {
    const match = await runTransferTest(10 * 1024 * 1024, 19001);
    assert.equal(match, true);
  });

  it('transfers a 100MB file correctly with hash match', { timeout: 60000 }, async () => {
    const match = await runTransferTest(100 * 1024 * 1024, 19002);
    assert.equal(match, true);
  });
});