# Mesh — Project Phases

## Overview

Mesh is a decentralised P2P file transfer platform. The project is built in 5 major phases. Each phase has multiple parts. Each part ends with a commit checkpoint. Tests are written alongside each part, not after.

---

## Phase 1 — Raw TCP Transfer Engine

The goal of this phase is two Node.js processes transferring a file correctly over raw TCP. No UI, no DHT, no encryption. Just bytes moving from A to B with integrity verification.

Ends when: a 1GB file transfers between two processes with hash match on the received file.

---

### Part 1 — Message Framing Protocol

The foundation everything else sits on. TCP is a stream not a packet system. If you write 100 bytes and 200 bytes back to back the receiver might get all 300 at once or in 5 pieces. Without framing you cannot tell where one message ends and the next begins.

What we build:
- A length prefix framer that prepends every message with a 4 byte header containing the body length
- A sendMessage function that takes a socket and data and writes a correctly framed packet
- A createFramer function that accumulates incoming bytes and fires a callback only when a complete message has arrived
- A message type system so we can distinguish JSON control messages from binary chunk data

What we test:
- Sending a message and receiving it complete on the other side
- Sending 10 messages back to back and receiving all 10 correctly despite TCP batching them
- Sending a message split across multiple data events and still receiving it correctly
- Max message size guard so a corrupted length header cannot allocate infinite memory

Files touched: protocol.js, test/protocol.test.js

Checkpoint: 1-1

---

### Part 2 — File Chunker and Merkle Tree

Takes any file and splits it into fixed size binary chunks. Builds a Merkle tree over all chunk hashes so any single chunk can be verified independently without knowing the rest of the file.

What we build:
- chunkFile function that reads a file and returns an array of Buffer chunks
- SHA-256 hash for every chunk
- buildMerkleTree function that takes chunk hashes and returns the root hash and all tree levels
- getMerkleProof function that returns the sibling path for any chunk index
- verifyChunk function that recomputes the root from a chunk and its proof and checks against expected root
- Stream based chunking for large files so we never load the whole file into memory

What we test:
- Chunking a file and reassembling chunks produces identical bytes to original
- Merkle root changes if any single chunk is modified
- Proof verification passes for valid chunk and fails for tampered chunk
- Large file chunking does not crash with out of memory

Files touched: chunker.js, crypto.js, test/chunker.test.js

Checkpoint: 1-2

---

### Part 3 — Sender and Receiver Scripts

The first real end to end transfer. Two scripts, one sends a file over TCP, the other receives it, verifies every chunk, and writes it to disk.

What we build:
- sender.js script at packages/engine/sender.js that starts a TCP server, waits for a receiver, sends file metadata then responds to chunk requests
- receiver.js script at packages/engine/receiver.js that connects to sender, requests chunks in a pipelined way, verifies each chunk hash, assembles the file and writes to disk
- Pipeline logic so receiver keeps 32 chunk requests in flight at once instead of waiting for each one before requesting the next
- Transfer summary printed on completion showing file size, time taken, and average speed

What we test:
- 10MB file transfers correctly with hash match
- 500MB file transfers correctly with no memory crash
- If a chunk hash fails verification the receiver re-requests it
- Receiver handles sender disconnecting mid transfer gracefully

Files touched: sender.js, receiver.js, test/transfer.test.js

Checkpoint: 1-3

---

## Phase 2 — DHT, Encryption, Multi-Peer

The goal is making the transfer genuinely decentralised and secure. Peers find each other without any central server. All data is encrypted end to end.

Ends when: three processes find each other via DHT and transfer a file encrypted end to end.

Parts:
- Part 1: Kademlia routing table, XOR distance, k-buckets
- Part 2: DHT iterative lookup, announce, get-peers over UDP
- Part 3: ECDH key exchange and AES-256-GCM encryption per chunk
- Part 4: Swarm manager coordinating parallel chunk downloads from multiple peers

---

## Phase 3 — Signaling Server and WebRTC

The goal is browser-to-browser peer connections through NAT.

Ends when: two browser tabs connect directly via WebRTC data channel using a room code.

Parts:
- Part 1: WebSocket signaling server with room creation and peer relay
- Part 2: Room codes, QR generation, password protection, rate limiting
- Part 3: WebRTC offer/answer flow, ICE candidate exchange, STUN integration
- Part 4: Full browser peer connection test

---

## Phase 4 — React Frontend

The goal is a production quality UI with live transfer visualisation.

Ends when: full transfer flow works in the browser with peer graph, chunk grid, and speed graph animating live.

Parts:
- Part 1: Zustand store and useTransfer hook
- Part 2: Landing page and Send page
- Part 3: Receive page and Transfer dashboard with D3 peer graph
- Part 4: Chunk grid, speed graph, peer cards, history page
- Part 5: Mobile responsive layout and polish

---

## Phase 5 — CLI, Polish, and Deployment

The goal is shipping the project publicly.

Ends when: mesh send works from terminal, live deployment is accessible, README and demo video are complete.

Parts:
- Part 1: mesh send and mesh receive CLI commands with Commander
- Part 2: Ink TUI with live progress bars, peer list, chunk grid
- Part 3: Docker, Railway deployment for signaling, Vercel for web
- Part 4: Architecture diagram, README, demo video

---

## Testing Strategy

Every phase has tests written in the same part as the code. Not after.

Engine tests use Node's built-in test runner. No Jest, no Vitest for the engine.

Web tests use Vitest since it is already in the Vite ecosystem.

Test types:
- Unit: individual functions like chunker, hasher, framer, XOR distance
- Integration: sender to receiver over real TCP, DHT node to node over real UDP
- End to end: full file transfer through the complete stack

---

## Checkpoint Structure

checkpoint [phase]-[part]: description

Examples:
- checkpoint 1-1: protocol framer complete with tests
- checkpoint 1-2: chunker and merkle tree complete with tests
- checkpoint 1-3: sender and receiver scripts with pipeline and tests
- checkpoint 2-1: kademlia routing table and XOR distance

---

## Current Status

- [x] Phase 0: Monorepo scaffolded, all packages initialized
- [ ] Phase 1: Raw TCP Transfer Engine
- [ ] Phase 2: DHT, Encryption, Multi-Peer
- [ ] Phase 3: Signaling Server and WebRTC
- [ ] Phase 4: React Frontend
- [ ] Phase 5: CLI, Polish, Deployment