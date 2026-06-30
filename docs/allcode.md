# All Code Snapshot

Generated from: Mesh Root Project

Excluded: node_modules, .git, package-lock.json, .env

## File List

- .env.example
- .gitignore
- docker-compose.yml
- docs/phases.md
- package.json
- packages/cli/package.json
- packages/cli/src/commands/receive.js
- packages/cli/src/commands/send.js
- packages/cli/src/index.js
- packages/cli/src/ui/TransferTUI.jsx
- packages/engine/package.json
- packages/engine/receiver.js
- packages/engine/sender.js
- packages/engine/src/chunker.js
- packages/engine/src/crypto.js
- packages/engine/src/dht.js
- packages/engine/src/index.js
- packages/engine/src/peer.js
- packages/engine/src/protocol.js
- packages/engine/src/swarm.js
- packages/engine/src/transfer.js
- packages/engine/test/chunker.test.js
- packages/engine/test/crypto.test.js
- packages/engine/test/protocol.test.js
- packages/engine/test/transfer.test.js
- packages/signaling/Dockerfile
- packages/signaling/package.json
- packages/signaling/src/metrics.js
- packages/signaling/src/server.js
- packages/web/.gitignore
- packages/web/eslint.config.js
- packages/web/index.html
- packages/web/package.json
- packages/web/public/favicon.svg
- packages/web/public/icons.svg
- packages/web/README.md
- packages/web/src/App.css
- packages/web/src/App.jsx
- packages/web/src/assets/hero.png
- packages/web/src/assets/react.svg
- packages/web/src/assets/vite.svg
- packages/web/src/index.css
- packages/web/src/main.jsx
- packages/web/vite.config.js
- received/protocol.js
- received/testfile.bin
- received/transfer.test.js
- testfile.bin

## Contents

### .env.example

```text
PORT=8080
NODE_ENV=development
VITE_SIGNALING_URL=ws://localhost:8080
```

### .gitignore

```text
node_modules/
dist/
.env
*.log
.DS_Store
received/
testfile.bin
```

### docker-compose.yml

```text
version: '3.8'
services:
  signaling:
    build: ./packages/signaling
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
    restart: unless-stopped
```

### docs/phases.md

```text
# Mesh — Project Phases

## Overview

Mesh is a decentralised P2P file transfer platform. The project is built in 5 major phases. Each phase has multiple parts. Each part ends with a commit checkpoint. Tests are written alongside each part, not after.

---

## Phase 1 — Raw TCP Transfer Engine

The goal of this phase is two Node.js processes transferring a file correctly over raw TCP. No UI, no DHT, no encryption. Just bytes moving from A to B with integrity verification.

What gets built:
- Message framing protocol over TCP streams
- File chunker with Merkle tree integrity
- SHA-256 chunk hashing and verification
- Sender and receiver scripts
- Backpressure handling for large files

Tests: chunker correctness, framer correctness, hash verification, large file transfer

Ends when: a 1GB file transfers between two processes with hash match

---

## Phase 2 — DHT, Encryption, Multi-Peer

The goal is making the transfer genuinely decentralised and secure. Peers find each other without any central server. All data is encrypted end to end.

What gets built:
- Kademlia DHT with k-buckets, XOR routing, iterative lookup
- DHT announce and get-peers flow over UDP
- ECDH key exchange per session
- AES-256-GCM encryption and decryption per chunk
- Swarm manager coordinating chunks across multiple peers in parallel

Tests: DHT routing correctness, XOR distance, key exchange, encryption round-trip, swarm chunk distribution

Ends when: three processes find each other via DHT and transfer a file encrypted end to end

---

## Phase 3 — Signaling Server and WebRTC

The goal is browser-to-browser peer connections. A lightweight signaling server introduces peers and then gets out of the way. NAT traversal via STUN.

What gets built:
- WebSocket signaling server with room system
- Room codes and QR generation
- WebRTC offer/answer exchange via signaling relay
- ICE candidate exchange and STUN integration
- Password protected rooms, room expiry, rate limiting
- Peer join and leave handling

Tests: room creation, peer join flow, relay correctness, rate limiting

Ends when: two browser tabs connect directly via WebRTC data channel using a room code

---

## Phase 4 — React Frontend

The goal is a production quality UI that makes the transfer experience visual and impressive. Five pages, real-time data from the engine, D3 peer graph, chunk grid animation.

What gets built:
- Zustand global transfer state store
- Landing page
- Send page with drag and drop, room code, QR display
- Receive page with code entry, file preview
- Transfer dashboard with D3 peer mesh graph, chunk grid, speed graph, peer cards
- History page
- useTransfer hook connecting engine to UI
- Mobile responsive layout

Tests: store updates, hook behaviour, component rendering

Ends when: full transfer flow works in the browser with live visualisation

---

## Phase 5 — CLI, Polish, and Deployment

The goal is shipping. A CLI that developers actually want to use, everything deployed and publicly accessible, and the project portfolio-ready.

What gets built:
- mesh send and mesh receive CLI commands
- Ink TUI with live progress, peer list, chunk grid
- Dockerfile for signaling server
- Deployment to Railway (signaling) and Vercel (web)
- Architecture diagram
- Demo video
- README with setup instructions

Tests: CLI send and receive integration test

Ends when: mesh send ./file.zip works from terminal, live deployment accessible, README complete

---

## Testing Strategy

Every phase has tests written in the same part as the code. Not after.

Engine tests use Node's built-in test runner. No Jest, no Vitest for the engine — zero dependencies.

Web tests use Vitest since it is already in the Vite ecosystem.

Test types across phases:
- Unit tests: individual functions like chunker, hasher, framer, XOR distance
- Integration tests: sender to receiver over real TCP, DHT node to node over real UDP
- End to end tests: full file transfer through the complete stack

---

## Checkpoint Structure

Each part inside a phase ends with a git commit. Commit messages follow this format:

checkpoint [phase]-[part]: description

Examples:
- checkpoint 1-1: protocol framer complete with tests
- checkpoint 1-2: chunker and merkle tree complete with tests
- checkpoint 2-1: kademlia routing table and XOR distance
- checkpoint 3-1: signaling server with room system

---

## Current Status

- [x] Phase 0: Monorepo scaffolded, all packages initialized
- [x] Phase 1: Raw TCP Transfer Engine
- [ ] Phase 2: DHT, Encryption, Multi-Peer
- [ ] Phase 3: Signaling Server and WebRTC
- [ ] Phase 4: React Frontend
- [ ] Phase 5: CLI, Polish, Deployment
```

### package.json

```text
{
  "name": "mesh",
  "version": "1.0.0",
  "description": "Decentralised P2P file transfer platform",
  "private": true,
  "workspaces": [
    "packages/engine",
    "packages/signaling",
    "packages/web",
    "packages/cli"
  ],
  "scripts": {
    "dev:signaling": "npm run dev --workspace=packages/signaling",
    "dev:web": "npm run dev --workspace=packages/web",
    "test": "npm run test --workspace=packages/engine"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/subhodeepsamanta/mesh.git"
  },
  "author": "Subhodeep Samanta",
  "license": "ISC"
}
```

### packages/cli/package.json

```text
{
  "name": "@mesh/cli",
  "version": "1.0.0",
  "description": "Mesh CLI for sending and receiving files",
  "main": "src/index.js",
  "type": "module",
  "bin": {
    "mesh": "src/index.js"
  },
  "scripts": {
    "dev": "node src/index.js"
  },
  "license": "ISC",
  "dependencies": {
    "commander": "^15.0.0",
    "ink": "^7.1.0"
  }
}
```

### packages/cli/src/commands/receive.js

```text
export function receiveCommand() {}
```

### packages/cli/src/commands/send.js

```text
export function sendCommand() {}
```

### packages/cli/src/index.js

```text
#!/usr/bin/env node
console.log('Mesh CLI');
```

### packages/cli/src/ui/TransferTUI.jsx

```text
export function TransferTUI() { return null; }
```

### packages/engine/package.json

```text
{
  "name": "@mesh/engine",
  "version": "1.0.0",
  "description": "Core P2P engine shared by web and cli",
  "main": "src/index.js",
  "type": "module",
  "scripts": {
    "test": "node --test --test-force-exit test/protocol.test.js test/chunker.test.js test/crypto.test.js test/transfer.test.js"
  },
  "license": "ISC"
}
```

### packages/engine/receiver.js

```text
import net from 'net';
import { mkdir, open } from 'fs/promises';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { sendJSON, createFramer, parseMessage, MSG, TYPE } from './src/protocol.js';
import { verifyChunk } from './src/crypto.js';

const SENDER_HOST  = process.argv[2] || '127.0.0.1';
const SENDER_PORT  = parseInt(process.argv[3] || '9000');
const OUTPUT_DIR   = resolve(process.argv[4] || './received');
const PIPELINE     = 32;
const TIMEOUT_MS   = 30000;
const KEEPALIVE_MS = 10000;

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  let metadata         = null;
  let fileHandle       = null;
  const received       = new Set();
  const inFlight       = new Set();
  const pending        = new Set();
  let nextRequest      = 0;
  let startTime        = null;
  let done             = false;
  let finishing        = false;
  let timeoutHandle    = null;
  let keepaliveHandle  = null;

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
    while (inFlight.size < PIPELINE && nextRequest < metadata.totalChunks) {
      if (!received.has(nextRequest)) {
        inFlight.add(nextRequest);
        sendJSON(socket, { type: MSG.CHUNK_REQUEST, index: nextRequest });
      }
      nextRequest++;
    }
    if (nextRequest >= metadata.totalChunks && inFlight.size < PIPELINE) {
      for (const idx of pending) {
        if (inFlight.size >= PIPELINE) break;
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

      const outPath = join(OUTPUT_DIR, metadata.fileName);
      fileHandle = await open(outPath, 'w');
      await fileHandle.truncate(metadata.fileSize);

      console.log(`Incoming: ${metadata.fileName}`);
      console.log(`Size:     ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Chunks:   ${metadata.totalChunks}`);
      console.log(`Root:     ${metadata.merkleRoot.slice(0, 32)}...`);

      for (let i = 0; i < metadata.totalChunks; i++) pending.add(i);

      sendJSON(socket, { type: MSG.FILE_ACCEPT });
      startKeepalive();
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
```

### packages/engine/sender.js

```text
import net from 'net';
import { basename, resolve } from 'path';
import { getMerkleProof } from './src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from './src/protocol.js';
import { indexFile, readChunk } from './src/chunker.js';

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

      if (data.type === MSG.CHUNK_REQUEST) {
        const { index } = data;
        if (index < 0 || index >= totalChunks) return;
        const chunkData = await readChunkCached(FILE_PATH, index, chunkSize);
        const proof     = getMerkleProof(tree, index);
        await sendChunk(socket, index, hashes[index], proof, chunkData);
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
```

### packages/engine/src/chunker.js

```text
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { sha256, buildMerkleTree } from './crypto.js';

export const DEFAULT_CHUNK_SIZE = 65536;

export async function indexFile(filePath, chunkSize = DEFAULT_CHUNK_SIZE) {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;
  const hashes = [];
  const stream = createReadStream(filePath, { highWaterMark: chunkSize });
  for await (const chunk of stream) {
    hashes.push(sha256(Buffer.from(chunk)));
  }
  const tree = buildMerkleTree(hashes);
  return { hashes, tree, merkleRoot: tree.root, totalChunks: hashes.length, fileSize, chunkSize };
}

export async function readChunk(filePath, index, chunkSize = DEFAULT_CHUNK_SIZE) {
  return new Promise((resolve, reject) => {
    const start  = index * chunkSize;
    const end    = start + chunkSize - 1;
    const stream = createReadStream(filePath, { start, end, highWaterMark: chunkSize });
    const buffers = [];
    stream.on('data',  d => buffers.push(Buffer.from(d)));
    stream.on('end',   () => resolve(Buffer.concat(buffers)));
    stream.on('error', reject);
  });
}

export async function chunkFile(filePath, chunkSize = DEFAULT_CHUNK_SIZE) {
  const { hashes, tree, merkleRoot, totalChunks, fileSize } = await indexFile(filePath, chunkSize);
  const chunks = [];
  const stream = createReadStream(filePath, { highWaterMark: chunkSize });
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return { chunks, hashes, tree, merkleRoot, totalChunks, fileSize, chunkSize };
}

export function assembleChunks(chunks, totalChunks) {
  const ordered = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!chunks.has(i)) throw new Error(`Missing chunk ${i}`);
    ordered.push(chunks.get(i));
  }
  return Buffer.concat(ordered);
}
```

### packages/engine/src/crypto.js

```text
import { createHash, createCipheriv, createDecipheriv, randomBytes, generateKeyPairSync, diffieHellman, hkdfSync, createPublicKey } from 'crypto';

export const CIPHER = 'aes-256-gcm';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function buildMerkleRoot(hashes) {
  if (hashes.length === 0) throw new Error('No hashes provided');
  if (hashes.length === 1) return hashes[0];
  let level = hashes.map(h => Buffer.from(h, 'hex'));
  if (level.length % 2 !== 0) level.push(level[level.length - 1]);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(Buffer.from(createHash('sha256').update(Buffer.concat([level[i], level[i + 1]])).digest()));
    }
    level = next;
    if (level.length > 1 && level.length % 2 !== 0) level.push(level[level.length - 1]);
  }
  return level[0].toString('hex');
}

export function buildMerkleTree(hashes) {
  if (hashes.length === 0) throw new Error('No hashes provided');
  let level = hashes.map(h => Buffer.from(h, 'hex'));
  if (level.length % 2 !== 0) level.push(level[level.length - 1]);
  const levels = [level.map(b => b.toString('hex'))];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(Buffer.from(createHash('sha256').update(Buffer.concat([level[i], level[i + 1]])).digest()));
    }
    level = next;
    if (level.length > 1 && level.length % 2 !== 0) level.push(level[level.length - 1]);
    levels.push(level.map(b => b.toString('hex')));
  }
  return { root: level[0].toString('hex'), levels };
}

export function getMerkleProof(tree, index) {
  const proof = [];
  let i = index;
  for (let lvl = 0; lvl < tree.levels.length - 1; lvl++) {
    const level = tree.levels[lvl];
    const isLeft = i % 2 === 0;
    const siblingIndex = isLeft ? i + 1 : i - 1;
    if (siblingIndex < level.length) {
      proof.push({ hash: level[siblingIndex], position: isLeft ? 'right' : 'left' });
    }
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyChunk(chunkData, proof, expectedRoot) {
  let current = Buffer.from(createHash('sha256').update(chunkData).digest());
  for (const { hash: sibling, position } of proof) {
    const siblingBuf = Buffer.from(sibling, 'hex');
    const combined   = position === 'right'
      ? Buffer.concat([current, siblingBuf])
      : Buffer.concat([siblingBuf, current]);
    current = Buffer.from(createHash('sha256').update(combined).digest());
  }
  return current.toString('hex') === expectedRoot;
}

export function generateKeyPair() {
  return generateKeyPairSync('x25519');
}

export function exportPublicKey(keyPair) {
  return keyPair.publicKey.export({ type: 'spki', format: 'der' });
}

export function importPublicKey(derBytes) {
  return createPublicKey({ key: Buffer.from(derBytes), type: 'spki', format: 'der' });
}

export function deriveSharedKey(myPrivateKey, theirPublicKeyDER) {
  const theirPublicKey = createPublicKey({ key: Buffer.from(theirPublicKeyDER), type: 'spki', format: 'der' });
  const raw = diffieHellman({ privateKey: myPrivateKey, publicKey: theirPublicKey });
  return Buffer.from(hkdfSync('sha256', raw, Buffer.from('mesh-v1'), Buffer.from('mesh-encryption-key'), 32));
}

export function encrypt(plaintext, key) {
  const iv      = randomBytes(12);
  const cipher  = createCipheriv(CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decrypt(pkg, key) {
  const iv        = pkg.slice(0, 12);
  const authTag   = pkg.slice(12, 28);
  const encrypted = pkg.slice(28);
  const decipher  = createDecipheriv(CIPHER, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new Error('Decryption failed: message authentication failed');
  }
}
```

### packages/engine/src/dht.js

```text
export const DHT_K = 20;
```

### packages/engine/src/index.js

```text
export * from './protocol.js';
export * from './chunker.js';
export * from './crypto.js';
```

### packages/engine/src/peer.js

```text
export const PEER_TIMEOUT_MS = 30000;
```

### packages/engine/src/protocol.js

```text
const HEADER_SIZE = 4;
const MAX_MESSAGE_SIZE = 100 * 1024 * 1024;

export const MSG = {
  FILE_OFFER:        'FILE_OFFER',
  FILE_ACCEPT:       'FILE_ACCEPT',
  FILE_REJECT:       'FILE_REJECT',
  CHUNK_REQUEST:     'CHUNK_REQUEST',
  CHUNK_DATA:        'CHUNK_DATA',
  CHUNK_NACK:        'CHUNK_NACK',
  TRANSFER_COMPLETE: 'TRANSFER_COMPLETE',
  KEEPALIVE:         'KEEPALIVE',
  ERROR:             'ERROR',
};

export const TYPE = {
  JSON:  0x00,
  CHUNK: 0x01,
};

export function sendMessage(socket, data) {
  const isBuffer = Buffer.isBuffer(data);
  const body = isBuffer ? data : Buffer.from(JSON.stringify(data), 'utf8');
  const header = Buffer.allocUnsafe(HEADER_SIZE);
  header.writeUInt32BE(body.length, 0);
  const packet = Buffer.concat([header, body]);
  const ok = socket.write(packet);
  if (!ok) {
    return new Promise(resolve => {
      socket.once('drain', resolve);
    });
  }
  return Promise.resolve();
}

export function sendJSON(socket, obj) {
  const typeFlag = Buffer.from([TYPE.JSON]);
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return sendMessage(socket, Buffer.concat([typeFlag, body]));
}

export function sendChunk(socket, chunkIndex, chunkHash, proof, chunkBuffer) {
  const typeFlag  = Buffer.from([TYPE.CHUNK]);
  const indexBuf  = Buffer.allocUnsafe(4);
  indexBuf.writeUInt32BE(chunkIndex, 0);
  const hashBuf   = Buffer.from(chunkHash, 'hex');
  const proofJSON = Buffer.from(JSON.stringify(proof), 'utf8');
  const proofLen  = Buffer.allocUnsafe(4);
  proofLen.writeUInt32BE(proofJSON.length, 0);
  const body = Buffer.concat([typeFlag, indexBuf, hashBuf, proofLen, proofJSON, chunkBuffer]);
  return sendMessage(socket, body);
}

export function createFramer(onMessage) {
  let accumulator = Buffer.alloc(0);
  return function (incoming) {
    accumulator = Buffer.concat([accumulator, incoming]);
    while (true) {
      if (accumulator.length < HEADER_SIZE) break;
      const bodyLength = accumulator.readUInt32BE(0);
      if (bodyLength > MAX_MESSAGE_SIZE) {
        throw new Error(`Message too large: ${bodyLength} bytes`);
      }
      if (accumulator.length < HEADER_SIZE + bodyLength) break;
      const body = Buffer.from(accumulator.slice(HEADER_SIZE, HEADER_SIZE + bodyLength));
      accumulator = Buffer.from(accumulator.slice(HEADER_SIZE + bodyLength));
      onMessage(body);
    }
  };
}

export function parseMessage(body) {
  const type = body.readUInt8(0);
  if (type === TYPE.JSON) {
    return { type: TYPE.JSON, data: JSON.parse(body.slice(1).toString('utf8')) };
  }
  if (type === TYPE.CHUNK) {
    const chunkIndex = body.readUInt32BE(1);
    const chunkHash  = body.slice(5, 37).toString('hex');
    const proofLen   = body.readUInt32BE(37);
    const proof      = JSON.parse(body.slice(41, 41 + proofLen).toString('utf8'));
    const chunkData  = Buffer.from(body.slice(41 + proofLen));
    return { type: TYPE.CHUNK, chunkIndex, chunkHash, proof, chunkData };
  }
  throw new Error(`Unknown message type: ${type}`);
}
```

### packages/engine/src/swarm.js

```text
export const PIPELINE_SIZE = 16;
```

### packages/engine/src/transfer.js

```text
export const TRANSFER_VERSION = '1.0.0';
```

### packages/engine/test/chunker.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes, createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { chunkFile, assembleChunks } from '../src/chunker.js';
import { sha256, buildMerkleRoot, buildMerkleTree, getMerkleProof, verifyChunk } from '../src/crypto.js';

async function makeTempFile(size) {
  const filePath = join(tmpdir(), `mesh-test-${Date.now()}.bin`);
  await writeFile(filePath, randomBytes(size));
  return filePath;
}

describe('chunker', () => {
  it('reassembles chunks to produce identical bytes to original', async () => {
    const filePath = await makeTempFile(500 * 1024);
    const { chunks, totalChunks } = await chunkFile(filePath);
    const chunkMap = new Map(chunks.map((c, i) => [i, c]));
    const reassembled = assembleChunks(chunkMap, totalChunks);
    const original = await import('fs/promises').then(fs => fs.readFile(filePath));
    assert.equal(
      createHash('sha256').update(reassembled).digest('hex'),
      createHash('sha256').update(original).digest('hex')
    );
    await unlink(filePath);
  });

  it('produces correct number of chunks for file size', async () => {
    const filePath = await makeTempFile(200 * 1024);
    const { totalChunks, chunkSize } = await chunkFile(filePath, 65536);
    assert.equal(totalChunks, Math.ceil(200 * 1024 / 65536));
    await unlink(filePath);
  });

  it('merkle root changes when any chunk is modified', () => {
    const hashes = ['aaa', 'bbb', 'ccc', 'ddd'];
    const root1 = buildMerkleRoot([...hashes]);
    const tampered = [...hashes];
    tampered[2] = 'TAMPERED';
    const root2 = buildMerkleRoot(tampered);
    assert.notEqual(root1, root2);
  });

  it('merkle proof verification passes for valid chunk', async () => {
    const filePath = await makeTempFile(300 * 1024);
    const { chunks, tree } = await chunkFile(filePath);
    const proof = getMerkleProof(tree, 0);
    const valid = verifyChunk(chunks[0], proof, tree.root);
    assert.equal(valid, true);
    await unlink(filePath);
  });

  it('merkle proof verification fails for tampered chunk', async () => {
    const filePath = await makeTempFile(300 * 1024);
    const { chunks, tree } = await chunkFile(filePath);
    const proof = getMerkleProof(tree, 0);
    const tampered = Buffer.from(chunks[0]);
    tampered[0] = tampered[0] ^ 0xff;
    const valid = verifyChunk(tampered, proof, tree.root);
    assert.equal(valid, false);
    await unlink(filePath);
  });

  it('does not crash on a large file', async () => {
    const filePath = await makeTempFile(50 * 1024 * 1024);
    const { totalChunks, merkleRoot } = await chunkFile(filePath);
    assert.ok(totalChunks > 0);
    assert.equal(typeof merkleRoot, 'string');
    assert.equal(merkleRoot.length, 64);
    await unlink(filePath);
  });
});
```

### packages/engine/test/crypto.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair,
  exportPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
} from '../src/crypto.js';

describe('crypto', () => {
  it('ECDH key exchange produces identical shared keys on both sides', () => {
    const aliceKeys = generateKeyPair();
    const bobKeys   = generateKeyPair();
    const alicePub  = exportPublicKey(aliceKeys);
    const bobPub    = exportPublicKey(bobKeys);
    const aliceShared = deriveSharedKey(aliceKeys.privateKey, bobPub);
    const bobShared   = deriveSharedKey(bobKeys.privateKey, alicePub);
    assert.deepEqual(aliceShared, bobShared);
  });

  it('encrypt and decrypt round trip produces original plaintext', () => {
    const keys      = generateKeyPair();
    const sharedKey = deriveSharedKey(keys.privateKey, exportPublicKey(keys));
    const plaintext = Buffer.from('hello mesh this is a secret message');
    const ciphertext = encrypt(plaintext, sharedKey);
    const decrypted  = decrypt(ciphertext, sharedKey);
    assert.deepEqual(decrypted, plaintext);
  });

  it('decrypt throws when ciphertext is tampered', () => {
    const keys      = generateKeyPair();
    const sharedKey = deriveSharedKey(keys.privateKey, exportPublicKey(keys));
    const ciphertext = encrypt(Buffer.from('secret data'), sharedKey);
    ciphertext[30] = ciphertext[30] ^ 0xff;
    assert.throws(() => decrypt(ciphertext, sharedKey), /authentication failed/);
  });

  it('two different encryptions of same plaintext produce different ciphertext', () => {
    const keys      = generateKeyPair();
    const sharedKey = deriveSharedKey(keys.privateKey, exportPublicKey(keys));
    const plaintext = Buffer.from('same message');
    const ct1 = encrypt(plaintext, sharedKey);
    const ct2 = encrypt(plaintext, sharedKey);
    assert.notDeepEqual(ct1, ct2);
  });
});
```

### packages/engine/test/protocol.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { sendJSON, sendChunk, createFramer, parseMessage, TYPE } from '../src/protocol.js';

function createTestSocketPair() {
  return new Promise((resolve, reject) => {
    const server = net.createServer((serverSocket) => {
      clientSocket.once('connect', () => {
        server.close();
        resolve({
          sender: clientSocket,
          receiver: serverSocket,
        });
      });
    });

    let clientSocket;

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      clientSocket = net.createConnection({
        port,
        host: '127.0.0.1',
      });

      clientSocket.on('error', reject);
    });

    server.on('error', reject);
  });
}

describe('protocol framer', () => {
  it('sends and receives a single JSON message correctly', async () => {
    const { sender, receiver } = await createTestSocketPair();
    const received = [];
    const framer = createFramer((body) => received.push(parseMessage(body)));
    receiver.on('data', framer);
    await sendJSON(sender, { type: 'TEST', value: 42 });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(received.length, 1);
    assert.equal(received[0].data.type, 'TEST');
    assert.equal(received[0].data.value, 42);
    sender.destroy();
    receiver.destroy();
  });

  it('receives 20 messages sent back to back all correctly', async () => {
    const { sender, receiver } = await createTestSocketPair();
    const received = [];
    const framer = createFramer((body) => received.push(parseMessage(body)));
    receiver.on('data', framer);
    for (let i = 0; i < 20; i++) {
      await sendJSON(sender, { index: i });
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(received.length, 20);
    for (let i = 0; i < 20; i++) {
      assert.equal(received[i].data.index, i);
    }
    sender.destroy();
    receiver.destroy();
  });

  it('sends and receives a binary chunk correctly', async () => {
  const { sender, receiver } = await createTestSocketPair();
  const received = [];
  const framer = createFramer((body) => received.push(parseMessage(body)));
  receiver.on('data', framer);
  const chunkData = Buffer.from('hello world this is chunk data');
  const fakeHash  = 'a'.repeat(64);
  const fakeProof = [{ hash: 'b'.repeat(64), position: 'right' }];
  await sendChunk(sender, 7, fakeHash, fakeProof, chunkData);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(received.length, 1);
  assert.equal(received[0].type, TYPE.CHUNK);
  assert.equal(received[0].chunkIndex, 7);
  assert.equal(received[0].chunkHash, fakeHash);
  assert.deepEqual(received[0].proof, fakeProof);
  assert.deepEqual(received[0].chunkData, chunkData);
  sender.destroy();
  receiver.destroy();
});

  it('throws when message exceeds max size', () => {
    const framer = createFramer(() => {});
    const fakeHeader = Buffer.allocUnsafe(4);
    fakeHeader.writeUInt32BE(200 * 1024 * 1024, 0);
    assert.throws(() => framer(fakeHeader), /too large/);
  });
});
```

### packages/engine/test/transfer.test.js

```text
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

process.on('exit', () => {
  console.log('Active handles:', process._getActiveHandles().map(h => h.constructor.name));
});

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
```

### packages/signaling/Dockerfile

```text

```

### packages/signaling/package.json

```text
{
  "name": "@mesh/signaling",
  "version": "1.0.0",
  "description": "WebSocket signaling server",
  "main": "src/server.js",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js"
  },
  "license": "ISC",
  "dependencies": {
    "ws": "^8.21.0"
  }
}
```

### packages/signaling/src/metrics.js

```text
export const metrics = { totalRooms: 0, totalPeers: 0 };
```

### packages/signaling/src/server.js

```text
const PORT = process.env.PORT || 8080;
console.log(`Signaling server starting on port ${PORT}`);
```

### packages/web/.gitignore

```text
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
```

### packages/web/eslint.config.js

```text
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
```

### packages/web/index.html

```text
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>web</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### packages/web/package.json

```text
{
  "name": "web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "d3": "^7.9.0",
    "framer-motion": "^12.42.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-dropzone": "^15.0.0",
    "recharts": "^3.9.0",
    "zustand": "^5.0.14"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.2",
    "eslint": "^10.5.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.3",
    "globals": "^17.6.0",
    "vite": "^8.1.0"
  }
}
```

### packages/web/public/favicon.svg

Binary file omitted from markdown snapshot (9522 bytes).

### packages/web/public/icons.svg

Binary file omitted from markdown snapshot (5031 bytes).

### packages/web/README.md

```text
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
```

### packages/web/src/App.css

```text
.counter {
  font-size: 16px;
  padding: 5px 10px;
  border-radius: 5px;
  color: var(--accent);
  background: var(--accent-bg);
  border: 2px solid transparent;
  transition: border-color 0.3s;
  margin-bottom: 24px;

  &:hover {
    border-color: var(--accent-border);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.hero {
  position: relative;

  .base,
  .framework,
  .vite {
    inset-inline: 0;
    margin: 0 auto;
  }

  .base {
    width: 170px;
    position: relative;
    z-index: 0;
  }

  .framework,
  .vite {
    position: absolute;
  }

  .framework {
    z-index: 1;
    top: 34px;
    height: 28px;
    transform: perspective(2000px) rotateZ(300deg) rotateX(44deg) rotateY(39deg)
      scale(1.4);
  }

  .vite {
    z-index: 0;
    top: 107px;
    height: 26px;
    width: auto;
    transform: perspective(2000px) rotateZ(300deg) rotateX(40deg) rotateY(39deg)
      scale(0.8);
  }
}

#center {
  display: flex;
  flex-direction: column;
  gap: 25px;
  place-content: center;
  place-items: center;
  flex-grow: 1;

  @media (max-width: 1024px) {
    padding: 32px 20px 24px;
    gap: 18px;
  }
}

#next-steps {
  display: flex;
  border-top: 1px solid var(--border);
  text-align: left;

  & > div {
    flex: 1 1 0;
    padding: 32px;
    @media (max-width: 1024px) {
      padding: 24px 20px;
    }
  }

  .icon {
    margin-bottom: 16px;
    width: 22px;
    height: 22px;
  }

  @media (max-width: 1024px) {
    flex-direction: column;
    text-align: center;
  }
}

#docs {
  border-right: 1px solid var(--border);

  @media (max-width: 1024px) {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}

#next-steps ul {
  list-style: none;
  padding: 0;
  display: flex;
  gap: 8px;
  margin: 32px 0 0;

  .logo {
    height: 18px;
  }

  a {
    color: var(--text-h);
    font-size: 16px;
    border-radius: 6px;
    background: var(--social-bg);
    display: flex;
    padding: 6px 12px;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    transition: box-shadow 0.3s;

    &:hover {
      box-shadow: var(--shadow);
    }
    .button-icon {
      height: 18px;
      width: 18px;
    }
  }

  @media (max-width: 1024px) {
    margin-top: 20px;
    flex-wrap: wrap;
    justify-content: center;

    li {
      flex: 1 1 calc(50% - 8px);
    }

    a {
      width: 100%;
      justify-content: center;
      box-sizing: border-box;
    }
  }
}

#spacer {
  height: 88px;
  border-top: 1px solid var(--border);
  @media (max-width: 1024px) {
    height: 48px;
  }
}

.ticks {
  position: relative;
  width: 100%;

  &::before,
  &::after {
    content: '';
    position: absolute;
    top: -4.5px;
    border: 5px solid transparent;
  }

  &::before {
    left: 0;
    border-left-color: var(--border);
  }
  &::after {
    right: 0;
    border-right-color: var(--border);
  }
}
```

### packages/web/src/App.jsx

```text
import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>
        <div>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.jsx</code> and save to test <code>HMR</code>
          </p>
        </div>
        <button
          type="button"
          className="counter"
          onClick={() => setCount((count) => count + 1)}
        >
          Count is {count}
        </button>
      </section>

      <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank">
                <img className="button-icon" src={reactLogo} alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Connect with us</h2>
          <p>Join the Vite community</p>
          <ul>
            <li>
              <a href="https://github.com/vitejs/vite" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#github-icon"></use>
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a href="https://chat.vite.dev/" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#discord-icon"></use>
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a href="https://x.com/vite_js" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#x-icon"></use>
                </svg>
                X.com
              </a>
            </li>
            <li>
              <a href="https://bsky.app/profile/vite.dev" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#bluesky-icon"></use>
                </svg>
                Bluesky
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

export default App
```

### packages/web/src/assets/hero.png

Binary file omitted from markdown snapshot (13057 bytes).

### packages/web/src/assets/react.svg

Binary file omitted from markdown snapshot (4126 bytes).

### packages/web/src/assets/vite.svg

Binary file omitted from markdown snapshot (8709 bytes).

### packages/web/src/index.css

```text
:root {
  --text: #6b6375;
  --text-h: #08060d;
  --bg: #fff;
  --border: #e5e4e7;
  --code-bg: #f4f3ec;
  --accent: #aa3bff;
  --accent-bg: rgba(170, 59, 255, 0.1);
  --accent-border: rgba(170, 59, 255, 0.5);
  --social-bg: rgba(244, 243, 236, 0.5);
  --shadow:
    rgba(0, 0, 0, 0.1) 0 10px 15px -3px, rgba(0, 0, 0, 0.05) 0 4px 6px -2px;

  --sans: system-ui, 'Segoe UI', Roboto, sans-serif;
  --heading: system-ui, 'Segoe UI', Roboto, sans-serif;
  --mono: ui-monospace, Consolas, monospace;

  font: 18px/145% var(--sans);
  letter-spacing: 0.18px;
  color-scheme: light dark;
  color: var(--text);
  background: var(--bg);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  @media (max-width: 1024px) {
    font-size: 16px;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --text: #9ca3af;
    --text-h: #f3f4f6;
    --bg: #16171d;
    --border: #2e303a;
    --code-bg: #1f2028;
    --accent: #c084fc;
    --accent-bg: rgba(192, 132, 252, 0.15);
    --accent-border: rgba(192, 132, 252, 0.5);
    --social-bg: rgba(47, 48, 58, 0.5);
    --shadow:
      rgba(0, 0, 0, 0.4) 0 10px 15px -3px, rgba(0, 0, 0, 0.25) 0 4px 6px -2px;
  }

  #social .button-icon {
    filter: invert(1) brightness(2);
  }
}

body {
  margin: 0;
}

#root {
  width: 1126px;
  max-width: 100%;
  margin: 0 auto;
  text-align: center;
  border-inline: 1px solid var(--border);
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

h1,
h2 {
  font-family: var(--heading);
  font-weight: 500;
  color: var(--text-h);
}

h1 {
  font-size: 56px;
  letter-spacing: -1.68px;
  margin: 32px 0;
  @media (max-width: 1024px) {
    font-size: 36px;
    margin: 20px 0;
  }
}
h2 {
  font-size: 24px;
  line-height: 118%;
  letter-spacing: -0.24px;
  margin: 0 0 8px;
  @media (max-width: 1024px) {
    font-size: 20px;
  }
}
p {
  margin: 0;
}

code,
.counter {
  font-family: var(--mono);
  display: inline-flex;
  border-radius: 4px;
  color: var(--text-h);
}

code {
  font-size: 15px;
  line-height: 135%;
  padding: 4px 8px;
  background: var(--code-bg);
}
```

### packages/web/src/main.jsx

```text
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

### packages/web/vite.config.js

```text
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
```

### received/protocol.js

```text
const HEADER_SIZE = 4;
const MAX_MESSAGE_SIZE = 100 * 1024 * 1024;

export const MSG = {
  FILE_OFFER:        'FILE_OFFER',
  FILE_ACCEPT:       'FILE_ACCEPT',
  FILE_REJECT:       'FILE_REJECT',
  CHUNK_REQUEST:     'CHUNK_REQUEST',
  CHUNK_DATA:        'CHUNK_DATA',
  CHUNK_NACK:        'CHUNK_NACK',
  TRANSFER_COMPLETE: 'TRANSFER_COMPLETE',
  KEEPALIVE:         'KEEPALIVE',
  ERROR:             'ERROR',
};

export const TYPE = {
  JSON:  0x00,
  CHUNK: 0x01,
};

export function sendMessage(socket, data) {
  const isBuffer = Buffer.isBuffer(data);
  const body = isBuffer ? data : Buffer.from(JSON.stringify(data), 'utf8');
  const header = Buffer.allocUnsafe(HEADER_SIZE);
  header.writeUInt32BE(body.length, 0);
  const packet = Buffer.concat([header, body]);
  const ok = socket.write(packet);
  if (!ok) {
    return new Promise(resolve => {
      socket.once('drain', resolve);
    });
  }
  return Promise.resolve();
}

export function sendJSON(socket, obj) {
  const typeFlag = Buffer.from([TYPE.JSON]);
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return sendMessage(socket, Buffer.concat([typeFlag, body]));
}

export function sendChunk(socket, chunkIndex, chunkHash, proof, chunkBuffer) {
  const typeFlag  = Buffer.from([TYPE.CHUNK]);
  const indexBuf  = Buffer.allocUnsafe(4);
  indexBuf.writeUInt32BE(chunkIndex, 0);
  const hashBuf   = Buffer.from(chunkHash, 'hex');
  const proofJSON = Buffer.from(JSON.stringify(proof), 'utf8');
  const proofLen  = Buffer.allocUnsafe(4);
  proofLen.writeUInt32BE(proofJSON.length, 0);
  const body = Buffer.concat([typeFlag, indexBuf, hashBuf, proofLen, proofJSON, chunkBuffer]);
  return sendMessage(socket, body);
}

export function createFramer(onMessage) {
  let accumulator = Buffer.alloc(0);
  return function (incoming) {
    accumulator = Buffer.concat([accumulator, incoming]);
    while (true) {
      if (accumulator.length < HEADER_SIZE) break;
      const bodyLength = accumulator.readUInt32BE(0);
      if (bodyLength > MAX_MESSAGE_SIZE) {
        throw new Error(`Message too large: ${bodyLength} bytes`);
      }
      if (accumulator.length < HEADER_SIZE + bodyLength) break;
      const body = Buffer.from(accumulator.slice(HEADER_SIZE, HEADER_SIZE + bodyLength));
      accumulator = Buffer.from(accumulator.slice(HEADER_SIZE + bodyLength));
      onMessage(body);
    }
  };
}

export function parseMessage(body) {
  const type = body.readUInt8(0);
  if (type === TYPE.JSON) {
    return { type: TYPE.JSON, data: JSON.parse(body.slice(1).toString('utf8')) };
  }
  if (type === TYPE.CHUNK) {
    const chunkIndex = body.readUInt32BE(1);
    const chunkHash  = body.slice(5, 37).toString('hex');
    const proofLen   = body.readUInt32BE(37);
    const proof      = JSON.parse(body.slice(41, 41 + proofLen).toString('utf8'));
    const chunkData  = Buffer.from(body.slice(41 + proofLen));
    return { type: TYPE.CHUNK, chunkIndex, chunkHash, proof, chunkData };
  }
  throw new Error(`Unknown message type: ${type}`);
}
```

### received/testfile.bin

Binary or non-UTF-8 file omitted from markdown snapshot (52428800 bytes).

### received/transfer.test.js

```text
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
```

### testfile.bin

Binary or non-UTF-8 file omitted from markdown snapshot (52428800 bytes).

