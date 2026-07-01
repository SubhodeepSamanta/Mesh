import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { randomBytes } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DHTNode } from '../src/dht.js';
import { buildMerkleTree, getMerkleProof, sha256, generateKeyPair, exportPublicKey, deriveSharedKey, encrypt } from '../src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from '../src/protocol.js';
import { downloadFile, MAX_CONCURRENT_CONNECTIONS } from '../src/transfer.js';

function startTestSeeder(chunks, hashes, tree, merkleRoot, fileSize, port) {
  return new Promise((resolveListen) => {
    const server = net.createServer((socket) => {
      socket.setNoDelay(true);
      socket.setMaxListeners(0);

      const keyPair = generateKeyPair();
      let sharedKey = null;

      const framer = createFramer((body) => {
        const msg = parseMessage(body);
        if (msg.type !== TYPE.JSON) return;

        if (msg.data.type === MSG.KEY_EXCHANGE) {
          const theirPub = Buffer.from(msg.data.publicKey, 'base64');
          sharedKey = deriveSharedKey(keyPair.privateKey, theirPub);
          const myPub = exportPublicKey(keyPair).toString('base64');
          sendJSON(socket, { type: MSG.KEY_EXCHANGE, publicKey: myPub });
          return;
        }

        if (msg.data.type === MSG.CHUNK_REQUEST && sharedKey) {
          const { index } = msg.data;
          const proof = getMerkleProof(tree, index);
          const encrypted = encrypt(chunks[index], sharedKey);
          sendChunk(socket, index, hashes[index], proof, encrypted);
        }
      });

      socket.on('data', framer);
    });

    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}

function startSlowTestSeeder(chunks, hashes, tree, delayMs, port) {
  return new Promise((resolveListen) => {
    const server = net.createServer((socket) => {
      socket.setNoDelay(true);
      socket.setMaxListeners(0);

      const keyPair = generateKeyPair();
      let sharedKey = null;

      const framer = createFramer((body) => {
        const msg = parseMessage(body);
        if (msg.type !== TYPE.JSON) return;

        if (msg.data.type === MSG.KEY_EXCHANGE) {
          setTimeout(() => {
            const theirPub = Buffer.from(msg.data.publicKey, 'base64');
            sharedKey = deriveSharedKey(keyPair.privateKey, theirPub);
            const myPub = exportPublicKey(keyPair).toString('base64');
            sendJSON(socket, { type: MSG.KEY_EXCHANGE, publicKey: myPub });
          }, delayMs);
          return;
        }

        if (msg.data.type === MSG.CHUNK_REQUEST && sharedKey) {
          const { index } = msg.data;
          const proof = getMerkleProof(tree, index);
          const encrypted = encrypt(chunks[index], sharedKey);
          sendChunk(socket, index, hashes[index], proof, encrypted);
        }
      });

      socket.on('data', framer);
    });

    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}

describe('engine integration', () => {
  it('downloads a file end to end via DHT discovery and encrypted swarm transfer', async () => {
    const numChunks = 10;
    const chunkSize = 1024;
    const chunks = [];
    const hashes = [];
    for (let i = 0; i < numChunks; i++) {
      const chunk = randomBytes(chunkSize);
      chunks.push(chunk);
      hashes.push(sha256(chunk));
    }
    const tree = buildMerkleTree(hashes);
    const fileHash = sha256(Buffer.concat(chunks));

    const seederNode = new DHTNode();
    const downloaderNode = new DHTNode();
    await seederNode.listen();
    await downloaderNode.listen();

    downloaderNode.routingTable.addPeer({
      id: seederNode.nodeId, addr: '127.0.0.1', port: seederNode.port,
    });

    const tcpPort = 18500 + Math.floor(Math.random() * 500);
    const server = await startTestSeeder(chunks, hashes, tree, tree.root, numChunks * chunkSize, tcpPort);

    await seederNode.announceFile(fileHash, tcpPort);

    const outputPath = join(tmpdir(), `mesh-dl-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
    const fileSize = numChunks * chunkSize;

    await downloadFile({
      fileHash, fileSize, totalChunks: numChunks, chunkSize,
      merkleRoot: tree.root, outputPath, dhtNode: downloaderNode,
    });

    const resultBuf = await readFile(outputPath);
    const expected = Buffer.concat(chunks);
    assert.deepEqual(resultBuf, expected);

    await unlink(outputPath);
    server.close();
    await seederNode.close();
    await downloaderNode.close();
  });
it('connects to multiple peers concurrently rather than sequentially', async () => {
    const numChunks = 5;
    const chunkSize = 1024;
    const chunks = [];
    const hashes = [];
    for (let i = 0; i < numChunks; i++) {
      const chunk = randomBytes(chunkSize);
      chunks.push(chunk);
      hashes.push(sha256(chunk));
    }
    const tree = buildMerkleTree(hashes);
    const fileHash = sha256(Buffer.concat(chunks));

    const DELAY_MS = 400;
    const NUM_SEEDERS = 5;
    const servers = [];
    const seederPeers = [];

    for (let i = 0; i < NUM_SEEDERS; i++) {
      const port = 18700 + i;
      const server = await startSlowTestSeeder(chunks, hashes, tree, DELAY_MS, port);
      servers.push(server);
      seederPeers.push({ addr: '127.0.0.1', port });
    }

    const fakeDht = { getPeersForFile: async () => seederPeers };
    const outputPath = join(tmpdir(), `mesh-concurrent-${Date.now()}.bin`);
    const start = Date.now();

    await downloadFile({
      fileHash, fileSize: numChunks * chunkSize, totalChunks: numChunks, chunkSize,
      merkleRoot: tree.root, outputPath, dhtNode: fakeDht,
    });

    const elapsed = Date.now() - start;
    assert.ok(
      elapsed < DELAY_MS * NUM_SEEDERS,
      `expected concurrent connect (< ${DELAY_MS * NUM_SEEDERS}ms), took ${elapsed}ms — possible sequential regression`
    );

    await unlink(outputPath);
    for (const s of servers) s.close();
  });

  it('caps concurrent connection attempts at MAX_CONCURRENT_CONNECTIONS', async () => {
    const deadPeers = Array.from({ length: 40 }, () => ({ addr: '127.0.0.1', port: 1 }));
    const fakeDht = { getPeersForFile: async () => deadPeers };
    const outputPath = join(tmpdir(), `mesh-cap-${Date.now()}.bin`);

await assert.rejects(
      () => downloadFile({
        fileHash: 'x'.repeat(64), fileSize: 1024 * 5, totalChunks: 5, chunkSize: 1024,
        merkleRoot: 'a'.repeat(64), outputPath, dhtNode: fakeDht,
      }),
      (err) => {
        assert.match(err.message, new RegExp(`Tried ${MAX_CONCURRENT_CONNECTIONS} of 40`));
        return true;
      }
    );
  });
  it('throws a clear error when no peers have the file', async () => {
    const downloaderNode = new DHTNode();
    await downloaderNode.listen();

    const fakeFileHash = sha256(Buffer.from('nobody has this'));
    const outputPath = join(tmpdir(), `mesh-dl-nopeer-${Date.now()}.bin`);

    await assert.rejects(
      () => downloadFile({
        fileHash: fakeFileHash, fileSize: 1024 * 5, totalChunks: 5, chunkSize: 1024,
        merkleRoot: 'a'.repeat(64), outputPath, dhtNode: downloaderNode,
      }),
      /No peers found/
    );

    await downloaderNode.close();
  });

  it('reports detailed errors when all peer connections fail', async () => {
    const downloaderNode = new DHTNode();
    const fakeSeederNode = new DHTNode();
    await downloaderNode.listen();
    await fakeSeederNode.listen();

    downloaderNode.routingTable.addPeer({
      id: fakeSeederNode.nodeId, addr: '127.0.0.1', port: fakeSeederNode.port,
    });

    const fileHash = sha256(Buffer.from('file with dead peer'));
    await fakeSeederNode.announceFile(fileHash, 19999);

    const outputPath = join(tmpdir(), `mesh-dl-deadpeer-${Date.now()}.bin`);

    await assert.rejects(
      () => downloadFile({
        fileHash, fileSize: 1024 * 5, totalChunks: 5, chunkSize: 1024,
        merkleRoot: 'a'.repeat(64), outputPath, dhtNode: downloaderNode,
      }),
      (err) => {
        assert.match(err.message, /Could not connect to any peer/);
        assert.match(err.message, /19999/);
        assert.match(err.message, /ECONNREFUSED/);
        return true;
      }
    );

    await downloaderNode.close();
    await fakeSeederNode.close();
  });
});