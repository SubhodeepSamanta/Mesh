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