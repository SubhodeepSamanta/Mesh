# All Code Snapshot

Generated from: Mesh Root Project

Excluded: node_modules, .git, package-lock.json, .env

## File List

- .env.example
- .gitignore
- docker-compose.yml
- docs/bugs.md
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
- packages/engine/src/chunkServer.js
- packages/engine/src/crypto.js
- packages/engine/src/dht.js
- packages/engine/src/index.js
- packages/engine/src/peer.js
- packages/engine/src/protocol.js
- packages/engine/src/resume.js
- packages/engine/src/seed.js
- packages/engine/src/swarm.js
- packages/engine/src/transfer.js
- packages/engine/test/chunker.test.js
- packages/engine/test/chunkServer.test.js
- packages/engine/test/crypto.test.js
- packages/engine/test/dht.test.js
- packages/engine/test/dhtfiles.test.js
- packages/engine/test/dhtnode.test.js
- packages/engine/test/integration.test.js
- packages/engine/test/peer.test.js
- packages/engine/test/protocol.test.js
- packages/engine/test/resume.test.js
- packages/engine/test/seed.test.js
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
- packages/web/src/App.jsx
- packages/web/src/components/ChunkGrid.jsx
- packages/web/src/components/ConnectionCode.jsx
- packages/web/src/components/FileDropZone.jsx
- packages/web/src/components/FileManifest.jsx
- packages/web/src/components/LandingGraph.jsx
- packages/web/src/components/layout/Header.jsx
- packages/web/src/components/layout/Layout.jsx
- packages/web/src/components/layout/ThemeToggle.jsx
- packages/web/src/components/PeerGraph.jsx
- packages/web/src/components/PeerList.jsx
- packages/web/src/components/RoomCode.jsx
- packages/web/src/components/shared/Accordion.jsx
- packages/web/src/components/shared/Badge.jsx
- packages/web/src/components/shared/Button.jsx
- packages/web/src/components/shared/Card.jsx
- packages/web/src/components/shared/MonoText.jsx
- packages/web/src/components/shared/ProgressBar.jsx
- packages/web/src/components/SpeedChart.jsx
- packages/web/src/components/StatusLog.jsx
- packages/web/src/hooks/useSignaling.js
- packages/web/src/hooks/useTransfer.js
- packages/web/src/hooks/useWebRTC.js
- packages/web/src/index.css
- packages/web/src/lib/browserCrypto.js
- packages/web/src/lib/fileChunker.js
- packages/web/src/lib/format.js
- packages/web/src/lib/swarmManager.js
- packages/web/src/lib/transferManager.js
- packages/web/src/lib/webrtc.js
- packages/web/src/main.jsx
- packages/web/src/pages/Dashboard.jsx
- packages/web/src/pages/History.jsx
- packages/web/src/pages/Landing.jsx
- packages/web/src/pages/NotFound.jsx
- packages/web/src/pages/Receive.jsx
- packages/web/src/pages/Send.jsx
- packages/web/src/store/useHistoryStore.js
- packages/web/src/store/useSignalingStore.js
- packages/web/src/store/useTransferStore.js
- packages/web/src/store/useUIStore.js
- packages/web/src/webrtc/protocol.js
- packages/web/src/webrtc/signalingClient.js
- packages/web/test/signalingClient.test.js
- packages/web/test/webrtc.test.js
- packages/web/test/webrtcProtocol.test.js
- packages/web/vite.config.js

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

### docs/bugs.md

````text
Good call auditing before Phase 4 — this codebase has more issues than the "COMPLETE" checkpoints suggest, and one of them directly answers your "any number/size of files" question with **no, not currently**. Let me lay out everything I found, ranked by severity, then propose how to split it into parts.

## The direct answer first

**No — right now the DHT/swarm/encrypted path cannot reliably handle arbitrarily large files.** Two compounding reasons:

**1. The whole file gets buffered in RAM, not streamed to disk.**
Your Phase 1 `receiver.js` writes each chunk directly to disk at its byte offset (`fileHandle.write(chunkData, 0, len, offset)`) — that was the right design, explicitly called out as a key decision. But `swarm.js` doesn't do this. Look at `onChunkReceived`:

```javascript
this.received.set(chunkIndex, chunkData);
```

Every verified chunk's raw bytes sit in a `Map` in memory for the entire transfer. Then `assemble()`:

```javascript
assemble() {
  if (!this.done) throw new Error('Transfer not complete');
  return assembleChunks(this.received, this.totalChunks);  // Buffer.concat of EVERYTHING
}
```

`transfer.js`'s `downloadFile()` returns this one giant in-memory `Buffer`. For a 50MB test file, fine. For a 20GB file, you need 20GB+ of free RAM just to hold the download, then another spike for `Buffer.concat`. This is a real regression from Phase 1's architecture, not a hypothetical — it happened because the DHT/swarm path was built as a self-contained function returning a `Buffer` rather than writing to a file handle like `receiver.js` does.

**2. `SwarmManager._fillPipeline` is O(n) per call, called on every chunk completion → O(n²) overall.**

```javascript
_fillPipeline(peerId) {
  ...
  for (let i = 0; i < this.totalChunks; i++) {
    if (peer.pending.size >= PIPELINE_SIZE) break;
    if (this.chunkState[i] !== CHUNK_STATE.PENDING) continue;
    ...
  }
}
```

This linearly scans from chunk 0 every single time a peer needs more work — which happens after every chunk verification. For a file with 160,000 chunks (≈10GB at 64KB/chunk), that's up to 160,000 comparisons run roughly 160,000 times ≈ 25 billion operations. Small test files (10-100 chunks) never expose this; a real large file would grind to a crawl or effectively hang.

Both of these need fixing before Phase 4 gives you a UI that lets people try genuinely large files — otherwise the frontend will just make the RAM/CPU problem visible with a spinner that never finishes.

## Critical bugs (crash / hang / leak)

**3. Malformed UDP messages with a bad `nodeId` crash the entire DHT node process.**

```javascript
_handleMessage(msgBuf, rinfo) {
  let msg;
  try { msg = JSON.parse(msgBuf.toString('utf8')); } catch { return; }

  if (msg.nodeId && msg.nodeId !== this.nodeId) {
    this.routingTable.addPeer({ id: msg.nodeId, addr: rinfo.address, port: rinfo.port });
  }
  ...
```

Your existing test ("handles malformed UDP packets") only sends invalid JSON, which the try/catch handles. But **valid JSON with a wrong-length `nodeId`** (e.g. `{"type":"DHT_PING","nodeId":"xyz"}`) sails past the try/catch, hits `addPeer` → `bucketIndex` → `xorDistance`:

```javascript
if (a.length !== ID_BYTES || b.length !== ID_BYTES) {
  throw new Error('Node IDs must be 20 bytes');
}
```

This throws synchronously inside a `dgram` `'message'` event handler. Node's `EventEmitter` does not catch listener exceptions — this is an **uncaught exception that crashes the process**. Any DHT node (which by design accepts UDP from arbitrary peers) can be killed by one malformed-but-valid-JSON packet. Same exposure exists via `FIND_NODE`'s `targetId` and `ANNOUNCE`/`GET_PEERS`'s `fileHash` fields — anything that flows into `xorDistance` unvalidated. This is your single highest-priority fix; it's a DoS vector, not an edge case.

**4. `downloadFile` can hang forever when the last connected peer fails mid-transfer.**

```javascript
_markPeerFailed(peerId) {
  ...
  peer.failed = true;
  this.emit('peerFailed', { peerId, reason: 'too_many_consecutive_failures' });  // ① fires first
  this.removePeer(peerId);                                                       // ② deletes after
}
```

In `transfer.js`:
```javascript
swarm.on('peerFailed', () => {
  if (swarm.peers.size === 0 && !swarm.isComplete()) {
    reject(new Error('All peers failed'));
  }
});
```

`emit()` calls listeners synchronously *before* `removePeer()` runs. So when this listener checks `swarm.peers.size`, the failing peer **hasn't been deleted yet** — `size` is still 1, never 0, at the exact moment this check needs to see 0. When the last peer fails, this condition never trips, the `complete` event never fires either, and the `await new Promise(...)` in `downloadFile` hangs indefinitely. Untested — your integration tests only cover failure at *connection* time (`ECONNREFUSED`), not mid-transfer peer failure after a successful connection.

**5. Connection resource leak on the "all peers failed" path.**

```javascript
await new Promise((resolve, reject) => { ... });  // if this rejects...
for (const conn of connections.values()) conn.close();  // ...this never runs
return swarm.assemble();
```

If the promise rejects (once bug #4 is fixed and it actually can reject), every successfully-opened `PeerConnection` socket in `connections` is abandoned — never closed. Needs a `try/finally`.

## High-priority correctness/performance issues

**6. Sequential peer connection in `downloadFile` — no concurrency.**
```javascript
for (const peerInfo of peers) {
  const conn = new PeerConnection(peerInfo.addr, peerInfo.port);
  await conn.connect();  // waits for THIS to resolve/reject before trying next peer
  ...
}
```
With `HANDSHAKE_TIMEOUT_MS = 5000`, if you discover 20 peers and 10 are dead/unreachable, you pay up to 50 seconds connecting sequentially before the swarm even starts. Should be `Promise.allSettled` over all peers concurrently.

**7. No cap on simultaneous peer connections.** For a popular file with hundreds of seeders, `downloadFile` will try to open a TCP connection (plus ECDH handshake) to every single one. Real P2P clients cap this (e.g. 30-50 concurrent). Not urgent at your current scale, but will bite you the moment more than a handful of peers exist.

**8. `WebRTCPeer` still can't carry chunk protocol traffic.** As flagged last time — it only does `JSON.stringify`/`JSON.parse` over the data channel, no binary support, and doesn't implement the `requestChunk`/framing interface `PeerConnection` does. This is necessary before WebRTC transfers can join the swarm at all, and it's more than a "nice to have" — it's a real gap between the architecture doc's stated invariant #5 and the actual code.

## Medium (dead code / duplication / edge cases)

**9. Empty file (0 bytes) crashes.** `buildMerkleTree([])` → `throw new Error('No hashes provided')`. `indexFile` never special-cases this. Anyone sending a 0-byte file breaks the sender at indexing time.

**10. Two independent Merkle-root implementations.** `buildMerkleRoot` (crypto.js) and `buildMerkleTree` (crypto.js) compute the same thing differently — the former is only referenced from a synthetic test, never from production code. Dead duplication; a future edit to one and not the other is a correctness trap waiting to happen.

**11. `importPublicKey` is defined but never called.** `deriveSharedKey` reimplements the same `createPublicKey(...)` call inline instead of using it. Minor DRY violation.

**12. `packages/signaling/Dockerfile` is a literally empty file**, but `docker-compose.yml` references `build: ./packages/signaling`. This will fail the moment you try `docker-compose up` — Phase 5 concern, but worth knowing it's not just "not started," it's actively broken if invoked today.

**13. Rate-limit map in the signaling server never prunes stale IPs.** `this.rateLimits` grows one entry per distinct `ip:action` forever; long-running server = slow leak. Room expiry already has a cleanup pattern (`_expireRooms`) — rate limits don't.

**14. Signaling server has no `wss.on('error', ...)` handler.** If the port's already in use, `WebSocketServer`'s `'error'` event has no listener — Node's special-case for unhandled `'error'` events means this throws and crashes the process instead of giving you a clean "port in use" message.

**15. `packages/signaling/src/metrics.js`** is an unused stub, never incremented anywhere. Dead placeholder.

**16. Repo hygiene** — `received/protocol.js` and `received/transfer.test.js` are stale leftover copies from before encryption was added (missing `KEY_EXCHANGE` entirely), sitting in a gitignored folder. Harmless but confusing if you ever `cat` the wrong file while debugging. Worth a `Remove-Item -Recurse` cleanup pass along with the stray root-level `test-out.txt`, `testfile.bin`, `sig-test-out.txt`.

## Proposed grouping

**Part F1 — Critical stability (do this first, before anything else):**
Fix #3 (DHT crash on malformed packets — wrap `_handleMessage` safely, validate ID lengths before use), #4 (peerFailed race), #5 (connection leak via try/finally). These are the ones that can crash a running node or silently hang a transfer forever. Small, surgical, testable in isolation.

**Part F2 — Large-file capability (this is the one that actually answers your size question):**
Rework the DHT/swarm download path to stream verified chunks to disk immediately instead of buffering the whole file in `SwarmManager.received`, and fix `_fillPipeline`'s O(n) scan (swap the linear scan for a pending-indices queue/Set). This is the biggest single piece of work — it changes `SwarmManager`'s and `transfer.js`'s contract (no more `assemble()` returning a `Buffer`; instead it needs a file handle passed in, like `receiver.js` already does it right).

**Part F3 — Peer connection quality:** #6 (concurrent connect), #7 (connection cap), #8 (WebRTC binary chunk protocol — the `WebRTCPeerConnection` class we discussed last time also lives here).

**Part F4 — Cleanup:** #9 through #16. Quick, low-risk, good to batch together in one pass.

Given your "fix everything now, don't leave things for later" style, I'd do F1 → F2 → F3 → F4 in that order and re-run the full test suite after each part, same discipline as Phase 1/2. F2 is the one gating a real "yes" to your size question, so don't skip to Phase 4 before it's done if large-file support matters for your portfolio demo.

Want me to start on **F1** now?
````

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
"test": "node --test test/protocol.test.js test/chunker.test.js test/crypto.test.js test/transfer.test.js test/dht.test.js test/dhtnode.test.js test/dhtfiles.test.js test/swarm.test.js test/peer.test.js test/integration.test.js test/resume.test.js test/chunkServer.test.js test/seed.test.js"
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
```

### packages/engine/sender.js

```text
import { basename, resolve } from 'path';
import { open } from 'fs/promises';
import { indexFile } from './src/chunker.js';
import { DHTNode } from './src/dht.js';
import { createChunkServer } from './src/chunkServer.js';

const FILE_PATH       = resolve(process.argv[2]);
const PORT             = parseInt(process.argv[3] || '9000');
const BOOTSTRAP_HOST   = process.argv[4] || null;
const BOOTSTRAP_PORT   = process.argv[5] ? parseInt(process.argv[5]) : null;

if (!process.argv[2]) {
  console.error('Usage: node sender.js <filepath> [port] [bootstrapHost] [bootstrapPort]');
  process.exit(1);
}

async function main() {
  console.log(`Indexing ${FILE_PATH}...`);
  const { fileSize, hashes, tree, merkleRoot, totalChunks, chunkSize } = await indexFile(FILE_PATH);
  console.log(`Ready: ${totalChunks} chunks, root: ${merkleRoot.slice(0, 16)}...`);
  console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Chunk size: ${(chunkSize / 1024).toFixed(0)} KB`);

  const fileHandle = await open(FILE_PATH, 'r');

  const dhtNode = new DHTNode();
  await dhtNode.listen();
  if (BOOTSTRAP_HOST && BOOTSTRAP_PORT) {
    try {
      await dhtNode.bootstrap(BOOTSTRAP_HOST, BOOTSTRAP_PORT);
      console.log(`Bootstrapped into DHT via ${BOOTSTRAP_HOST}:${BOOTSTRAP_PORT}`);
    } catch (e) {
      console.warn(`DHT bootstrap failed: ${e.message}`);
    }
  }

  const server = createChunkServer({
    fileHandle, hashes, tree, merkleRoot,
    fileName: basename(FILE_PATH), fileSize, totalChunks, chunkSize,
  });

  server.on('peerError', (e) => console.error('Peer connection error:', e.message));

  server.listen(PORT, '127.0.0.1', async () => {
    console.log(`Sender listening on 127.0.0.1:${PORT}`);
    console.log(`Serves any number of peers concurrently. Run receiver: node packages/engine/receiver.js 127.0.0.1 ${PORT} ./received`);
    try {
      await dhtNode.announceFile(merkleRoot, PORT);
      console.log(`Announced to DHT. File id: ${merkleRoot}`);
    } catch (e) {
      console.warn(`DHT announce failed: ${e.message}`);
    }
  });

  server.on('error', (e) => {
    console.error('Server error:', e.message);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await new Promise((resolve) => server.close(resolve));
    await fileHandle.close().catch(() => {});
    await dhtNode.close();
    process.exit(0);
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
export const MAX_CHUNK_SIZE = 32 * 1024 * 1024;
export const TARGET_CHUNK_COUNT = 50000;

export const EMPTY_FILE_MERKLE_ROOT = sha256(Buffer.alloc(0));

export function computeChunkSize(fileSize) {
  if (fileSize <= DEFAULT_CHUNK_SIZE * TARGET_CHUNK_COUNT) {
    return DEFAULT_CHUNK_SIZE;
  }
  const raw = Math.ceil(fileSize / TARGET_CHUNK_COUNT);
  let size = DEFAULT_CHUNK_SIZE;
  while (size < raw && size < MAX_CHUNK_SIZE) {
    size *= 2;
  }
  return size;
}

export function computeCacheSize(chunkSize) {
  const TARGET_CACHE_BYTES = 64 * DEFAULT_CHUNK_SIZE;
  const raw = Math.floor(TARGET_CACHE_BYTES / chunkSize);
  return Math.max(8, Math.min(256, raw));
}

export function computeSwarmPipelineDepth(chunkSize) {
  const TARGET_INFLIGHT_BYTES = 16 * DEFAULT_CHUNK_SIZE;
  const raw = Math.floor(TARGET_INFLIGHT_BYTES / chunkSize);
  return Math.max(4, Math.min(16, raw));
}

export function computeSimplePipelineDepth(chunkSize) {
  const TARGET_INFLIGHT_BYTES = 32 * DEFAULT_CHUNK_SIZE;
  const raw = Math.floor(TARGET_INFLIGHT_BYTES / chunkSize);
  return Math.max(4, Math.min(32, raw));
}

export async function indexFile(filePath, chunkSize = null) {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;
  const effectiveChunkSize = chunkSize || computeChunkSize(fileSize);

  if (fileSize === 0) {
    return {
      hashes: [],
      tree: { root: EMPTY_FILE_MERKLE_ROOT, levels: [] },
      merkleRoot: EMPTY_FILE_MERKLE_ROOT,
      totalChunks: 0,
      fileSize,
      chunkSize: effectiveChunkSize,
    };
  }

  const hashes = [];
  const stream = createReadStream(filePath, { highWaterMark: effectiveChunkSize });
  for await (const chunk of stream) {
    hashes.push(sha256(Buffer.from(chunk)));
  }
  const tree = buildMerkleTree(hashes);
  return { hashes, tree, merkleRoot: tree.root, totalChunks: hashes.length, fileSize, chunkSize: effectiveChunkSize };
}

export async function readChunk(fileHandle, index, chunkSize = DEFAULT_CHUNK_SIZE) {
  const start = index * chunkSize;
  const buffer = Buffer.allocUnsafe(chunkSize);
  const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, start);
  return buffer.subarray(0, bytesRead);
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

### packages/engine/src/chunkServer.js

```text
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

  const server = net.createServer((socket) => {
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
  });

  return server;
}
```

### packages/engine/src/crypto.js

```text
import { createHash, createCipheriv, createDecipheriv, randomBytes, generateKeyPairSync, diffieHellman, hkdfSync, createPublicKey } from 'crypto';

export const CIPHER = 'aes-256-gcm';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
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
  const theirPublicKey = importPublicKey(theirPublicKeyDER);
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

export function isValidNodeId(id) {
  return typeof id === 'string' && id.length === ID_BYTES * 2 && /^[0-9a-f]+$/i.test(id);
}

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
    if (!peer || !isValidNodeId(peer.id)) return false;
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
    if (!isValidNodeId(peerId)) return false;
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
    if (!isValidNodeId(targetId)) return [];
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

    try {
      this._processMessage(msg, rinfo);
    } catch (e) {
      this.emit('malformedMessage', { error: e.message, rinfo });
    }
  }

  _processMessage(msg, rinfo) {
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
  const localPeers = this.fileStore.get(fileHash) || [];
  const existsLocally = localPeers.some(p => p.addr === this.address && p.port === myPort);
  if (!existsLocally) {
    localPeers.push({ addr: this.address, port: myPort, announcedAt: Date.now() });
  }
  this.fileStore.set(fileHash, localPeers);

  const dhtKey = fileHashToDhtKey(fileHash);
  const closest = await this.iterativeFindNode(dhtKey);

  if (closest.length === 0) {
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
export * from './resume.js';
export * from './chunkServer.js';
export * from './seed.js';
```

### packages/engine/src/peer.js

```text
import net from 'net';
import { sendJSON, createFramer, parseMessage, MSG, TYPE } from './protocol.js';
import { generateKeyPair, exportPublicKey, deriveSharedKey, encrypt, decrypt } from './crypto.js';

export const PEER_TIMEOUT_MS = 30000;
export const HANDSHAKE_TIMEOUT_MS = 5000;
export const METADATA_TIMEOUT_MS = 10000;

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
    this._metadataWaiters = [];
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
        for (const { reject: rej } of this._metadataWaiters) {
          rej(new Error('Connection closed'));
        }
        this._metadataWaiters = [];
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

  waitForMetadata(timeoutMs = METADATA_TIMEOUT_MS) {
    if (this.metadata) return Promise.resolve(this.metadata);
    return new Promise((resolve, reject) => {
      const entry = { resolve: null, reject: null };
      const timeout = setTimeout(() => {
        const idx = this._metadataWaiters.indexOf(entry);
        if (idx !== -1) this._metadataWaiters.splice(idx, 1);
        reject(new Error('Timed out waiting for file metadata'));
      }, timeoutMs);
      entry.resolve = (data) => { clearTimeout(timeout); resolve(data); };
      entry.reject = (e) => { clearTimeout(timeout); reject(e); };
      this._metadataWaiters.push(entry);
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
      const waiters = this._metadataWaiters;
      this._metadataWaiters = [];
      for (const { resolve } of waiters) resolve(msg.data);
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

### packages/engine/src/resume.js

```text
import { readFile, writeFile, rename, unlink } from 'fs/promises';

export const RESUME_STATE_VERSION = 1;

export function stateFilePath(outputPath) {
  return `${outputPath}.meshstate`;
}

export async function loadResumeState(outputPath) {
  const statePath = stateFilePath(outputPath);
  try {
    const raw = await readFile(statePath, 'utf8');
    const state = JSON.parse(raw);
    if (state.version !== RESUME_STATE_VERSION) return null;
    return state;
  } catch {
    return null;
  }
}

export async function saveResumeState(outputPath, state) {
  const statePath = stateFilePath(outputPath);
  const tmpPath = `${statePath}.tmp`;
  const payload = JSON.stringify({ version: RESUME_STATE_VERSION, ...state });
  await writeFile(tmpPath, payload, 'utf8');
  await rename(tmpPath, statePath);
}

export async function deleteResumeState(outputPath) {
  const statePath = stateFilePath(outputPath);
  await unlink(statePath).catch(() => {});
}

export function resumeStateMatches(state, { fileHash, totalChunks, chunkSize, merkleRoot, fileSize }) {
  if (!state) return false;
  return (
    state.fileHash === fileHash &&
    state.totalChunks === totalChunks &&
    state.chunkSize === chunkSize &&
    state.merkleRoot === merkleRoot &&
    state.fileSize === fileSize
  );
}
```

### packages/engine/src/seed.js

```text
import { open } from 'fs/promises';
import { basename } from 'path';
import { indexFile } from './chunker.js';
import { createChunkServer } from './chunkServer.js';

export class SeedManager {
  constructor(dhtNode) {
    this.dhtNode = dhtNode;
    this.seeds = new Map();
  }

async seedFile(filePath, { fileName, chunkSize: chunkSizeOverride } = {}) {
    const { fileSize, hashes, tree, merkleRoot, totalChunks, chunkSize } = await indexFile(filePath, chunkSizeOverride);
    const existing = this.seeds.get(merkleRoot);
    if (existing) return existing;

    const fileHandle = await open(filePath, 'r');
    const server = createChunkServer({
      fileHandle, hashes, tree, merkleRoot,
      fileName: fileName || basename(filePath),
      fileSize, totalChunks, chunkSize,
    });

    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve(server.address().port);
      });
    });

    await this.dhtNode.announceFile(merkleRoot, port);

    const entry = { server, fileHandle, port, merkleRoot, filePath, totalChunks, fileSize, chunkSize };
    this.seeds.set(merkleRoot, entry);
    return entry;
  }

  async stopSeeding(merkleRoot) {
    const entry = this.seeds.get(merkleRoot);
    if (!entry) return;
    await new Promise((resolve) => entry.server.close(resolve));
    await entry.fileHandle.close().catch(() => {});
    this.seeds.delete(merkleRoot);
  }

  async stopAll() {
    for (const merkleRoot of [...this.seeds.keys()]) {
      await this.stopSeeding(merkleRoot);
    }
  }

  isSeeding(merkleRoot) {
    return this.seeds.has(merkleRoot);
  }

  getSeedingList() {
    return [...this.seeds.values()].map(({ merkleRoot, filePath, port, totalChunks, fileSize }) => ({
      merkleRoot, filePath, port, totalChunks, fileSize,
    }));
  }
}
```

### packages/engine/src/swarm.js

```text
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { verifyChunk } from './crypto.js';
import { computeSwarmPipelineDepth, DEFAULT_CHUNK_SIZE } from './chunker.js';

export const MAX_CONSECUTIVE_FAILURES = 5;

const CHUNK_STATE = {
  PENDING:   'pending',
  REQUESTED: 'requested',
  VERIFIED:  'verified',
};

const QUEUE_COMPACT_THRESHOLD = 1000;

export class SwarmManager extends EventEmitter {
  constructor(totalChunks, merkleRoot, chunkSize = DEFAULT_CHUNK_SIZE, alreadyVerified = []) {
    super();
    this.totalChunks   = totalChunks;
    this.merkleRoot    = merkleRoot;
    this.chunkSize     = chunkSize;
    this.pipelineSize  = computeSwarmPipelineDepth(chunkSize);
    this.chunkState    = new Array(totalChunks).fill(CHUNK_STATE.PENDING);
    this.chunkPeer     = new Array(totalChunks).fill(null);
    this.verifiedCount = 0;
    this.peers         = new Map();
    this.done          = false;
    this.aborted       = false;

    const verifiedSet = new Set(alreadyVerified);
    for (const idx of verifiedSet) {
      if (idx >= 0 && idx < totalChunks && this.chunkState[idx] !== CHUNK_STATE.VERIFIED) {
        this.chunkState[idx] = CHUNK_STATE.VERIFIED;
        this.verifiedCount++;
      }
    }

    this.pendingQueue = [];
    for (let i = 0; i < totalChunks; i++) {
      if (this.chunkState[i] !== CHUNK_STATE.VERIFIED) this.pendingQueue.push(i);
    }
    this.queueHead = 0;

    if (totalChunks > 0 && this.verifiedCount === totalChunks) {
      this.done = true;
    }
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
        this._requeueChunk(chunkIdx);
      }
    }

    this.peers.delete(peerId);
    this.emit('peerRemoved', peerId);

    for (const id of this.peers.keys()) {
      this._fillPipeline(id);
    }
  }

  abort() {
    this.aborted = true;
  }

  _markPeerFailed(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed) return;
    peer.failed = true;
    this.removePeer(peerId);
    this.emit('peerFailed', { peerId, reason: 'too_many_consecutive_failures' });
  }

  _requeueChunk(chunkIndex) {
    this.chunkState[chunkIndex] = CHUNK_STATE.PENDING;
    this.chunkPeer[chunkIndex] = null;
    this.pendingQueue.push(chunkIndex);
  }

  _compactQueue() {
    if (this.queueHead > QUEUE_COMPACT_THRESHOLD && this.queueHead > this.pendingQueue.length / 2) {
      this.pendingQueue = this.pendingQueue.slice(this.queueHead);
      this.queueHead = 0;
    }
  }

  _fillPipeline(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed || this.done || this.aborted) return;

    while (peer.pending.size < this.pipelineSize && this.queueHead < this.pendingQueue.length) {
      const i = this.pendingQueue[this.queueHead++];
      if (this.chunkState[i] !== CHUNK_STATE.PENDING) continue;

      this.chunkState[i] = CHUNK_STATE.REQUESTED;
      this.chunkPeer[i]  = peerId;
      peer.pending.add(i);

      peer.requestChunk(i).catch(() => {
        this._handleChunkFailure(peerId, i);
      });
    }

    this._compactQueue();
  }

  _handleChunkFailure(peerId, chunkIndex) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pending.delete(chunkIndex);
      peer.consecutiveFailures++;
    }

    if (this.chunkState[chunkIndex] === CHUNK_STATE.REQUESTED) {
      this._requeueChunk(chunkIndex);
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
      this._requeueChunk(chunkIndex);

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
      this._requeueChunk(chunkIndex);

      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }

    peer.consecutiveFailures = 0;
    this.chunkState[chunkIndex] = CHUNK_STATE.VERIFIED;
    this.verifiedCount++;
    peer.chunksServed++;

    this.emit('chunkVerified', {
      peerId, chunkIndex, chunkData,
      total: this.totalChunks,
      verified: this.verifiedCount,
    });

    if (this.verifiedCount === this.totalChunks) {
      this.done = true;
      this.emit('complete');
    } else {
      this._fillPipeline(peerId);
    }

    return true;
  }

  getVerifiedChunkIndices() {
    const out = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (this.chunkState[i] === CHUNK_STATE.VERIFIED) out.push(i);
    }
    return out;
  }

  getProgress() {
    return {
      verified: this.verifiedCount,
      total: this.totalChunks,
      percent: (this.verifiedCount / this.totalChunks) * 100,
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
}
```

### packages/engine/src/transfer.js

```text
import { open } from 'fs/promises';
import { DHTNode } from './dht.js';
import { SwarmManager } from './swarm.js';
import { PeerConnection } from './peer.js';
import { loadResumeState, saveResumeState, deleteResumeState, resumeStateMatches } from './resume.js';

export const TRANSFER_VERSION = '1.0.0';
export const MAX_CONCURRENT_CONNECTIONS = 30;
export const CHECKPOINT_INTERVAL_MS = 2000;

export async function downloadFile({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode, signal }) {
  if (totalChunks === 0) {
    const emptyHandle = await open(outputPath, 'w');
    await emptyHandle.close();
    return { outputPath, fileSize: 0, totalChunks: 0, status: 'complete' };
  }

  const existingState = await loadResumeState(outputPath);
  const canResume = resumeStateMatches(existingState, { fileHash, totalChunks, chunkSize, merkleRoot, fileSize });
  const alreadyVerified = canResume ? existingState.completedChunks : [];

  const swarm = new SwarmManager(totalChunks, merkleRoot, chunkSize, alreadyVerified);

  if (swarm.isComplete()) {
    await deleteResumeState(outputPath);
    return { outputPath, fileSize, totalChunks, status: 'complete' };
  }

  const peers = await dhtNode.getPeersForFile(fileHash);

  if (peers.length === 0) {
    throw new Error('No peers found for this file');
  }

  const peersToTry = peers.slice(0, MAX_CONCURRENT_CONNECTIONS);
  const connections = new Map();
  const connectionErrors = [];
  const fileHandle = await open(outputPath, canResume ? 'r+' : 'w');

  let checkpointTimer = null;
  const checkpoint = async () => {
    await saveResumeState(outputPath, {
      fileHash, fileSize, totalChunks, chunkSize, merkleRoot,
      completedChunks: swarm.getVerifiedChunkIndices(),
    }).catch(() => {});
  };
  const scheduleCheckpoint = () => {
    if (checkpointTimer) return;
    checkpointTimer = setTimeout(async () => {
      checkpointTimer = null;
      await checkpoint();
    }, CHECKPOINT_INTERVAL_MS);
  };

  try {
    if (!canResume) {
      await fileHandle.truncate(fileSize);
    }

    const connectionAttempts = await Promise.allSettled(
      peersToTry.map(async (peerInfo) => {
        const peerId = `${peerInfo.addr}:${peerInfo.port}`;
        try {
          const conn = new PeerConnection(peerInfo.addr, peerInfo.port);
          await conn.connect();
          return { peerId, conn };
        } catch (e) {
          return { peerId, error: e };
        }
      })
    );

    for (const result of connectionAttempts) {
      const { peerId, conn, error } = result.value;
      if (conn) {
        connections.set(peerId, conn);
        swarm.addPeer(peerId, async (chunkIndex) => {
          const chunkMsg = await conn.requestChunk(chunkIndex);
          const verified = swarm.onChunkReceived(
            peerId, chunkIndex, chunkMsg.chunkData, chunkMsg.chunkHash, chunkMsg.proof
          );
          if (verified) {
            await fileHandle.write(
              chunkMsg.chunkData, 0, chunkMsg.chunkData.length, chunkIndex * chunkSize
            );
            scheduleCheckpoint();
          }
        });
      } else {
        connectionErrors.push({ peerId, reason: error.message });
      }
    }

    if (connections.size === 0) {
      const detail = connectionErrors.map(e => `${e.peerId}: ${e.reason}`).join('; ');
      throw new Error(`Could not connect to any peer for this file. Tried ${peersToTry.length} of ${peers.length} discovered peer(s). ${detail}`);
    }

    if (connectionErrors.length > 0) {
      swarm.emit('connectionWarnings', connectionErrors);
    }

    let onAbort = null;

    await new Promise((resolve, reject) => {
      swarm.on('complete', resolve);
      swarm.on('peerFailed', () => {
        if (swarm.peers.size === 0 && !swarm.isComplete()) {
          reject(new Error('All peers failed'));
        }
      });
      if (signal) {
        onAbort = () => { swarm.abort(); resolve(); };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    if (signal && onAbort) signal.removeEventListener('abort', onAbort);

    if (signal && signal.aborted) {
      await checkpoint();
      return { outputPath, fileSize, totalChunks, status: 'paused', verifiedChunks: swarm.verifiedCount };
    }

    await deleteResumeState(outputPath);
    return { outputPath, fileSize, totalChunks, status: 'complete' };
  } catch (err) {
    await checkpoint();
    throw err;
  } finally {
    if (checkpointTimer) clearTimeout(checkpointTimer);
    for (const conn of connections.values()) conn.close();
    await fileHandle.close().catch(() => {});
  }
}

export async function downloadFileByHash({ fileHash, outputPath, dhtNode, signal }) {
  const peers = await dhtNode.getPeersForFile(fileHash);
  if (peers.length === 0) {
    throw new Error('No peers found for this file');
  }

  let manifest = null;
  const manifestErrors = [];

  for (const peerInfo of peers) {
    let conn = null;
    try {
      conn = new PeerConnection(peerInfo.addr, peerInfo.port);
      await conn.connect();
      manifest = await conn.waitForMetadata();
      conn.close();
      break;
    } catch (e) {
      manifestErrors.push(`${peerInfo.addr}:${peerInfo.port}: ${e.message}`);
      if (conn) conn.close();
    }
  }

  if (!manifest) {
    throw new Error(`Could not retrieve file metadata from any peer. ${manifestErrors.join('; ')}`);
  }

  const resolvedOutputPath = outputPath || manifest.fileName;

  return downloadFile({
    fileHash,
    fileSize: manifest.fileSize,
    totalChunks: manifest.totalChunks,
    chunkSize: manifest.chunkSize,
    merkleRoot: manifest.merkleRoot,
    outputPath: resolvedOutputPath,
    dhtNode,
    signal,
  });
}
export async function downloadAndSeed({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode, signal, seedManager }) {
  const result = await downloadFile({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode, signal });

  if (result.status === 'complete' && seedManager) {
    const seedEntry = await seedManager.seedFile(outputPath, { chunkSize });
    if (seedEntry.merkleRoot !== merkleRoot) {
      throw new Error(
        `Re-seed verification failed: recomputed root (${seedEntry.merkleRoot}) does not match expected root (${merkleRoot}). The downloaded file may not match what was requested.`
      );
    }
    return { ...result, seeding: true, seedPort: seedEntry.port };
  }

  return { ...result, seeding: false };
}
export async function startDownloadSession({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, bootstrapAddr, bootstrapPort, signal }) {
  const dhtNode = new DHTNode();
  await dhtNode.listen();

  if (bootstrapAddr && bootstrapPort) {
    await dhtNode.bootstrap(bootstrapAddr, bootstrapPort);
  }

  try {
    return await downloadFile({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode, signal });
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
import { chunkFile, assembleChunks, computeChunkSize, computeCacheSize, computeSwarmPipelineDepth, computeSimplePipelineDepth } from '../src/chunker.js';
import { sha256, buildMerkleTree, getMerkleProof, verifyChunk } from '../src/crypto.js';

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
it('computeChunkSize keeps small files at the default chunk size', () => {
    assert.equal(computeChunkSize(1024), 65536);
    assert.equal(computeChunkSize(500 * 1024 * 1024), 65536);
    assert.equal(computeChunkSize(3 * 1024 * 1024 * 1024), 65536);
  });

  it('computeChunkSize scales up for large files and stays under the protocol message ceiling', () => {
    const size100GB = 100 * 1024 * 1024 * 1024;
    const size1TB = 1024 * 1024 * 1024 * 1024;

    const chunk100GB = computeChunkSize(size100GB);
    const chunk1TB = computeChunkSize(size1TB);

    assert.ok(chunk100GB > 65536);
    assert.ok(chunk1TB >= chunk100GB);
    assert.ok(chunk1TB <= 32 * 1024 * 1024);

    const totalChunks100GB = Math.ceil(size100GB / chunk100GB);
    const totalChunks1TB = Math.ceil(size1TB / chunk1TB);

    assert.ok(totalChunks100GB < 100000);
    assert.ok(totalChunks1TB < 100000);
  });

  it('computeChunkSize never exceeds MAX_CHUNK_SIZE even for extreme file sizes', () => {
    const size10TB = 10 * 1024 * 1024 * 1024 * 1024;
    assert.equal(computeChunkSize(size10TB), 32 * 1024 * 1024);
  });

  it('computeCacheSize and pipeline depth shrink as chunk size grows', () => {
    const smallChunkCache = computeCacheSize(65536);
    const largeChunkCache = computeCacheSize(32 * 1024 * 1024);
    assert.ok(largeChunkCache < smallChunkCache);
    assert.ok(largeChunkCache >= 8);

    const smallChunkSwarmDepth = computeSwarmPipelineDepth(65536);
    const largeChunkSwarmDepth = computeSwarmPipelineDepth(32 * 1024 * 1024);
    assert.equal(smallChunkSwarmDepth, 16);
    assert.ok(largeChunkSwarmDepth < smallChunkSwarmDepth);
    assert.ok(largeChunkSwarmDepth >= 4);

    const smallChunkSimpleDepth = computeSimplePipelineDepth(65536);
    assert.equal(smallChunkSimpleDepth, 32);
  });

  it('indexFile picks the adaptive chunk size automatically when none is given', async () => {
    const filePath = await makeTempFile(200 * 1024);
    const { indexFile } = await import('../src/chunker.js');
    const result = await indexFile(filePath);
    assert.equal(result.chunkSize, 65536);
    await unlink(filePath);
  });

  it('readChunk reads the correct byte range using a persistent file handle', async () => {
    const filePath = await makeTempFile(200 * 1024);
    const { readChunk } = await import('../src/chunker.js');
    const { open } = await import('fs/promises');
    const handle = await open(filePath, 'r');
    const chunk0 = await readChunk(handle, 0, 65536);
    const chunk1 = await readChunk(handle, 1, 65536);
    assert.equal(chunk0.length, 65536);
    assert.equal(chunk1.length, 65536);
    assert.notDeepEqual(chunk0, chunk1);
    await handle.close();
    await unlink(filePath);
  });
it('merkle root changes when any chunk is modified', () => {
    const hashes = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32), 'dd'.repeat(32)];
    const root1 = buildMerkleTree([...hashes]).root;
    const tampered = [...hashes];
    tampered[2] = 'ee'.repeat(32);
    const root2 = buildMerkleTree(tampered).root;
    assert.notEqual(root1, root2);
  });
it('handles a 0-byte file without crashing', async () => {
    const filePath = join(tmpdir(), `mesh-empty-${Date.now()}.bin`);
    await import('fs/promises').then(fs => fs.writeFile(filePath, Buffer.alloc(0)));
    const { totalChunks, fileSize, merkleRoot } = await import('../src/chunker.js').then(m => m.indexFile(filePath));
    assert.equal(totalChunks, 0);
    assert.equal(fileSize, 0);
    assert.equal(typeof merkleRoot, 'string');
    await unlink(filePath);
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

### packages/engine/test/chunkServer.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { open } from 'fs/promises';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { PeerConnection } from '../src/peer.js';
import { createChunkServer } from '../src/chunkServer.js';
import { indexFile } from '../src/chunker.js';

async function makeTempFile(size) {
  const filePath = join(tmpdir(), `mesh-cs-${Date.now()}.bin`);
  await writeFile(filePath, randomBytes(size));
  return filePath;
}

describe('chunk server', () => {
  it('serves a correct encrypted chunk with valid proof to a connecting peer', async () => {
    const filePath = await makeTempFile(50 * 1024);
    const { fileSize, hashes, tree, merkleRoot, totalChunks, chunkSize } = await indexFile(filePath);
    const fileHandle = await open(filePath, 'r');

    const server = createChunkServer({
      fileHandle, hashes, tree, merkleRoot,
      fileName: 'test.bin', fileSize, totalChunks, chunkSize,
    });

    const port = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });

    const conn = new PeerConnection('127.0.0.1', port);
    await conn.connect();
    assert.ok(conn.metadata);
    assert.equal(conn.metadata.merkleRoot, merkleRoot);

    const chunkMsg = await conn.requestChunk(0);
    assert.equal(chunkMsg.chunkHash, hashes[0]);

    conn.close();
    await new Promise((resolve) => server.close(resolve));
    await fileHandle.close();
    await unlink(filePath);
  });

  it('serves multiple concurrent peers to completion without shutting down after the first', async () => {
    const filePath = await makeTempFile(30 * 1024);
    const { fileSize, hashes, tree, merkleRoot, totalChunks, chunkSize } = await indexFile(filePath);
    const fileHandle = await open(filePath, 'r');

    const server = createChunkServer({
      fileHandle, hashes, tree, merkleRoot,
      fileName: 'test.bin', fileSize, totalChunks, chunkSize,
    });

    const port = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });

    const connA = new PeerConnection('127.0.0.1', port);
    const connB = new PeerConnection('127.0.0.1', port);
    await connA.connect();
    await connB.connect();

    const chunkA = await connA.requestChunk(0);
    assert.equal(chunkA.chunkHash, hashes[0]);

    const chunkB = await connB.requestChunk(0);
    assert.equal(chunkB.chunkHash, hashes[0]);

    assert.equal(server.listening, true);

    connA.close();
    connB.close();
    await new Promise((resolve) => server.close(resolve));
    await fileHandle.close();
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
it('an announcing node remains discoverable directly even after the peer it replicated to goes offline', async () => {
    const seeder = new DHTNode();
    const relay = new DHTNode();
    const finder = new DHTNode();
    await seeder.listen();
    await relay.listen();
    await finder.listen();

    seeder.routingTable.addPeer({ id: relay.nodeId, addr: '127.0.0.1', port: relay.port });
    finder.routingTable.addPeer({ id: seeder.nodeId, addr: '127.0.0.1', port: seeder.port });

    const fileHash = sha256(Buffer.from('offline relay test'));
    await seeder.announceFile(fileHash, 6100);

    await relay.close();

    const peers = await finder.getPeersForFile(fileHash);
    assert.ok(peers.some(p => p.port === 6100));

    await seeder.close();
    await finder.close();
  }, { timeout: 10000 });
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
it('survives a valid-JSON packet with a malformed nodeId without crashing', async () => {
    const nodeA = new DHTNode();
    await nodeA.listen();

    const dgram = await import('dgram');
    const sender = dgram.default.createSocket('udp4');
    const badPacket = Buffer.from(JSON.stringify({
      type: 'DHT_PING', msgId: 'aaaa', nodeId: 'not-a-valid-hex-id',
    }));
    sender.send(badPacket, nodeA.port, '127.0.0.1');

    await new Promise(r => setTimeout(r, 100));

    const stillAlive = await nodeA.ping('127.0.0.1', nodeA.port).catch(() => 'survived');
    assert.ok(stillAlive);

    sender.close();
    await nodeA.close();
  });

  it('survives a FIND_NODE with a malformed targetId without crashing', async () => {
    const nodeA = new DHTNode();
    const nodeB = new DHTNode();
    await nodeA.listen();
    await nodeB.listen();

    const dgram = await import('dgram');
    const sender = dgram.default.createSocket('udp4');
    const badPacket = Buffer.from(JSON.stringify({
      type: 'DHT_FIND_NODE', msgId: 'bbbb', nodeId: nodeB.nodeId, targetId: 'short',
    }));
    sender.send(badPacket, nodeA.port, '127.0.0.1');

    await new Promise(r => setTimeout(r, 100));

    const stillAlive = await nodeA.ping('127.0.0.1', nodeA.port).catch(() => 'survived');
    assert.ok(stillAlive);

    sender.close();
    await nodeA.close();
    await nodeB.close();
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
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DHTNode } from '../src/dht.js';
import { buildMerkleTree, getMerkleProof, sha256, generateKeyPair, exportPublicKey, deriveSharedKey, encrypt } from '../src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from '../src/protocol.js';
import { downloadFile, downloadFileByHash, downloadAndSeed, MAX_CONCURRENT_CONNECTIONS } from '../src/transfer.js';
import { SeedManager } from '../src/seed.js';

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

      sendJSON(socket, {
        type: MSG.FILE_OFFER,
        fileName: 'testfile.bin',
        fileSize,
        totalChunks: chunks.length,
        chunkSize: chunks.length > 0 ? chunks[0].length : 0,
        merkleRoot,
      });
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
function startThrottledTestSeeder(chunks, hashes, tree, delayPerChunkMs, port) {
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
          setTimeout(() => {
            const proof = getMerkleProof(tree, index);
            const encrypted = encrypt(chunks[index], sharedKey);
            sendChunk(socket, index, hashes[index], proof, encrypted);
          }, delayPerChunkMs);
        }
      });

      socket.on('data', framer);

      sendJSON(socket, {
        type: MSG.FILE_OFFER,
        fileName: 'testfile.bin',
        fileSize: chunks.length * chunks[0].length,
        totalChunks: chunks.length,
        chunkSize: chunks[0].length,
        merkleRoot: tree.root,
      });
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
  it('downloadFileByHash discovers file metadata automatically via a peer and completes the transfer', async () => {
    const numChunks = 8;
    const chunkSize = 1024;
    const chunks = [];
    const hashes = [];
    for (let i = 0; i < numChunks; i++) {
      const chunk = randomBytes(chunkSize);
      chunks.push(chunk);
      hashes.push(sha256(chunk));
    }
    const tree = buildMerkleTree(hashes);
    const fileHash = tree.root;

    const seederNode = new DHTNode();
    const downloaderNode = new DHTNode();
    await seederNode.listen();
    await downloaderNode.listen();

    downloaderNode.routingTable.addPeer({
      id: seederNode.nodeId, addr: '127.0.0.1', port: seederNode.port,
    });

    const tcpPort = 18900 + Math.floor(Math.random() * 500);
    const fileSize = numChunks * chunkSize;
    const server = await startTestSeeder(chunks, hashes, tree, tree.root, fileSize, tcpPort);

    await seederNode.announceFile(fileHash, tcpPort);

    const outputPath = join(tmpdir(), `mesh-byhash-${Date.now()}.bin`);

    const result = await downloadFileByHash({ fileHash, outputPath, dhtNode: downloaderNode });

    assert.equal(result.status, 'complete');
    const resultBuf = await readFile(outputPath);
    assert.deepEqual(resultBuf, Buffer.concat(chunks));

    await unlink(outputPath);
    server.close();
    await seederNode.close();
    await downloaderNode.close();
  });

  it('pauses a transfer via signal, then resumes it and completes without re-downloading finished chunks', async () => {
    const numChunks = 40;
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

    const tcpPort = 19100 + Math.floor(Math.random() * 500);
    const fileSize = numChunks * chunkSize;
    const server = await startThrottledTestSeeder(chunks, hashes, tree, 20, tcpPort);
    await seederNode.announceFile(fileHash, tcpPort);

    const outputPath = join(tmpdir(), `mesh-pause-${Date.now()}.bin`);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);

    const firstResult = await downloadFile({
      fileHash, fileSize, totalChunks: numChunks, chunkSize,
      merkleRoot: tree.root, outputPath, dhtNode: downloaderNode,
      signal: controller.signal,
    });

    assert.equal(firstResult.status, 'paused');
    assert.ok(firstResult.verifiedChunks < numChunks);

    const secondResult = await downloadFile({
      fileHash, fileSize, totalChunks: numChunks, chunkSize,
      merkleRoot: tree.root, outputPath, dhtNode: downloaderNode,
    });

    assert.equal(secondResult.status, 'complete');
    const resultBuf = await readFile(outputPath);
    assert.deepEqual(resultBuf, Buffer.concat(chunks));

    await unlink(outputPath);
    server.close();
    await seederNode.close();
    await downloaderNode.close();
  });
it('a downloader becomes a seeder and a second downloader can chain-download from it', { timeout: 20000 }, async () => {
    const numChunks = 12;
    const chunkSize = 1024;
    const chunks = [];
    const hashes = [];
    for (let i = 0; i < numChunks; i++) {
      const chunk = randomBytes(chunkSize);
      chunks.push(chunk);
      hashes.push(sha256(chunk));
    }
    const tree = buildMerkleTree(hashes);
    const fileHash = tree.root;
    const fileSize = numChunks * chunkSize;

    const originalSeederNode = new DHTNode();
    const relaySeederDownloaderNode = new DHTNode();
    const finalDownloaderNode = new DHTNode();
    await originalSeederNode.listen();
    await relaySeederDownloaderNode.listen();
    await finalDownloaderNode.listen();

    relaySeederDownloaderNode.routingTable.addPeer({
      id: originalSeederNode.nodeId, addr: '127.0.0.1', port: originalSeederNode.port,
    });
    finalDownloaderNode.routingTable.addPeer({
      id: relaySeederDownloaderNode.nodeId, addr: '127.0.0.1', port: relaySeederDownloaderNode.port,
    });

    const originalTcpPort = 19300 + Math.floor(Math.random() * 500);
    const server = await startTestSeeder(chunks, hashes, tree, tree.root, fileSize, originalTcpPort);
    await originalSeederNode.announceFile(fileHash, originalTcpPort);

    const relayOutputPath = join(tmpdir(), `mesh-relay-${Date.now()}.bin`);
    const relaySeedManager = new SeedManager(relaySeederDownloaderNode);

    const relayResult = await downloadAndSeed({
      fileHash, fileSize, totalChunks: numChunks, chunkSize,
      merkleRoot: tree.root, outputPath: relayOutputPath,
      dhtNode: relaySeederDownloaderNode, seedManager: relaySeedManager,
    });

    assert.equal(relayResult.status, 'complete');
    assert.equal(relayResult.seeding, true);

    server.close();
    await originalSeederNode.close();

    const finalOutputPath = join(tmpdir(), `mesh-final-${Date.now()}.bin`);
    const finalResult = await downloadFile({
      fileHash, fileSize, totalChunks: numChunks, chunkSize,
      merkleRoot: tree.root, outputPath: finalOutputPath,
      dhtNode: finalDownloaderNode,
    });

    assert.equal(finalResult.status, 'complete');
    const finalBuf = await readFile(finalOutputPath);
    assert.deepEqual(finalBuf, Buffer.concat(chunks));

    await unlink(relayOutputPath);
    await unlink(finalOutputPath);
    await relaySeedManager.stopAll();
    await relaySeederDownloaderNode.close();
    await finalDownloaderNode.close();
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

### packages/engine/test/resume.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { saveResumeState, loadResumeState, deleteResumeState, resumeStateMatches } from '../src/resume.js';

describe('resume state', () => {
  it('returns null when no state file exists', async () => {
    const outputPath = join(tmpdir(), `mesh-resume-none-${Date.now()}.bin`);
    const state = await loadResumeState(outputPath);
    assert.equal(state, null);
  });

  it('saves and loads a state file round trip', async () => {
    const outputPath = join(tmpdir(), `mesh-resume-${Date.now()}.bin`);
    const original = {
      fileHash: 'a'.repeat(64),
      fileSize: 1024,
      totalChunks: 10,
      chunkSize: 64,
      merkleRoot: 'a'.repeat(64),
      completedChunks: [0, 1, 2, 5],
    };
    await saveResumeState(outputPath, original);
    const loaded = await loadResumeState(outputPath);
    assert.equal(loaded.fileHash, original.fileHash);
    assert.deepEqual(loaded.completedChunks, original.completedChunks);
    await deleteResumeState(outputPath);
  });

  it('deleteResumeState removes the file and is safe to call when absent', async () => {
    const outputPath = join(tmpdir(), `mesh-resume-del-${Date.now()}.bin`);
    await saveResumeState(outputPath, {
      fileHash: 'b'.repeat(64), fileSize: 1, totalChunks: 1, chunkSize: 1,
      merkleRoot: 'b'.repeat(64), completedChunks: [],
    });
    await deleteResumeState(outputPath);
    const loaded = await loadResumeState(outputPath);
    assert.equal(loaded, null);
    await deleteResumeState(outputPath);
  });

  it('resumeStateMatches validates matching and mismatched state correctly', () => {
    const state = {
      fileHash: 'c'.repeat(64), fileSize: 1024, totalChunks: 10,
      chunkSize: 64, merkleRoot: 'c'.repeat(64), completedChunks: [0],
    };
    assert.equal(resumeStateMatches(state, {
      fileHash: 'c'.repeat(64), fileSize: 1024, totalChunks: 10, chunkSize: 64, merkleRoot: 'c'.repeat(64),
    }), true);
    assert.equal(resumeStateMatches(state, {
      fileHash: 'c'.repeat(64), fileSize: 999, totalChunks: 10, chunkSize: 64, merkleRoot: 'c'.repeat(64),
    }), false);
    assert.equal(resumeStateMatches(null, {
      fileHash: 'c'.repeat(64), fileSize: 1024, totalChunks: 10, chunkSize: 64, merkleRoot: 'c'.repeat(64),
    }), false);
  });
});
```

### packages/engine/test/seed.test.js

```text
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { DHTNode } from '../src/dht.js';
import { SeedManager } from '../src/seed.js';
import { indexFile } from '../src/chunker.js';
import { downloadFile } from '../src/transfer.js';

async function makeTempFile(size) {
  const filePath = join(tmpdir(), `mesh-seed-${Date.now()}.bin`);
  await writeFile(filePath, randomBytes(size));
  return filePath;
}

describe('seed manager', () => {
  it('seeds a file, announces it to the DHT, and a downloader can retrieve it', async () => {
    const filePath = await makeTempFile(40 * 1024);
    const { merkleRoot, totalChunks, chunkSize, fileSize } = await indexFile(filePath);

    const seederDht = new DHTNode();
    const downloaderDht = new DHTNode();
    await seederDht.listen();
    await downloaderDht.listen();

    downloaderDht.routingTable.addPeer({
      id: seederDht.nodeId, addr: '127.0.0.1', port: seederDht.port,
    });

    const seedManager = new SeedManager(seederDht);
    const seedEntry = await seedManager.seedFile(filePath);

    assert.equal(seedManager.isSeeding(merkleRoot), true);
    assert.equal(seedManager.getSeedingList().length, 1);

    const outputPath = join(tmpdir(), `mesh-seed-out-${Date.now()}.bin`);
    await downloadFile({
      fileHash: merkleRoot, fileSize, totalChunks, chunkSize,
      merkleRoot, outputPath, dhtNode: downloaderDht,
    });

    const original = await readFile(filePath);
    const downloaded = await readFile(outputPath);
    assert.deepEqual(downloaded, original);

    await unlink(outputPath);
    await unlink(filePath);
    await seedManager.stopAll();
    await seederDht.close();
    await downloaderDht.close();
  });

  it('stopSeeding closes the server so new connections fail', async () => {
    const filePath = await makeTempFile(20 * 1024);
    const { merkleRoot } = await indexFile(filePath);

    const dhtNode = new DHTNode();
    await dhtNode.listen();

    const seedManager = new SeedManager(dhtNode);
    const seedEntry = await seedManager.seedFile(filePath);
    const port = seedEntry.port;

    await seedManager.stopSeeding(merkleRoot);
    assert.equal(seedManager.isSeeding(merkleRoot), false);

    const net = await import('net');
    await assert.rejects(() => new Promise((resolve, reject) => {
      const socket = net.default.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', resolve);
      socket.once('error', reject);
    }));

    await unlink(filePath);
    await dhtNode.close();
  });

  it('calling seedFile twice for the same file reuses the existing seed entry', async () => {
    const filePath = await makeTempFile(15 * 1024);
    const dhtNode = new DHTNode();
    await dhtNode.listen();

    const seedManager = new SeedManager(dhtNode);
    const first = await seedManager.seedFile(filePath);
    const second = await seedManager.seedFile(filePath);

    assert.equal(first.port, second.port);
    assert.equal(seedManager.getSeedingList().length, 1);

    await unlink(filePath);
    await seedManager.stopAll();
    await dhtNode.close();
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
import { assembleChunks } from '../src/chunker.js';

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

    const collected = new Map();
    swarm.on('chunkVerified', ({ chunkIndex, chunkData }) => {
      collected.set(chunkIndex, chunkData);
    });

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const assembled = assembleChunks(collected, 5);
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

    assert.ok(maxPending <= swarm.pipelineSize);
  });

  it('scales pipeline depth down for large chunk sizes', async () => {
    const { merkleRoot } = buildTestFile(100);
    const largeChunkSwarm = new SwarmManager(100, merkleRoot, 32 * 1024 * 1024);

    assert.ok(largeChunkSwarm.pipelineSize < 16);
    assert.ok(largeChunkSwarm.pipelineSize >= 4);
  });
it('resumes with pre-verified chunks skipped and not re-requested', async () => {
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(10);
    const requested = [];
    const swarm = new SwarmManager(10, merkleRoot, 1024, [0, 1, 2]);

    assert.equal(swarm.getProgress().verified, 3);

    swarm.addPeer('peerA', (idx) => {
      requested.push(idx);
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    assert.equal(swarm.isComplete(), true);
    assert.ok(!requested.includes(0));
    assert.ok(!requested.includes(1));
    assert.ok(!requested.includes(2));
    assert.equal(requested.length, 7);
  });

  it('reports already complete immediately when all chunks are pre-verified', () => {
    const { merkleRoot } = buildTestFile(5);
    const swarm = new SwarmManager(5, merkleRoot, 1024, [0, 1, 2, 3, 4]);
    assert.equal(swarm.isComplete(), true);
    assert.equal(swarm.getProgress().verified, 5);
  });

  it('getVerifiedChunkIndices returns exactly the verified set', async () => {
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

    const verified = swarm.getVerifiedChunkIndices();
    assert.deepEqual(verified.sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  it('abort() stops issuing new chunk requests but keeps prior state', async () => {
    const { merkleRoot } = buildTestFile(50);
    const swarm = new SwarmManager(50, merkleRoot);

    let requestCount = 0;
    swarm.addPeer('peerA', () => {
      requestCount++;
      return new Promise(() => {});
    });

    const countAfterStart = requestCount;
    swarm.abort();
    swarm.addPeer('peerB', () => {
      requestCount++;
      return new Promise(() => {});
    });

    assert.equal(requestCount, countAfterStart);
  });

  it('compacts pendingQueue after heavy retries instead of growing unboundedly', async () => {
    const { merkleRoot } = buildTestFile(2000, 16);
    const swarm = new SwarmManager(2000, merkleRoot, 16);

    let calls = 0;
    swarm.addPeer('flakyPeer', () => {
      calls++;
      if (calls < 5000) {
        return Promise.reject(new Error('simulated failure'));
      }
      return new Promise(() => {});
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.ok(swarm.pendingQueue.length < 20000, `pendingQueue grew to ${swarm.pendingQueue.length}, compaction likely not working`);
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

  it('peers.size reflects the failed peer being removed by the time peerFailed fires', async () => {
    const { merkleRoot } = buildTestFile(10);
    const swarm = new SwarmManager(10, merkleRoot);

    swarm.addPeer('onlyPeer', () => Promise.reject(new Error('always fails')));

    const result = await new Promise((resolve) => {
      swarm.on('complete', () => resolve('complete'));
      swarm.on('peerFailed', () => {
        if (swarm.peers.size === 0 && !swarm.isComplete()) {
          resolve('all_failed_detected');
        } else {
          resolve(`race_bug_size_${swarm.peers.size}`);
        }
      });
    });

    assert.equal(result, 'all_failed_detected');
  });

  it('handles a large number of chunks efficiently without O(n^2) blowup', { timeout: 20000 }, async () => {
    const numChunks = 50000;
    const { chunks, hashes, tree, merkleRoot } = buildTestFile(numChunks, 16);
    const swarm = new SwarmManager(numChunks, merkleRoot);

    const start = Date.now();

    swarm.addPeer('peerA', (idx) => {
      setImmediate(() => {
        const proof = getMerkleProof(tree, idx);
        swarm.onChunkReceived('peerA', idx, chunks[idx], hashes[idx], proof);
      });
      return Promise.resolve();
    });

    await new Promise(resolve => swarm.on('complete', resolve));

    const elapsedMs = Date.now() - start;
    assert.equal(swarm.isComplete(), true);
    assert.ok(
      elapsedMs < 10000,
      `expected the pipeline to fill in under 10s, took ${elapsedMs}ms — possible O(n^2) regression in _fillPipeline`
    );
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
it('handles a 0-byte file end to end without hanging', async () => {
    const { indexFile } = await import('../src/chunker.js');
    const { downloadFile } = await import('../src/transfer.js');
    const filePath = join(tmpdir(), `mesh-empty-src-${Date.now()}.bin`);
    await writeFile(filePath, Buffer.alloc(0));

    const meta = await indexFile(filePath);
    const outputPath = join(tmpdir(), `mesh-empty-out-${Date.now()}.bin`);
    const fakeDht = { getPeersForFile: async () => [] };

    const result = await downloadFile({
      fileHash: 'x'.repeat(64),
      fileSize: meta.fileSize,
      totalChunks: meta.totalChunks,
      chunkSize: meta.chunkSize,
      merkleRoot: meta.merkleRoot,
      outputPath,
      dhtNode: fakeDht,
    });

    assert.equal(result.totalChunks, 0);
    const written = await readFile(outputPath);
    assert.equal(written.length, 0);

    await unlink(filePath);
    await unlink(outputPath);
  });
  it('transfers a 100MB file correctly with hash match', { timeout: 60000 }, async () => {
    const match = await runTransferTest(100 * 1024 * 1024, 19002);
    assert.equal(match, true);
  });
});
```

### packages/signaling/Dockerfile

```text
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 8080

CMD ["node", "src/server.js"]
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
export const metrics = {
  totalRoomsCreated: 0,
  totalPeersJoined: 0,
  activeRooms: 0,
  activePeers: 0,
};

export function recordRoomCreated() {
  metrics.totalRoomsCreated++;
  metrics.activeRooms++;
}

export function recordRoomExpiredOrClosed() {
  metrics.activeRooms = Math.max(0, metrics.activeRooms - 1);
}

export function recordPeerJoined() {
  metrics.totalPeersJoined++;
  metrics.activePeers++;
}

export function recordPeerLeft() {
  metrics.activePeers = Math.max(0, metrics.activePeers - 1);
}
```

### packages/signaling/src/server.js

```text
import { WebSocketServer } from 'ws';
import { randomBytes, createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { recordRoomCreated, recordRoomExpiredOrClosed, recordPeerJoined, recordPeerLeft } from './metrics.js';

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
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port });

      this.wss.once('error', reject);

      this.wss.once('listening', () => {
        this.wss.removeListener('error', reject);

        this.wss.on('error', (err) => {
          this.emit ? this.emit('error', err) : console.error('Signaling server error:', err.message);
        });

        this.wss.on('connection', (ws, req) => {
          ws._ip = req.socket.remoteAddress || '127.0.0.1';
          this._handleConnection(ws);
        });

        this._expiryTimer = setInterval(() => {
          this._expireRooms();
          this._pruneRateLimits();
        }, 60 * 1000);

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

  _pruneRateLimits() {
    const now = Date.now();
    for (const [key, list] of this.rateLimits) {
      const recent = list.filter(t => now - t < RATE_WINDOW_MS);
      if (recent.length === 0) {
        this.rateLimits.delete(key);
      } else {
        this.rateLimits.set(key, recent);
      }
    }
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
        recordRoomExpiredOrClosed();
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
    recordRoomCreated();
    recordPeerJoined();
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
    recordPeerJoined();

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
    recordPeerLeft();

    for (const peerWs of room.peers.values()) {
      this._send(peerWs, { type: MSG_TYPE.PEER_LEFT, peerId: ws.peerId });
    }

    if (room.peers.size === 0) {
      this.rooms.delete(ws.roomCode);
      recordRoomExpiredOrClosed();
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
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
  it('metrics track room and peer activity', async () => {
    const { metrics } = await import('../src/metrics.js');
    const startRooms = metrics.totalRoomsCreated;

    const server = new SignalingServer();
    const addr = await server.listen(0);

    const ws1 = await connect(addr.port);
    send(ws1, { type: MSG_TYPE.CREATE_ROOM });
    await nextMessage(ws1);

    assert.equal(metrics.totalRoomsCreated, startRooms + 1);
    assert.equal(metrics.activeRooms >= 1, true);

    ws1.close();
    await server.close();
  });
it('listen rejects cleanly when the port is already in use', async () => {
    const serverA = new SignalingServer();
    const addr = await serverA.listen(0);

    const serverB = new SignalingServer();
    await assert.rejects(() => serverB.listen(addr.port));

    await serverA.close();
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
    "@tailwindcss/vite": "^4.3.2",
    "d3": "^7.9.0",
    "framer-motion": "^12.42.0",
    "jsqr": "^1.4.0",
    "qrcode.react": "^4.2.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-dropzone": "^15.0.0",
    "react-router-dom": "^7.18.1",
    "recharts": "^3.9.0",
    "tailwindcss": "^4.3.2",
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

### packages/web/src/App.jsx

```text
import { Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Layout from './components/layout/Layout.jsx'
import Landing from './pages/Landing.jsx'
import Send from './pages/Send.jsx'
import Receive from './pages/Receive.jsx'
import Dashboard from './pages/Dashboard.jsx'
import History from './pages/History.jsx'
import NotFound from './pages/NotFound.jsx'
import { useUIStore } from './store/useUIStore.js'

function AnimatedPage({ children }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.div>
  )
}

function App() {
  const initTheme = useUIStore((s) => s.initTheme)
  const location = useLocation()

  useEffect(() => { initTheme() }, [initTheme])

  return (
    <Layout>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<AnimatedPage><Landing /></AnimatedPage>} />
          <Route path="/send" element={<AnimatedPage><Send /></AnimatedPage>} />
          <Route path="/receive" element={<AnimatedPage><Receive /></AnimatedPage>} />
          <Route path="/dashboard" element={<AnimatedPage><Dashboard /></AnimatedPage>} />
          <Route path="/history" element={<AnimatedPage><History /></AnimatedPage>} />
          <Route path="*" element={<AnimatedPage><NotFound /></AnimatedPage>} />
        </Routes>
      </AnimatePresence>
    </Layout>
  )
}

export default App
```

### packages/web/src/components/ChunkGrid.jsx

```text
import { useMemo, useRef, useEffect } from 'react'

const CHUNK_COLORS = {
  pending: 'bg-[var(--surface-hover)]',
  requested: 'bg-[var(--accent)]/40',
  verified: 'bg-[var(--success)]',
  failed: 'bg-[var(--error)]',
}

export default function ChunkGrid({ chunkStates = [], transferStatus }) {
  const scrollRef = useRef(null)
  const atBottomRef = useRef(true)

  const { displayStates, cols, completePercent } = useMemo(() => {
    const total = chunkStates.length
    if (total === 0) return { displayStates: [], cols: 0, completePercent: 0 }

    let compressed = chunkStates
    if (total > 1000) {
      const ratio = total / 1000
      compressed = []
      for (let i = 0; i < 1000; i++) {
        compressed.push(chunkStates[Math.floor(i * ratio)])
      }
    }

    const sqrt = Math.ceil(Math.sqrt(compressed.length))
    const verified = chunkStates.filter((s) => s === 'verified').length
    const percent = total > 0 ? Math.round((verified / total) * 100) : 0

    return { displayStates: compressed, cols: Math.min(sqrt, 50), completePercent: percent }
  }, [chunkStates])

  useEffect(() => {
    if (scrollRef.current && atBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [completePercent])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handleScroll = () => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  if (chunkStates.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="py-8 text-center text-sm text-[var(--txt-secondary)]">No chunk data</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-widest text-[var(--txt-secondary)]">
          Chunks
        </span>
        <span className="text-sm font-medium text-[var(--accent)]">
          {completePercent}% COMPLETE
        </span>
      </div>
      <div ref={scrollRef} className="max-h-[200px] overflow-y-auto">
        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {displayStates.map((state, i) => (
            <div
              key={i}
              className={`aspect-square rounded-sm ${CHUNK_COLORS[state] || CHUNK_COLORS.pending}`}
              title={`Chunk ${i}: ${state}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
```

### packages/web/src/components/ConnectionCode.jsx

```text
import { useState, useRef, useEffect } from 'react'
import jsQR from 'jsqr'
import Button from './shared/Button.jsx'

export default function ConnectionCode({ onJoin, joining = false, defaultValue = '' }) {
  const [code, setCode] = useState(defaultValue)
  const [scanning, setScanning] = useState(false)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const animRef = useRef(null)

  useEffect(() => {
    return () => stopCamera()
  }, [])

  function stopCamera() {
    cancelAnimationFrame(animRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setScanning(false)
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setScanning(true)

      if (!videoRef.current) { stopCamera(); return }
      videoRef.current.srcObject = stream
      await new Promise((resolve, reject) => {
        const v = videoRef.current
        if (!v) { resolve(); return }
        v.onloadedmetadata = resolve
        v.onerror = reject
        setTimeout(resolve, 3000)
      })

      if (!videoRef.current) { stopCamera(); return }
      try { await videoRef.current.play() } catch { stopCamera(); return }
      scanFrame()
    } catch {
      setScanning(false)
    }
  }

  function scanFrame() {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) { stopCamera(); return }

    ctx.drawImage(video, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const result = jsQR(imageData.data, imageData.width, imageData.height)

    if (result) {
      const match = result.data.match(/[?&]code=([A-Z0-9-]{6,9})/)
      if (match) {
        setCode(match[1])
        stopCamera()
        return
      }
    }

    animRef.current = requestAnimationFrame(scanFrame)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const cleaned = code.trim().toUpperCase()
    if (cleaned.length >= 6) onJoin(cleaned)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="relative">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9))}
          placeholder="e.g. WOLF-4821"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-lg tracking-widest text-[var(--txt-primary)] placeholder:text-[var(--txt-secondary)] outline-none transition-colors focus:border-[var(--accent)]/50"
          maxLength={9}
        />
        <button
          type="button"
          onClick={scanning ? stopCamera : startCamera}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-[var(--txt-secondary)] transition-colors hover:text-[var(--accent)]"
          title={scanning ? 'Close scanner' : 'Scan QR code'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <rect x="7" y="7" width="5" height="5" rx="0.5" />
            <rect x="12" y="12" width="5" height="5" rx="0.5" />
            <line x1="7" y1="12" x2="7" y2="12" />
            <line x1="17" y1="12" x2="17" y2="12" />
            <line x1="12" y1="7" x2="12" y2="7" />
            <line x1="12" y1="17" x2="12" y2="17" />
          </svg>
        </button>
      </div>

      {scanning && (
        <div className="relative overflow-hidden rounded-lg border border-[var(--accent)]/30 bg-black">
          <video ref={videoRef} className="h-48 w-full object-cover" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-32 rounded-lg border-2 border-[var(--accent)]/60" />
          </div>
          <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-[var(--accent)]/70">Align QR code within the frame</p>
        </div>
      )}

      <Button type="submit" disabled={code.trim().length < 6 || joining} className="w-full">
        {joining ? 'CONNECTING...' : 'ESTABLISH LINK'}
      </Button>
    </form>
  )
}
```

### packages/web/src/components/FileDropZone.jsx

```text
import { useCallback, useState, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { indexFiles } from '../lib/fileChunker.js'

const MODES = [
  { key: 'single', label: 'File', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M12 18v-6 M9 15l3-3 3 3' },
  { key: 'multiple', label: 'Files', icon: 'M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z M16 2v6h6' },
  { key: 'folder', label: 'Folder', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
]

export default function FileDropZone({ onFileReady }) {
  const [mode, setMode] = useState('multiple')
  const [indexing, setIndexing] = useState(false)
  const [statusText, setStatusText] = useState('')
  const fileRefs = useRef({})
  const inputRef = useRef(null)

  const traverseDir = useCallback(async (entry, path = '') => {
    const reader = entry.createReader()
    const files = []
    const readBatch = () => new Promise((r) => reader.readEntries((e) => r(e)))
    let batch = await readBatch()
    while (batch.length > 0) {
      for (const e of batch) {
        const p = path ? `${path}/${e.name}` : e.name
        if (e.isFile) {
          const file = await new Promise((r) => e.file(r))
          file.relativePath = p
          files.push(file)
        } else if (e.isDirectory) {
          files.push(...await traverseDir(e, p))
        }
      }
      batch = await readBatch()
    }
    return files
  }, [])

  const handleFiles = useCallback(async (files) => {
    if (files.length === 0) return
    setStatusText(`Indexing ${files.length} file${files.length > 1 ? 's' : ''}...`)
    setIndexing(true)
    try {
      const fileMap = {}
      files.forEach(f => { fileMap[f.relativePath || f.name] = f })
      fileRefs.current = fileMap
      const fileIndex = await indexFiles(files)
      onFileReady(files[0], fileIndex, fileMap)
    } finally {
      setIndexing(false)
      setStatusText('')
    }
  }, [onFileReady])

  const onDrop = useCallback(async (accepted, rejections, event) => {
    const item = event?.dataTransfer?.items?.[0]
    const entry = item?.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      setStatusText('Reading folder...')
      setIndexing(true)
      try {
        const files = await traverseDir(entry)
        await handleFiles(files)
      } finally {
        setIndexing(false)
      }
    } else if (accepted.length > 0) {
      await handleFiles(accepted)
    }
  }, [handleFiles, traverseDir])

  const handleClick = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    if (mode === 'folder') {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
    } else if (mode === 'multiple') {
      input.multiple = true
    }
    input.onchange = async () => {
      const fileList = input.files
      if (!fileList || fileList.length === 0) return
      const files = Array.from(fileList)
      if (mode === 'folder') {
        files.forEach(f => { f.relativePath = f.webkitRelativePath || f.name })
      }
      await handleFiles(files)
    }
    input.click()
  }, [mode, handleFiles])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    multiple: mode === 'multiple' || mode === 'folder',
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium uppercase tracking-wider transition-all cursor-pointer ${
              mode === m.key
                ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--txt-primary)]'
            }`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={m.icon} />
            </svg>
            {m.label}
          </button>
        ))}
      </div>

      <div
        {...getRootProps()}
        onClick={handleClick}
        className={`relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
          isDragActive
            ? 'border-[var(--accent)]/60 bg-[var(--accent)]/5'
            : 'border-[var(--border-light)] bg-[var(--bg-secondary)] hover:border-[var(--border-hover)]'
        }`}
      >
        <input {...getInputProps()} />
        <svg className="mb-3 h-10 w-10 text-[var(--accent)]/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          {mode === 'folder'
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          }
        </svg>
        {indexing ? (
          <p className="text-sm text-[var(--accent)]/80">{statusText}</p>
        ) : isDragActive ? (
          <p className="text-sm font-medium text-[var(--accent)]">Drop here</p>
        ) : (
          <>
            <p className="text-sm font-medium text-[var(--txt-primary)]">
              {mode === 'single' ? 'Select a file or drag here' : mode === 'multiple' ? 'Select files or drag them here' : 'Select a folder or drag here'}
            </p>
            <p className="mt-1 text-xs text-[var(--txt-secondary)]">
              {mode === 'single' ? 'Upload a single file' : mode === 'multiple' ? 'Upload multiple files at once' : 'Upload an entire folder with all contents'}
            </p>
          </>
        )}
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-light)] bg-[var(--bg-secondary)] px-3 py-1 text-[11px] uppercase tracking-widest text-[var(--txt-secondary)]">
          AES-256-GCM · E2E encrypted
        </span>
      </div>
    </div>
  )
}
```

### packages/web/src/components/FileManifest.jsx

```text
import { useState, useCallback } from 'react'
import { formatBytes } from '../lib/format.js'
import Badge from './shared/Badge.jsx'
import Card from './shared/Card.jsx'

function FileEntry({ file, depth = 0, checked, onToggle }) {
  const indent = depth * 20
  return (
    <label
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-[var(--surface-hover)]"
      style={{ paddingLeft: `${12 + indent}px` }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(file.path)}
        className="h-4 w-4 rounded border-[var(--border-light)] bg-[var(--bg-secondary)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
      />
      <span className="flex-1 truncate text-sm text-[var(--txt-primary)]">{file.name}</span>
      <span className="text-xs text-[var(--txt-secondary)]">{formatBytes(file.size)}</span>
    </label>
  )
}

export default function FileManifest({ fileMeta }) {
  const [expandedHash, setExpandedHash] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState(() => {
    const sel = {}
    if (fileMeta?.files) {
      fileMeta.files.forEach((f) => { sel[f.path] = true })
    } else if (fileMeta?.fileName) {
      sel[fileMeta.fileName] = true
    }
    return sel
  })

  if (!fileMeta) return null

  const files = fileMeta.files || [{ path: fileMeta.fileName, name: fileMeta.fileName, size: fileMeta.fileSize }]
  const allSelected = files.every((f) => selectedFiles[f.path])
  const anySelected = files.some((f) => selectedFiles[f.path])

  function toggleFile(path) {
    setSelectedFiles((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  function toggleAll() {
    if (allSelected) {
      const sel = {}; files.forEach((f) => { sel[f.path] = false }); setSelectedFiles(sel)
    } else {
      const sel = {}; files.forEach((f) => { sel[f.path] = true }); setSelectedFiles(sel)
    }
  }

  const totalSelected = files.filter((f) => selectedFiles[f.path]).reduce((s, f) => s + f.size, 0)
  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const isFolder = fileMeta.files && fileMeta.files.length > 1
  const rootHash = fileMeta.merkleRoot || fileMeta.fileMerkleRoot || ''
  const [hashCopied, setHashCopied] = useState(false)

  const copyHash = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rootHash)
      setHashCopied(true)
      setTimeout(() => setHashCopied(false), 1500)
    } catch {}
  }, [rootHash])

  return (
    <div className="flex flex-col gap-4">
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-medium text-[var(--txt-primary)]">{fileMeta.fileName}</p>
            <p className="text-sm text-[var(--txt-secondary)]">{formatBytes(fileMeta.fileSize)}</p>
          </div>
          {fileMeta.senderId && <Badge color="amber">SENDER ID</Badge>}
        </div>

        {fileMeta.senderId && (
          <p className="font-mono text-xs text-[var(--txt-dim)]">{fileMeta.senderId.length > 16 ? `${fileMeta.senderId.slice(0, 16)}...` : fileMeta.senderId}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-[var(--txt-secondary)]">
          <span className="font-mono">{fileMeta.totalChunks || '—'} CHUNKS</span>
          <span className="text-[var(--border-light)]">|</span>
          <span className="font-mono">MERKLE ROOT</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpandedHash(!expandedHash)}
            className="flex-1 cursor-pointer truncate rounded bg-[var(--bg-primary)] px-3 py-2 text-left font-mono text-xs text-[var(--txt-dim)] transition-colors hover:text-[var(--accent)]"
            title={rootHash}
          >
            {expandedHash ? rootHash : `${rootHash.slice(0, 24)}...`}
          </button>
          <button
            type="button"
            onClick={copyHash}
            className="cursor-pointer rounded p-2 text-[var(--txt-secondary)] transition-colors hover:text-[var(--accent)]"
            title="Copy hash"
          >
            {hashCopied ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        </div>
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-[var(--border-light)] bg-[var(--bg-secondary)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
            />
            <span className="text-xs font-medium uppercase tracking-widest text-[var(--txt-secondary)]">Content Manifest</span>
          </label>
        </div>

        {anySelected && (
          <p className="text-xs text-[var(--txt-secondary)]">
            <span className="font-mono text-[var(--accent)]">{files.filter((f) => selectedFiles[f.path]).length}</span> of{' '}
            <span className="font-mono">{files.length}</span> files selected —{' '}
            <span className="font-mono text-[var(--accent)]">{formatBytes(totalSelected)}</span> / {formatBytes(totalSize)}
          </p>
        )}

        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {files.map((file) => (
            <FileEntry
              key={file.path}
              file={file}
              depth={isFolder && file.path.includes('/') ? file.path.split('/').length - 1 : 0}
              checked={!!selectedFiles[file.path]}
              onToggle={toggleFile}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}
```

### packages/web/src/components/LandingGraph.jsx

```text
import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

const NODES = 16
const LINKS = [
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,0],
  [0,4],[1,5],[2,6],[3,7],[8,12],[9,13],[10,14],[11,15],[4,8],[5,9],[6,10],[7,11],[0,8],[4,12],
]

export default function LandingGraph({ className = '' }) {
  const svgRef = useRef(null)

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = svgRef.current
    const parent = el.parentElement
    const rect = parent.getBoundingClientRect()
    let width = Math.max(rect.width, 300)
    let height = Math.max(rect.height, 300)

    const svg = d3.select(el)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')

    const linkData = LINKS.map(([s, t]) => ({ source: s, target: t }))
    const nodeData = Array.from({ length: NODES }, (_, i) => ({
      id: i, pulsing: i < 6,
      z: Math.sin((i / NODES) * Math.PI * 2) * 50,
    }))

    const simulation = d3.forceSimulation(nodeData)
      .force('link', d3.forceLink(linkData).distance(140).strength(0.12))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(35))
      .alpha(0.6).alphaDecay(0.008).alphaTarget(0.1).velocityDecay(0.25)

    const link = g.append('g').selectAll('line').data(linkData).join('line')
      .attr('stroke', '#3a3a3a').attr('stroke-width', 1.2).attr('stroke-opacity', 0.35)

    const linkFlow = g.append('g').selectAll('line').data(linkData).join('line')
      .attr('stroke', '#f59e0b').attr('stroke-width', 1.8)
      .attr('stroke-opacity', 0.5).attr('stroke-dasharray', '4 12')
      .attr('stroke-linecap', 'round')

    const node = g.append('g').selectAll('circle').data(nodeData).join('circle')
      .attr('r', d => 7 + d.z / 30)
      .attr('fill', d => d.pulsing ? '#fbbf24' : '#f59e0b')
      .attr('opacity', d => 0.5 + (d.z + 50) / 100 * 0.5)

    if (!prefersReduced) {
      node.filter(d => d.pulsing).each(function () {
        const el = d3.select(this)
        ;(function pulse() {
          el.transition().duration(1800).attr('r', 12).attr('opacity', 0.6)
            .transition().duration(1800).attr('r', d => 7 + d.z / 30).attr('opacity', d => 0.5 + (d.z + 50) / 100 * 0.5)
            .on('end', pulse)
        })()
      })

      let mouseX = null, mouseY = null
      svg.on('mousemove', e => {
        const [mx, my] = d3.pointer(e)
        mouseX = mx; mouseY = my
      })
      svg.on('mouseleave', () => { mouseX = null; mouseY = null })

      const t0 = Date.now()
      simulation.on('tick', () => {
        const dt = (Date.now() - t0) / 1000
        const driftX = Math.sin(dt * 0.15) * 0.18
        const driftY = Math.cos(dt * 0.1) * 0.18
        nodeData.forEach(d => { d.vx += driftX; d.vy += driftY })

        if (mouseX !== null && mouseY !== null) {
          const r = 140
          nodeData.forEach(d => {
            const dx = d.x - mouseX, dy = d.y - mouseY
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < r && dist > 0) {
              const force = (r - dist) / r * 3.5
              d.vx += (dx / dist) * force
              d.vy += (dy / dist) * force
            }
          })
        }

        link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
        linkFlow.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
        node.attr('cx', d => d.x).attr('cy', d => d.y)
      })

      d3.timer(elapsed => {
        linkFlow.attr('stroke-dashoffset', -elapsed / 50)
      })

      let flowPhase = 0
      setInterval(() => {
        flowPhase = (flowPhase + 0.03) % (Math.PI * 2)
        linkFlow.attr('stroke-opacity', 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(flowPhase)))
      }, 60)
    }

    function resize() {
      const r = parent.getBoundingClientRect()
      width = Math.max(r.width, 300)
      height = Math.max(r.height, 300)
      simulation.force('center', d3.forceCenter(width / 2, height / 2))
      simulation.alpha(0.3).restart()
    }
    window.addEventListener('resize', resize)

    return () => { simulation.stop(); window.removeEventListener('resize', resize) }
  }, [])

  return <svg ref={svgRef} className={className} />
}
```

### packages/web/src/components/layout/Header.jsx

```text
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import ThemeToggle from './ThemeToggle.jsx'

const NAV_LINKS = [
  { to: '/send', label: 'Send' },
  { to: '/receive', label: 'Receive' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/history', label: 'History' },
]

export default function Header() {
  const location = useLocation()
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg-primary)]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2 text-base font-semibold tracking-tight text-[var(--txt-primary)]">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
          mesh
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`rounded-md px-3 py-1.5 text-xs font-medium tracking-wider uppercase transition-colors ${
                location.pathname === link.to
                  ? 'text-[var(--accent)] bg-[var(--accent)]/10'
                  : 'text-[var(--txt-secondary)] hover:text-[var(--txt-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setOpen(!open)}
            aria-label="Menu"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border-light)] text-sm text-[var(--txt-secondary)] transition-colors hover:text-[var(--accent)] hover:border-[var(--accent)]/30 sm:hidden"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {open ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-[var(--border)] sm:hidden"
          >
            <div className="flex flex-col px-4 py-2">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setOpen(false)}
                  className={`rounded-md px-3 py-2.5 text-sm font-medium tracking-wider uppercase transition-colors ${
                    location.pathname === link.to
                      ? 'text-[var(--accent)] bg-[var(--accent)]/10'
                      : 'text-[var(--txt-secondary)] hover:text-[var(--txt-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}
```

### packages/web/src/components/layout/Layout.jsx

```text
import { useEffect } from 'react'
import { useTransferStore } from '../../store/useTransferStore.js'
import Header from './Header.jsx'

export default function Layout({ children }) {
  const status = useTransferStore((s) => s.status)

  useEffect(() => {
    const active = status === 'transferring' || status === 'file-offered' || status === 'waiting-for-peer' || status === 'waiting-for-file'
    if (active) {
      const handler = (e) => { e.preventDefault(); e.returnValue = '' }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    }
  }, [status])

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-primary)]">
      <Header />
      <main className="flex-1">{children}</main>
    </div>
  )
}
```

### packages/web/src/components/layout/ThemeToggle.jsx

```text
import { useUIStore } from '../../store/useUIStore.js'

export default function ThemeToggle() {
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)

  return (
    <button
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border-light)] text-sm text-[var(--txt-secondary)] transition-colors hover:text-[var(--accent)] hover:border-[var(--accent)]/30"
    >
      {theme === 'dark' ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      )}
    </button>
  )
}
```

### packages/web/src/components/PeerGraph.jsx

```text
import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

const COLORS = { pending: '#3a3a3a', requested: '#f59e0b', verified: '#22c55e', failed: '#ef4444' }

export default function PeerGraph({ className = '', chunkStates = [], role = null, peerStats = [], seeding = false }) {
  const svgRef = useRef(null)
  const simRef = useRef(null)
  const nodeRef = useRef(null)
  const linkRef = useRef(null)
  const infoRef = useRef(null)

  const allVerified = chunkStates.length > 0 && chunkStates.every(s => s === 'verified')
  const youLabel = role === 'sender' ? 'YOU (Seeder)' : 'YOU (Leecher)'

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = svgRef.current
    const parent = el.parentElement
    const rect = parent.getBoundingClientRect()
    const width = Math.max(rect.width, 300)
    const height = Math.max(rect.height, 200)

    const svg = d3.select(el)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const margin = { top: 34, right: 30, bottom: 34, left: 30 }
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom
    const centerY = margin.top + innerH / 2
    const leftX = margin.left + innerW * 0.12
    const rightX = margin.left + innerW * 0.88

    const total = Math.max(chunkStates.length, 10)
    const displayCount = Math.min(total, 40)
    const chunkNodes = Array.from({ length: displayCount }, (_, i) => {
      const idx = total > displayCount ? Math.floor((i / displayCount) * total) : i
      return { id: `c${i}`, idx, state: chunkStates[idx] || 'pending' }
    })

    const senderNode = { id: 'sender' }
    const receiverNode = { id: 'receiver' }
    const allNodes = [senderNode, receiverNode, ...chunkNodes]
    const allLinks = chunkNodes.flatMap(d => [{ source: 'sender', target: d.id }, { source: d.id, target: 'receiver' }])

    const sim = d3.forceSimulation(allNodes)
      .force('x', d3.forceX(d => {
        if (d.id === 'sender') return leftX
        if (d.id === 'receiver') return rightX
        const s = chunkStates[d.idx]
        if (allVerified || s === 'verified') return rightX
        if (s === 'requested') return margin.left + innerW / 2
        return leftX
      }).strength(d => d.id === 'sender' || d.id === 'receiver' ? 4 : 0.08))
      .force('y', d3.forceY(d => d.id === 'sender' || d.id === 'receiver' ? centerY : centerY + (Math.random() - 0.5) * innerH * 0.7).strength(d => d.id === 'sender' || d.id === 'receiver' ? 4 : 0.05))
      .force('charge', d3.forceManyBody().strength(d => d.id === 'sender' || d.id === 'receiver' ? -100 : -15))
      .force('collision', d3.forceCollide(d => d.id === 'sender' || d.id === 'receiver' ? 14 : 5))
      .alpha(0.5).alphaDecay(0.015).alphaTarget(allVerified ? 0 : 0.05).velocityDecay(0.35)

    const g = svg.append('g')

    const link = g.append('g').selectAll('line').data(allLinks).join('line')
      .attr('stroke', '#2a2a2a').attr('stroke-width', 0.3).attr('stroke-opacity', 0.2)

    const node = g.append('g').selectAll('circle').data(allNodes).join('circle')
      .attr('r', d => d.id === 'sender' || d.id === 'receiver' ? 12 : 5)
      .attr('fill', d => {
        if (d.id === 'sender') return '#f59e0b'
        if (d.id === 'receiver') return '#22c55e'
        return COLORS[d.state] || '#3a3a3a'
      })
      .attr('stroke', d => d.id === 'sender' || d.id === 'receiver' ? 'none' : 'rgba(255,255,255,0.08)')
      .attr('stroke-width', 1)

    const label = g.append('g')
    const txt = (x, y, text, color = '#6b7280', bold = false) => {
      const t = label.append('text').attr('text-anchor', 'middle').attr('font-family', 'monospace').attr('font-size', '10px').attr('fill', color).attr('x', x).attr('y', y)
      if (bold) t.attr('font-weight', 'bold')
      t.text(text)
    }

    txt(leftX, centerY + 20, role === 'sender' ? youLabel : 'SEEDER', role === 'sender' ? '#f59e0b' : '#6b7280', role === 'sender')
    txt(rightX, centerY + 20, role === 'receiver' ? youLabel : 'LEECHER', role === 'receiver' ? '#22c55e' : '#6b7280', role === 'receiver')
    if (seeding) {
      txt(rightX, centerY + 32, '+ SEEDING', '#f59e0b', false)
    }

    const verified = chunkStates.filter(s => s === 'verified').length
    const totalChunks = chunkStates.length
    if (totalChunks > 0) {
      txt(14, height - 14, allVerified ? '✓ Complete' : `${verified}/${totalChunks}`)
    }

    if (prefersReduced) {
      sim.stop()
      allNodes.forEach(d => {
        if (d.id === 'sender') { d.x = leftX; d.y = centerY }
        else if (d.id === 'receiver') { d.x = rightX; d.y = centerY }
        else { d.x = leftX + Math.random() * innerW * 0.7; d.y = centerY + (Math.random() - 0.5) * innerH * 0.5 }
      })
      sim.tick(50)
    }

    sim.on('tick', () => {
      link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      node.attr('cx', d => d.x).attr('cy', d => d.y)
    })

    simRef.current = sim
    nodeRef.current = node
    linkRef.current = link
    infoRef.current = label

    return () => { sim.stop() }
  }, [role, chunkStates.length, allVerified, seeding])

  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    const nodes = sim.nodes()
    const total = chunkStates.length
    nodes.forEach(d => {
      if (d.idx !== undefined && d.idx < total) d.state = chunkStates[d.idx]
    })
    if (nodeRef.current) {
      nodeRef.current.transition().duration(400).attr('fill', d => {
        if (d.id === 'sender') return '#f59e0b'
        if (d.id === 'receiver') return '#22c55e'
        return COLORS[d.state] || '#3a3a3a'
      })
    }
    const verified = chunkStates.filter(s => s === 'verified').length
    if (infoRef.current && total > 0) {
      infoRef.current.selectAll('text').filter(function() {
        return d3.select(this).text().includes('/')
      }).text(allVerified ? '✓ Complete' : `${verified}/${total}`)
    }
    sim.alpha(allVerified ? 0.8 : 0.5).restart()
  }, [chunkStates, role, allVerified])

  return <svg ref={svgRef} className={className} />
}
```

### packages/web/src/components/PeerList.jsx

```text
import Badge from './shared/Badge.jsx'

export default function PeerList({ peerStats = [] }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-widest text-[var(--txt-secondary)]">
          Active Peers
        </span>
        <span className="text-sm text-[var(--txt-secondary)]">{peerStats.length}</span>
      </div>
      <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
        {peerStats.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--txt-secondary)]">No peers connected</p>
        ) : (
          peerStats.map((peer) => {
            const connected = !peer.failed && (peer.consecutiveFailures || 0) < 3
            const isSeeder = (peer.chunksServed || 0) > 0
            return (
              <div
                key={peer.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`}
                  title={connected ? 'Connected' : 'Disconnected'}
                />
                <span className="font-mono text-[var(--txt-primary)] break-all">
                  {peer.id}
                </span>
                <Badge color={isSeeder ? 'amber' : 'gray'} dot={false}>
                  {isSeeder ? 'SEED' : 'LEECH'}
                </Badge>
                <span className="text-xs text-[var(--txt-secondary)] whitespace-nowrap">
                  {peer.chunksServed || 0} chunks
                </span>
                {peer.failed && (
                  <Badge color="red" dot={false}>FAILED</Badge>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
```

### packages/web/src/components/RoomCode.jsx

```text
import { QRCodeSVG } from 'qrcode.react'
import MonoText from './shared/MonoText.jsx'
import Badge from './shared/Badge.jsx'

export default function RoomCode({ roomCode }) {
  const shareUrl = `${window.location.origin}/receive?code=${roomCode}`

  return (
    <div className="flex flex-col items-center gap-4">
      <Badge color="gray" dot={false}>ROOM CODE</Badge>
      <div className="rounded-xl bg-[var(--bg-secondary)] p-4">
        <QRCodeSVG value={shareUrl} size={180} bgColor="transparent" fgColor="#ffffff" />
      </div>
      <MonoText text={roomCode} copyable className="text-2xl tracking-[0.2em]" />
    </div>
  )
}
```

### packages/web/src/components/shared/Accordion.jsx

```text
import { useState } from 'react'

export default function Accordion({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-[var(--txt-primary)] transition-colors hover:bg-[var(--surface-hover)] cursor-pointer"
      >
        {title}
        <svg
          className={`h-4 w-4 shrink-0 text-[var(--txt-secondary)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="border-t border-[var(--border)] px-4 py-3 text-sm leading-relaxed text-[var(--txt-secondary)]">
          {children}
        </div>
      </div>
    </div>
  )
}
```

### packages/web/src/components/shared/Badge.jsx

```text
const COLORS = {
  green: 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20',
  amber: 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20',
  red: 'bg-[var(--error)]/10 text-[var(--error)] border-[var(--error)]/20',
  gray: 'bg-[var(--surface-hover)] text-[var(--txt-secondary)] border-[var(--border-light)]',
}

const DOTS = {
  green: 'bg-[var(--success)]',
  amber: 'bg-[var(--accent)]',
  red: 'bg-[var(--error)]',
  gray: 'bg-[var(--txt-secondary)]',
}

export default function Badge({ color = 'gray', dot = true, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium tracking-wide uppercase ${COLORS[color]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOTS[color]}`} />}
      {children}
    </span>
  )
}
```

### packages/web/src/components/shared/Button.jsx

```text
const VARIANTS = {
  primary: 'bg-[var(--accent)] text-black hover:bg-[var(--accent)] font-medium',
  secondary: 'border border-[var(--border-light)] text-[var(--txt-primary)] hover:bg-[var(--surface-hover)] font-medium',
  ghost: 'text-[var(--txt-secondary)] hover:text-[var(--txt-primary)] hover:bg-[var(--surface-hover)]',
  danger: 'bg-[var(--error)] text-white hover:bg-[var(--error)] font-medium',
}

export default function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
```

### packages/web/src/components/shared/Card.jsx

```text
export default function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
```

### packages/web/src/components/shared/MonoText.jsx

```text
import { useState } from 'react'

export default function MonoText({ text, copyable = false, className = '' }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard denied */ }
  }

  return (
    <span className={`inline-flex items-center gap-2 font-mono tracking-wide ${className}`}>
      <span className="text-[var(--txt-dim)]">{text}</span>
      {copyable && (
        <button
          onClick={handleCopy}
          className="cursor-pointer rounded p-1 text-[var(--txt-secondary)] transition-colors hover:text-[var(--accent)] hover:bg-[var(--surface-hover)]"
          title="Copy"
        >
          {copied ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      )}
    </span>
  )
}
```

### packages/web/src/components/shared/ProgressBar.jsx

```text
export default function ProgressBar({ percent }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
      <div
        className="h-full rounded-full bg-brand-500 transition-all duration-300"
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  )
}
```

### packages/web/src/components/SpeedChart.jsx

```text
import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const AMBER_SHADES = ['#f59e0b', '#d97706', '#b45309', '#a16207', '#fbbf24']

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-[var(--border-light)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--txt-primary)] shadow-lg">
      <p className="mb-1 text-[var(--txt-secondary)]">{label}</p>
      {[...payload].reverse().map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {Number(entry.value) < 0.01 ? '<0.01' : Number(entry.value).toFixed(2)} MB/s
        </p>
      ))}
    </div>
  )
}

export default function SpeedChart({ data = [], peerCount = 1 }) {
  const total = useMemo(() => {
    if (data.length === 0) return 0
    const last = data[data.length - 1]
    if (last.peers) {
      return last.peers.reduce((s, p) => s + (p.mbps || 0), 0)
    }
    return last.mbps || 0
  }, [data])

  const chartData = useMemo(() => {
    return data.map((d, i) => {
      const label =
        i % 10 === 0 || i === data.length - 1
          ? new Date(d.t).toLocaleTimeString('en-US', { minute: '2-digit', second: '2-digit' })
          : ''
      const entry = { t: label }
      if (d.peers) {
        d.peers.forEach((p, j) => {
          entry[`peer_${j}`] = p.mbps || 0
        })
      } else {
        entry.total = d.mbps || 0
      }
      return entry
    })
  }, [data])

  const bars = useMemo(() => {
    if (data.length === 0) return []
    if (data[0].peers) {
      return data[0].peers.map((_, j) => ({
        dataKey: `peer_${j}`,
        fill: AMBER_SHADES[j % AMBER_SHADES.length],
        stackId: 'speed',
      }))
    }
    return [{ dataKey: 'total', fill: '#f59e0b', stackId: 'speed' }]
  }, [data])

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium uppercase tracking-widest text-[var(--txt-secondary)]">
            Throughput
          </span>
          <span className="text-xl font-bold text-[var(--accent)]">
            0.0{' '}
            <span className="text-sm font-normal text-[var(--txt-secondary)]">MB/s</span>
          </span>
        </div>
        <div className="flex h-48 items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <svg className="h-8 w-8 text-[var(--txt-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18M3 9h18M3 13.5h18M3 18h18" />
            </svg>
            <p className="text-sm text-[var(--txt-secondary)]">Waiting for data...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-widest text-[var(--txt-secondary)]">
          Throughput
        </span>
        <span className="text-xl font-bold text-[var(--accent)]">
          {total < 0.01 ? '<0.01' : total.toFixed(2)}{' '}
          <span className="text-sm font-normal text-[var(--txt-secondary)]">MB/s</span>
        </span>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={1}>
            <XAxis
              dataKey="t"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              axisLine={{ stroke: '#2a2a2a' }}
              tickLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1a1a1a' }} />
            {bars.map((bar) => (
              <Bar
                key={bar.dataKey}
                dataKey={bar.dataKey}
                fill={bar.fill}
                stackId={bar.stackId}
                radius={[1, 1, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
```

### packages/web/src/components/StatusLog.jsx

```text
import { useEffect, useRef } from 'react'

export default function StatusLog({ lines = [], blinking = false }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3 font-mono text-sm text-[var(--txt-dim)]">
      {lines.map((line, i) => (
        <div key={i} className="leading-5">
          <span className="text-[var(--accent)]">[SYS]</span> {line}
        </div>
      ))}
      {blinking && (
        <span className="inline-block animate-blink text-[var(--accent)]">▌</span>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
```

### packages/web/src/hooks/useSignaling.js

```text
import { useCallback } from 'react'
import { useSignalingStore } from '../store/useSignalingStore.js'

export function useSignaling() {
  const status = useSignalingStore((s) => s.status)
  const roomCode = useSignalingStore((s) => s.roomCode)
  const peerId = useSignalingStore((s) => s.peerId)
  const peers = useSignalingStore((s) => s.peers)
  const error = useSignalingStore((s) => s.error)
  const client = useSignalingStore((s) => s.client)

  const connect = useSignalingStore((s) => s.connect)
  const createRoom = useSignalingStore((s) => s.createRoom)
  const joinRoom = useSignalingStore((s) => s.joinRoom)
  const disconnect = useSignalingStore((s) => s.disconnect)
  const reset = useSignalingStore((s) => s.reset)

  const createAndWait = useCallback(async (password) => {
    const result = await createRoom(password)
    return result
  }, [createRoom])

  return {
    client, status, roomCode, peerId, peers, error,
    connect, createRoom: createAndWait, joinRoom, disconnect, reset,
  }
}
```

### packages/web/src/hooks/useTransfer.js

```text
import { useCallback } from 'react'
import { SwarmManager } from '../lib/swarmManager.js'
import { transferManager as M } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import { MSG } from '../webrtc/protocol.js'
import { readChunk, getFileForChunk } from '../lib/fileChunker.js'
import { sha256Hex, getMerkleProof } from '../lib/browserCrypto.js'
import { useTransferStore } from '../store/useTransferStore.js'

export function useTransfer() {
  const startSending = useCallback(async (file, fileIndex, fileRefs) => {
    M.fileRef = file
    M.indexRef = fileIndex
    M.fileRefs = fileRefs || null
    M.downloadGuard = false
    M.servedRef = new Set()
    M.streamHandle = null
    const meta = {
      fileName: fileIndex.fileName,
      fileSize: fileIndex.fileSize,
      totalChunks: fileIndex.totalChunks,
      chunkSize: fileIndex.chunkSize,
      merkleRoot: fileIndex.merkleRoot,
      files: fileIndex.files,
    }
    useTransferStore.getState().startAsSender(meta)
    if (meta.totalChunks === 0) {
      useTransferStore.getState().setComplete()
    }
    return meta
  }, [])

  const startReceiving = useCallback(async (meta) => {
    M.downloadGuard = false
    M.chunks = new Array(meta.totalChunks)
    M.streamHandle = null
    M.receivedMeta = { files: meta.files, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks, merkleRoot: meta.merkleRoot }
    useTransferStore.getState().setIncomingFile(meta)

    const swarm = new SwarmManager(meta.totalChunks, meta.merkleRoot, meta.chunkSize)
    M.swarm = swarm

    let speedBytes = 0
    let speedTime = Date.now()
    const chunkSize = meta.chunkSize

    swarm.addEventListener('chunkVerified', async (e) => {
      const { chunkIndex, chunkData, verified, total } = e.detail
      M.chunks[chunkIndex] = chunkData

      if (M.streamHandle) {
        try {
          await M.streamHandle.write(chunkData)
        } catch {}
      }

      useTransferStore.getState().updateChunkState(chunkIndex, 'verified')
      useTransferStore.getState().updateProgress({ verified, total, percent: (verified / total) * 100 })
      useTransferStore.getState().updatePeerStats(swarm.getPeerStats())

      speedBytes += chunkSize || chunkData.byteLength || 0
      const now = Date.now()
      const elapsed = (now - speedTime) / 1000
      if (elapsed >= 0.5) {
        const mbps = (speedBytes / elapsed) / (1024 * 1024)
        useTransferStore.getState().recordSpeedSample(mbps)
        speedBytes = 0
        speedTime = now
      }
    })

    swarm.addEventListener('chunkFailed', (e) => {
      useTransferStore.getState().updateChunkState(e.detail.chunkIndex, 'pending')
    })

    swarm.addEventListener('complete', async () => {
      if (M.streamHandle) {
        try { await M.streamHandle.close() } catch {}
        M.streamHandle = null
      }
      useTransferStore.getState().setComplete()
    })

    swarm.addEventListener('peerFailed', () => {
      useTransferStore.getState().updatePeerStats(swarm.getPeerStats())
    })

    return swarm
  }, [])

  const addSenderPeer = useCallback(async (transport, fileIndex) => {
    if (!M.servedRef) M.servedRef = new Set()
    const total = fileIndex.totalChunks
    transport.onJSON(async (msg) => {
      if (msg.type !== MSG.CHUNK_REQUEST) return
      if (!useTransferStore.getState().seeding) return

      const file = M.fileRef
      const idx = M.indexRef
      const refs = M.fileRefs

      if (file && idx && refs) {
        const entry = getFileForChunk(idx.files, msg.index)
        if (!entry) return
        const targetFile = refs[entry.fileEntry.path]
        if (!targetFile) return
        const buf = await (async () => {
          const b = await readChunk(targetFile, entry.localIndex, idx.chunkSize)
          const proof = getMerkleProof(idx.tree, msg.index)
          transport.sendChunk(msg.index, idx.hashes[msg.index], proof, new Uint8Array(b))
          return b
        })()
      } else if (M.chunks && M.chunks[msg.index]) {
        const data = M.chunks[msg.index]
        const arr = data instanceof Uint8Array ? data : new Uint8Array(data)
        const hash = await sha256Hex(arr)
        transport.sendChunk(msg.index, hash, null, arr)
      } else {
        return
      }
      M.servedRef.add(msg.index)
      useTransferStore.getState().updateProgress({
        verified: M.servedRef.size,
        total,
        percent: (M.servedRef.size / total) * 100,
      })
      if (M.servedRef.size >= total) {
        useTransferStore.getState().setComplete()
      }
    })
    transport.sendJSON({
      type: MSG.FILE_OFFER,
      fileName: fileIndex.fileName,
      fileSize: fileIndex.fileSize,
      totalChunks: fileIndex.totalChunks,
      chunkSize: fileIndex.chunkSize,
      merkleRoot: fileIndex.merkleRoot,
      files: fileIndex.files,
    })
    transport.pc.addEventListener('connectionstatechange', () => {
      if (transport.pc.connectionState === 'disconnected' || transport.pc.connectionState === 'failed') {
        M.transports.delete(transport.remotePeerId)
      }
    })
    M.transports.set(transport.remotePeerId, transport)
    useTransferStore.getState().setTransferring()
  }, [])

  const addReceiverPeer = useCallback(async (transport, swarm) => {
    const requestFn = (index) => {
      transport.sendJSON({ type: MSG.CHUNK_REQUEST, index })
      return Promise.resolve()
    }

    transport.onChunk(async (msg) => {
      if (!M.swarm || M.swarm.isComplete()) return
      await M.swarm.onChunkReceived(
        transport.remotePeerId,
        msg.chunkIndex,
        msg.chunkData,
        msg.chunkHash,
        msg.proof
      )
    })

    swarm.addPeer(transport.remotePeerId, requestFn)
    transport.pc.addEventListener('connectionstatechange', () => {
      if (transport.pc.connectionState === 'disconnected' || transport.pc.connectionState === 'failed') {
        M.transports.delete(transport.remotePeerId)
        swarm.removePeer(transport.remotePeerId)
      }
    })
    M.transports.set(transport.remotePeerId, transport)
    useTransferStore.getState().setTransferring()
  }, [])

  const blobForEntry = useCallback((entry) => {
    const ordered = []
    for (let i = 0; i < entry.chunkCount; i++) {
      ordered.push(M.chunks[entry.startChunk + i])
    }
    return new Blob(ordered, { type: 'application/octet-stream' })
  }, [])

  const triggerDownload = useCallback(async () => {
    if (M.downloadGuard) return
    M.downloadGuard = true
    const meta = useTransferStore.getState().fileMeta
    const saveMode = useTransferStore.getState().saveMode
    if (!meta || M.chunks.length === 0) return

    const files = meta.files || [{ path: meta.fileName, name: meta.fileName, size: meta.fileSize, startChunk: 0, chunkCount: meta.totalChunks }]
    const isMulti = files.length > 1

    if (isMulti && saveMode === 'auto') {
      let wroteAny = false
      try {
        const dirHandle = await window.showDirectoryPicker?.({ mode: 'readwrite' })
        if (dirHandle) {
          for (const entry of files) {
            const parts = entry.path.replace(/\\/g, '/').split('/')
            let handle = dirHandle
            for (let p = 0; p < parts.length - 1; p++) {
              handle = await handle.getDirectoryHandle(parts[p], { create: true })
            }
            const fileHandle = await handle.getFileHandle(parts[parts.length - 1], { create: true })
            const writable = await fileHandle.createWritable()
            const blob = blobForEntry(entry)
            await writable.write(blob)
            await writable.close()
            wroteAny = true
          }
          return
        }
      } catch {}
      if (wroteAny) return
    }

    if (isMulti || saveMode === 'files') {
      for (const entry of files) {
        const blob = blobForEntry(entry)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = entry.name
        a.click()
        URL.revokeObjectURL(url)
        await new Promise(r => setTimeout(r, 200))
      }
      return
    }

    try {
      const handle = await window.showSaveFilePicker?.({
        suggestedName: meta.fileName,
        types: [{ accept: { 'application/octet-stream': [] } }],
      })
      if (handle) {
        const writable = await handle.createWritable()
        await writable.write(blobForEntry(files[0]))
        await writable.close()
        return
      }
    } catch {}

    const blob = blobForEntry(files[0])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = meta.fileName
    a.click()
    URL.revokeObjectURL(url)
  }, [blobForEntry])

  const disconnectAll = useCallback(() => {
    if (M.swarm) {
      M.swarm.abort()
      M.swarm = null
    }
    for (const [id, t] of M.transports) {
      t.close()
    }
    if (M.streamHandle) {
      try { M.streamHandle.close() } catch {}
      M.streamHandle = null
    }
    M.reset()
    useTransferStore.getState().reset()
  }, [])

  const stopSeeding = useCallback(() => {
    useTransferStore.getState().setSeeding(false)
  }, [])

  const resumeSeeding = useCallback(() => {
    useTransferStore.getState().setSeeding(true)
  }, [])

  const resetDownload = useCallback(() => {
    M.downloadGuard = false
  }, [])

  return {
    startSending,
    startReceiving,
    addSenderPeer,
    addReceiverPeer,
    triggerDownload,
    resetDownload,
    disconnectAll,
    stopSeeding,
    resumeSeeding,
  }
}
```

### packages/web/src/hooks/useWebRTC.js

```text
import { useRef, useCallback } from 'react'
import { WebRTCTransport } from '../lib/webrtc.js'

export function useWebRTC(signalingClient) {
  const transports = useRef(new Map())

  const createTransport = useCallback(async (remotePeerId, initiator) => {
    const existing = transports.current.get(remotePeerId)
    if (existing) return existing

    const t = new WebRTCTransport(signalingClient, remotePeerId, { initiator })
    try {
      await t.connect()
      transports.current.set(remotePeerId, t)
      return t
    } catch (err) {
      t.close()
      throw err
    }
  }, [signalingClient])

  const getTransport = useCallback((peerId) => {
    return transports.current.get(peerId)
  }, [])

  const destroyTransport = useCallback((peerId) => {
    const t = transports.current.get(peerId)
    if (t) {
      t.close()
      transports.current.delete(peerId)
    }
  }, [])

  const destroyAll = useCallback(() => {
    for (const [id, t] of transports.current) {
      t.close()
    }
    transports.current.clear()
  }, [])

  return { createTransport, getTransport, destroyTransport, destroyAll }
}
```

### packages/web/src/index.css

```text
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --color-brand-50: #fffbeb;
  --color-brand-100: #fef3c7;
  --color-brand-200: #fde68a;
  --color-brand-300: #fcd34d;
  --color-brand-400: #fbbf24;
  --color-brand-500: #f59e0b;
  --color-brand-600: #d97706;
  --color-brand-700: #b45309;
  --color-brand-800: #92400e;
  --color-brand-900: #78350f;

  --color-amber-400: #fbbf24;
  --color-amber-500: #f59e0b;
  --color-amber-600: #d97706;

  --color-success: #22c55e;
  --color-error: #ef4444;
  --color-pending: #f59e0b;
}

:root {
  --txt-primary: #e5e5e5;
  --txt-dim: #a3a3a3;
  --txt-secondary: #6b7280;
  --txt-tertiary: #9ca3af;
  --txt-muted: #4b5563;
  --bg-primary: #0a0a0a;
  --bg-secondary: #0d0d0d;
  --surface: #111111;
  --surface-hover: #1a1a1a;
  --border: #1f1f1f;
  --border-light: #2a2a2a;
  --border-hover: #3a3a3a;
  --accent: #f59e0b;
  --accent-dim: #fbbf24;
  --success: #22c55e;
  --error: #ef4444;
  --dot-online: #22c55e;
  --dot-offline: #ef4444;
  --badge-bg: rgba(245,158,11,0.1);
  --badge-border: rgba(245,158,11,0.2);
}

:root:not(.dark) {
  --txt-primary: #171717;
  --txt-dim: #4b5563;
  --txt-secondary: #6b7280;
  --txt-tertiary: #6b7280;
  --txt-muted: #9ca3af;
  --bg-primary: #fafafa;
  --bg-secondary: #f5f5f5;
  --surface: #ffffff;
  --surface-hover: #f3f4f6;
  --border: #e5e5e5;
  --border-light: #d1d5db;
  --border-hover: #9ca3af;
  --accent: #d97706;
  --accent-dim: #b45309;
  --success: #16a34a;
  --error: #dc2626;
  --dot-online: #16a34a;
  --dot-offline: #dc2626;
  --badge-bg: rgba(217,119,6,0.1);
  --badge-border: rgba(217,119,6,0.25);
}

html {
  color-scheme: dark;
  background-color: var(--bg-primary);
}

html:not(.dark) {
  color-scheme: light;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background-color: var(--bg-primary);
  color: var(--txt-primary);
  -webkit-font-smoothing: antialiased;
}

* {
  box-sizing: border-box;
}

::selection {
  background-color: rgba(245, 158, 11, 0.3);
  color: #fff;
}

::-webkit-scrollbar { width: 0; height: 0; }
* { scrollbar-width: none; -ms-overflow-style: none; }

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.animate-blink {
  animation: blink 1s step-end infinite;
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 4px rgba(245, 158, 11, 0.2); }
  50% { box-shadow: 0 0 12px rgba(245, 158, 11, 0.4); }
}

.animate-glow {
  animation: pulse-glow 2s ease-in-out infinite;
}
```

### packages/web/src/lib/browserCrypto.js

```text
export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bytesToHex(new Uint8Array(digest))
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

async function hashPair(hexA, hexB) {
  const combined = new Uint8Array(64)
  combined.set(hexToBytes(hexA), 0)
  combined.set(hexToBytes(hexB), 32)
  return sha256Hex(combined.buffer)
}

export async function buildMerkleTree(hashes) {
  if (hashes.length === 0) throw new Error('No hashes provided')
  let level = [...hashes]
  if (level.length % 2 !== 0) level.push(level[level.length - 1])
  const levels = [level]
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      next.push(await hashPair(level[i], level[i + 1]))
    }
    level = next
    if (level.length > 1 && level.length % 2 !== 0) level.push(level[level.length - 1])
    levels.push(level)
  }
  return { root: level[0], levels }
}

export function getMerkleProof(tree, index) {
  const proof = []
  let i = index
  for (let lvl = 0; lvl < tree.levels.length - 1; lvl++) {
    const level = tree.levels[lvl]
    const isLeft = i % 2 === 0
    const siblingIndex = isLeft ? i + 1 : i - 1
    if (siblingIndex < level.length) {
      proof.push({ hash: level[siblingIndex], position: isLeft ? 'right' : 'left' })
    }
    i = Math.floor(i / 2)
  }
  return proof
}

export async function verifyChunk(chunkBuffer, proof, expectedRoot) {
  let current = await sha256Hex(chunkBuffer)
  for (const { hash: sibling, position } of proof) {
    current = position === 'right' ? await hashPair(current, sibling) : await hashPair(sibling, current)
  }
  return current === expectedRoot
}
```

### packages/web/src/lib/fileChunker.js

```text
import { sha256Hex, buildMerkleTree } from './browserCrypto.js'

const DEFAULT_CHUNK_SIZE = 65536
const MAX_CHUNK_SIZE = 4 * 1024 * 1024
const TARGET_CHUNK_COUNT = 20000

export function computeChunkSize(fileSize) {
  if (fileSize <= DEFAULT_CHUNK_SIZE * TARGET_CHUNK_COUNT) return DEFAULT_CHUNK_SIZE
  const raw = Math.ceil(fileSize / TARGET_CHUNK_COUNT)
  let size = DEFAULT_CHUNK_SIZE
  while (size < raw && size < MAX_CHUNK_SIZE) size *= 2
  return size
}

export async function indexFiles(files) {
  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const chunkSize = computeChunkSize(totalSize)
  const allHashes = []
  const fileEntries = []
  let globalIdx = 0

  for (const file of files) {
    const fileChunks = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize)
    const hashes = []
    for (let i = 0; i < fileChunks; i++) {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const buf = await file.slice(start, end).arrayBuffer()
      hashes.push(await sha256Hex(buf))
    }
    fileEntries.push({
      path: file.relativePath || file.webkitRelativePath || file.name,
      name: file.name,
      size: file.size,
      startChunk: globalIdx,
      chunkCount: fileChunks,
    })
    allHashes.push(...hashes)
    globalIdx += fileChunks
  }

  const tree = allHashes.length > 0
    ? await buildMerkleTree(allHashes)
    : { root: await sha256Hex(new ArrayBuffer(0)), levels: [] }

  const folderLabel = files[0].webkitRelativePath?.split('/')[0] || files[0].relativePath?.split('/')[0]
  const rootName = files.length === 1
    ? files[0].name
    : (folderLabel || `files-${new Date().toISOString().slice(0, 10)}`)

  return {
    fileName: rootName,
    fileSize: totalSize,
    chunkSize,
    totalChunks: allHashes.length,
    hashes: allHashes,
    tree,
    merkleRoot: tree.root,
    files: fileEntries,
  }
}

export async function indexFile(file) {
  return indexFiles([file])
}

export async function readChunk(file, index, chunkSize) {
  const start = index * chunkSize
  const end = Math.min(start + chunkSize, file.size)
  return file.slice(start, end).arrayBuffer()
}

export function getFileForChunk(fileEntries, globalIndex) {
  for (const entry of fileEntries) {
    if (globalIndex >= entry.startChunk && globalIndex < entry.startChunk + entry.chunkCount) {
      return { fileEntry: entry, localIndex: globalIndex - entry.startChunk }
    }
  }
  return null
}
```

### packages/web/src/lib/format.js

```text
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatSpeed(mbps) {
  if (mbps < 0.1) return '< 0.1 MB/s'
  return `${mbps.toFixed(1)} MB/s`
}

export function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

export function formatEta(bytesRemaining, mbpsCurrent) {
  if (!mbpsCurrent || mbpsCurrent <= 0) return '—'
  const secondsRemaining = bytesRemaining / (mbpsCurrent * 1024 * 1024)
  return formatDuration(secondsRemaining)
}
```

### packages/web/src/lib/swarmManager.js

```text
import { sha256Hex, verifyChunk } from './browserCrypto.js';

export const MAX_CONSECUTIVE_FAILURES = 5;
const CHUNK_TIMEOUT = 30000;

const P = 'pending';
const R = 'requested';
const V = 'verified';
const COMPACT_THRESHOLD = 1000;

export class SwarmManager extends EventTarget {
  constructor(totalChunks, merkleRoot, chunkSize, alreadyVerified = []) {
    super();
    this.totalChunks = totalChunks;
    this.merkleRoot = merkleRoot;
    this.chunkSize = chunkSize;
    this.pipelineSize = 4;
    this.chunkState = new Array(totalChunks).fill(P);
    this.chunkPeer = new Array(totalChunks).fill(null);
    this.verifiedCount = 0;
    this.peers = new Map();
    this.done = false;
    this.aborted = false;
    this._chunkTimeouts = new Map();

    const vs = new Set(alreadyVerified);
    for (const idx of vs) {
      if (idx >= 0 && idx < totalChunks && this.chunkState[idx] !== V) {
        this.chunkState[idx] = V;
        this.verifiedCount++;
      }
    }

    this.pendingQueue = [];
    for (let i = 0; i < totalChunks; i++) {
      if (this.chunkState[i] !== V) this.pendingQueue.push(i);
    }
    this.queueHead = 0;

    if (totalChunks > 0 && this.verifiedCount === totalChunks) {
      this.done = true;
    }
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
    for (const ci of peer.pending) {
      this._clearChunkTimeout(ci);
      if (this.chunkState[ci] === R) this._requeueChunk(ci);
    }
    this.peers.delete(peerId);
    this.dispatchEvent(new CustomEvent('peerRemoved', { detail: peerId }));
    for (const id of this.peers.keys()) this._fillPipeline(id);
  }

  abort() {
    this.aborted = true;
    for (const [ci, t] of this._chunkTimeouts) { clearTimeout(t); }
    this._chunkTimeouts.clear();
  }

  _markPeerFailed(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed) return;
    peer.failed = true;
    this.removePeer(peerId);
    this.dispatchEvent(new CustomEvent('peerFailed', { detail: { peerId, reason: 'too_many_consecutive_failures' } }));
  }

  _requeueChunk(idx) {
    this.chunkState[idx] = P;
    this.chunkPeer[idx] = null;
    this.pendingQueue.push(idx);
  }

  _compactQueue() {
    if (this.queueHead > COMPACT_THRESHOLD && this.queueHead > this.pendingQueue.length / 2) {
      this.pendingQueue = this.pendingQueue.slice(this.queueHead);
      this.queueHead = 0;
    }
  }

  _fillPipeline(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.failed || this.done || this.aborted) return;
    while (peer.pending.size < this.pipelineSize && this.queueHead < this.pendingQueue.length) {
      const i = this.pendingQueue[this.queueHead++];
      if (this.chunkState[i] !== P) continue;
      this.chunkState[i] = R;
      this.chunkPeer[i] = peerId;
      peer.pending.add(i);
      this._chunkTimeouts.set(i, setTimeout(() => this._handleChunkTimeout(peerId, i), CHUNK_TIMEOUT));
      const p = peer.requestChunk(i)
      if (p && typeof p.catch === 'function') p.catch(() => this._handleChunkFailure(peerId, i))
    }
    this._compactQueue();
  }

  _clearChunkTimeout(ci) {
    const t = this._chunkTimeouts.get(ci);
    if (t) { clearTimeout(t); this._chunkTimeouts.delete(ci); }
  }

  _handleChunkTimeout(peerId, ci) {
    this._chunkTimeouts.delete(ci);
    this._handleChunkFailure(peerId, ci);
  }

  _handleChunkFailure(peerId, ci) {
    this._clearChunkTimeout(ci);
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pending.delete(ci);
      peer.consecutiveFailures++;
    }
    if (this.chunkState[ci] === R) this._requeueChunk(ci);
    if (peer && peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this._markPeerFailed(peerId);
      return;
    }
    if (peer) this._fillPipeline(peerId);
  }

  async onChunkReceived(peerId, ci, data, expectedHash, proof) {
    this._clearChunkTimeout(ci);
    if (this.aborted) return false;
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    peer.pending.delete(ci);
    if (this.chunkState[ci] === V) {
      this._fillPipeline(peerId);
      return true;
    }
    const actualHash = await sha256Hex(data);
    if (this.aborted) return false;
    if (actualHash !== expectedHash) {
      peer.consecutiveFailures++;
      this.dispatchEvent(new CustomEvent('chunkFailed', { detail: { peerId, chunkIndex: ci, reason: 'hash_mismatch' } }));
      this._requeueChunk(ci);
      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }
    if (proof && !(await verifyChunk(data, proof, this.merkleRoot))) {
      peer.consecutiveFailures++;
      this.dispatchEvent(new CustomEvent('chunkFailed', { detail: { peerId, chunkIndex: ci, reason: 'proof_invalid' } }));
      this._requeueChunk(ci);
      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }
    peer.consecutiveFailures = 0;
    this.chunkState[ci] = V;
    this.verifiedCount++;
    peer.chunksServed++;
    this.dispatchEvent(new CustomEvent('chunkVerified', {
      detail: { peerId, chunkIndex: ci, chunkData: data, total: this.totalChunks, verified: this.verifiedCount }
    }));
    if (this.verifiedCount === this.totalChunks) {
      this.done = true;
      this.dispatchEvent(new CustomEvent('complete'));
    } else {
      this._fillPipeline(peerId);
    }
    return true;
  }

  progress() {
    return {
      verified: this.verifiedCount,
      total: this.totalChunks,
      percent: this.totalChunks > 0 ? (this.verifiedCount / this.totalChunks) * 100 : 100,
    };
  }

  getVerifiedChunkIndices() {
    const out = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (this.chunkState[i] === V) out.push(i);
    }
    return out;
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
}
```

### packages/web/src/lib/transferManager.js

```text
import { WebRTCTransport } from './webrtc.js'
import { MSG } from '../webrtc/protocol.js'

export const transferManager = {
  swarm: null,
  transports: new Map(),
  chunks: [],
  fileRef: null,
  indexRef: null,
  fileRefs: null,
  servedRef: new Set(),
  downloadGuard: false,
  receivedMeta: null,
  streamHandle: null,
  _relayHandler: null,
  _relayClient: null,

  startSeederListener(client, onOffer) {
    this.stopSeederListener()
    if (!client) return
    this._relayClient = client
    this._relayHandler = (event) => {
      const { fromPeerId, payload } = event.detail
      if (payload.kind !== 'offer') return
      if (this.transports.has(fromPeerId)) return
      onOffer(fromPeerId)
    }
    client.addEventListener('relay', this._relayHandler)
  },

  stopSeederListener() {
    if (this._relayClient && this._relayHandler) {
      this._relayClient.removeEventListener('relay', this._relayHandler)
    }
    this._relayClient = null
    this._relayHandler = null
  },

  reset() {
    this.stopSeederListener()
    this.swarm = null
    this.transports.clear()
    this.chunks = []
    this.fileRef = null
    this.indexRef = null
    this.fileRefs = null
    this.servedRef = new Set()
    this.downloadGuard = false
    this.receivedMeta = null
    this.streamHandle = null
  },
}
```

### packages/web/src/lib/webrtc.js

```text
import { buildJSONBody, buildChunkBody, parseMessage } from '../webrtc/protocol.js';

export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
export const CONNECT_TIMEOUT_MS = 15000;

export class WebRTCTransport {
  constructor(signalingClient, remotePeerId, { initiator }) {
    this.signalingClient = signalingClient;
    this.remotePeerId = remotePeerId;
    this.initiator = initiator;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = null;
    this.jsonHandler = null;
    this.chunkHandler = null;
    this._pendingIce = [];
    this._remoteDescSet = false;
    this._closed = false;
    this._resolve = null;
    this._reject = null;

    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.signalingClient.relay(this.remotePeerId, {
        kind: 'ice-candidate',
        candidate: e.candidate.toJSON(),
      });
    };

    this._relayHandler = (event) => this._handleSignal(event.detail);
    this.signalingClient.addEventListener('relay', this._relayHandler);

    if (initiator) {
      this.channel = this.pc.createDataChannel('mesh');
      this.channel.binaryType = 'arraybuffer';
      this._bindChannel();
    } else {
      this.pc.ondatachannel = (e) => {
        this.channel = e.channel;
        this.channel.binaryType = 'arraybuffer';
        this._bindChannel();
      };
    }
  }

  _bindChannel() {
    this.channel.onopen = () => {
      if (this._resolve) {
        this._resolve();
        this._resolve = null;
      }
    };
    this.channel.onmessage = (e) => {
      try {
        const msg = parseMessage(new Uint8Array(e.data));
        if (msg.type === 0x00 && this.jsonHandler) Promise.resolve(this.jsonHandler(msg.data)).catch(() => {});
        else if (msg.type === 0x01 && this.chunkHandler) Promise.resolve(this.chunkHandler(msg)).catch(() => {});
      } catch (_) {}
    };
  }

  async _handleSignal(detail) {
    if (detail.fromPeerId !== this.remotePeerId || this._closed) return;
    const p = detail.payload;
    if (p.kind === 'offer') {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      this._remoteDescSet = true;
      await this._flushIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.signalingClient.relay(this.remotePeerId, { kind: 'answer', sdp: answer.sdp });
    } else if (p.kind === 'answer') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
      this._remoteDescSet = true;
      await this._flushIce();
    } else if (p.kind === 'ice-candidate') {
      if (this._remoteDescSet) {
        await this.pc.addIceCandidate(p.candidate).catch(() => {});
      } else {
        this._pendingIce.push(p.candidate);
      }
    }
  }

  async _flushIce() {
    const cs = this._pendingIce;
    this._pendingIce = [];
    for (const c of cs) {
      await this.pc.addIceCandidate(c).catch(() => {});
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      const timeout = setTimeout(() => {
        if (this._reject) {
          this._reject(new Error('Connection timeout'));
          this._reject = null;
          this.close();
        }
      }, CONNECT_TIMEOUT_MS);
      const orig = this._resolve;
      this._resolve = () => { clearTimeout(timeout); orig(); };
      if (this.initiator) {
        this.pc.createOffer().then((offer) => {
          this.pc.setLocalDescription(offer);
          this.signalingClient.relay(this.remotePeerId, { kind: 'offer', sdp: offer.sdp });
        });
      }
    });
  }

  sendJSON(obj) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(buildJSONBody(obj));
    }
  }

  sendChunk(index, hashHex, proof, data) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(buildChunkBody(index, hashHex, proof, data));
    }
  }

  onJSON(handler) { this.jsonHandler = handler; }
  onChunk(handler) { this.chunkHandler = handler; }

  close() {
    if (this._closed) return;
    this._closed = true;
    this.signalingClient.removeEventListener('relay', this._relayHandler);
    if (this.channel) this.channel.close();
    this.pc.close();
    if (this._reject) {
      this._reject(new Error('Transport closed'));
      this._reject = null;
    }
  }
}
```

### packages/web/src/main.jsx

```text
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

### packages/web/src/pages/Dashboard.jsx

```text
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { transferManager as M } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import Card from '../components/shared/Card.jsx'
import PeerList from '../components/PeerList.jsx'
import ChunkGrid from '../components/ChunkGrid.jsx'
import SpeedChart from '../components/SpeedChart.jsx'
import PeerGraph from '../components/PeerGraph.jsx'

export default function Dashboard() {
  const navigate = useNavigate()
  const roomCode = useSignalingStore((s) => s.roomCode)
  const { role, peerStats, chunkStates, speedHistory, status, fileMeta, progress, seeding } = useTransferStore()
  const { disconnectAll, triggerDownload, stopSeeding, resumeSeeding, addSenderPeer } = useTransfer()
  const downloadFired = useRef(false)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (status !== 'idle') return
    try {
      const raw = localStorage.getItem('mesh-transfer-state')
      if (!raw) { navigate('/', { replace: true }); return }
      const saved = JSON.parse(raw)
      if (!saved || !saved.fileMeta || saved.status === 'idle') { navigate('/', { replace: true }); return }
      const store = useTransferStore.getState()
      if (store.status !== 'idle') return
      const chunks = saved.progress?.total ? new Array(saved.progress.total).fill('pending') : []
      if (saved.progress?.verified > 0) {
        for (let i = 0; i < saved.progress.verified && i < chunks.length; i++) chunks[i] = 'verified'
      }
      useTransferStore.setState({ ...saved, chunkStates: chunks })
    } catch { navigate('/', { replace: true }) }
  }, [status])

  useEffect(() => {
    if (status === 'transferring' && !startRef.current) {
      startRef.current = Date.now()
    }
    if (status === 'transferring') {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      }, 1000)
    }
    if (status === 'complete' || status === 'idle' || status === 'error') {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [status])

  useEffect(() => {
    if (status === 'idle') {
      startRef.current = null
      setElapsed(0)
    }
  }, [status])

  useEffect(() => {
    if (status === 'complete' && role === 'receiver' && !downloadFired.current) {
      downloadFired.current = true
      triggerDownload()
    }
  }, [status, role, triggerDownload])

  useEffect(() => {
    const c = useSignalingStore.getState().client
    if (!c || !fileMeta) return
    const hasData = M.indexRef || (M.receivedMeta && M.chunks.length > 0)
    if (!hasData) return
    const idx = M.indexRef || {
      totalChunks: M.receivedMeta.totalChunks,
      chunkSize: M.receivedMeta.chunkSize,
      merkleRoot: M.receivedMeta.merkleRoot,
      files: M.receivedMeta.files,
      fileName: fileMeta.fileName,
      fileSize: fileMeta.fileSize,
    }
    M.startSeederListener(c, (fromPeerId) => {
      if (M.transports.has(fromPeerId)) return
      const t = new WebRTCTransport(c, fromPeerId, { initiator: false })
      t.connect().then(() => addSenderPeer(t, idx)).catch(() => {})
    })
    return () => M.stopSeederListener()
  }, [fileMeta, addSenderPeer])

  const handleDismiss = useCallback(() => {
    const currentRole = useTransferStore.getState().role
    M.stopSeederListener()
    try {
      const signal = useSignalingStore.getState()
      if (signal.client) signal.disconnect()
    } catch {}
    try { disconnectAll() } catch {}
    startRef.current = null
    setElapsed(0)
    navigate(currentRole === 'sender' ? '/send' : '/receive')
  }, [disconnectAll, navigate])

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const fileCount = fileMeta?.files?.length || 1
  const totalChunks = progress.total || 0
  const verifiedChunks = progress.verified || 0
  const percent = totalChunks > 0 ? (verifiedChunks / totalChunks) * 100 : 0
  const speed = speedHistory.length > 0 ? speedHistory[speedHistory.length - 1].mbps || 0 : 0
  const done = status === 'complete' || status === 'error'

  if (status === 'idle') {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-8 py-16">
          <svg className="mb-4 h-12 w-12 text-[var(--txt-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <p className="text-lg font-medium text-[var(--txt-primary)]">No Active Transfer</p>
          <p className="mt-1 text-sm text-[var(--txt-secondary)] text-center max-w-sm">
            Start a new transfer from the Send page, or join one from the Receive page.
          </p>
          <div className="mt-6 flex gap-3">
            <Button variant="primary" onClick={() => navigate('/send')}>
              SEND A FILE
            </Button>
            <Button variant="secondary" onClick={() => navigate('/receive')}>
              RECEIVE
            </Button>
          </div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Card className="text-center">
            <p className="text-2xl font-bold text-[var(--accent)]">0</p>
            <p className="mt-1 text-xs text-[var(--txt-secondary)] uppercase tracking-wider">Active Transfers</p>
          </Card>
          <Card className="text-center">
            <p className="text-2xl font-bold text-[var(--txt-primary)]">—</p>
            <p className="mt-1 text-xs text-[var(--txt-secondary)] uppercase tracking-wider">Peers Connected</p>
          </Card>
          <Card className="text-center">
            <p className="text-2xl font-bold text-[var(--txt-primary)]">—</p>
            <p className="mt-1 text-xs text-[var(--txt-secondary)] uppercase tracking-wider">Data Transferred</p>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-4">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-wider text-[var(--accent)]">mesh</span>
          <Badge color="amber">{roomCode || '\u2014\u2014'}</Badge>
          {fileMeta && (
            <span className="hidden items-center gap-2 text-sm sm:flex">
              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                role === 'sender' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-[var(--success)]/10 text-[var(--success)]'
              }`}>
                {role === 'sender' ? 'SENDER' : 'RECEIVER'}
              </span>
              <span className="text-[var(--txt-secondary)]">{fileMeta.fileName} · {fileCount} file{fileCount > 1 ? 's' : ''}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-2xl font-bold tracking-wider text-[var(--txt-primary)]">{mmss}</span>
          <div className="hidden items-center gap-1 text-xs text-[var(--txt-secondary)] sm:flex">
            <span>{verifiedChunks}/{totalChunks} chunks</span>
            <span className="text-[var(--txt-dim)]">·</span>
            <span className={speed > 0 ? 'text-[var(--accent)]' : ''}>{speed.toFixed(1)} MB/s</span>
          </div>
          {!done && role === 'sender' && (
            <Button variant="secondary" onClick={seeding ? stopSeeding : resumeSeeding}>
              {seeding ? 'STOP SEED' : 'RESUME SEED'}
            </Button>
          )}
          <Button variant={done ? 'primary' : 'danger'} onClick={handleDismiss}>
            {done ? 'DISMISS' : 'ABORT'}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-4">
        <div className="w-80 shrink-0">
          <Card className="h-full">
            <PeerList peerStats={peerStats} />
            <div className="mt-4 border-t border-[var(--border)] pt-4 space-y-3">
              <div className="space-y-2 text-xs text-[var(--txt-secondary)]">
                <div className="flex justify-between">
                  <span>Role</span>
                  <span className={`font-mono ${role === 'sender' ? 'text-[var(--accent)]' : 'text-[var(--success)]'}`}>
                    {role === 'sender' ? 'Seeder' : 'Leecher'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Files</span>
                  <span className="font-mono text-[var(--txt-primary)]">{fileCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Size</span>
                  <span className="font-mono text-[var(--txt-primary)]">{fileMeta ? (fileMeta.fileSize / 1e6).toFixed(1) : '—'} MB</span>
                </div>
                <div className="flex justify-between">
                  <span>Chunks</span>
                  <span className="font-mono text-[var(--txt-primary)]">{totalChunks}</span>
                </div>
                <div className="flex justify-between">
                  <span>Speed</span>
                  <span className="font-mono text-[var(--accent)]">{speed.toFixed(1)} MB/s</span>
                </div>
              </div>
              <div className="border-t border-[var(--border)] pt-3 space-y-1.5 text-[10px] leading-relaxed text-[var(--txt-muted)]">
                <p>🔐 <span className="text-[var(--txt-secondary)]">DTLS 1.3 encrypted · P2P channel</span></p>
                <p>🧩 <span className="text-[var(--txt-secondary)]">{fileMeta?.chunkSize || '—'} bytes per chunk · Merkle verified</span></p>
                <p>📡 <span className="text-[var(--txt-secondary)]">{roomCode ? `Room ${roomCode}` : 'Direct connection'}</span></p>
                {verifiedChunks > 0 && (
                  <p>📊 <span className="text-[var(--txt-secondary)]">{((verifiedChunks * (fileMeta?.chunkSize || 0)) / 1e6).toFixed(1)} MB verified so far</span></p>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-[var(--txt-secondary)]">
                {role === 'sender' ? 'Upload Progress' : 'Download Progress'}
              </span>
              <span className="font-mono text-sm font-bold text-[var(--accent)]">{Math.round(percent)}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-500 ease-out"
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-[var(--txt-muted)]">
              <span>0%</span>
              <span>{verifiedChunks} / {totalChunks} chunks</span>
              <span>100%</span>
            </div>
          </Card>

          <ChunkGrid chunkStates={chunkStates} transferStatus={status} />

          <Card className="flex-1">
            <PeerGraph className="h-80 w-full" chunkStates={chunkStates} role={role} peerStats={peerStats} seeding={seeding} />
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--txt-secondary)]">
              {role === 'sender' ? (
                <>
                  <span>
                    SENT:{' '}
                    <span className="font-mono text-[var(--accent)]">{verifiedChunks}</span>
                    <span className="text-[var(--txt-dim)]"> / {totalChunks} chunks</span>
                  </span>
                  <span>
                    SEEDING:{' '}
                    <span className={`font-mono ${seeding ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                      {seeding ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span>
                    RECEIVED:{' '}
                    <span className="font-mono text-[var(--success)]">{verifiedChunks}</span>
                    <span className="text-[var(--txt-dim)]"> / {totalChunks} chunks</span>
                  </span>
                  <span>
                    FILES:{' '}
                    <span className="font-mono text-[var(--accent)]">{fileCount}</span>
                  </span>
                </>
              )}
              <span>
                PEERS:{' '}
                <span className="font-mono text-[var(--accent)]">{peerStats.length}</span>
              </span>
              <span>
                SIZE:{' '}
                <span className="font-mono text-[var(--txt-primary)]">
                  {fileMeta ? (fileMeta.fileSize / 1e6).toFixed(1) : 0} MB
                </span>
              </span>
            </div>
          </Card>

          <SpeedChart data={speedHistory} peerCount={peerStats.length} />
        </div>
      </div>
    </div>
  )
}
```

### packages/web/src/pages/History.jsx

```text
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import Card from '../components/shared/Card.jsx'
import { getHistory, clearHistory, removeHistoryEntry } from '../store/useHistoryStore.js'
import { formatBytes, formatDuration } from '../lib/format.js'

const STATUS_META = {
  complete: { color: 'green', label: 'Complete' },
  failed: { color: 'red', label: 'Failed' },
  partial: { color: 'amber', label: 'Partial' },
}

export default function History() {
  const [entries, setEntries] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    setEntries(getHistory())
    const handler = () => setEntries(getHistory())
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  function handleClear() {
    if (!window.confirm('Clear all transfer history?')) return
    setEntries(clearHistory())
  }

  function handleRejoin(e) {
    if (!e.roomCode) return
    navigate(`/receive?code=${e.roomCode}`)
  }

  function handleRemove(id) {
    setEntries(removeHistoryEntry(id))
  }

  function roleLabel(role) {
    return role === 'sender' ? 'Sent' : 'Received'
  }

  if (entries.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8">
          <p className="text-xs tracking-widest uppercase text-[var(--accent)]">History</p>
          <h1 className="text-2xl font-bold text-[var(--txt-primary)]">Transfer History</h1>
        </div>
        <div className="flex flex-col items-center py-24">
          <svg className="mb-4 h-12 w-12 text-[var(--txt-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-lg text-[var(--txt-secondary)]">No transfer history yet</p>
          <p className="mt-1 text-sm text-[var(--txt-secondary)]">Completed transfers will appear here</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs tracking-widest uppercase text-[var(--accent)]">History</p>
          <h1 className="text-2xl font-bold text-[var(--txt-primary)]">Transfer History</h1>
        </div>
        <Button variant="ghost" className="text-xs text-[var(--txt-muted)] hover:text-[var(--error)]" onClick={handleClear}>
          Clear all
        </Button>
      </div>

      <div className="space-y-3">
        {entries.map((e) => {
          const meta = STATUS_META[e.status] || STATUS_META.failed
          return (
            <Card key={e.id} className="group transition-all hover:border-[var(--border-hover)]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <Badge color={meta.color}>{meta.label}</Badge>
                    <span className="text-xs uppercase tracking-wider text-[var(--txt-muted)]">
                      {roleLabel(e.role)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className="truncate font-mono text-sm font-medium text-[var(--txt-primary)]">
                      {e.fileName}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--txt-secondary)]">
                      <span>{formatBytes(e.fileSize)}</span>
                      {e.fileCount > 1 && <span>{e.fileCount} files</span>}
                      <span>{e.totalChunks} chunks</span>
                      <span>·</span>
                      <span>{formatDuration(e.duration)}</span>
                      {e.avgSpeed > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-[var(--accent)]">{e.avgSpeed.toFixed(1)} MB/s</span>
                        </>
                      )}
                      {e.peers > 0 && (
                        <>
                          <span>·</span>
                          <span>{e.peers} peer{e.peers > 1 ? 's' : ''}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-[var(--txt-muted)]">
                    {new Date(e.date).toLocaleString()}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {e.roomCode && (
                    <Button
                      variant="secondary"
                      className="text-xs px-3 py-1.5"
                      onClick={() => handleRejoin(e)}
                    >
                      Rejoin room
                    </Button>
                  )}
                  <button
                    onClick={() => handleRemove(e.id)}
                    className="cursor-pointer rounded-md p-1.5 text-[var(--txt-muted)] opacity-0 transition-opacity hover:text-[var(--error)] group-hover:opacity-100"
                    title="Remove from history"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {entries.length > 0 && (
        <p className="mt-4 text-center text-[10px] text-[var(--txt-muted)]">
          {entries.length} transfer{entries.length > 1 ? 's' : ''} · Oldest entries are automatically removed
        </p>
      )}
    </div>
  )
}
```

### packages/web/src/pages/Landing.jsx

```text
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import LandingGraph from '../components/LandingGraph.jsx'

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6 } },
}

export default function Landing() {
  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col sm:min-h-[calc(100vh-65px)]">
      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="flex flex-col justify-center gap-6 px-6 pt-12 pb-6 sm:px-8 sm:pt-16 sm:pb-8 lg:w-2/5 lg:px-16 lg:py-16">
          <motion.div {...fadeUp} className="flex flex-col gap-1">
            <h1 className="text-4xl font-bold tracking-tight text-[var(--txt-primary)] sm:text-5xl lg:text-7xl">Decentralized.</h1>
            <h1 className="text-4xl font-bold tracking-tight text-[var(--txt-primary)] sm:text-5xl lg:text-7xl">Unstoppable.</h1>
            <h1 className="text-4xl font-bold tracking-tight text-[var(--accent)] sm:text-5xl lg:text-7xl">Data Transfer.</h1>
          </motion.div>

          <motion.p {...fadeUp} className="max-w-md text-sm leading-relaxed text-[var(--txt-secondary)] sm:text-base">
            Mesh moves files straight between browsers over an encrypted P2P connection. Nothing touches a server.
          </motion.p>

          <motion.div {...fadeUp} className="flex flex-wrap gap-3">
            <Link to="/send"><Button variant="primary" className="w-36 sm:w-40">Start Transfer</Button></Link>
            <Link to="/receive"><Button variant="secondary" className="w-36 sm:w-40">Receive File</Button></Link>
          </motion.div>

          <motion.div {...fadeUp} className="flex flex-wrap gap-2">
            <Badge color="green">6 PEERS ACTIVE</Badge>
            <Badge color="amber">132 GB TRANSFERRED</Badge>
            <Badge color="gray" dot={false}>AES-256-GCM E2EE</Badge>
          </motion.div>
        </div>

        <div className="relative min-h-[300px] sm:min-h-[400px] lg:min-h-auto lg:w-3/5">
          <LandingGraph className="absolute inset-0 h-full w-full" />
        </div>
      </div>

      <footer className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4 text-xs text-[var(--txt-muted)] sm:px-8">
        <span>MESH v0.1.0</span>
        <span>&copy; {new Date().getFullYear()} Mesh</span>
      </footer>
    </div>
  )
}
```

### packages/web/src/pages/NotFound.jsx

```text
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Button from '../components/shared/Button.jsx'

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/send', label: 'Send' },
  { to: '/receive', label: 'Receive' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/history', label: 'History' },
]

export default function NotFound() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId
    const dots = Array.from({ length: 60 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2 + 0.5,
    }))

    function resize() {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const d of dots) {
        d.x += d.vx
        d.y += d.vy
        if (d.x < 0 || d.x > canvas.width) d.vx *= -1
        if (d.y < 0 || d.y > canvas.height) d.vy *= -1
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(245, 158, 11, 0.15)'
        ctx.fill()
      }
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x
          const dy = dots[i].y - dots[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            ctx.beginPath()
            ctx.moveTo(dots[i].x, dots[i].y)
            ctx.lineTo(dots[j].x, dots[j].y)
            ctx.strokeStyle = `rgba(245, 158, 11, ${(1 - dist / 120) * 0.1})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }
      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="relative flex min-h-[calc(100vh-57px)] flex-col items-center justify-center overflow-hidden px-6 sm:min-h-[calc(100vh-65px)]">
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex flex-col items-center gap-6 text-center"
      >
        <div className="relative">
          <span className="text-[clamp(6rem,20vw,12rem)] font-black leading-none tracking-tighter text-[var(--txt-primary)]/5 select-none">
            404
          </span>
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="absolute inset-0 flex items-center justify-center text-[clamp(3rem,10vw,6rem)] font-black leading-none tracking-tighter text-[var(--accent)]"
          >
            404
          </motion.span>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="text-sm text-[var(--txt-secondary)] sm:text-base"
        >
          This page wandered off the mesh.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.4 }}
          className="flex flex-wrap justify-center gap-3"
        >
          {LINKS.map((link) => (
            <Link key={link.to} to={link.to}>
              <Button variant={link.to === '/' ? 'primary' : 'secondary'} className="text-xs px-4 py-2">
                {link.label}
              </Button>
            </Link>
          ))}
        </motion.div>
      </motion.div>
    </div>
  )
}
```

### packages/web/src/pages/Receive.jsx

```text
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import { MSG } from '../webrtc/protocol.js'
import { motion, AnimatePresence } from 'framer-motion'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import Card from '../components/shared/Card.jsx'
import Accordion from '../components/shared/Accordion.jsx'
import ProgressBar from '../components/shared/ProgressBar.jsx'
import ConnectionCode from '../components/ConnectionCode.jsx'
import FileManifest from '../components/FileManifest.jsx'

export default function Receive() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)
  const [roomClosed, setRoomClosed] = useState(false)
  const swarmRef = useRef(null)
  const transportsRef = useRef([])
  const downloadGuardRef = useRef(false)

  const joinRoom = useSignalingStore((s) => s.joinRoom)
  const roomCode = useSignalingStore((s) => s.roomCode)
  const signalingStatus = useSignalingStore((s) => s.status)
  const signalingPeers = useSignalingStore((s) => s.peers)

  const fileMeta = useTransferStore((s) => s.fileMeta)
  const status = useTransferStore((s) => s.status)
  const progress = useTransferStore((s) => s.progress)
  const saveMode = useTransferStore((s) => s.saveMode)
  const setSaveMode = useTransferStore((s) => s.setSaveMode)
  const setComplete = useTransferStore((s) => s.setComplete)

  const { startReceiving, addReceiverPeer, triggerDownload, resetDownload, disconnectAll } = useTransfer()

  async function handleJoin(code) {
    setJoining(true)
    setJoinError(null)
    try {
      const result = await joinRoom(code)
      useTransferStore.getState().setRoomCode(code.toUpperCase())
      useTransferStore.getState().startAsReceiver()
      for (const peerId of result.existingPeers || []) {
        const client = useSignalingStore.getState().client
        const transport = new WebRTCTransport(client, peerId, { initiator: true })
        transport.onJSON(async (msg) => {
          if (msg.type === MSG.FILE_OFFER && !swarmRef.current) {
            swarmRef.current = await startReceiving(msg)
          }
        })
        await transport.connect()
        transportsRef.current.push(transport)
      }
    } catch (err) {
      setJoinError(err.message || 'Failed to join room')
    } finally {
      setJoining(false)
    }
  }

  function handleBeginTransfer() {
    if (!swarmRef.current) return
    for (const transport of transportsRef.current) {
      addReceiverPeer(transport, swarmRef.current)
    }
  }

  function handleDismiss() {
    try { useSignalingStore.getState().disconnect() } catch {}
    disconnectAll()
    swarmRef.current = null
    transportsRef.current = []
    downloadGuardRef.current = false
    setRoomClosed(false)
    navigate('/receive')
  }

  useEffect(() => {
    if (status === 'transferring') navigate('/dashboard')
  }, [status, navigate])

  useEffect(() => {
    if (status === 'complete' && fileMeta && !downloadGuardRef.current) {
      downloadGuardRef.current = true
      triggerDownload()
    }
  }, [status, fileMeta, triggerDownload])

  useEffect(() => {
    if (!roomCode) return
    const unsub = useSignalingStore.subscribe((s, prev) => {
      if (prev.peers.length > 0 && s.peers.length === 0 && status !== 'complete') {
        setRoomClosed(true)
      }
      if (prev.status === 'connected' && s.status === 'disconnected' && status !== 'complete') {
        setRoomClosed(true)
      }
    })
    return unsub
  }, [roomCode, status])

  const prefillCode = searchParams.get('code') || ''
  const showFileMeta = !!fileMeta

  const accordionsBefore = (
    <div className="mt-8 space-y-2">
      <Accordion title="How to receive a file">
        <ol className="list-inside list-decimal space-y-1.5">
          <li>Ask the sender for their room code (a 6-character code like <span className="font-mono text-[var(--txt-primary)]">WOLF482</span>).</li>
          <li>Type it in above, or scan the QR code directly from their screen.</li>
          <li>Once linked, your browser connects directly to theirs — no middlemen.</li>
          <li>When they send a file offer, review what's being shared and hit "Begin Transfer".</li>
          <li>Your browser downloads chunks, verifies each one, and saves the file.</li>
        </ol>
      </Accordion>
      <Accordion title="Is it secure?">
        <p>Yes. The signaling server only helps establish the connection — it never sees your data. After that, everything flows through a direct encrypted channel between browsers.</p>
        <ul className="mt-2 space-y-1">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">Direct peer-to-peer</strong> — no data touches any server</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">Encrypted in transit</strong> via WebRTC DTLS (same encryption as HTTPS)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">Integrity checked</strong> — every chunk is verified against a Merkle tree</span>
          </li>
        </ul>
      </Accordion>
      <Accordion title="QR scanning tips">
        <p>Click the QR icon in the input field to open your camera. Point it at the sender's QR code — the room code fills in automatically.</p>
        <p className="mt-2 text-xs text-[var(--txt-dim)]">Works best on devices with rear-facing cameras. If the scanner doesn't start, you can always type the code manually.</p>
      </Accordion>
    </div>
  )

  const accordionsAfter = (
    <div className="mt-6 space-y-2">
      <Accordion title="What happens next?" defaultOpen>
        <p>You're linked to the sender and waiting for them to offer a file. As soon as they do, you'll see the file details here. You can then choose to begin receiving.</p>
        <p className="mt-2 text-xs text-[var(--txt-dim)]">Make sure both browsers stay open and connected. If the connection drops, you'll need a new room code.</p>
      </Accordion>
    </div>
  )

  const accordionsTransfer = (
    <div className="mt-6 space-y-2">
      <Accordion title="What's happening right now?">
        <p>Your browser is downloading chunks from the sender. Each chunk is checked against the file's Merkle tree to make sure it hasn't been tampered with. Once all chunks arrive and verify, the file is reconstructed and saved.</p>
        <p className="mt-2 text-xs text-[var(--txt-dim)]">For larger files, you may be asked where to save — this lets the browser stream data directly to disk instead of holding it all in memory.</p>
      </Accordion>
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`mx-auto min-h-[calc(100vh-4rem)] px-6 ${
        showFileMeta ? 'py-12 lg:flex lg:flex-row lg:gap-8 max-w-6xl' : 'max-w-2xl pt-16 pb-8'
      }`}
    >
      <div className={`flex flex-col gap-6 ${showFileMeta ? 'lg:w-[35%]' : 'w-full'}`}>
        <div>
          <p className="mb-1 text-xs uppercase tracking-widest text-[var(--accent)]">Secure Peer-to-Peer</p>
          <h1 className="text-3xl font-bold text-[var(--txt-primary)]">Receive a File</h1>
          <p className="mt-2 text-base text-[var(--txt-secondary)]">
            {!showFileMeta
              ? 'Enter the room code from the sender to link up. Once connected, you can download files directly from their browser — no servers involved.'
              : fileMeta?.fileName
                ? `Ready to receive "${fileMeta.fileName}"`
                : 'You\'ve linked to the sender. Waiting for them to offer a file...'}
          </p>
        </div>

        {!roomCode && !showFileMeta && (
          <>
            <ConnectionCode onJoin={handleJoin} joining={joining} defaultValue={prefillCode} />
            <AnimatePresence>
              {joinError && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="flex items-center gap-2 rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-4 py-3">
                  <svg className="h-4 w-4 shrink-0 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-[var(--error)]">{joinError}</p>
                </motion.div>
              )}
              {joining && (
                <div className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/10 bg-[var(--accent)]/5 px-4 py-3">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                  <span className="text-xs text-[var(--accent)]/80">Joining room...</span>
                </div>
              )}
            </AnimatePresence>
          </>
        )}

        {roomCode && !showFileMeta && (
          <>
            <AnimatePresence>
              {roomClosed && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-4 py-4 text-center">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--error)]/10">
                      <svg className="h-5 w-5 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-[var(--error)]">Connection Lost</p>
                    <p className="mt-1 text-xs text-[var(--error)]/70">The sender has disconnected or the room was closed.</p>
                    <button onClick={handleDismiss} className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--error)]/20 px-3 py-1.5 text-xs font-medium text-[var(--error)] transition-colors hover:bg-[var(--error)]/5">
                      Leave Room
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge color="green" dot>LINK ESTABLISHED</Badge>
                  <span className="text-xs text-[var(--txt-secondary)]">via relay</span>
                </div>
                <button onClick={handleDismiss} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border-light)] px-2.5 py-1.5 text-xs font-medium text-[var(--txt-secondary)] transition-colors hover:border-[var(--error)]/40 hover:text-[var(--error)] hover:bg-[var(--error)]/5">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Dismiss
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--success)]/10">
                  <svg className="h-5 w-5 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--txt-primary)]">Connected to room</p>
                  <p className="font-mono text-xs text-[var(--txt-dim)]">{roomCode}</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-[var(--txt-secondary)]">
                You're in the room. Once the sender offers a file, you'll see the details and can start the transfer. No action needed right now.
              </p>
            </Card>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/10 bg-[var(--accent)]/5 px-4 py-3">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
              <span className="text-xs text-[var(--accent)]/80">Listening for file offer...</span>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="mb-2 text-xs uppercase tracking-widest text-[var(--txt-secondary)]">Save preference</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSaveMode('auto')}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                    saveMode === 'auto'
                      ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                      Specific folder
                    </button>
                <button
                  onClick={() => setSaveMode('files')}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                    saveMode === 'files'
                      ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Files
                </button>
              </div>
              <p className="mt-2 text-xs text-[var(--txt-secondary)]">
                {saveMode === 'auto' ? 'Saved to a folder you pick — all files together in one place' : 'Each file downloaded individually to your default downloads location'}
              </p>
            </div>
            {accordionsAfter}
          </>
        )}
      </div>

      {showFileMeta && (
        <div className={`flex-1 ${roomCode ? 'lg:w-[65%]' : ''}`}>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
          >
            <AnimatePresence>
              {roomClosed && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-4 py-4 text-center">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--error)]/10">
                      <svg className="h-5 w-5 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-[var(--error)]">Connection Lost</p>
                    <p className="mt-1 text-xs text-[var(--error)]/70">The sender has disconnected or the room was closed.</p>
                    <button onClick={handleDismiss} className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--error)]/20 px-3 py-1.5 text-xs font-medium text-[var(--error)] transition-colors hover:bg-[var(--error)]/5">
                      Leave Room
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <Badge color={status === 'complete' ? 'green' : 'amber'} dot>
                  {status === 'complete' ? 'RECEIVED' : status === 'transferring' ? 'DOWNLOADING' : 'OFFERED'}
                </Badge>
                <span className="text-xs text-[var(--txt-secondary)]">
                  {status === 'complete' ? 'Done!' : status === 'transferring' ? 'In progress' : 'Review and accept'}
                </span>
              </div>
              <FileManifest fileMeta={fileMeta} />
            </Card>

            {status === 'file-offered' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                  <p className="mb-2 text-xs uppercase tracking-widest text-[var(--txt-secondary)]">Save as</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSaveMode('auto')}
                      className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                        saveMode === 'auto'
                          ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)]'
                      }`}
                    >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Specific folder
                    </button>
                    <button
                      onClick={() => setSaveMode('files')}
                      className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                        saveMode === 'files'
                          ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)]'
                      }`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Files
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-[var(--txt-secondary)]">
                    {saveMode === 'auto'
                      ? 'Saved to a folder you pick — all files together in one place'
                      : 'Each file downloaded individually to your default downloads location'}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                  <Button onClick={handleBeginTransfer} className="w-full py-3.5 text-sm font-bold tracking-widest uppercase">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Begin Transfer
                  </Button>
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-[var(--txt-dim)]">Files transferred directly peer-to-peer. Browser must stay open.</p>
                    <button onClick={handleDismiss} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border-light)] px-2.5 py-1 text-xs font-medium text-[var(--txt-secondary)] transition-colors hover:border-[var(--error)]/40 hover:text-[var(--error)] hover:bg-[var(--error)]/5">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            {status === 'transferring' && (
              <Card className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                    <span className="text-sm font-medium text-[var(--txt-primary)]">Downloading...</span>
                  </div>
                  <span className="font-mono text-sm text-[var(--txt-dim)]">
                    {progress.verified} / {progress.total} chunks
                  </span>
                </div>
                <ProgressBar percent={progress.percent || 0} />
                <p className="text-xs text-[var(--txt-dim)]">
                  Each chunk is verified against the Merkle tree before being accepted.
                </p>
              </Card>
            )}

            {status === 'complete' && (
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                className="rounded-lg border border-[var(--success)]/20 bg-[var(--success)]/5 px-6 py-5 text-center"
              >
                <svg className="mx-auto mb-2 h-8 w-8 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-lg font-medium text-[var(--success)]">Download Complete</p>
                <p className="mt-1 text-sm text-[var(--success)]/60">{progress.verified} chunks verified and saved</p>
                <p className="mt-3 text-xs text-[var(--txt-dim)]">
                  File has been saved to your downloads. You can close this page.
                </p>
                <div className="mt-5 flex gap-3">
                  <Button onClick={() => { resetDownload(); triggerDownload() }} variant="secondary" className="flex-1 py-3 text-sm font-semibold">
                    RECEIVE AGAIN
                  </Button>
                  <Button onClick={handleDismiss} variant="primary" className="flex-1 py-3 text-sm font-semibold">
                    RECEIVE ANOTHER FILE
                  </Button>
                </div>
              </motion.div>
            )}

            {status === 'error' && (
              <Card className="border-[var(--error)]/20 bg-[var(--error)]/5 text-center">
                <svg className="mx-auto mb-2 h-8 w-8 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-lg font-medium text-[var(--error)]">Transfer Failed</p>
                <p className="mt-1 text-sm text-[var(--error)]/60">Something went wrong — the connection may have dropped or a chunk failed verification.</p>
                <div className="mt-5 flex gap-3">
                  <Button onClick={() => { resetDownload(); triggerDownload() }} variant="secondary" className="flex-1 py-3 text-sm font-semibold">
                    RETRY
                  </Button>
                  <Button onClick={handleDismiss} variant="primary" className="flex-1 py-3 text-sm font-semibold">
                    RECEIVE ANOTHER FILE
                  </Button>
                </div>
              </Card>
            )}

            {status === 'transferring' && accordionsTransfer}

            {status === 'file-offered' && (
              <div className="space-y-2">
                <Accordion title="What am I agreeing to?">
                  <p>By clicking Begin Transfer, your browser will receive encrypted chunks directly from the sender. Each chunk is verified for integrity. Once all chunks arrive, the file is reconstructed and saved automatically.</p>
                  <p className="mt-2 text-xs text-[var(--txt-dim)]">The sender will see that you've started receiving. You can close your browser at any time to cancel.</p>
                </Accordion>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {!roomCode && !showFileMeta && accordionsBefore}
    </motion.div>
  )
}
```

### packages/web/src/pages/Send.jsx

```text
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { transferManager as M } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import Card from '../components/shared/Card.jsx'
import Badge from '../components/shared/Badge.jsx'
import Accordion from '../components/shared/Accordion.jsx'
import FileDropZone from '../components/FileDropZone.jsx'
import RoomCode from '../components/RoomCode.jsx'
import StatusLog from '../components/StatusLog.jsx'

export default function Send() {
  const navigate = useNavigate()
  const [fileIndex, setFileIndex] = useState(null)
  const [lines, setLines] = useState([])
  const startRef = useRef(null)
  const fileIdxRef = useRef(null)

  const roomCode = useSignalingStore((s) => s.roomCode)
  const peers = useSignalingStore((s) => s.peers)
  const createRoom = useSignalingStore((s) => s.createRoom)
  const client = useSignalingStore((s) => s.client)

  const st = useTransferStore((s) => s.status)
  const prog = useTransferStore((s) => s.progress)
  const meta = useTransferStore((s) => s.fileMeta)

  const { startSending, addSenderPeer, disconnectAll } = useTransfer()

  function addLine(t) { setLines((p) => [...p, t]) }

  async function handleFileReady(file, index, fileRefs) {
    fileIdxRef.current = index
    setFileIndex(index)
    addLine(`${index.files.length > 1 ? index.files.length + ' files' : index.fileName} (${(index.fileSize / 1e6).toFixed(1)} MB)`)
    addLine('Indexing & hashing chunks for verification...')
    await startSending(file, index, fileRefs)
    addLine('Creating encrypted relay room...')
    const room = await createRoom()
    useTransferStore.getState().setRoomCode(room.roomCode)
    addLine(`Room active: ${room.roomCode}`)
    startRef.current = Date.now()
    M.startSeederListener(useSignalingStore.getState().client, (fromPeerId) => {
      addLine(`Peer connected: ${fromPeerId.slice(0, 12)}...`)
      addLine('Establishing WebRTC data channel...')
      const c = useSignalingStore.getState().client
      if (!c) return
      const t = new WebRTCTransport(c, fromPeerId, { initiator: false })
      t.connect().then(() => {
        addLine('Channel open — encrypted')
        addLine('Sending file offer...')
        addSenderPeer(t, fileIdxRef.current)
        addLine('Transfer started!')
      }).catch((e) => {
        addLine(`Connection error: ${e.message}`)
      })
    })
    addLine('Waiting for someone to join with your room code...')
  }

  useEffect(() => {
    if (peers.length > 0) {
      addLine(`${peers.length} peer${peers.length > 1 ? 's' : ''} in room`)
    }
  }, [peers.length])

  useEffect(() => {
    if (st === 'transferring') navigate('/dashboard')
    return () => M.stopSeederListener()
  }, [st, navigate])

  useEffect(() => {
    if (st === 'complete') { addLine('All chunks sent and verified'); addLine('Transfer complete!') }
    else if (st === 'error') { addLine(`Error: ${useTransferStore.getState().error}`) }
  }, [st])

  function handleCancel() {
    M.stopSeederListener()
    useSignalingStore.getState().disconnect()
    disconnectAll(); startRef.current = null; fileIdxRef.current = null
    setFileIndex(null); setLines([])
  }

  const done = st === 'complete'
  const xfer = st === 'transferring'
  const hp = peers.length > 0
  const secs = startRef.current ? Math.floor((Date.now() - startRef.current) / 1000) : 0
  const uptime = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
  const fileCount = fileIndex?.files?.length || 1
  const totalSize = fileIndex?.fileSize || 0

  const infoAccordions = (
    <div className="mt-8 space-y-2">
      <Accordion title="How it works">
        <ol className="list-inside list-decimal space-y-1.5">
          <li>Pick the file or folder you want to send.</li>
          <li>Mesh splits it into encrypted chunks and creates a unique room code.</li>
          <li>Share the code with your friend — it also works as a QR code.</li>
          <li>When they join, a direct WebRTC connection forms between you two.</li>
          <li>Your browser sends chunks peer-to-peer. No servers see your data.</li>
          <li>Done! The receiver can download right from their browser.</li>
        </ol>
        <p className="mt-3 text-xs text-[var(--txt-dim)]">Everything stays in-browser. Nothing is stored on any server.</p>
      </Accordion>
      <Accordion title="Security & encryption">
        <p>Your file never touches any server. The signaling relay only helps peers find each other — after that, it's a direct encrypted WebRTC connection.</p>
        <ul className="mt-2 space-y-1">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">End-to-end encrypted</strong> — DTLS keys negotiated peer-to-peer</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">Chunk verification</strong> — each piece is SHA-256 checked against the Merkle root</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">No account needed</strong> — no sign-up, no tracking, no data collection</span>
          </li>
        </ul>
      </Accordion>
      <Accordion title="Tips & limits">
        <ul className="space-y-1.5">
          <li>Both devices need to stay online during the transfer.</li>
          <li>For large files (&gt;2 GB), the receiver may be prompted to pick a save location.</li>
          <li>Folders with multiple files are sent as one batch — all files arrive together.</li>
          <li>Room codes expire after the transfer ends for security.</li>
        </ul>
      </Accordion>
    </div>
  )

  if (!fileIndex) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--accent)]">Secure Peer-to-Peer</p>
        <h1 className="text-3xl font-bold text-[var(--txt-primary)]">Send a File</h1>
        <p className="mt-2 mb-8 text-base text-[var(--txt-secondary)]">
          Drop any file or folder below to start sharing. Mesh creates a private room and gives you a code — share it with anyone to begin the transfer.
        </p>
        <FileDropZone onFileReady={handleFileReady} />
        {infoAccordions}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8">
        <p className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--accent)]">Secure Peer-to-Peer</p>
        <h1 className="text-3xl font-bold text-[var(--txt-primary)]">Sending...</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Badge color="amber" dot>{fileCount > 1 ? `${fileCount} files` : fileIndex.fileName}</Badge>
          <span className="text-sm text-[var(--txt-secondary)]">{(totalSize / 1e6).toFixed(1)} MB</span>
          <Badge color="gray" dot={false}>{fileIndex.totalChunks} chunks</Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col items-center justify-center py-8">
          {roomCode ? (
            <>
              <p className="mb-3 text-xs uppercase tracking-widest text-[var(--txt-secondary)]">Share this code</p>
              <RoomCode roomCode={roomCode} />
              <p className="mt-4 text-center text-xs text-[var(--txt-dim)]">
                Share the code or let them scan the QR
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)]/30 border-t-amber-400" />
              <p className="text-sm text-[var(--txt-secondary)]">Creating room...</p>
            </div>
          )}
        </Card>
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <Badge color="amber" dot={!done && hp}>{done ? 'COMPLETE' : hp ? 'ACTIVE' : 'WAITING'}</Badge>
            <span className="text-xs text-[var(--txt-secondary)]">
              {done ? 'All done' : hp ? 'Peer connected' : 'Waiting for receiver'}
            </span>
          </div>
          <StatusLog lines={lines} blinking={!done && !hp} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-[var(--txt-secondary)]">Peers</span>
            <span className="font-mono text-sm text-[var(--accent)]">{peers.length}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {hp ? peers.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/10 px-2 py-1 font-mono text-xs text-[var(--accent-dim)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                {p.slice(0, 8)}
              </span>
            )) : (
              <p className="text-xs text-[var(--txt-dim)]">No one joined yet — share the code above</p>
            )}
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-[var(--txt-secondary)]">Session</span>
            <span className="font-mono text-xs text-[var(--txt-dim)]">{startRef.current ? uptime : '—'}</span>
          </div>
          <p className="mt-3 text-xs text-[var(--txt-dim)]">
            {roomCode ? `Room: ${roomCode}` : 'Initializing...'}
          </p>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-[var(--txt-secondary)]">Encryption</span>
            <Badge color="green" dot={false}>DTLS 1.3</Badge>
          </div>
          <p className="mt-3 text-xs text-[var(--txt-dim)]">
            {hp ? 'Peer-to-peer channel active' : 'Waiting for peer to connect'}
          </p>
        </Card>
      </div>

      {xfer && (
        <Card className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--txt-primary)]">Uploading chunks</span>
            <span className="font-mono text-sm text-[var(--txt-secondary)]">{prog.verified} / {prog.total}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${Math.min(100, prog.percent)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--txt-dim)]">
            Each chunk is hashed and sent. The receiver verifies every piece against the Merkle tree.
          </p>
        </Card>
      )}

      {done && (
        <Card className="mt-6 border-[var(--success)]/20 bg-[var(--success)]/5">
          <div className="flex items-center gap-3">
            <svg className="h-6 w-6 shrink-0 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-medium text-[var(--success)]">Transfer Complete</p>
              <p className="text-xs text-[var(--success)]/60">{prog.verified} / {prog.total} chunks · All verified</p>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-8 flex items-center justify-center gap-5 border-t border-[var(--border)] pt-4">
        <span className="text-xs uppercase tracking-[0.15em] text-[var(--txt-secondary)]">
          STATUS <span className={`ml-1 ${done ? 'text-[var(--success)]' : xfer ? 'text-[var(--accent)]' : 'text-[var(--txt-dim)]'}`}>
            {done ? 'COMPLETE' : xfer ? 'SENDING' : hp ? 'CONNECTED' : 'WAITING'}
          </span>
        </span>
        {startRef.current && (
          <span className="text-xs uppercase tracking-[0.15em] text-[var(--txt-secondary)]">
            UPTIME <span className="ml-1 text-[var(--accent)]">{uptime}</span>
          </span>
        )}
        {!done && (
          <button
            onClick={handleCancel}
            className="cursor-pointer rounded-md border border-[var(--border-light)] px-3 py-1 text-xs uppercase tracking-wider text-[var(--txt-secondary)] transition-colors hover:border-[var(--error)]/30 hover:text-[var(--error)]"
          >
            Cancel
          </button>
        )}
        {done && (
          <button
            onClick={handleCancel}
            className="cursor-pointer rounded-md border border-[var(--border-light)] px-3 py-1 text-xs uppercase tracking-wider text-[var(--txt-secondary)] transition-colors hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
          >
            Send Another
          </button>
        )}
      </div>
    </div>
  )
}
```

### packages/web/src/store/useHistoryStore.js

```text
const KEY = 'mesh-history'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {}
}

export function addHistoryEntry(entry) {
  const entries = load()
  entries.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: Date.now(),
    ...entry,
  })
  if (entries.length > 50) entries.length = 50
  save(entries)
  return entries
}

export function getHistory() {
  return load()
}

export function clearHistory() {
  save([])
  return []
}

export function removeHistoryEntry(id) {
  const entries = load().filter(e => e.id !== id)
  save(entries)
  return entries
}
```

### packages/web/src/store/useSignalingStore.js

```text
import { create } from 'zustand'
import { SignalingClient } from '../webrtc/signalingClient.js'

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:8080'

export const useSignalingStore = create((set, get) => ({
  client: null,
  status: 'idle',
  roomCode: null,
  peerId: null,
  peers: [],
  error: null,

  connect: async () => {
    const { client } = get()
    if (client) return client
    set({ status: 'connecting', error: null })
    try {
      const c = new SignalingClient(SIGNALING_URL)
      c.addEventListener('peerJoined', (e) => {
        set((s) => ({ peers: [...s.peers, e.detail.peerId] }))
      })
      c.addEventListener('peerLeft', (e) => {
        set((s) => ({ peers: s.peers.filter((p) => p !== e.detail.peerId) }))
      })
      c.addEventListener('close', () => {
        const s = get()
        set({ client: null, status: 'disconnected', peerId: null, peers: [] })
        if (!s.roomCode) set({ roomCode: null })
      })
      await c.connect()
      set({ client: c, status: 'connected' })
      return c
    } catch (err) {
      set({ status: 'error', error: err.message || 'Connection failed' })
      throw err
    }
  },

  createRoom: async (password) => {
    const client = await get().connect()
    const result = await client.createRoom(password)
    set({ roomCode: result.roomCode, peerId: result.peerId, peers: [] })
    return result
  },

  joinRoom: async (roomCode, password) => {
    const client = await get().connect()
    const result = await client.joinRoom(roomCode, password)
    set({ roomCode, peerId: result.peerId, peers: result.existingPeers || [] })
    return result
  },

  disconnect: () => {
    const { client } = get()
    if (client) client.close()
    set({ client: null, status: 'idle', roomCode: null, peerId: null, peers: [], error: null })
  },

  reset: () => {
    set({ status: 'idle', roomCode: null, peerId: null, peers: [], error: null })
  },
}))
```

### packages/web/src/store/useTransferStore.js

```text
import { create } from 'zustand'
import { addHistoryEntry } from './useHistoryStore.js'

const STORAGE_KEY = 'mesh-transfer-state'

const initial = {
  role: null,
  status: 'idle',
  fileMeta: null,
  progress: { verified: 0, total: 0, percent: 0 },
  chunkStates: [],
  peerStats: [],
  speedHistory: [],
  error: null,
  seeding: false,
  saveMode: 'files',
  startTime: null,
  roomCode: '',
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || !saved.fileMeta) return null
    const total = saved.fileMeta.totalChunks || 0
    saved.chunkStates = new Array(total).fill('pending')
    if (saved.progress.verified > 0) {
      for (let i = 0; i < saved.progress.verified && i < total; i++) {
        saved.chunkStates[i] = 'verified'
      }
    }
    return saved
  } catch { return null }
}

export const useTransferStore = create((set) => {
  const saved = loadSaved()
  return {
    ...initial,
    ...saved,

    startAsSender: (fileMeta) => set({
      role: 'sender',
      status: 'waiting-for-peer',
      seeding: true,
      fileMeta,
      chunkStates: new Array(fileMeta.totalChunks).fill('pending'),
      progress: { verified: 0, total: fileMeta.totalChunks, percent: 0 },
      error: null, startTime: Date.now(),
    }),

    startAsReceiver: () => set({
      role: 'receiver',
      status: 'waiting-for-file',
      fileMeta: null,
      progress: { verified: 0, total: 0, percent: 0 },
      chunkStates: [],
      peerStats: [],
      speedHistory: [],
      error: null, startTime: Date.now(),
    }),

    setIncomingFile: (fileMeta) => set({
      fileMeta,
      status: 'file-offered',
      chunkStates: new Array(fileMeta.totalChunks).fill('pending'),
      progress: { verified: 0, total: fileMeta.totalChunks, percent: 0 },
    }),

    setTransferring: () => set({ status: 'transferring' }),
    updateProgress: (p) => set({ progress: p }),

    updateChunkState: (index, state) => set((s) => {
      const next = [...s.chunkStates]
      next[index] = state
      return { chunkStates: next }
    }),

    updatePeerStats: (peerStats) => set({ peerStats }),

    recordSpeedSample: (mbps) => set((s) => {
      const clean = typeof mbps === 'number' && isFinite(mbps) && mbps >= 0 ? mbps : 0
      return { speedHistory: [...s.speedHistory.slice(-59), { t: Date.now(), mbps: clean }] }
    }),

    setRoomCode: (roomCode) => set({ roomCode }),
    setSeeding: (seeding) => set({ seeding }),
    setSaveMode: (saveMode) => set({ saveMode }),

    setComplete: () => set((s) => {
      if (!s.fileMeta || s.role === null) return s
      const meta = s.fileMeta
      const fileCount = meta?.files?.length || 1
      const totalChunks = meta?.totalChunks || s.progress.total
      const avgMbps = s.speedHistory.length > 0
        ? s.speedHistory.reduce((a, b) => a + b.mbps, 0) / s.speedHistory.length
        : 0
      addHistoryEntry({
        role: s.role,
        fileName: meta?.fileName || 'Unknown',
        fileSize: meta?.fileSize || 0,
        fileCount,
        totalChunks,
        chunkSize: meta?.chunkSize || 0,
        merkleRoot: meta?.merkleRoot || '',
        roomCode: s.roomCode || '',
        status: 'complete',
        duration: s.startTime ? Math.round((Date.now() - s.startTime) / 1000) : 0,
        avgSpeed: avgMbps,
        peers: s.peerStats.length,
      })
      return { status: 'complete', seeding: true }
    }),
    setPaused: () => set({ status: 'paused' }),
    setError: (message) => set((s) => {
      if (!s.fileMeta || s.role === null) return s
      const meta = s.fileMeta
      addHistoryEntry({
        role: s.role,
        fileName: meta?.fileName || 'Unknown',
        fileSize: meta?.fileSize || 0,
        fileCount: meta?.files?.length || 1,
        totalChunks: meta?.totalChunks || 0,
        chunkSize: meta?.chunkSize || 0,
        merkleRoot: meta?.merkleRoot || '',
        roomCode: s.roomCode || '',
        status: 'failed',
        duration: s.startTime ? Math.round((Date.now() - s.startTime) / 1000) : 0,
        avgSpeed: 0,
        peers: s.peerStats.length,
      })
      return { status: 'error', error: message }
    }),

    reset: () => {
      localStorage.removeItem(STORAGE_KEY)
      set({ ...initial })
    },
  }
})

const KEY = STORAGE_KEY
useTransferStore.subscribe((state) => {
  if (state.status === 'idle') {
    localStorage.removeItem(KEY)
    return
  }
  try {
    const toSave = {
      role: state.role,
      status: state.status,
      fileMeta: state.fileMeta,
      progress: state.progress,
      chunkStates: state.chunkStates,
      peerStats: state.peerStats,
      speedHistory: state.speedHistory,
      error: state.error,
      seeding: state.seeding,
      saveMode: state.saveMode,
      roomCode: state.roomCode,
    }
    localStorage.setItem(KEY, JSON.stringify(toSave))
  } catch { /* storage full */ }
})
```

### packages/web/src/store/useUIStore.js

```text
import { create } from 'zustand'

const KEY = 'mesh-theme'

export const useUIStore = create((set, get) => ({
  theme: 'dark',

  initTheme: () => {
    const stored = localStorage.getItem(KEY)
    const theme = stored === 'light' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', next === 'dark')
    localStorage.setItem(KEY, next)
    set({ theme: next })
  },

  setPage: (page) => set({ page }),
}))
```

### packages/web/src/webrtc/protocol.js

```text
export const TYPE = { JSON: 0x00, CHUNK: 0x01 };

export const MSG = {
  FILE_OFFER:        'FILE_OFFER',
  FILE_ACCEPT:       'FILE_ACCEPT',
  CHUNK_REQUEST:     'CHUNK_REQUEST',
  TRANSFER_COMPLETE: 'TRANSFER_COMPLETE',
  KEEPALIVE:         'KEEPALIVE',
  ERROR:             'ERROR',
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function concatBytes(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function buildJSONBody(obj) {
  const typeFlag = new Uint8Array([TYPE.JSON]);
  const body = textEncoder.encode(JSON.stringify(obj));
  return concatBytes([typeFlag, body]);
}

export function buildChunkBody(chunkIndex, chunkHashHex, proof, chunkData) {
  const typeFlag = new Uint8Array([TYPE.CHUNK]);

  const indexBuf = new Uint8Array(4);
  new DataView(indexBuf.buffer).setUint32(0, chunkIndex, false);

  const hashBuf = hexToBytes(chunkHashHex);

  const proofJSON = textEncoder.encode(JSON.stringify(proof));
  const proofLenBuf = new Uint8Array(4);
  new DataView(proofLenBuf.buffer).setUint32(0, proofJSON.length, false);

  const dataBytes = chunkData instanceof Uint8Array ? chunkData : new Uint8Array(chunkData);

  return concatBytes([typeFlag, indexBuf, hashBuf, proofLenBuf, proofJSON, dataBytes]);
}

export function parseMessage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint8(0);

  if (type === TYPE.JSON) {
    return { type: TYPE.JSON, data: JSON.parse(textDecoder.decode(bytes.subarray(1))) };
  }

  if (type === TYPE.CHUNK) {
    const chunkIndex = view.getUint32(1, false);
    const chunkHash = bytesToHex(bytes.subarray(5, 37));
    const proofLen = view.getUint32(37, false);
    const proof = JSON.parse(textDecoder.decode(bytes.subarray(41, 41 + proofLen)));
    const chunkData = bytes.subarray(41 + proofLen);
    return { type: TYPE.CHUNK, chunkIndex, chunkHash, proof, chunkData };
  }

  throw new Error(`Unknown message type: ${type}`);
}
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
    this._relayBuffer = [];
  }

  addEventListener(type, handler) {
    super.addEventListener(type, handler);
    if (type === 'relay' && this._relayBuffer.length > 0) {
      for (const detail of this._relayBuffer) {
        handler(new CustomEvent('relay', { detail }));
      }
    }
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
      const detail = { fromPeerId: msg.fromPeerId, payload: msg.payload };
      this._relayBuffer.push(detail);
      if (this._relayBuffer.length > 20) this._relayBuffer.shift();
      this.dispatchEvent(new CustomEvent('relay', { detail }));
      return;
    }
  }

  createRoom(password) {
    return new Promise((resolve, reject) => {
      if (this._pending) this._pending.reject(new Error('Request cancelled'));
      this._pending = { resolve, reject };
      this._send({ type: MSG_TYPE.CREATE_ROOM, password });
    });
  }

  joinRoom(roomCode, password) {
    return new Promise((resolve, reject) => {
      if (this._pending) this._pending.reject(new Error('Request cancelled'));
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
      peerB.addEventListener('jsonMessage', (e) => resolve(e.detail));
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

### packages/web/test/webrtcProtocol.test.js

```text
import { describe, it, expect } from 'vitest';
import { TYPE, MSG, buildJSONBody, buildChunkBody, parseMessage } from '../src/webrtc/protocol.js';

describe('webrtc binary protocol', () => {
  it('round trips a JSON message', () => {
    const body = buildJSONBody({ type: MSG.CHUNK_REQUEST, index: 42 });
    const parsed = parseMessage(body);
    expect(parsed.type).toBe(TYPE.JSON);
    expect(parsed.data).toEqual({ type: MSG.CHUNK_REQUEST, index: 42 });
  });

  it('round trips a chunk message including binary data', () => {
    const chunkData = new Uint8Array([1, 2, 3, 4, 5, 250, 251]);
    const hash = 'a'.repeat(64);
    const proof = [{ hash: 'b'.repeat(64), position: 'right' }];

    const body = buildChunkBody(7, hash, proof, chunkData);
    const parsed = parseMessage(body);

    expect(parsed.type).toBe(TYPE.CHUNK);
    expect(parsed.chunkIndex).toBe(7);
    expect(parsed.chunkHash).toBe(hash);
    expect(parsed.proof).toEqual(proof);
    expect(new Uint8Array(parsed.chunkData)).toEqual(chunkData);
  });
});
```

### packages/web/vite.config.js

```text
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

