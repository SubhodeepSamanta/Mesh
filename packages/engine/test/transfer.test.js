import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink, mkdir, rm } from 'fs/promises';
import { randomBytes, createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'net';
import { chunkFile, assembleChunks } from '../src/chunker.js';
import { getMerkleProof } from '../src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from '../src/protocol.js';

async function makeTempFile(size) {
    const filePath = join(tmpdir(), `mesh-transfer-${Date.now()}.bin`);
    await writeFile(filePath, randomBytes(size));
    return filePath;
}

function startMiniSender(filePath, port) {
    return new Promise(async (resolveSender, rejectSender) => {
       const { chunks, hashes, tree, merkleRoot, totalChunks, fileSize } = await chunkFile(filePath);

        const server = net.createServer((socket) => {
            socket.setNoDelay(true);
            socket.setMaxListeners(200);

            const framer = createFramer((body) => {
                const msg = parseMessage(body);
                if (msg.type !== TYPE.JSON) return;

                if (msg.data.type === MSG.CHUNK_REQUEST) {
                    const { index } = msg.data;
                    const proof = getMerkleProof(tree, index);
                    sendChunk(socket, index, hashes[index], proof, chunks[index]);
                }

                if (msg.data.type === MSG.TRANSFER_COMPLETE) {
                    server.close();
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
        const received = new Map();
        let metadata = null;
        const PIPELINE = 32;
        let nextRequest = 0;
        const inFlight = new Set();
        let done = false;

        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.setNoDelay(true);
        socket.setMaxListeners(200);

        function requestNext() {
            if (!metadata || done) return;
            while (inFlight.size < PIPELINE && nextRequest < metadata.totalChunks) {
                if (!received.has(nextRequest)) {
                    inFlight.add(nextRequest);
                    sendJSON(socket, { type: MSG.CHUNK_REQUEST, index: nextRequest });
                }
                nextRequest++;
            }
        }

        const framer = createFramer(async (body) => {
            if (done) return;
            const msg = parseMessage(body);

            if (msg.type === TYPE.JSON && msg.data.type === MSG.FILE_OFFER) {
                metadata = msg.data;
                sendJSON(socket, { type: MSG.FILE_ACCEPT });
                requestNext();
                return;
            }

            if (msg.type === TYPE.CHUNK) {
                const { chunkIndex, chunkHash, proof, chunkData } = msg;
                inFlight.delete(chunkIndex);
                const hashMatch = createHash('sha256').update(chunkData).digest('hex') === chunkHash;
                if (!hashMatch) { reject(new Error(`Chunk ${chunkIndex} hash mismatch`)); return; }
                const { verifyChunk } = await import('../src/crypto.js');
                const proofValid = verifyChunk(chunkData, proof, metadata.merkleRoot);
                if (!proofValid) { reject(new Error(`Chunk ${chunkIndex} Merkle proof invalid`)); return; }
                received.set(chunkIndex, chunkData);
                if (received.size === metadata.totalChunks) {
                    const assembled = assembleChunks(received, metadata.totalChunks);
                    const outPath = join(outputDir, metadata.fileName);
                    await writeFile(outPath, assembled);
                    sendJSON(socket, { type: MSG.TRANSFER_COMPLETE });
                    socket.destroy();
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
    const outDir = join(tmpdir(), `mesh-out-${Date.now()}`);
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