# Mesh CLI — Build Log

Companion package to `packages/web`. `npm install -g mesh-share` then `mesh send ./file.zip` / `mesh receive <code>` from any terminal, no browser, no signaling server — pure Kademlia DHT peer discovery, with UPnP and TURN relay fallback for NAT traversal.

**Status: shipped.** All six phases below are complete, tested, and verified against a real end-to-end transfer.

---

## What shipped

| Piece | State |
|---|---|
| Kademlia DHT, encrypted TCP peer protocol, swarm scheduling, resume | Already existed, ~90% done at project start |
| CLI wiring (`mesh send` / `mesh receive` / `mesh diagnose`) | **New** — real commander program, share codes, config-free |
| NAT traversal ladder: direct → UPnP-assisted → TURN relay | **New** — STUN client, UPnP/SSDP+SOAP client, RFC5766 TURN client, reliable-datagram shim |
| Ink TUI (progress bar, peer list, connectivity tier) | **New** — with a plain-text fallback for non-TTY/piped output |
| npm packaging (esbuild bundle, npm-name check, README) | **New** — verified with `npm pack`/`npm publish --dry-run` |
| Security fix: path-traversal via remote `fileName` | **Fixed** in `transfer.js` |
| Legacy `receiver.js`/`sender.js` demo scripts | **Removed** — superseded by the real CLI |

129 engine tests + 11 CLI tests pass, including a process-spawning integration test that runs real `mesh send`/`mesh receive` binaries against each other and diffs the resulting file byte-for-byte.

---

## Architecture

```
mesh send <file>                          mesh receive <code>
      │                                          │
      ▼                                          ▼
 commander command                         commander command
      │                                          │
      ▼                                          ▼
 index + chunk file (chunker.js)          decode share code → fileHash + bootstrap addr
      │                                          │
      ▼                                          ▼
 DHTNode.listen() + announceFile()        DHTNode.listen() + bootstrap(senderAddr)
      │                                          │
      ▼                                          ▼
 chunkServer (TCP, ECDH+AES-GCM)  ◄── connectToPeer() ladder ──►  transfer.js downloadFileByHash
      │                                          │
      ├─ UPnP port mapping (best effort)  ┌───────┴────────┐
      └─ TURN relay listener (optional)   │ 1. direct dial │
                                           │ 2. TURN relay  │
                                           │  (RFC5766 +    │
                                           │   ReliableDatagramChannel) │
                                           └───────┬────────┘
                                                   ▼
                                       SwarmManager schedules chunks
                                                   ▼
                                       disk write + resume checkpoint
                                                   ▼
                                       Ink TUI renders live progress
```

The NAT ladder is intentionally two-tier, not three. **True simultaneous-open TCP hole punching was deliberately skipped** in favor of UPnP (handles the common cone-NAT case with zero user config) plus a TURN relay (guarantees connectivity through symmetric NAT/CGNAT, where hole-punching has a poor success rate anyway). This is a smaller, more reliable surface than a three-tier ladder with a flaky middle tier.

---

## The share code

A share code is a self-contained rendezvous token — no server involved. It base32-encodes:

```
version(1) + sender's public IPv4(4) + sender's DHT UDP port(2) + full 256-bit file hash(32) = 39 bytes
```

The receiver decodes it, bootstraps its own DHT node directly against the sender's DHT address, then discovers the sender's TCP chunk-server address (and optional TURN relay info) through the normal DHT announce/get-peers mechanism — the share code only needs to get the receiver *into the DHT*, not describe the whole swarm.

This is why the code is longer than the web app's 4-character room codes: a content-addressed, serverless swarm key needs a full 256-bit hash to avoid collisions, where the web app's short codes are just ephemeral signaling-server lookup keys. `packages/cli/src/lib/shareCode.js`, tested in `packages/cli/test/shareCode.test.js`.

---

## NAT traversal internals

- **`packages/engine/src/net/stun.js`** — RFC 5389 STUN binding request/response, used for public-IP discovery (`mesh diagnose`, and to report the sender's likely-reachable address).
- **`packages/engine/src/net/upnp.js`** — zero-dependency SSDP discovery + WANIPConnection SOAP client (`AddPortMapping`/`DeletePortMapping`/`GetExternalIPAddress`). Tried automatically by `mesh send` unless `--no-upnp`.
- **`packages/engine/src/net/turn.js`** + **`stunMessage.js`** — a real RFC 5766 TURN client: long-term credential challenge/response (401 → nonce → authenticated retry, with stale-nonce recovery), `Allocate`/`CreatePermission`/`Send-Indication`/`Data-Indication`. `generateTurnCredentials()` reuses the exact HMAC-SHA1 `expiry:identity` scheme already running in `packages/signaling/src/server.js`'s `getIceServers()` — same coturn deployment, no new infrastructure.
- **`packages/engine/src/net/reliableDatagram.js`** — TURN only relays datagrams, but the wire protocol (`protocol.js`) assumes an ordered byte stream like TCP. This is a small sliding-window ARQ (sequence numbers, cumulative ACKs, retransmit-on-timeout, an explicit CLOSE frame for fast teardown) that makes a lossy/reordering datagram channel look like a socket to `PeerConnection`/`chunkServer`. Stress-tested with a simulated 15% loss + reordering + duplication channel.
- **`packages/engine/src/net/connect.js`** — the actual ladder: try direct `PeerConnection.connect()` with a short timeout; on failure, if the peer advertised relay info, send a `RELAY_HELLO` over the DHT (a new DHT message type) so the sender's TURN client grants a permission, then connect via a relayed `ReliableDatagramChannel`.
- **`dht.js`** — `announceFile()`/`getPeersForFile()` now carry optional `relay: {addr, port}` and the announcing node's own `dhtAddr`/`dhtPort`, and a new `RELAY_HELLO`/`RELAY_HELLO_ACK` message pair lets a receiver ask a sender (by DHT address) to authorize its IP on the sender's TURN allocation before the first relayed packet arrives.

### A note on what "done" means here

The protocol implementations (STUN, TURN, the ARQ shim) are spec-correct and covered by tests that exercise the real wire format — including a fake-but-protocol-accurate TURN server for the relay tests, and hand-computed XOR-address bytes for the STUN tests (not just round-tripping through the same encoder). What isn't and can't be verified from this sandbox: behavior against a **real** consumer router's UPnP implementation (router UPnP stacks vary in how strictly they follow the spec) and a **real** coturn deployment reachable from two independent NATs. The existing `docker-compose.yml` coturn service is the right target for that field test.

---

## Bugs found and fixed along the way

- **Path traversal via remote `fileName`.** `downloadFileByHash` and the (now-removed) legacy `receiver.js` both used the sender-supplied file name as an output path verbatim. Fixed with `path.basename()` in `transfer.js`.
- **`chunkServer`/`DHTNode` defaulted to binding `127.0.0.1` only.** Silently unreachable from any other machine, even on a LAN. Both now default to `0.0.0.0`, with a new `publicAddress` concept on `DHTNode` (distinct from the bind address) so self-announced entries carry something actually connectable rather than the wildcard address.
- **`PeerConnection`'s `close` handler never cleared pending chunk-request timeouts.** Harmless-looking, but it left a live 30-second timer (`PEER_TIMEOUT_MS`) on every connection close, which was silently keeping entire test processes (and would have kept real CLI processes) alive for up to 30 extra seconds after real work finished. Found by noticing `npm test` took 30s longer than the sum of its parts.
- **`ReliableDatagramChannel` didn't guard `channel.send()`.** If the underlying transport (e.g., a closed TURN socket) threw, it crashed the whole process instead of failing that one channel. Now wrapped so a dead transport just fails the channel gracefully.
- **Sender-side relay demux was keyed to the wrong port.** The first design pre-bound a per-peer relay channel using the port seen on the `RELAY_HELLO` DHT message — but the receiver talks to the actual TURN relay from a *different* local socket, which (especially under symmetric NAT) can get a different external port for a different destination. Fixed by deferring channel creation until the first real `Data Indication` arrives, learning the true port then. Full write-up of the debugging path is in this file's history — the fix is `createRelayListener()` in `turn.js`.
- **DHT node identity must not be persisted per-machine.** An earlier draft cached a single DHT node ID in `~/.config/mesh/config.json` for routing-table stability. Running `mesh send` and `mesh receive` on the same machine then gave both processes the *same* node ID, and the routing table silently refuses to add a peer that shares your own ID — breaking discovery between two processes on one computer, a completely normal thing to do. Removed; each process now gets a fresh random ID, matching the engine's own tested default.

---

## Verifying it yourself

```bash
cd packages/engine && npm test     # 129 tests
cd packages/cli && npm test        # 11 tests, including a real spawned send/receive round trip
cd packages/cli && npm run build   # esbuild bundle to dist/mesh.js
cd packages/cli && npm pack --dry-run   # confirm publish contents
```

Manual two-terminal check:

```bash
mesh send ./somefile --public-ip 127.0.0.1 --no-upnp --no-stun
# copy the printed share code
mesh receive <share-code> --out ./somefile.copy
cmp somefile somefile.copy   # identical
```

To exercise the TURN relay tier for real, point `--turn-host`/`--turn-port`/`--turn-secret` at the `coturn` service in the repo's `docker-compose.yml` (same `TURN_SECRET` the signaling server uses) and force a direct-connect failure (e.g. block the sender's TCP port at the firewall).

---

## What's still open

- **Folder/multi-file transfers.** The chunker is single-file; the web app supports folders. Scoped out of v1 deliberately rather than rushed.
- **Field validation against a real home router + real coturn deployment**, as noted above — the code is protocol-correct and unit/integration tested, but hasn't been run across two actual separate NATs on the open internet.
- **Actual `npm publish`.** Everything is publish-ready (verified via `npm publish --dry-run`), but publishing is a one-way, public action that needs the maintainer's own npm login — not something to automate.
