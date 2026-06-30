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