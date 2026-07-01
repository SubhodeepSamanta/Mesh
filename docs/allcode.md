# All Code Snapshot

Generated from: Mesh Root Project

Excluded: node_modules, .git, package-lock.json, .env

## File List

- .env.example
- .gitignore
- docker-compose.yml
- docs/phase2.md
- docs/phases.md
- docs/sig-test-out.txt
- docs/test-out.txt
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
- packages/engine/test/dht.test.js
- packages/engine/test/dhtfiles.test.js
- packages/engine/test/dhtnode.test.js
- packages/engine/test/integration.test.js
- packages/engine/test/peer.test.js
- packages/engine/test/protocol.test.js
- packages/engine/test/swarm.test.js
- packages/engine/test/transfer.test.js
- packages/signaling/Dockerfile
- packages/signaling/package.json
- packages/signaling/src/metrics.js
- packages/signaling/src/server.js
- packages/signaling/test/server.test.js
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
- packages/web/src/webrtc-test.html
- packages/web/src/webrtc/signalingClient.js
- packages/web/src/webrtc/webrtcPeer.js
- packages/web/test/signalingClient.test.js
- packages/web/test/webrtc.test.js
- packages/web/vite.config.js
- received/protocol.js
- received/testfile.bin
- received/transfer.test.js
- sig-test-out.txt
- test-out.txt
- testfile.bin
- web-test-out.txt

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
test-out.txt
dht-out.txt
dhtfiles-out.txt
*-out.txt
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

### docs/phase2.md

```text
## Phase 2 — DHT, Encryption, Multi-Peer

The goal is making the transfer genuinely decentralised and secure. Peers find each other without any central server. All data is encrypted end to end.

Ends when: three processes find each other via DHT and transfer a file encrypted end to end.

---

### Part 1 — Kademlia Routing Table (DONE)

Built the foundational data structure for the DHT. No networking yet — pure math and data structure, fully testable in isolation.

What we built:
- 160-bit random node ID generation
- XOR distance calculation between two node IDs
- Bucket index calculation based on leading differing bit
- RoutingTable class with k-buckets (max 20 peers per bucket)
- addPeer, removePeer, getClosest functions

What we tested:
- Node ID generation and uniqueness
- XOR distance properties: zero for self, symmetric, nonzero for different IDs
- Distance comparison ordering by most significant byte
- Bucket index correctness for various bit-difference scenarios
- Routing table peer management including bucket overflow rejection
- getClosest sorting correctness

Files touched: dht.js, test/dht.test.js

Checkpoint: 2-1

---

### Part 2 — DHT Networking (NEXT)

UDP transport, FIND_NODE protocol, iterative lookup algorithm, bootstrap process.

What we will build:
- UDP socket setup with message send/receive
- DHT_PING, DHT_FIND_NODE, DHT_FOUND_NODE message types
- Iterative lookup algorithm with alpha=3 concurrency
- Bootstrap process to join an existing DHT network
- Timeout and retry handling for unresponsive peers

### Part 3 — Announce and GetPeers

Storing and retrieving which peers have which files via the DHT.

### Part 4 — Swarm Manager

Coordinating parallel chunk downloads from multiple peers found via DHT.

---

## Phase 3 — Signaling Server and WebRTC


### Part 2 — DHT Networking (DONE)

UDP transport layer for the DHT. Nodes can ping each other, find other nodes via FIND_NODE queries, and the iterative lookup algorithm converges on any target node ID across multi-hop chains.

What we built:
- UDP socket setup with dgram, message send/receive
- DHT_PING / DHT_PONG message types
- DHT_FIND_NODE / DHT_FOUND_NODE message types
- Iterative lookup algorithm with ALPHA=3 concurrency
- Bootstrap process to join an existing DHT network
- Timeout handling for unresponsive peers
- Malformed packet resilience

What we tested:
- Ping/pong round trip and routing table population
- Ping timeout for unreachable peers
- FindNode returns closest known peers
- Bootstrap joins network and populates routing table
- Iterative lookup converges across 3-node and 5-node chains
- Malformed UDP packets do not crash the node

Files touched: dht.js, test/dhtnode.test.js

Checkpoint: 2-2

---


### Part 3 — Announce and GetPeers (NEXT)

### Part 3 — Announce and GetPeers (DONE)

The layer that lets peers say "I have this file" and other peers discover "who has this file" using the file's hash as a DHT key.

What we built:
- DHT_ANNOUNCE / DHT_ANNOUNCE_ACK message types
- DHT_GET_PEERS / DHT_PEERS message types
- File store per node mapping fileHash to a list of seeding peers
- fileHashToDhtKey helper truncating SHA-256 (32 bytes) to DHT key size (20 bytes)
- announceFile method using iterativeFindNode to reach the K closest nodes to the file hash
- getPeersForFile method merging local and remote results, deduplicated

What we tested:
- Single node announces and finds its own file
- Peer announces, different peer finds it through a relay node
- Multiple seeders for the same file all discoverable
- GetPeers for an unannounced file returns empty array
- Re-announcing does not create duplicate entries
- Announce and discovery work correctly across a five node mesh

Files touched: dht.js, test/dhtfiles.test.js

Checkpoint: 2-3

---

### Part 4 — Swarm Manager (NEXT)

### Part 4 — Swarm Manager (DONE)

The coordination layer that takes peers discovered via DHT and downloads different chunks from different peers in parallel, with verification and automatic recovery on failure.

What we built:
- SwarmManager class with chunk state tracking (pending, requested, verified)
- Pipeline-based chunk assignment per peer, max 16 in flight
- Hash and Merkle proof verification on every received chunk
- Automatic re-queue of chunks when a peer fails or disconnects
- Event-driven interface: chunkVerified, chunkFailed, complete, peerRemoved
- Progress and per-peer stats reporting

What we tested:
- Single peer completes a full transfer
- Assembled output matches original byte-for-byte
- Chunks distributed across multiple peers simultaneously
- Corrupted chunks rejected and re-requested
- Peer removal mid-transfer re-queues its in-flight chunks to others
- Pipeline limit respected per peer
- Progress and peer stats reporting correctness

Files touched: swarm.js, test/swarm.test.js

Checkpoint: 2-4

---

## Current Status

- [x] Phase 0: Monorepo scaffolded, all packages initialized
- [x] Phase 1: Raw TCP Transfer Engine
- [x] Phase 2: DHT, Encryption, Multi-Peer
- [ ] Phase 3: Signaling Server and WebRTC
- [ ] Phase 4: React Frontend
- [ ] Phase 5: CLI, Polish, Deployment
```

### docs/phases.md

```text
# Mesh — Project Phases

## Overview

Mesh is a decentralised P2P file transfer platform. The project is built in 5 major phases. Each phase has multiple parts. Each part ends with a commit checkpoint. Tests are written alongside each part, not after.

---

## Phase 1 — Raw TCP Transfer Engine

The goal of this phase is two Node.js processes transferring a file correctly over raw TCP. No UI, no DHT, no encryption. Just bytes moving from A to B with integrity verification.

What got built:
- Message framing protocol over TCP streams
- File chunker with Merkle tree integrity (binary concatenation, not string)
- SHA-256 chunk hashing and verification
- Sender and receiver scripts with streaming disk I/O, keepalive, and resume-ready architecture
- Backpressure handling for large files

Tests: chunker correctness, framer correctness, hash verification, large file transfer (100MB at 130+ MB/s confirmed)

Status: COMPLETE

---

## Phase 2 — DHT, Encryption, Multi-Peer

The goal is making the transfer genuinely decentralised and secure. Peers find each other without any central server. All data is encrypted end to end.

Ends when: peers find each other via DHT and transfer a file encrypted end to end. This was verified with a real integration test.

### Part 1 — Kademlia Routing Table
XOR distance, k-buckets, RoutingTable class. Checkpoint 2-1.

### Part 2 — DHT Networking
UDP transport, PING/FIND_NODE, iterative lookup, bootstrap. Checkpoint 2-2.

### Part 3 — Announce and GetPeers
File hash announce/discovery via DHT. Checkpoint 2-3.

### Part 4 — Swarm Manager
Multi-peer parallel chunk coordination with failure tracking (peers marked failed and removed after 5 consecutive failures). Checkpoint 2-4.

### Part 5 — Engine Integration
DHT + Swarm + TCP wired into a single downloadFile() function. Connection failures now reported with full detail (which peer, why it failed) instead of silently swallowed. Checkpoint 2-5.

### Part 6 — Encryption Integration
ECDH key exchange and AES-256-GCM applied to every chunk on the wire via a real handshake (KEY_EXCHANGE message), not just unit tested in isolation. Tampered ciphertext is detected and rejected. Checkpoint 2-6.

See docs/phase2.md for full part-by-part history and detailed testing notes.

Status: COMPLETE — 65/65 tests passing across the whole engine

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
- A WebRTC variant of PeerConnection alongside the existing TCP one — same interface, different transport

Tests: room creation, peer join flow, relay correctness, rate limiting

Ends when: two browser tabs connect directly via WebRTC data channel using a room code

Status: NOT STARTED

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

Status: NOT STARTED

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

Status: NOT STARTED

---

## Testing Strategy

Every phase has tests written in the same part as the code. Not after.

Engine tests use Node's built-in test runner. No Jest, no Vitest for the engine — zero dependencies.

Web tests use Vitest since it is already in the Vite ecosystem.

Test types across phases:
- Unit tests: individual functions like chunker, hasher, framer, XOR distance
- Integration tests: sender to receiver over real TCP, DHT node to node over real UDP
- End to end tests: full file transfer through the complete stack, including DHT discovery and encryption

---

## Checkpoint Structure

Each part inside a phase ends with a git commit. Commit messages follow this format:

checkpoint [phase]-[part]: description

Examples:
- checkpoint 1-1: protocol framer complete with tests
- checkpoint 2-6: ECDH handshake and AES-256-GCM encryption wired into live peer connections
- checkpoint 3-1: signaling server with room system

---

## Current Status

- [x] Phase 0: Monorepo scaffolded, all packages initialized
- [x] Phase 1: Raw TCP Transfer Engine
- [x] Phase 2: DHT, Encryption, Multi-Peer — fully integrated and encrypted, 65/65 tests passing
- [ ] Phase 3: Signaling Server and WebRTC
- [ ] Phase 4: React Frontend
- [ ] Phase 5: CLI, Polish, Deployment
```

### docs/sig-test-out.txt

Binary or non-UTF-8 file omitted from markdown snapshot (1140 bytes).

### docs/test-out.txt

Binary or non-UTF-8 file omitted from markdown snapshot (28974 bytes).

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
    "test": "node --test test/protocol.test.js test/chunker.test.js test/crypto.test.js test/transfer.test.js test/dht.test.js test/dhtnode.test.js test/dhtfiles.test.js test/swarm.test.js test/peer.test.js test/integration.test.js"
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
import { randomBytes } from 'crypto';
import dgram from 'dgram';
import { EventEmitter } from 'events';

export const DHT_K = 20;
export const ID_BYTES = 20;
export const ALPHA = 3;
export const REQUEST_TIMEOUT_MS = 3000;

export function generateNodeId() {
  return randomBytes(ID_BYTES).toString('hex');
}
export function fileHashToDhtKey(sha256Hex) {
  return sha256Hex.slice(0, ID_BYTES * 2);
}
export function xorDistance(idA, idB) {
  const a = Buffer.from(idA, 'hex');
  const b = Buffer.from(idB, 'hex');
  if (a.length !== ID_BYTES || b.length !== ID_BYTES) {
    throw new Error('Node IDs must be 20 bytes');
  }
  const result = Buffer.allocUnsafe(ID_BYTES);
  for (let i = 0; i < ID_BYTES; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

export function compareDistance(distA, distB) {
  for (let i = 0; i < ID_BYTES; i++) {
    if (distA[i] !== distB[i]) return distA[i] - distB[i];
  }
  return 0;
}

export function bucketIndex(myId, peerId) {
  const dist = xorDistance(myId, peerId);
  for (let byteIdx = 0; byteIdx < ID_BYTES; byteIdx++) {
    if (dist[byteIdx] === 0) continue;
    for (let bit = 7; bit >= 0; bit--) {
      if ((dist[byteIdx] >> bit) & 1) {
        return byteIdx * 8 + (7 - bit);
      }
    }
  }
  return ID_BYTES * 8 - 1;
}

export class RoutingTable {
  constructor(myId) {
    this.myId = myId;
    this.buckets = Array.from({ length: ID_BYTES * 8 }, () => []);
  }

  addPeer(peer) {
    if (peer.id === this.myId) return false;
    const idx = bucketIndex(this.myId, peer.id);
    const bucket = this.buckets[idx];
    const existingIdx = bucket.findIndex(p => p.id === peer.id);
    if (existingIdx !== -1) {
      bucket.splice(existingIdx, 1);
      bucket.push({ ...peer, lastSeen: Date.now() });
      return true;
    }
    if (bucket.length < DHT_K) {
      bucket.push({ ...peer, lastSeen: Date.now() });
      return true;
    }
    return false;
  }

  removePeer(peerId) {
    const idx = bucketIndex(this.myId, peerId);
    const bucket = this.buckets[idx];
    const existingIdx = bucket.findIndex(p => p.id === peerId);
    if (existingIdx !== -1) {
      bucket.splice(existingIdx, 1);
      return true;
    }
    return false;
  }

  getBucket(idx) {
    return this.buckets[idx];
  }

  getAllPeers() {
    return this.buckets.flat();
  }

  getClosest(targetId, count = DHT_K) {
    const all = this.getAllPeers();
    return all
      .map(peer => ({ peer, dist: xorDistance(peer.id, targetId) }))
      .sort((a, b) => compareDistance(a.dist, b.dist))
      .slice(0, count)
      .map(x => x.peer);
  }

  size() {
    return this.getAllPeers().length;
  }
}

export const DHT_MSG = {
  PING:         'DHT_PING',
  PONG:         'DHT_PONG',
  FIND_NODE:    'DHT_FIND_NODE',
  FOUND_NODE:   'DHT_FOUND_NODE',
  ANNOUNCE:     'DHT_ANNOUNCE',
  ANNOUNCE_ACK: 'DHT_ANNOUNCE_ACK',
  GET_PEERS:    'DHT_GET_PEERS',
  PEERS:        'DHT_PEERS',
};

export class DHTNode extends EventEmitter {
  constructor(nodeId = generateNodeId()) {
    super();
    this.nodeId = nodeId;
    this.routingTable = new RoutingTable(nodeId);
    this.socket = dgram.createSocket('udp4');
    this.pending = new Map();
    this.port = null;
    this.address = null;
    this.fileStore = new Map();
  }

listen(port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    this.socket.once('error', reject);
    this.socket.bind(port, host, () => {
      const addr = this.socket.address();
      this.port = addr.port;
      this.address = addr.address;
      this.socket.removeListener('error', reject);
      this.socket.on('message', (msg, rinfo) => this._handleMessage(msg, rinfo));
      this.socket.on('error', (e) => this.emit('error', e));
      resolve(addr);
    });
  });
}

  close() {
    return new Promise((resolve) => {
      this.socket.close(resolve);
    });
  }

  _msgId() {
    return randomBytes(4).toString('hex');
  }

  _send(addr, port, obj) {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    return new Promise((resolve, reject) => {
      this.socket.send(buf, port, addr, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  _handleMessage(msgBuf, rinfo) {
    let msg;
    try {
      msg = JSON.parse(msgBuf.toString('utf8'));
    } catch {
      return;
    }

    if (msg.nodeId && msg.nodeId !== this.nodeId) {
      this.routingTable.addPeer({ id: msg.nodeId, addr: rinfo.address, port: rinfo.port });
    }

    if (msg.type === DHT_MSG.PING) {
      this._send(rinfo.address, rinfo.port, {
        type: DHT_MSG.PONG, msgId: msg.msgId, nodeId: this.nodeId,
      });
      return;
    }

    if (msg.type === DHT_MSG.FIND_NODE) {
      const closest = this.routingTable.getClosest(msg.targetId, DHT_K);
      this._send(rinfo.address, rinfo.port, {
        type: DHT_MSG.FOUND_NODE,
        msgId: msg.msgId,
        nodeId: this.nodeId,
        closest: closest.map(p => ({ id: p.id, addr: p.addr, port: p.port })),
      });
      return;
    }

if (msg.type === DHT_MSG.ANNOUNCE) {
  if (typeof msg.fileHash !== 'string' || typeof msg.port !== 'number') return;
  const peers = this.fileStore.get(msg.fileHash) || [];
  const existingIdx = peers.findIndex(p => p.addr === rinfo.address && p.port === msg.port);
  if (existingIdx === -1) {
    peers.push({ addr: rinfo.address, port: msg.port, announcedAt: Date.now() });
  } else {
    peers[existingIdx].announcedAt = Date.now();
  }
  this.fileStore.set(msg.fileHash, peers);
  this._send(rinfo.address, rinfo.port, {
    type: DHT_MSG.ANNOUNCE_ACK, msgId: msg.msgId, nodeId: this.nodeId,
  });
  return;
}

if (msg.type === DHT_MSG.GET_PEERS) {
  if (typeof msg.fileHash !== 'string') return;
  const peers = this.fileStore.get(msg.fileHash) || [];
  this._send(rinfo.address, rinfo.port, {
    type: DHT_MSG.PEERS, msgId: msg.msgId, nodeId: this.nodeId,
    fileHash: msg.fileHash,
    peers: peers.map(p => ({ addr: p.addr, port: p.port })),
  });
  return;
}

    if (msg.type === DHT_MSG.PONG || msg.type === DHT_MSG.FOUND_NODE ||
        msg.type === DHT_MSG.ANNOUNCE_ACK || msg.type === DHT_MSG.PEERS) {
      const handler = this.pending.get(msg.msgId);
      if (handler) {
        clearTimeout(handler.timeout);
        this.pending.delete(msg.msgId);
        handler.resolve(msg);
      }
      return;
    }
  }

  ping(addr, port) {
    return new Promise((resolve, reject) => {
      const msgId = this._msgId();
      const timeout = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error('PING timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(msgId, { resolve, reject, timeout });
      this._send(addr, port, { type: DHT_MSG.PING, msgId, nodeId: this.nodeId }).catch(reject);
    });
  }

  findNode(addr, port, targetId) {
    return new Promise((resolve, reject) => {
      const msgId = this._msgId();
      const timeout = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error('FIND_NODE timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(msgId, {
        resolve: (msg) => resolve(msg.closest || []),
        reject,
        timeout,
      });
      this._send(addr, port, {
        type: DHT_MSG.FIND_NODE, msgId, nodeId: this.nodeId, targetId,
      }).catch(reject);
    });
  }

  async bootstrap(addr, port) {
    const closest = await this.findNode(addr, port, this.nodeId);
    closest.forEach(peer => this.routingTable.addPeer(peer));
    return closest;
  }

  async iterativeFindNode(targetId) {
    const queried = new Set();
    let closest = this.routingTable.getClosest(targetId, DHT_K);

    if (closest.length === 0) return [];

    while (true) {
      const toQuery = closest
        .filter(peer => peer.id && !queried.has(peer.id))
        .slice(0, ALPHA);

      if (toQuery.length === 0) break;

      const results = await Promise.allSettled(
        toQuery.map(async (peer) => {
          queried.add(peer.id);
          try {
            const found = await this.findNode(peer.addr, peer.port, targetId);
            found.forEach(p => this.routingTable.addPeer(p));
            return found;
          } catch {
            this.routingTable.removePeer(peer.id);
            return [];
          }
        })
      );

      const newPeers = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

      const candidateMap = new Map();
      [...closest, ...newPeers].forEach(p => {
        if (p.id) candidateMap.set(p.id, p);
      });

      closest = [...candidateMap.values()]
        .map(peer => ({ peer, dist: xorDistance(peer.id, targetId) }))
        .sort((a, b) => compareDistance(a.dist, b.dist))
        .slice(0, DHT_K)
        .map(x => x.peer);

      const allQueried = closest.every(p => queried.has(p.id));
      if (allQueried) break;
    }

    return closest;
  }

  _announceToOne(addr, port, fileHash, myPort) {
    return new Promise((resolve, reject) => {
      const msgId = this._msgId();
      const timeout = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error('ANNOUNCE timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(msgId, { resolve, reject, timeout });
      this._send(addr, port, {
        type: DHT_MSG.ANNOUNCE, msgId, nodeId: this.nodeId, fileHash, port: myPort,
      }).catch(reject);
    });
  }

  _getPeersFromOne(addr, port, fileHash) {
    return new Promise((resolve, reject) => {
      const msgId = this._msgId();
      const timeout = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error('GET_PEERS timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(msgId, {
        resolve: (msg) => resolve(msg.peers || []),
        reject,
        timeout,
      });
      this._send(addr, port, {
        type: DHT_MSG.GET_PEERS, msgId, nodeId: this.nodeId, fileHash,
      }).catch(reject);
    });
  }

async announceFile(fileHash, myPort) {
  const dhtKey = fileHashToDhtKey(fileHash);
  const closest = await this.iterativeFindNode(dhtKey);

  if (closest.length === 0) {
    const peers = this.fileStore.get(fileHash) || [];
    const exists = peers.some(p => p.addr === this.address && p.port === myPort);
    if (!exists) {
      peers.push({ addr: this.address, port: myPort, announcedAt: Date.now() });
    }
    this.fileStore.set(fileHash, peers);
    return [];
  }

  const results = await Promise.allSettled(
    closest.map(peer => this._announceToOne(peer.addr, peer.port, fileHash, myPort))
  );

  return closest.filter((_, i) => results[i].status === 'fulfilled');
}

async getPeersForFile(fileHash) {
  const dhtKey = fileHashToDhtKey(fileHash);
  const closest = await this.iterativeFindNode(dhtKey);

  const localPeers = this.fileStore.get(fileHash) || [];
  const seen = new Set();
  const merged = [];

  for (const peer of localPeers) {
    const key = `${peer.addr}:${peer.port}`;
    if (!seen.has(key)) { seen.add(key); merged.push({ addr: peer.addr, port: peer.port }); }
  }

  const allLists = await Promise.allSettled(
    closest.map(peer => this._getPeersFromOne(peer.addr, peer.port, fileHash))
  );

  for (const result of allLists) {
    if (result.status !== 'fulfilled') continue;
    for (const peer of result.value) {
      const key = `${peer.addr}:${peer.port}`;
      if (!seen.has(key)) { seen.add(key); merged.push(peer); }
    }
  }

  return merged;
}
}
```

### packages/engine/src/index.js

```text
export * from './protocol.js';
export * from './chunker.js';
export * from './crypto.js';
export * from './dht.js';
export * from './swarm.js';
export * from './peer.js';
export * from './transfer.js';
```

### packages/engine/src/peer.js

```text
import net from 'net';
import { sendJSON, createFramer, parseMessage, MSG, TYPE } from './protocol.js';
import { generateKeyPair, exportPublicKey, deriveSharedKey, encrypt, decrypt } from './crypto.js';

export const PEER_TIMEOUT_MS = 30000;
export const HANDSHAKE_TIMEOUT_MS = 5000;

export class PeerConnection {
  constructor(addr, port) {
    this.addr = addr;
    this.port = port;
    this.socket = null;
    this.metadata = null;
    this.pendingRequests = new Map();
    this.keyPair = generateKeyPair();
    this.sharedKey = null;
    this._handshakeResolve = null;
    this._handshakeReject = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.addr, port: this.port });
      this.socket.setNoDelay(true);
      this.socket.setMaxListeners(0);

      const framer = createFramer((body) => this._handleMessage(body));

      this.socket.once('connect', async () => {
        try {
          await this._performHandshake();
          resolve(this);
        } catch (e) {
          reject(e);
        }
      });

      this.socket.once('error', reject);
      this.socket.on('data', framer);

      this.socket.on('close', () => {
        for (const { reject: rej } of this.pendingRequests.values()) {
          rej(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
      });
    });
  }

  _performHandshake() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Key exchange handshake timeout'));
      }, HANDSHAKE_TIMEOUT_MS);

      this._handshakeResolve = () => { clearTimeout(timeout); resolve(); };
      this._handshakeReject = (e) => { clearTimeout(timeout); reject(e); };

      const myPublicKey = exportPublicKey(this.keyPair).toString('base64');
      sendJSON(this.socket, { type: MSG.KEY_EXCHANGE, publicKey: myPublicKey }).catch(reject);
    });
  }

  _handleMessage(body) {
    const msg = parseMessage(body);

    if (msg.type === TYPE.JSON && msg.data.type === MSG.KEY_EXCHANGE) {
      try {
        const theirPublicKeyDER = Buffer.from(msg.data.publicKey, 'base64');
        this.sharedKey = deriveSharedKey(this.keyPair.privateKey, theirPublicKeyDER);
        if (this._handshakeResolve) this._handshakeResolve();
      } catch (e) {
        if (this._handshakeReject) this._handshakeReject(e);
      }
      return;
    }

    if (msg.type === TYPE.JSON && msg.data.type === MSG.FILE_OFFER) {
      this.metadata = msg.data;
      return;
    }

    if (msg.type === TYPE.CHUNK) {
      const handler = this.pendingRequests.get(msg.chunkIndex);
      if (handler) {
        clearTimeout(handler.timeout);
        this.pendingRequests.delete(msg.chunkIndex);

        if (this.sharedKey) {
          try {
            const decrypted = decrypt(msg.chunkData, this.sharedKey);
            handler.resolve({ ...msg, chunkData: decrypted });
          } catch (e) {
            handler.reject(new Error('Chunk decryption failed: ' + e.message));
          }
        } else {
          handler.resolve(msg);
        }
      }
      return;
    }
  }

  requestChunk(index) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(index);
        reject(new Error(`Chunk ${index} request timeout`));
      }, PEER_TIMEOUT_MS);

      this.pendingRequests.set(index, { resolve, reject, timeout });
      sendJSON(this.socket, { type: MSG.CHUNK_REQUEST, index }).catch(reject);
    });
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
  }
}
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
  KEY_EXCHANGE:      'KEY_EXCHANGE',
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
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { verifyChunk } from './crypto.js';
import { assembleChunks } from './chunker.js';

export const PIPELINE_SIZE = 16;
export const MAX_CONSECUTIVE_FAILURES = 5;

const CHUNK_STATE = {
  PENDING:   'pending',
  REQUESTED: 'requested',
  VERIFIED:  'verified',
};

export class SwarmManager extends EventEmitter {
  constructor(totalChunks, merkleRoot) {
    super();
    this.totalChunks = totalChunks;
    this.merkleRoot  = merkleRoot;
    this.chunkState  = new Array(totalChunks).fill(CHUNK_STATE.PENDING);
    this.chunkPeer   = new Array(totalChunks).fill(null);
    this.received    = new Map();
    this.peers       = new Map();
    this.done        = false;
  }

  addPeer(peerId, requestChunkFn) {
    this.peers.set(peerId, {
      id: peerId,
      requestChunk: requestChunkFn,
      pending: new Set(),
      failed: false,
      consecutiveFailures: 0,
      chunksServed: 0,
    });
    this._fillPipeline(peerId);
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    for (const chunkIdx of peer.pending) {
      if (this.chunkState[chunkIdx] === CHUNK_STATE.REQUESTED) {
        this.chunkState[chunkIdx] = CHUNK_STATE.PENDING;
        this.chunkPeer[chunkIdx] = null;
      }
    }

    this.peers.delete(peerId);
    this.emit('peerRemoved', peerId);

    for (const id of this.peers.keys()) {
      this._fillPipeline(id);
    }
  }

  _markPeerFailed(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed) return;
    peer.failed = true;
    this.emit('peerFailed', { peerId, reason: 'too_many_consecutive_failures' });
    this.removePeer(peerId);
  }

  _fillPipeline(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed || this.done) return;

    for (let i = 0; i < this.totalChunks; i++) {
      if (peer.pending.size >= PIPELINE_SIZE) break;
      if (this.chunkState[i] !== CHUNK_STATE.PENDING) continue;

      this.chunkState[i] = CHUNK_STATE.REQUESTED;
      this.chunkPeer[i]  = peerId;
      peer.pending.add(i);

      peer.requestChunk(i).catch(() => {
        this._handleChunkFailure(peerId, i);
      });
    }
  }

  _handleChunkFailure(peerId, chunkIndex) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pending.delete(chunkIndex);
      peer.consecutiveFailures++;
    }

    if (this.chunkState[chunkIndex] === CHUNK_STATE.REQUESTED) {
      this.chunkState[chunkIndex] = CHUNK_STATE.PENDING;
      this.chunkPeer[chunkIndex] = null;
    }

    if (peer && peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this._markPeerFailed(peerId);
      return;
    }

    if (peer) this._fillPipeline(peerId);
  }

  onChunkReceived(peerId, chunkIndex, chunkData, expectedHash, proof) {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    peer.pending.delete(chunkIndex);

    if (this.chunkState[chunkIndex] === CHUNK_STATE.VERIFIED) {
      this._fillPipeline(peerId);
      return true;
    }

    const actualHash = createHash('sha256').update(chunkData).digest('hex');
    if (actualHash !== expectedHash) {
      peer.consecutiveFailures++;
      this.emit('chunkFailed', { peerId, chunkIndex, reason: 'hash_mismatch' });
      this.chunkState[chunkIndex] = CHUNK_STATE.PENDING;
      this.chunkPeer[chunkIndex] = null;

      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }

    if (proof && !verifyChunk(chunkData, proof, this.merkleRoot)) {
      peer.consecutiveFailures++;
      this.emit('chunkFailed', { peerId, chunkIndex, reason: 'proof_invalid' });
      this.chunkState[chunkIndex] = CHUNK_STATE.PENDING;
      this.chunkPeer[chunkIndex] = null;

      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }

    peer.consecutiveFailures = 0;
    this.chunkState[chunkIndex] = CHUNK_STATE.VERIFIED;
    this.received.set(chunkIndex, chunkData);
    peer.chunksServed++;

    this.emit('chunkVerified', { peerId, chunkIndex, total: this.totalChunks, verified: this.received.size });

    if (this.received.size === this.totalChunks) {
      this.done = true;
      this.emit('complete');
    } else {
      this._fillPipeline(peerId);
    }

    return true;
  }

  getProgress() {
    return {
      verified: this.received.size,
      total: this.totalChunks,
      percent: (this.received.size / this.totalChunks) * 100,
    };
  }

  getPeerStats() {
    return [...this.peers.values()].map(p => ({
      id: p.id,
      pending: p.pending.size,
      chunksServed: p.chunksServed,
      failed: p.failed,
      consecutiveFailures: p.consecutiveFailures,
    }));
  }

  isComplete() {
    return this.done;
  }

  assemble() {
    if (!this.done) throw new Error('Transfer not complete');
    return assembleChunks(this.received, this.totalChunks);
  }
}
```

### packages/engine/src/transfer.js

```text
import { DHTNode, fileHashToDhtKey } from './dht.js';
import { SwarmManager } from './swarm.js';
import { PeerConnection } from './peer.js';

export const TRANSFER_VERSION = '1.0.0';

export async function downloadFile(fileHash, totalChunks, merkleRoot, dhtNode) {
  const peers = await dhtNode.getPeersForFile(fileHash);

  if (peers.length === 0) {
    throw new Error('No peers found for this file');
  }

  const swarm = new SwarmManager(totalChunks, merkleRoot);
  const connections = new Map();
  const connectionErrors = [];

  for (const peerInfo of peers) {
    const peerId = `${peerInfo.addr}:${peerInfo.port}`;
    try {
      const conn = new PeerConnection(peerInfo.addr, peerInfo.port);
      await conn.connect();
      connections.set(peerId, conn);

      swarm.addPeer(peerId, async (chunkIndex) => {
        const chunkMsg = await conn.requestChunk(chunkIndex);
        swarm.onChunkReceived(peerId, chunkIndex, chunkMsg.chunkData, chunkMsg.chunkHash, chunkMsg.proof);
      });
    } catch (e) {
      connectionErrors.push({ peerId, reason: e.message });
    }
  }

  if (connections.size === 0) {
    const detail = connectionErrors.map(e => `${e.peerId}: ${e.reason}`).join('; ');
    throw new Error(`Could not connect to any peer for this file. Tried ${peers.length} peer(s). ${detail}`);
  }

  if (connectionErrors.length > 0) {
    swarm.emit('connectionWarnings', connectionErrors);
  }

  await new Promise((resolve, reject) => {
    swarm.on('complete', resolve);
    swarm.on('peerFailed', () => {
      if (swarm.peers.size === 0 && !swarm.isComplete()) {
        reject(new Error('All peers failed'));
      }
    });
  });

  for (const conn of connections.values()) conn.close();

  return swarm.assemble();
}

export async function startDownloadSession(fileHash, totalChunks, merkleRoot, bootstrapAddr, bootstrapPort) {
  const dhtNode = new DHTNode();
  await dhtNode.listen();

  if (bootstrapAddr && bootstrapPort) {
    await dhtNode.bootstrap(bootstrapAddr, bootstrapPort);
  }

  try {
    const fileBuffer = await downloadFile(fileHash, totalChunks, merkleRoot, dhtNode);
    return fileBuffer;
  } finally {
    await dhtNode.close();
  }
}
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

### packages/engine/test/dht.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateNodeId,
  xorDistance,
  compareDistance,
  bucketIndex,
  RoutingTable,
  ID_BYTES,
  DHT_K,
} from '../src/dht.js';

describe('dht node id', () => {
  it('generates a 20 byte hex node id', () => {
    const id = generateNodeId();
    assert.equal(id.length, ID_BYTES * 2);
    assert.match(id, /^[0-9a-f]+$/);
  });

  it('generates different ids each time', () => {
    const id1 = generateNodeId();
    const id2 = generateNodeId();
    assert.notEqual(id1, id2);
  });
});

describe('xor distance', () => {
  it('distance from a node to itself is zero', () => {
    const id = generateNodeId();
    const dist = xorDistance(id, id);
    assert.ok(dist.every(byte => byte === 0));
  });

  it('distance is symmetric', () => {
    const idA = generateNodeId();
    const idB = generateNodeId();
    const distAB = xorDistance(idA, idB);
    const distBA = xorDistance(idB, idA);
    assert.deepEqual(distAB, distBA);
  });

  it('different ids produce nonzero distance', () => {
    const idA = generateNodeId();
    const idB = generateNodeId();
    const dist = xorDistance(idA, idB);
    assert.ok(dist.some(byte => byte !== 0));
  });

  it('throws on malformed node id length', () => {
    assert.throws(() => xorDistance('abc', generateNodeId()));
  });
});

describe('compare distance', () => {
  it('returns 0 for equal distances', () => {
    const id = generateNodeId();
    const dist = xorDistance(id, id);
    assert.equal(compareDistance(dist, dist), 0);
  });

  it('correctly orders by first differing byte', () => {
    const distA = Buffer.from('00'.repeat(19) + '01', 'hex');
    const distB = Buffer.from('00'.repeat(19) + '02', 'hex');
    assert.ok(compareDistance(distA, distB) < 0);
    assert.ok(compareDistance(distB, distA) > 0);
  });

  it('most significant byte dominates comparison', () => {
    const distA = Buffer.from('01' + 'ff'.repeat(19), 'hex');
    const distB = Buffer.from('02' + '00'.repeat(19), 'hex');
    assert.ok(compareDistance(distA, distB) < 0);
  });
});

describe('bucket index', () => {
  it('identical ids fall in the last bucket', () => {
    const id = generateNodeId();
    assert.equal(bucketIndex(id, id), ID_BYTES * 8 - 1);
  });

  it('ids differing only in the last bit fall in bucket 0', () => {
    const myId = '00'.repeat(ID_BYTES);
    const peerId = '00'.repeat(ID_BYTES - 1) + '01';
    assert.equal(bucketIndex(myId, peerId), 159);
  });

  it('ids differing in the first bit fall in bucket 0', () => {
    const myId = '00'.repeat(ID_BYTES);
    const peerId = '80' + '00'.repeat(ID_BYTES - 1);
    assert.equal(bucketIndex(myId, peerId), 0);
  });
});

describe('routing table', () => {
  it('does not add self', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    const added = table.addPeer({ id: myId, addr: '127.0.0.1', port: 9000 });
    assert.equal(added, false);
    assert.equal(table.size(), 0);
  });

  it('adds a peer successfully', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    const peerId = generateNodeId();
    const added = table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9001 });
    assert.equal(added, true);
    assert.equal(table.size(), 1);
  });

  it('updates lastSeen when adding an existing peer again', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    const peerId = generateNodeId();
    table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9001 });
    const idx = bucketIndex(myId, peerId);
    const firstSeen = table.getBucket(idx)[0].lastSeen;

    table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9001 });
    const secondSeen = table.getBucket(idx)[0].lastSeen;

    assert.ok(secondSeen >= firstSeen);
    assert.equal(table.size(), 1);
  });

it('rejects new peer when bucket is full', () => {
  const myId = '00'.repeat(ID_BYTES);
  const table = new RoutingTable(myId);

  for (let i = 0; i < DHT_K; i++) {
    const peerId = '80' + i.toString(16).padStart(2, '0') + '00'.repeat(ID_BYTES - 2);
    table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9000 + i });
  }
  assert.equal(table.getBucket(0).length, DHT_K);

  const overflowId = '80ff' + '00'.repeat(ID_BYTES - 2);
  const added = table.addPeer({ id: overflowId, addr: '127.0.0.1', port: 9999 });
  assert.equal(added, false);
  assert.equal(table.getBucket(0).length, DHT_K);
});

  it('removes a peer', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    const peerId = generateNodeId();
    table.addPeer({ id: peerId, addr: '127.0.0.1', port: 9001 });
    assert.equal(table.size(), 1);
    const removed = table.removePeer(peerId);
    assert.equal(removed, true);
    assert.equal(table.size(), 0);
  });

  it('getClosest returns peers sorted by XOR distance to target', () => {
    const myId = '00'.repeat(ID_BYTES);
    const table = new RoutingTable(myId);

    const peerNear = '00'.repeat(ID_BYTES - 1) + '01';
    const peerFar  = 'ff'.repeat(ID_BYTES);
    const peerMid  = '0f'.repeat(ID_BYTES);

    table.addPeer({ id: peerFar,  addr: '1.1.1.1', port: 1 });
    table.addPeer({ id: peerNear, addr: '1.1.1.2', port: 2 });
    table.addPeer({ id: peerMid,  addr: '1.1.1.3', port: 3 });

    const target = '00'.repeat(ID_BYTES);
    const closest = table.getClosest(target, 3);

    assert.equal(closest[0].id, peerNear);
    assert.equal(closest[2].id, peerFar);
  });

  it('getClosest respects count limit', () => {
    const myId = generateNodeId();
    const table = new RoutingTable(myId);
    for (let i = 0; i < 10; i++) {
      table.addPeer({ id: generateNodeId(), addr: '127.0.0.1', port: 9000 + i });
    }
    const closest = table.getClosest(generateNodeId(), 5);
    assert.equal(closest.length, 5);
  });
});
```

### packages/engine/test/dhtfiles.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DHTNode, generateNodeId } from '../src/dht.js';
import { sha256 } from '../src/crypto.js';

describe('dht announce and get peers', () => {
  it('a single node can announce and find its own file', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    const fileHash = sha256(Buffer.from('test file contents'));
    await nodeA.announceFile(fileHash, 9999);

    const peers = await nodeA.getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 9999));

    await nodeA.close();
  });

  it('peer announces, different peer finds it across the network', async () => {
    const seeder   = new DHTNode();
    const finder   = new DHTNode();
    const relay    = new DHTNode();
    await seeder.listen();
    await finder.listen();
    await relay.listen();

    seeder.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });
    finder.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });

    const fileHash = sha256(Buffer.from('shared file data'));
    await seeder.announceFile(fileHash, 8888);

    const peers = await finder.getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 8888));

    await seeder.close();
    await finder.close();
    await relay.close();
  });

  it('multiple seeders for the same file are all discoverable', async () => {
    const seederA = new DHTNode();
    const seederB = new DHTNode();
    const finder  = new DHTNode();
    const relay   = new DHTNode();
    await seederA.listen();
    await seederB.listen();
    await finder.listen();
    await relay.listen();

    seederA.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });
    seederB.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });
    finder.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });

    const fileHash = sha256(Buffer.from('a file with multiple seeders'));
    await seederA.announceFile(fileHash, 7001);
    await seederB.announceFile(fileHash, 7002);

    const peers = await finder.getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 7001));
    assert.ok(peers.some(p => p.port === 7002));

    await seederA.close();
    await seederB.close();
    await finder.close();
    await relay.close();
  });

  it('getPeers for a file nobody announced returns empty array', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    nodeA.routingTable.addPeer({ id: nodeB.nodeId, addr: '127.0.0.1', port: nodeB.port });

    const fileHash = sha256(Buffer.from('nobody has this file'));
    const peers = await nodeA.getPeersForFile(fileHash);
    assert.deepEqual(peers, []);

    await nodeA.close();
    await nodeB.close();
  });

  it('re-announcing the same file updates timestamp not duplicates entry', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    const fileHash = sha256(Buffer.from('re-announce test'));
    await nodeA.announceFile(fileHash, 6000);
    await nodeA.announceFile(fileHash, 6000);

    const peers = await nodeA.getPeersForFile(fileHash);
    const matching = peers.filter(p => p.port === 6000);
    assert.equal(matching.length, 1);

    await nodeA.close();
  });

  it('announce and getPeers work across a five node mesh', async () => {
    const nodes = [];
    for (let i = 0; i < 5; i++) {
      const n = new DHTNode();
      await n.listen();
      nodes.push(n);
    }

    for (let i = 0; i < nodes.length; i++) {
      const next = nodes[(i + 1) % nodes.length];
      nodes[i].routingTable.addPeer({ id: next.nodeId, addr: '127.0.0.1', port: next.port });
    }

    const fileHash = sha256(Buffer.from('mesh network file'));
    await nodes[0].announceFile(fileHash, 5500);

    const peers = await nodes[3].getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 5500));

    for (const n of nodes) await n.close();
  });
});
```

### packages/engine/test/dhtnode.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DHTNode, generateNodeId } from '../src/dht.js';

describe('dht node networking', () => {
  it('two nodes can ping each other', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    const result = await nodeA.ping('127.0.0.1', nodeB.port);
    assert.equal(result.type, 'DHT_PONG');
    assert.equal(result.nodeId, nodeB.nodeId);

    await nodeA.close();
    await nodeB.close();
  });

  it('ping adds the responding peer to routing table', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    await nodeA.ping('127.0.0.1', nodeB.port);
    await new Promise(r => setTimeout(r, 50));

    const peers = nodeA.routingTable.getAllPeers();
    assert.equal(peers.length, 1);
    assert.equal(peers[0].id, nodeB.nodeId);

    await nodeA.close();
    await nodeB.close();
  });

  it('ping times out for unreachable peer', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    await assert.rejects(
      () => nodeA.ping('127.0.0.1', 1),
      /timeout/
    );

    await nodeA.close();
  });

  it('findNode returns closest known peers from target node', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    const nodeC = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();
    await nodeC.listen();

    nodeB.routingTable.addPeer({ id: nodeC.nodeId, addr: '127.0.0.1', port: nodeC.port });

    const closest = await nodeA.findNode('127.0.0.1', nodeB.port, nodeC.nodeId);
    assert.ok(closest.some(p => p.id === nodeC.nodeId));

    await nodeA.close();
    await nodeB.close();
    await nodeC.close();
  });

  it('bootstrap joins the network and populates routing table', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    nodeB.routingTable.addPeer({ id: nodeA.nodeId, addr: '127.0.0.1', port: nodeA.port });

    await nodeA.bootstrap('127.0.0.1', nodeB.port);
    await new Promise(r => setTimeout(r, 50));

    const peers = nodeA.routingTable.getAllPeers();
    assert.ok(peers.some(p => p.id === nodeB.nodeId));

    await nodeA.close();
    await nodeB.close();
  });

  it('iterativeFindNode converges and finds a target across three nodes', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    const nodeC = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();
    await nodeC.listen();

    nodeA.routingTable.addPeer({ id: nodeB.nodeId, addr: '127.0.0.1', port: nodeB.port });
    nodeB.routingTable.addPeer({ id: nodeC.nodeId, addr: '127.0.0.1', port: nodeC.port });

    const result = await nodeA.iterativeFindNode(nodeC.nodeId);
    assert.ok(result.some(p => p.id === nodeC.nodeId));

    await nodeA.close();
    await nodeB.close();
    await nodeC.close();
  });

it('iterativeFindNode handles a five node chain', { timeout: 15000 }, async () => {
  const nodes = [];
  for (let i = 0; i < 5; i++) {
    const n = new DHTNode();
    await n.listen();
    nodes.push(n);
  }

  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].routingTable.addPeer({
      id: nodes[i + 1].nodeId, addr: '127.0.0.1', port: nodes[i + 1].port,
    });
  }

  const target = nodes[4].nodeId;
  const result = await nodes[0].iterativeFindNode(target);
  assert.ok(result.some(p => p.id === target));

  for (const n of nodes) await n.close();
});

  it('handles malformed UDP packets without crashing', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    const dgram = await import('dgram');
    const sender = dgram.default.createSocket('udp4');
    sender.send(Buffer.from('not valid json {{{'), nodeA.port, '127.0.0.1');

    await new Promise(r => setTimeout(r, 100));

    const stillAlive = await nodeA.ping('127.0.0.1', nodeA.port).catch(() => 'survived');
    assert.ok(stillAlive);

    sender.close();
    await nodeA.close();
  });
});
```

### packages/engine/test/integration.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { randomBytes } from 'crypto';
import { DHTNode } from '../src/dht.js';
import { buildMerkleTree, getMerkleProof, sha256, generateKeyPair, exportPublicKey, deriveSharedKey, encrypt } from '../src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from '../src/protocol.js';
import { downloadFile } from '../src/transfer.js';

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

    const result = await downloadFile(fileHash, numChunks, tree.root, downloaderNode);

    const expected = Buffer.concat(chunks);
    assert.deepEqual(result, expected);

    server.close();
    await seederNode.close();
    await downloaderNode.close();
  });

  it('throws a clear error when no peers have the file', async () => {
    const downloaderNode = new DHTNode();
    await downloaderNode.listen();

    const fakeFileHash = sha256(Buffer.from('nobody has this'));

    await assert.rejects(
      () => downloadFile(fakeFileHash, 5, 'a'.repeat(64), downloaderNode),
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

    await assert.rejects(
      () => downloadFile(fileHash, 5, 'a'.repeat(64), downloaderNode),
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
```

### packages/engine/test/peer.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { randomBytes } from 'crypto';
import { PeerConnection } from '../src/peer.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from '../src/protocol.js';
import { generateKeyPair, exportPublicKey, deriveSharedKey, encrypt, sha256, buildMerkleTree, getMerkleProof } from '../src/crypto.js';

function startEncryptedTestSeeder(chunkData, chunkHash, proof, port) {
  return new Promise((resolveListen) => {
    const keyPair = generateKeyPair();
    let sharedKey = null;

    const server = net.createServer((socket) => {
      socket.setNoDelay(true);
      socket.setMaxListeners(0);

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
          const encrypted = encrypt(chunkData, sharedKey);
          sendChunk(socket, msg.data.index, chunkHash, proof, encrypted);
        }
      });

      socket.on('data', framer);
    });

    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}

describe('peer connection encryption', () => {
  it('performs ECDH handshake and decrypts chunk correctly', async () => {
    const plaintext = randomBytes(1024);
    const chunkHash = sha256(plaintext);
    const tree = buildMerkleTree([chunkHash]);
    const proof = getMerkleProof(tree, 0);

    const port = 19700 + Math.floor(Math.random() * 200);
    const server = await startEncryptedTestSeeder(plaintext, chunkHash, proof, port);

    const conn = new PeerConnection('127.0.0.1', port);
    await conn.connect();

    assert.ok(conn.sharedKey, 'shared key should be established after handshake');

    const result = await conn.requestChunk(0);
    assert.deepEqual(result.chunkData, plaintext);

    conn.close();
    server.close();
  });

  it('rejects tampered ciphertext during decryption', async () => {
    const plaintext = randomBytes(512);
    const chunkHash = sha256(plaintext);
    const tree = buildMerkleTree([chunkHash]);
    const proof = getMerkleProof(tree, 0);

    const port = 19900 + Math.floor(Math.random() * 200);

    const keyPair = generateKeyPair();
    let sharedKey = null;

    const server = net.createServer((socket) => {
      socket.setNoDelay(true);
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
          const encrypted = encrypt(plaintext, sharedKey);
          encrypted[encrypted.length - 1] ^= 0xff;
          sendChunk(socket, msg.data.index, chunkHash, proof, encrypted);
        }
      });
      socket.on('data', framer);
    });

    await new Promise(r => server.listen(port, '127.0.0.1', r));

    const conn = new PeerConnection('127.0.0.1', port);
    await conn.connect();

    await assert.rejects(() => conn.requestChunk(0), /decryption failed/i);

    conn.close();
    server.close();
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

### packages/engine/test/swarm.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'crypto';
import { SwarmManager } from '../src/swarm.js';
import { buildMerkleTree, getMerkleProof, sha256 } from '../src/crypto.js';

function buildTestFile(numChunks, chunkSize = 1024) {
  const chunks = [];
  const hashes = [];
  for (let i = 0; i < numChunks; i++) {
    const chunk = randomBytes(chunkSize);
    chunks.push(chunk);
    hashes.push(sha256(chunk));
  }
  const tree = buildMerkleTree(hashes);
  return { chunks, hashes, tree, merkleRoot: tree.root };
}

describe('swarm manager', () => {
  it('completes a transfer with a single reliable peer', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    let completed = false;
    swarm.on('complete', () => { completed = true; });

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => {
      swarm.on('complete', resolve);
    });

    assert.equal(completed, true);
    assert.equal(swarm.isComplete(), true);
    assert.equal(swarm.getProgress().verified, 10);
  });

  it('assembled buffer matches original chunks in order', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(5);
    const swarm = new SwarmManager(5, merkleRoot);

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const assembled = swarm.assemble();
    const expected = Buffer.concat(chunks);
    assert.deepEqual(assembled, expected);
  });

  it('distributes chunks across multiple peers', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(20);
    const swarm = new SwarmManager(20, merkleRoot);

    const servedBy = { peerA: 0, peerB: 0 };

    const makeHandler = (peerId) => (idx) => {
      setImmediate(() => {
        servedBy[peerId]++;
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived(peerId, idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    };

    swarm.addPeer('peerA', makeHandler('peerA'));
    swarm.addPeer('peerB', makeHandler('peerB'));

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.equal(servedBy.peerA + servedBy.peerB, 20);
    assert.ok(servedBy.peerA > 0);
    assert.ok(servedBy.peerB > 0);
  });

  it('rejects a chunk with wrong hash and re-requests it', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(3);
    const swarm = new SwarmManager(3, merkleRoot);

    let attempt = 0;
    const failedEvents = [];
    swarm.on('chunkFailed', (e) => failedEvents.push(e));

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        attempt++;
        if (idx === 0 && attempt === 1) {
          swarm.onChunkReceived('peerA', idx, Buffer.from('wrong data'), hashes[idx], null);
        } else {
          const proof = getMerkleProof(tree, idx);
          swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
        }
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.ok(failedEvents.some(e => e.reason === 'hash_mismatch'));
    assert.equal(swarm.isComplete(), true);
  });

  it('re-queues chunks when a peer is removed mid-transfer', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    swarm.addPeer('peerA', () => new Promise(() => {}));
    swarm.addPeer('peerB', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerB', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    swarm.removePeer('peerA');

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.equal(swarm.isComplete(), true);
  });

  it('does not exceed pipeline size per peer', async () => {
    const { merkleRoot } = buildTestFile(100);
    const swarm = new SwarmManager(100, merkleRoot);

    let maxPending = 0;
    swarm.addPeer('peerA', () => {
      const peer = swarm.peers.get('peerA');
      maxPending = Math.max(maxPending, peer.pending.size);
      return new Promise(() => {});
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    assert.ok(maxPending <= 16);
  });

  it('getProgress reports correct percentage', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(4);
    const swarm = new SwarmManager(4, merkleRoot);

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const progress = swarm.getProgress();
    assert.equal(progress.percent, 100);
  });

  it('getPeerStats reports chunks served per peer', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(6);
    const swarm = new SwarmManager(6, merkleRoot);

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const stats = swarm.getPeerStats();
    assert.equal(stats.length, 1);
    assert.equal(stats[0].chunksServed, 6);
  });

  it('assemble throws if called before completion', () => {
    const { merkleRoot } = buildTestFile(5);
    const swarm = new SwarmManager(5, merkleRoot);
    assert.throws(() => swarm.assemble(), /not complete/);
  });
  it('marks a peer as failed after too many consecutive chunk failures', async () => {
    const { merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    const failedEvents = [];
    swarm.on('peerFailed', (e) => failedEvents.push(e));

    swarm.addPeer('badPeer', () => Promise.reject(new Error('always fails')));

    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(failedEvents.length, 1);
    assert.equal(failedEvents[0].peerId, 'badPeer');
    assert.equal(swarm.peers.has('badPeer'), false);
  });

  it('recovers and completes when a bad peer is replaced by a good one', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    swarm.addPeer('badPeer', () => Promise.reject(new Error('always fails')));

    swarm.addPeer('goodPeer', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('goodPeer', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.equal(swarm.isComplete(), true);
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
    "start": "node src/server.js",
    "test": "node --test test/server.test.js"
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
import { WebSocketServer } from 'ws';
import { randomBytes, createHash } from 'crypto';

export const MSG_TYPE = {
  CREATE_ROOM:  'CREATE_ROOM',
  ROOM_CREATED: 'ROOM_CREATED',
  JOIN_ROOM:    'JOIN_ROOM',
  ROOM_JOINED:  'ROOM_JOINED',
  PEER_JOINED:  'PEER_JOINED',
  PEER_LEFT:    'PEER_LEFT',
  RELAY:        'RELAY',
  ERROR:        'ERROR',
};

const ROOM_CODE_CHARS  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS      = 30 * 60 * 1000;
const RATE_WINDOW_MS   = 60 * 1000;
const MAX_CREATES_PER_MIN = 10;
const MAX_JOINS_PER_MIN   = 20;

function generateRoomCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[randomBytes(1)[0] % ROOM_CODE_CHARS.length];
  }
  return code;
}

function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

export class SignalingServer {
  constructor(opts = {}) {
    this.rooms        = new Map();
    this.wss          = null;
    this.rateLimits   = new Map();
    this.roomTtlMs    = opts.roomTtlMs    ?? ROOM_TTL_MS;
    this.maxCreates   = opts.maxCreates   ?? MAX_CREATES_PER_MIN;
    this.maxJoins     = opts.maxJoins     ?? MAX_JOINS_PER_MIN;
    this._expiryTimer = null;
  }

  listen(port = 0) {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port }, () => {
        this.wss.on('connection', (ws, req) => {
          ws._ip = req.socket.remoteAddress || '127.0.0.1';
          this._handleConnection(ws);
        });

        this._expiryTimer = setInterval(() => this._expireRooms(), 60 * 1000);

        resolve(this.wss.address());
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      clearInterval(this._expiryTimer);
      if (!this.wss) { resolve(); return; }
      this.wss.close(() => resolve());
    });
  }

  _send(ws, msg) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  _checkRateLimit(ip, action) {
    const key  = `${ip}:${action}`;
    const now  = Date.now();
    const max  = action === 'create' ? this.maxCreates : this.maxJoins;
    const list = this.rateLimits.get(key) || [];

    const recent = list.filter(t => now - t < RATE_WINDOW_MS);
    recent.push(now);
    this.rateLimits.set(key, recent);

    return recent.length <= max;
  }

  _expireRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > this.roomTtlMs) {
        for (const ws of room.peers.values()) {
          this._send(ws, { type: MSG_TYPE.ERROR, message: 'Room expired' });
          ws.close();
        }
        this.rooms.delete(code);
      }
    }
  }

  _handleConnection(ws) {
    ws.roomCode = null;
    ws.peerId   = randomBytes(8).toString('hex');

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        this._send(ws, { type: MSG_TYPE.ERROR, message: 'Invalid JSON' });
        return;
      }
      this._handleMessage(ws, msg);
    });

    ws.on('close', () => this._handleDisconnect(ws));
  }

  _handleMessage(ws, msg) {
    switch (msg.type) {
      case MSG_TYPE.CREATE_ROOM:
        this._createRoom(ws, msg.password);
        break;
      case MSG_TYPE.JOIN_ROOM:
        this._joinRoom(ws, msg.roomCode, msg.password);
        break;
      case MSG_TYPE.RELAY:
        this._relay(ws, msg);
        break;
      default:
        this._send(ws, { type: MSG_TYPE.ERROR, message: `Unknown message type: ${msg.type}` });
    }
  }

  _createRoom(ws, password) {
    if (!this._checkRateLimit(ws._ip, 'create')) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Rate limit exceeded: too many rooms created' });
      return;
    }

    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    this.rooms.set(roomCode, {
      peers:        new Map([[ws.peerId, ws]]),
      passwordHash: password ? hashPassword(password) : null,
      createdAt:    Date.now(),
      lastActivity: Date.now(),
    });

    ws.roomCode = roomCode;
    this._send(ws, { type: MSG_TYPE.ROOM_CREATED, roomCode, peerId: ws.peerId });
  }

  _joinRoom(ws, roomCode, password) {
    if (!this._checkRateLimit(ws._ip, 'join')) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Rate limit exceeded: too many join attempts' });
      return;
    }

    const room = this.rooms.get(roomCode);

    if (!room) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Room not found' });
      return;
    }

    if (room.passwordHash) {
      if (!password || hashPassword(password) !== room.passwordHash) {
        this._send(ws, { type: MSG_TYPE.ERROR, message: 'Incorrect room password' });
        return;
      }
    }

    const existingPeerIds = [...room.peers.keys()];
    room.peers.set(ws.peerId, ws);
    room.lastActivity = Date.now();
    ws.roomCode = roomCode;

    this._send(ws, {
      type: MSG_TYPE.ROOM_JOINED,
      roomCode,
      peerId: ws.peerId,
      existingPeers: existingPeerIds,
    });

    for (const [peerId, peerWs] of room.peers) {
      if (peerId !== ws.peerId) {
        this._send(peerWs, { type: MSG_TYPE.PEER_JOINED, peerId: ws.peerId });
      }
    }
  }

  _relay(ws, msg) {
    if (!ws.roomCode) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Not in a room' });
      return;
    }

    const room = this.rooms.get(ws.roomCode);
    if (!room) return;

    room.lastActivity = Date.now();

    const targetWs = room.peers.get(msg.targetPeerId);
    if (!targetWs) {
      this._send(ws, { type: MSG_TYPE.ERROR, message: 'Target peer not found' });
      return;
    }

    this._send(targetWs, {
      type: MSG_TYPE.RELAY,
      fromPeerId: ws.peerId,
      payload: msg.payload,
    });
  }

  _handleDisconnect(ws) {
    if (!ws.roomCode) return;

    const room = this.rooms.get(ws.roomCode);
    if (!room) return;

    room.peers.delete(ws.peerId);

    for (const peerWs of room.peers.values()) {
      this._send(peerWs, { type: MSG_TYPE.PEER_LEFT, peerId: ws.peerId });
    }

    if (room.peers.size === 0) {
      this.rooms.delete(ws.roomCode);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 8080;
  const server = new SignalingServer();
  server.listen(PORT).then(() => {
    console.log(`Signaling server running on port ${PORT}`);
  });
}
```

### packages/signaling/test/server.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { SignalingServer, MSG_TYPE } from '../src/server.js';

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

describe('signaling server', () => {
  it('creates a room and returns a room code', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    send(ws, { type: MSG_TYPE.CREATE_ROOM });
    const msg = await nextMessage(ws);

    assert.equal(msg.type, MSG_TYPE.ROOM_CREATED);
    assert.match(msg.roomCode, /^[A-Z2-9]{6}$/);
    assert.ok(msg.peerId);

    ws.close();
    await server.close();
  });

  it('a second peer can join an existing room', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });
    const joined = await nextMessage(ws2);

    assert.equal(joined.type, MSG_TYPE.ROOM_JOINED);
    assert.equal(joined.roomCode, created.roomCode);
    assert.deepEqual(joined.existingPeers, [created.peerId]);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('existing peer is notified when a new peer joins', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    const peerJoinedPromise = nextMessage(ws1);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });

    const peerJoinedMsg = await peerJoinedPromise;
    assert.equal(peerJoinedMsg.type, MSG_TYPE.PEER_JOINED);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('joining a nonexistent room returns an error', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    send(ws, { type: MSG_TYPE.JOIN_ROOM, roomCode: 'NOTREAL' });
    const msg = await nextMessage(ws);

    assert.equal(msg.type, MSG_TYPE.ERROR);

    ws.close();
    await server.close();
  });

  it('relays a message from one peer to another by peerId', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });

    const [joined] = await Promise.all([
      nextMessage(ws2),
      nextMessage(ws1),
    ]);

    const relayPromise = nextMessage(ws1);
    send(ws2, {
      type: MSG_TYPE.RELAY,
      targetPeerId: created.peerId,
      payload: { sdp: 'fake-offer-data' },
    });

    const relayed = await relayPromise;
    assert.equal(relayed.type, MSG_TYPE.RELAY);
    assert.equal(relayed.fromPeerId, joined.peerId);
    assert.deepEqual(relayed.payload, { sdp: 'fake-offer-data' });

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('notifies remaining peer when one peer disconnects', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });
    await nextMessage(ws2);
    await nextMessage(ws1);

    const peerLeftPromise = nextMessage(ws1);
    ws2.close();

    const leftMsg = await peerLeftPromise;
    assert.equal(leftMsg.type, MSG_TYPE.PEER_LEFT);

    ws1.close();
    await server.close();
  });

  it('removes the room entirely once all peers disconnect', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    await nextMessage(ws1);

    assert.equal(server.rooms.size, 1);

    ws1.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(server.rooms.size, 0);

    await server.close();
  });

  it('relay to an unknown peerId returns an error', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    send(ws, { type: MSG_TYPE.CREATE_ROOM });
    await nextMessage(ws);

    send(ws, { type: MSG_TYPE.RELAY, targetPeerId: 'nonexistent', payload: {} });
    const msg = await nextMessage(ws);

    assert.equal(msg.type, MSG_TYPE.ERROR);

    ws.close();
    await server.close();
  });

  it('sending malformed JSON does not crash the server', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    ws.send('not valid json {{{');
    const msg = await nextMessage(ws);

    assert.equal(msg.type, MSG_TYPE.ERROR);

    ws.close();
    await server.close();
  });

  it('password protected room rejects wrong password', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM, password: 'secret123' });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode, password: 'wrongpass' });
    const msg = await nextMessage(ws2);

    assert.equal(msg.type, MSG_TYPE.ERROR);
    assert.match(msg.message, /password/i);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('password protected room accepts correct password', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM, password: 'secret123' });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode, password: 'secret123' });
    const joined = await nextMessage(ws2);

    assert.equal(joined.type, MSG_TYPE.ROOM_JOINED);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('joining without password when room has one returns error', async () => {
    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM, password: 'secret' });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });
    const msg = await nextMessage(ws2);

    assert.equal(msg.type, MSG_TYPE.ERROR);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('rate limits room creation per IP', async () => {
    const server = new SignalingServer({ maxCreates: 3 });
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    let lastMsg;

    for (let i = 0; i < 4; i++) {
      send(ws, { type: MSG_TYPE.CREATE_ROOM });
      lastMsg = await nextMessage(ws);
    }

    assert.equal(lastMsg.type, MSG_TYPE.ERROR);
    assert.match(lastMsg.message, /rate limit/i);

    ws.close();
    await server.close();
  });

  it('rate limits join attempts per IP', async () => {
    const server = new SignalingServer({ maxJoins: 2 });
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    const created = await nextMessage(ws1);

    const ws2 = await connect(addr.port);
    let lastMsg;

    for (let i = 0; i < 3; i++) {
      send(ws2, { type: MSG_TYPE.JOIN_ROOM, roomCode: created.roomCode });
      lastMsg = await nextMessage(ws2);
    }

    assert.equal(lastMsg.type, MSG_TYPE.ERROR);
    assert.match(lastMsg.message, /rate limit/i);

    ws1.close();
    ws2.close();
    await server.close();
  });

  it('expired rooms are cleaned up automatically', async () => {
    const server = new SignalingServer({ roomTtlMs: 100 });
    const addr = await server.listen(0);

    const ws = await connect(addr.port);
    send(ws, { type: MSG_TYPE.CREATE_ROOM });
    await nextMessage(ws);

    assert.equal(server.rooms.size, 1);

    server._expireRooms();
    await new Promise(r => setTimeout(r, 150));
    server._expireRooms();

    assert.equal(server.rooms.size, 0);

    ws.close();
    await server.close();
  });
});
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
    "preview": "vite preview",
    "test": "vitest run"
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
    "vite": "^8.1.0",
    "vitest": "^4.1.9"
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

### packages/web/src/webrtc-test.html

```text
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Mesh WebRTC Test</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen p-8 font-mono">
<div class="max-w-3xl mx-auto space-y-6">

<h1 class="text-2xl font-bold">Mesh — WebRTC Connectivity Test</h1>
<p class="text-slate-400 text-sm">Open this same URL in a second tab. Create a room in one, join with the code in the other.</p>

<div class="space-y-2">
  <label class="block text-sm text-slate-400">Signaling server URL</label>
  <input id="signalingUrl" type="text" value="ws://localhost:8080"
    class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm" />
</div>

<div class="grid grid-cols-2 gap-4">
  <div class="bg-slate-900 border border-slate-700 rounded p-4 space-y-3">
    <h2 class="font-semibold">Create room</h2>
    <button id="createRoomBtn" class="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded text-sm w-full">
      Create Room
    </button>
    <div class="text-sm">
      Room code: <span id="roomCodeDisplay" class="text-emerald-400 font-bold">—</span>
    </div>
  </div>

  <div class="bg-slate-900 border border-slate-700 rounded p-4 space-y-3">
    <h2 class="font-semibold">Join room</h2>
    <input id="roomCodeInput" type="text" placeholder="ROOMCODE"
      class="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm uppercase" />
    <button id="joinRoomBtn" class="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm w-full">
      Join Room
    </button>
  </div>
</div>

<div class="bg-slate-900 border border-slate-700 rounded p-4 space-y-3">
  <h2 class="font-semibold">Status</h2>
  <div class="text-sm">
    Peer ID: <span id="peerIdDisplay" class="text-slate-300">—</span>
  </div>
  <div class="text-sm">
    WebRTC state: <span id="webrtcStateDisplay" class="text-yellow-400">idle</span>
  </div>
</div>

<div class="bg-slate-900 border border-slate-700 rounded p-4 space-y-3">
  <h2 class="font-semibold">Send message over data channel</h2>
  <div class="flex gap-2">
    <input id="messageInput" type="text" placeholder="hello from tab A"
      class="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
    <button id="sendBtn" disabled
      class="bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:cursor-not-allowed px-4 py-2 rounded text-sm">
      Send
    </button>
  </div>
</div>

<div class="bg-black border border-slate-700 rounded p-4">
  <h2 class="font-semibold mb-2">Log</h2>
  <div id="log" class="text-xs text-slate-300 space-y-1 h-80 overflow-y-auto"></div>
</div>

</div>

<script type="module">
import { SignalingClient } from '/src/webrtc/signalingClient.js';
import { WebRTCPeer } from '/src/webrtc/webrtcPeer.js';

const logEl = document.getElementById('log');
const peerIdDisplay = document.getElementById('peerIdDisplay');
const webrtcStateDisplay = document.getElementById('webrtcStateDisplay');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const sendBtn = document.getElementById('sendBtn');
const messageInput = document.getElementById('messageInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomCodeInput = document.getElementById('roomCodeInput');
const signalingUrlInput = document.getElementById('signalingUrl');

let signaling = null;
let peer = null;

function log(message) {
  const line = document.createElement('div');
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setWebrtcState(state, color) {
  webrtcStateDisplay.textContent = state;
  webrtcStateDisplay.className = color;
}

async function ensureSignaling() {
  if (signaling) return signaling;
  signaling = new SignalingClient(signalingUrlInput.value);
  await signaling.connect();
  peerIdDisplay.textContent = signaling.peerId || 'connected';
  log('connected to signaling server');

  signaling.addEventListener('peerJoined', (event) => {
    log(`peer joined room: ${event.detail.peerId}`);
    startConnection(event.detail.peerId, true);
  });

  signaling.addEventListener('peerLeft', (event) => {
    log(`peer left room: ${event.detail.peerId}`);
    setWebrtcState('peer left', 'text-red-400');
  });

  signaling.addEventListener('signalingError', (event) => {
    log(`signaling error: ${event.detail.message}`);
  });

  return signaling;
}

async function startConnection(remotePeerId, initiator) {
  log(`starting webrtc connection to ${remotePeerId} (initiator=${initiator})`);
  setWebrtcState('connecting', 'text-yellow-400');

  peer = new WebRTCPeer(signaling, remotePeerId, { initiator });

  peer.addEventListener('message', (event) => {
    log(`received: ${JSON.stringify(event.detail)}`);
  });

  peer.addEventListener('close', () => {
    log('data channel closed');
    setWebrtcState('closed', 'text-red-400');
    sendBtn.disabled = true;
  });

  try {
    await peer.connect();
    log('data channel open — connection established');
    setWebrtcState('connected', 'text-emerald-400');
    sendBtn.disabled = false;
  } catch (err) {
    log(`connection failed: ${err.message}`);
    setWebrtcState('failed', 'text-red-400');
  }
}

createRoomBtn.addEventListener('click', async () => {
  createRoomBtn.disabled = true;
  try {
    await ensureSignaling();
    const result = await signaling.createRoom();
    roomCodeDisplay.textContent = result.roomCode;
    peerIdDisplay.textContent = result.peerId;
    log(`room created: ${result.roomCode}`);
  } catch (err) {
    log(`create room failed: ${err.message}`);
  } finally {
    createRoomBtn.disabled = false;
  }
});

joinRoomBtn.addEventListener('click', async () => {
  joinRoomBtn.disabled = true;
  try {
    await ensureSignaling();
    const code = roomCodeInput.value.trim().toUpperCase();
    const result = await signaling.joinRoom(code);
    peerIdDisplay.textContent = result.peerId;
    log(`joined room ${result.roomCode}, existing peers: ${result.existingPeers.join(', ') || 'none'}`);
    for (const existingPeerId of result.existingPeers) {
      startConnection(existingPeerId, false);
    }
  } catch (err) {
    log(`join room failed: ${err.message}`);
  } finally {
    joinRoomBtn.disabled = false;
  }
});

sendBtn.addEventListener('click', () => {
  if (!peer) return;
  const text = messageInput.value;
  if (!text) return;
  peer.send({ text, ts: Date.now() });
  log(`sent: ${text}`);
  messageInput.value = '';
});
</script>
</body>
</html>
```

### packages/web/src/webrtc/signalingClient.js

```text
export const MSG_TYPE = {
  CREATE_ROOM:  'CREATE_ROOM',
  ROOM_CREATED: 'ROOM_CREATED',
  JOIN_ROOM:    'JOIN_ROOM',
  ROOM_JOINED:  'ROOM_JOINED',
  PEER_JOINED:  'PEER_JOINED',
  PEER_LEFT:    'PEER_LEFT',
  RELAY:        'RELAY',
  ERROR:        'ERROR',
};

export class SignalingClient extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.peerId = null;
    this.roomCode = null;
    this._pending = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener('open', () => resolve(this), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('Signaling connection failed')), { once: true });
      this.ws.addEventListener('message', (event) => this._handleMessage(event));
      this.ws.addEventListener('close', () => this.dispatchEvent(new Event('close')));
    });
  }

  _send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  _handleMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === MSG_TYPE.ROOM_CREATED || msg.type === MSG_TYPE.ROOM_JOINED) {
      this.peerId = msg.peerId;
      this.roomCode = msg.roomCode;
      if (this._pending) {
        this._pending.resolve(msg);
        this._pending = null;
      }
      return;
    }

    if (msg.type === MSG_TYPE.ERROR) {
      if (this._pending) {
        this._pending.reject(new Error(msg.message));
        this._pending = null;
        return;
      }
      this.dispatchEvent(new CustomEvent('signalingError', { detail: msg }));
      return;
    }

    if (msg.type === MSG_TYPE.PEER_JOINED) {
      this.dispatchEvent(new CustomEvent('peerJoined', { detail: { peerId: msg.peerId } }));
      return;
    }

    if (msg.type === MSG_TYPE.PEER_LEFT) {
      this.dispatchEvent(new CustomEvent('peerLeft', { detail: { peerId: msg.peerId } }));
      return;
    }

    if (msg.type === MSG_TYPE.RELAY) {
      this.dispatchEvent(new CustomEvent('relay', {
        detail: { fromPeerId: msg.fromPeerId, payload: msg.payload },
      }));
      return;
    }
  }

  createRoom(password) {
    return new Promise((resolve, reject) => {
      this._pending = { resolve, reject };
      this._send({ type: MSG_TYPE.CREATE_ROOM, password });
    });
  }

  joinRoom(roomCode, password) {
    return new Promise((resolve, reject) => {
      this._pending = { resolve, reject };
      this._send({ type: MSG_TYPE.JOIN_ROOM, roomCode, password });
    });
  }

  relay(targetPeerId, payload) {
    this._send({ type: MSG_TYPE.RELAY, targetPeerId, payload });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}
```

### packages/web/src/webrtc/webrtcPeer.js

```text
export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
export const CONNECT_TIMEOUT_MS = 15000;

export class WebRTCPeer extends EventTarget {
  constructor(signalingClient, remotePeerId, { initiator }) {
    super();
    this.signalingClient = signalingClient;
    this.remotePeerId = remotePeerId;
    this.initiator = initiator;
    this.pc = null;
    this.channel = null;
    this._remoteDescSet = false;
    this._pendingCandidates = [];
    this._relayHandler = (event) => this._handleRelay(event);
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('WebRTC connection timeout'));
      }, CONNECT_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        this.signalingClient.removeEventListener('relay', this._relayHandler);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(this);
      };

      const fail = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      this.pc.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
          this.signalingClient.relay(this.remotePeerId, {
            kind: 'ice-candidate',
            candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
          });
        }
      });

      this.pc.addEventListener('connectionstatechange', () => {
        if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
          fail(new Error(`WebRTC connection ${this.pc.connectionState}`));
        }
      });

      if (this.initiator) {
        this.channel = this.pc.createDataChannel('mesh');
        this._bindChannel(succeed);
        this.pc.createOffer()
          .then((offer) => this.pc.setLocalDescription(offer).then(() => offer))
          .then((offer) => {
            this.signalingClient.relay(this.remotePeerId, { kind: 'offer', sdp: offer.sdp });
          })
          .catch(fail);
      } else {
        this.pc.addEventListener('datachannel', (event) => {
          this.channel = event.channel;
          this._bindChannel(succeed);
        });
      }

      this.signalingClient.addEventListener('relay', this._relayHandler);
    });
  }

  _bindChannel(onOpen) {
    this.channel.addEventListener('open', onOpen);
    this.channel.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      this.dispatchEvent(new CustomEvent('message', { detail: data }));
    });
    this.channel.addEventListener('close', () => {
      this.dispatchEvent(new Event('close'));
    });
  }

  async _handleRelay(event) {
    const { fromPeerId, payload } = event.detail;
    if (fromPeerId !== this.remotePeerId) return;

    if (payload.kind === 'offer') {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
      this._remoteDescSet = true;
      await this._flushCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.signalingClient.relay(this.remotePeerId, { kind: 'answer', sdp: answer.sdp });
      return;
    }

    if (payload.kind === 'answer') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      this._remoteDescSet = true;
      await this._flushCandidates();
      return;
    }

    if (payload.kind === 'ice-candidate') {
      if (this._remoteDescSet) {
        await this.pc.addIceCandidate(payload.candidate).catch(() => {});
      } else {
        this._pendingCandidates.push(payload.candidate);
      }
    }
  }

  async _flushCandidates() {
    const candidates = this._pendingCandidates;
    this._pendingCandidates = [];
    for (const candidate of candidates) {
      await this.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  send(obj) {
    this.channel.send(JSON.stringify(obj));
  }

  close() {
    this.signalingClient.removeEventListener('relay', this._relayHandler);
    if (this.channel) this.channel.close();
    if (this.pc) this.pc.close();
  }
}
```

### packages/web/test/signalingClient.test.js

```text
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignalingClient, MSG_TYPE } from '../src/webrtc/signalingClient.js';

class FakeWebSocket extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.dispatchEvent(new Event('close'));
  }

  emitServerMessage(obj) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(obj) }));
  }
}
FakeWebSocket.instances = [];

describe('SignalingClient', () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  it('connect resolves once the socket opens', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    const resolved = await client.connect();
    expect(resolved).toBe(client);
  });

  it('createRoom resolves with roomCode and peerId', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();

    const createPromise = client.createRoom();
    const socket = FakeWebSocket.instances[0];
    expect(socket.sent[0]).toEqual({ type: MSG_TYPE.CREATE_ROOM, password: undefined });

    socket.emitServerMessage({ type: MSG_TYPE.ROOM_CREATED, roomCode: 'ABC123', peerId: 'peer1' });

    const result = await createPromise;
    expect(result.roomCode).toBe('ABC123');
    expect(client.peerId).toBe('peer1');
  });

  it('joinRoom rejects when the server returns an error', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();

    const joinPromise = client.joinRoom('BADCOD');
    const socket = FakeWebSocket.instances[0];
    socket.emitServerMessage({ type: MSG_TYPE.ERROR, message: 'Room not found' });

    await expect(joinPromise).rejects.toThrow('Room not found');
  });

  it('dispatches peerJoined, peerLeft, and relay events', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();
    const socket = FakeWebSocket.instances[0];

    const peerJoined = new Promise((resolve) => {
      client.addEventListener('peerJoined', (e) => resolve(e.detail));
    });
    socket.emitServerMessage({ type: MSG_TYPE.PEER_JOINED, peerId: 'peer2' });
    await expect(peerJoined).resolves.toEqual({ peerId: 'peer2' });

    const peerLeft = new Promise((resolve) => {
      client.addEventListener('peerLeft', (e) => resolve(e.detail));
    });
    socket.emitServerMessage({ type: MSG_TYPE.PEER_LEFT, peerId: 'peer2' });
    await expect(peerLeft).resolves.toEqual({ peerId: 'peer2' });

    const relay = new Promise((resolve) => {
      client.addEventListener('relay', (e) => resolve(e.detail));
    });
    socket.emitServerMessage({ type: MSG_TYPE.RELAY, fromPeerId: 'peer2', payload: { sdp: 'x' } });
    await expect(relay).resolves.toEqual({ fromPeerId: 'peer2', payload: { sdp: 'x' } });
  });

  it('relay sends a RELAY message with targetPeerId and payload', async () => {
    const client = new SignalingClient('ws://localhost:8080');
    await client.connect();
    const socket = FakeWebSocket.instances[0];

    client.relay('peer2', { kind: 'offer', sdp: 'fake' });

    expect(socket.sent[0]).toEqual({
      type: MSG_TYPE.RELAY,
      targetPeerId: 'peer2',
      payload: { kind: 'offer', sdp: 'fake' },
    });
  });
});
```

### packages/web/test/webrtc.test.js

```text
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebRTCPeer, CONNECT_TIMEOUT_MS } from '../src/webrtc/webrtcPeer.js';

class FakeDataChannel extends EventTarget {
  constructor() {
    super();
    this.readyState = 'connecting';
    this.peer = null;
  }

  send(data) {
    this.peer.dispatchEvent(new MessageEvent('message', { data }));
  }

  open() {
    this.readyState = 'open';
    this.dispatchEvent(new Event('open'));
  }

  close() {
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
}

function linkChannels(a, b) {
  a.peer = b;
  b.peer = a;
}

class FakeRTCPeerConnection extends EventTarget {
  constructor() {
    super();
    this.connectionState = 'new';
    this.channel = null;
    this.localDescription = null;
    this.remoteDescription = null;
  }

  createDataChannel() {
    this.channel = new FakeDataChannel();
    return this.channel;
  }

  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'fake-offer-sdp' });
  }

  createAnswer() {
    return Promise.resolve({ type: 'answer', sdp: 'fake-answer-sdp' });
  }

  setLocalDescription(desc) {
    this.localDescription = desc;
    return Promise.resolve();
  }

  setRemoteDescription(desc) {
    this.remoteDescription = desc;
    return Promise.resolve();
  }

  addIceCandidate() {
    return Promise.resolve();
  }

  close() {
    this.connectionState = 'closed';
  }
}

class FakeSignalingClient extends EventTarget {
  constructor(peerId) {
    super();
    this.peerId = peerId;
    this.partner = null;
    this.sentPayloads = [];
  }

  relay(targetPeerId, payload) {
    this.sentPayloads.push(payload);
    queueMicrotask(() => {
      this.partner.dispatchEvent(new CustomEvent('relay', {
        detail: { fromPeerId: this.peerId, payload },
      }));
    });
  }
}

function linkSignaling(a, b) {
  a.partner = b;
  b.partner = a;
}

async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('WebRTCPeer', () => {
  let originalRTCPeerConnection;

  beforeEach(() => {
    originalRTCPeerConnection = global.RTCPeerConnection;
  });

  afterEach(() => {
    global.RTCPeerConnection = originalRTCPeerConnection;
    vi.useRealTimers();
  });

  it('establishes a data channel and exchanges a message end to end', async () => {
    const pcA = new FakeRTCPeerConnection();
    const pcB = new FakeRTCPeerConnection();
    global.RTCPeerConnection = vi.fn()
      .mockImplementationOnce(function () { return pcA; })
      .mockImplementationOnce(function () { return pcB; });

    const sigA = new FakeSignalingClient('peerA');
    const sigB = new FakeSignalingClient('peerB');
    linkSignaling(sigA, sigB);

    const peerA = new WebRTCPeer(sigA, 'peerB', { initiator: true });
    const peerB = new WebRTCPeer(sigB, 'peerA', { initiator: false });

    const connectA = peerA.connect();
    const connectB = peerB.connect();

    await flush();

    const channelB = new FakeDataChannel();
    linkChannels(pcA.channel, channelB);
    pcB.dispatchEvent(Object.assign(new Event('datachannel'), { channel: channelB }));

    pcA.channel.open();
    channelB.open();

    const [resolvedA, resolvedB] = await Promise.all([connectA, connectB]);
    expect(resolvedA).toBe(peerA);
    expect(resolvedB).toBe(peerB);

    const received = new Promise((resolve) => {
      peerB.addEventListener('message', (e) => resolve(e.detail));
    });
    peerA.send({ hello: 'world' });
    await expect(received).resolves.toEqual({ hello: 'world' });

    expect(pcB.remoteDescription.sdp).toBe('fake-offer-sdp');
    expect(pcA.remoteDescription.sdp).toBe('fake-answer-sdp');
  });

  it('ignores relay messages from peers other than the remote peer', async () => {
    const pcA = new FakeRTCPeerConnection();
    global.RTCPeerConnection = vi.fn().mockImplementationOnce(function () { return pcA; });

    const sigA = new FakeSignalingClient('peerA');
    sigA.partner = sigA;

    const peerA = new WebRTCPeer(sigA, 'peerB', { initiator: true });
    peerA.connect().catch(() => {});

    await flush();

    sigA.dispatchEvent(new CustomEvent('relay', {
      detail: { fromPeerId: 'someOtherPeer', payload: { kind: 'answer', sdp: 'should-be-ignored' } },
    }));

    await flush();

    expect(pcA.remoteDescription).toBeNull();
    peerA.close();
  });

  it('rejects if the data channel never opens before the timeout', async () => {
    vi.useFakeTimers();

    const pcA = new FakeRTCPeerConnection();
    const pcB = new FakeRTCPeerConnection();
    global.RTCPeerConnection = vi.fn()
      .mockImplementationOnce(function () { return pcA; })
      .mockImplementationOnce(function () { return pcB; });

    const sigA = new FakeSignalingClient('peerA');
    const sigB = new FakeSignalingClient('peerB');
    linkSignaling(sigA, sigB);

    const peerA = new WebRTCPeer(sigA, 'peerB', { initiator: true });
    const connectA = peerA.connect();

    const assertion = expect(connectA).rejects.toThrow('WebRTC connection timeout');
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 100);
    await assertion;
  });
});
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

### sig-test-out.txt

Binary or non-UTF-8 file omitted from markdown snapshot (6300 bytes).

### test-out.txt

Binary or non-UTF-8 file omitted from markdown snapshot (28940 bytes).

### testfile.bin

Binary or non-UTF-8 file omitted from markdown snapshot (52428800 bytes).

### web-test-out.txt

Binary or non-UTF-8 file omitted from markdown snapshot (720 bytes).

