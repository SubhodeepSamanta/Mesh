# Mesh CLI — Build Roadmap

Companion package to `packages/web`. Goal: `npm install -g <pkg>` then `mesh send ./file.zip` / `mesh receive <code>` from any terminal, no browser, no signaling server dependency — pure Kademlia DHT peer discovery.

---

## 1. Where we actually are

This is the honest audit (done by reading every file, not by trusting old status docs — `docs/phases.md` currently says Phase 5 is "NOT STARTED", which undersells it).

### `packages/engine` — the P2P core. ~90% done.

| Module | State | Notes |
|---|---|---|
| `protocol.js` | ✅ done | length-prefixed binary framing, JSON + raw chunk frame types, backpressure-aware |
| `crypto.js` | ✅ done | SHA-256, Merkle tree build/proof/verify, X25519 ECDH + HKDF, AES-256-GCM |
| `chunker.js` | ✅ done | adaptive chunk size (64KB–32MB based on file size), streaming indexer, Merkle root |
| `dht.js` | ✅ done | full Kademlia: XOR routing table, k-buckets, iterative `FIND_NODE`, `ANNOUNCE`/`GET_PEERS` over UDP |
| `peer.js` | ✅ done | TCP `PeerConnection`, ECDH handshake, encrypted chunk request/response |
| `swarm.js` | ✅ done | multi-peer pipelined chunk scheduling, peer failure eviction (5 consecutive fails), progress events |
| `chunkServer.js` | ✅ done | TCP listener serving chunks to any number of peers, LRU cache, keepalive/liveness timeout |
| `seed.js` | ✅ done | `SeedManager` — turns a downloaded file back into a served swarm seed (chain-seeding) |
| `resume.js` | ✅ done | `.meshstate` sidecar checkpointing, resumes partial downloads |
| `transfer.js` | ✅ done | **the real glue** — `downloadFile`, `downloadFileByHash`, `downloadAndSeed`, `startDownloadSession` wire DHT → PeerConnection → SwarmManager → disk → resume, in one call |
| Tests | ✅ done | 65+ unit tests + `integration.test.js` (7 scenarios: e2e download, concurrent multi-peer, all-peers-fail, `downloadFileByHash` auto-discovery, pause/resume via `AbortSignal`, chain-seeding) |

**This is genuinely solid, tested infrastructure.** The gap is not "the engine is unfinished" — it's that nothing calls it from a command line yet.

### `packages/cli` — ~5% done, skeleton only

- `src/index.js` → `console.log('Mesh CLI')`. That's it.
- `src/commands/send.js`, `src/commands/receive.js` → **empty files (0 bytes)**.
- `src/ui/TransferTUI.jsx` → `export function TransferTUI() { return null; }`.
- `package.json` has `commander` + `ink` as dependencies and a `bin: { mesh: "src/index.js" }` entry, but no wiring, no `files`/`publishConfig`, no README, no build step.

### Legacy scripts — `packages/engine/receiver.js` / `sender.js`

These are a separate, older point-to-point demo pair (predates the DHT+swarm integration). `sender.js` announces to the DHT but `receiver.js` **never touches the DHT, swarm, or resume** — it just dials a hardcoded `host:port` and reimplements chunk-fetch/verify/write inline. They work as a demo but duplicate what `transfer.js` + `chunkServer.js` already do properly. **Recommendation: retire them** once the real CLI commands exist — keep them only if you want a minimal reference example, otherwise delete to avoid two divergent code paths.

### NAT traversal — 0% done. This is the actual missing piece.

Confirmed by full-repo search: STUN/TURN/UPnP/hole-punching code exists **only** in `packages/web` (WebRTC) and `packages/signaling` (coturn credential minting). None of it touches `packages/engine` or `packages/cli`. Today, `chunkServer.js` is a plain `net.createServer()` — reachable only if the host is on the same LAN, or has manually port-forwarded, or has a public IP. Two people on home Wi-Fi behind typical NAT/CGNAT **cannot** connect today. This is the single biggest thing standing between "impressive engine" and "CLI that works for a real user."

The good news: `packages/signaling/src/server.js`'s `getIceServers()` (coturn time-limited credential scheme — HMAC-SHA1 over `expiry:peerId` using `TURN_SECRET`) is plain TURN-protocol auth, not WebRTC-specific. The CLI can reuse the **same coturn container** already defined in `docker-compose.yml` — it just needs its own TURN client instead of piggybacking on a browser's WebRTC stack.

### Security finding surfaced during this audit (fix in Phase E, but noted now)

`transfer.js` (`downloadFileByHash`) and the legacy `receiver.js` both take the **file name from the remote peer's `FILE_OFFER` message and use it directly as the output path** (`resolvedOutputPath = outputPath || manifest.fileName`, `join(OUTPUT_DIR, metadata.fileName)`). On a trusted LAN demo this is fine. Once the CLI talks to arbitrary internet peers via DHT, a malicious sender can offer a file with `fileName: "../../../.ssh/authorized_keys"` and the receiver will write attacker-controlled bytes to an arbitrary path. **Must sanitize with `path.basename()` and reject any resolved path that escapes the output directory before this ships.**

---

## 2. Target architecture

```
mesh send <file>                          mesh receive <code>
      │                                          │
      ▼                                          ▼
 commander command                         commander command
      │                                          │
      ▼                                          ▼
 index+chunk file (chunker.js)            resolve code → fileHash
      │                                          │
      ▼                                          ▼
 DHTNode.listen() + announceFile()        DHTNode.listen() + bootstrap()
      │                                          │
      ▼                                          ▼
 chunkServer (TCP, ECDH+AES-GCM)  ◄── connectivity layer ──►  transfer.js downloadFileByHash
                                          │
                              ┌───────────┴───────────┐
                              │   connection ladder    │
                              │ 1. direct dial          │
                              │ 2. UPnP/NAT-PMP port map│
                              │ 3. UDP hole punch       │
                              │    (DHT peer as         │
                              │     rendezvous)         │
                              │ 4. TURN relay (coturn)  │
                              └─────────────────────────┘
                                          │
                                          ▼
                              SwarmManager schedules chunks
                                          │
                                          ▼
                              disk write + resume checkpoint
                                          │
                                          ▼
                              Ink TUI renders live progress
```

---

## 3. Phases

Each phase ends with a working, demoable checkpoint — same discipline as `docs/phases.md`.

### Phase A — Wire the CLI to the engine (foundation, no new engine features)

**Goal:** `mesh send ./file.zip` and `mesh receive <hash>` work end-to-end on one machine / LAN, using what already exists in `packages/engine`.

- `src/index.js`: real `commander` program — `mesh send <path> [--port] [--bootstrap host:port]`, `mesh receive <fileHashOrCode> [--out dir] [--bootstrap host:port]`, `mesh seed <path>` (keep seeding after a download completes, wraps `SeedManager`).
- `src/commands/send.js`: `indexFile()` → start `DHTNode` → `bootstrap()` if a bootstrap peer is configured → `createChunkServer()` → `announceFile()`. Print a short **share code** (see Phase C) instead of a raw 64-hex-char hash.
- `src/commands/receive.js`: parse the share code → `DHTNode` + `bootstrap()` → `downloadFileByHash()` from `transfer.js` → wire an `AbortController` to `SIGINT` for graceful pause (resume.js already supports this, it just needs a signal handler).
- Fix the path-traversal bug (sanitize `fileName`) as part of this phase, not deferred — it's a one-line `basename()` call and this is the first phase where untrusted input becomes real.
- Delete or archive `packages/engine/receiver.js` / `sender.js` once the new commands are proven equivalent.
- New test: `packages/cli/test/send-receive.test.js` — spawn `send` and `receive` as child processes against a local DHT bootstrap node, assert the file arrives byte-identical. This is the "CLI send and receive integration test" `docs/phases.md` already calls for.

**Exit criteria:** two terminals on the same machine, `mesh send`/`mesh receive`, file arrives correctly, resumes after Ctrl+C.

### Phase B — NAT traversal & real-internet connectivity (the hard part)

This is what turns a LAN demo into something two strangers can actually use.

- **B1 — UPnP / NAT-PMP auto port mapping.** On `mesh send`, attempt to open a port mapping on the local router (e.g. via `@achingbrain/nat-port-mapper` or similar; no native deps, pure JS). Falls through silently if the router doesn't support it. Cheapest win, works on a large fraction of home routers with zero user config.
- **B2 — UDP hole punching using the DHT itself as rendezvous.** The DHT already talks UDP. Add a STUN binding request (a handful of public STUN servers, e.g. `stun.l.google.com:19302`, already referenced in the web app) so each node learns its own reflexive `ip:port`. When two DHT nodes want to connect, they exchange reflexive addresses through a node that's already reachable (or through the bootstrap node) and both sides fire UDP packets at each other simultaneously to punch through NAT. This needs a UDP-based chunk transport as a sibling to the existing TCP `PeerConnection`/`chunkServer` — same protocol framing, different socket type — because TCP simultaneous-open hole punching is much less reliable than UDP.
- **B3 — TURN relay fallback (last resort, guarantees connectivity).** Reuse the existing `coturn` container from `docker-compose.yml`. Reimplement the same HMAC-SHA1 time-limited credential scheme from `packages/signaling/src/server.js:getIceServers()` (it's plain TURN auth, no WebRTC involved) so the CLI can allocate a relayed transport address directly. This is exactly what the browser client falls back to when direct WebRTC fails — same server, same trust model, just a raw TURN client instead of the browser's built-in one.
- **Connection ladder** used by both `send` and `receive`: try direct dial → try after UPnP mapping → try UDP hole punch via rendezvous → fall back to TURN relay. Log which tier succeeded (useful for debugging and for the TUI's peer list).

**Exit criteria:** two machines on different home networks (no port forwarding, no shared LAN) successfully transfer a file.

### Phase C — Production CLI UX

- **Share codes**, not raw hashes: `mesh send` should print something short and copy-pasteable (like the web app's room codes), e.g. `mesh receive SWIFT-EAGLE-42` — encode the fileHash + a bootstrap hint, don't make users paste a 64-character hex string.
- **Ink TUI** (`TransferTUI.jsx` currently a stub): live progress bar, transfer speed, connected-peer count/list, pause/resume status. Detect non-TTY (piped output, CI) and fall back to plain line-based logging — Ink shouldn't be a hard requirement.
- **Config persistence**: `~/.config/mesh/config.json` (or platform equivalent) storing a persistent node identity (so the DHT node ID is stable across runs, improving routing table health) and known-good bootstrap peers learned from prior sessions.
- **Signal handling**: SIGINT → pause + checkpoint (already supported by `resume.js`/`AbortSignal` in `transfer.js`, just needs to be connected to `process.on('SIGINT', ...)`).
- **Decide folder support scope**: the web app supports folder sharing; today's chunker is single-file. Either add a manifest format for multi-file transfers, or explicitly scope v1 to single files (recommend: ship single-file first, folder support as a fast-follow — don't block the first release on it).

**Exit criteria:** `mesh send` feels like a real tool — a stranger could use it without reading source code.

### Phase D — Packaging & npm publish

- **Bundle, don't workspace-link.** `@mesh/engine` is a monorepo-local dependency; end users installing the CLI globally won't have the workspace. Add a build step (`esbuild`, single entry point, zero native deps since crypto/net/dgram/fs are all Node core) that bundles `@mesh/engine` + `commander` + `ink` into `packages/cli/dist/mesh.js` with the shebang preserved. `bin` points at the built file, not `src/index.js`.
- **Package name.** Checked npm registry: `mesh` and `mesh-cli` are **already taken**. Available: `mesh-p2p`, `meshdrop`, `mesh-transfer`, `meshfile`, `mesh-dht`. The npm package name and the `bin` command name are independent — you can publish as `mesh-p2p` while still exposing the command as `mesh` (or a less collision-prone command like `meshx` if you want to avoid clashing with some other globally-installed `mesh`). Safest option of all: publish scoped under your own npm username, e.g. `@yourusername/mesh-cli`, which is guaranteed collision-free and still installs a `mesh` bin locally.
- **`package.json` fields to add**: `files` (allowlist `dist/`, `README.md`, `LICENSE`), `engines.node` (recommend `>=18`, since `crypto.hkdfSync`/X25519 key generation need modern Node), `repository`, `homepage`, `keywords`, `publishConfig.access: "public"` if scoped.
- **CI**: extend `.github/workflows` (currently just `deploy.yml` for the web/signaling side) with a publish workflow — run engine + CLI tests on every push, `npm publish` on version tag.

**Exit criteria:** `npm install -g mesh-p2p` (or your chosen name) on a clean machine, `mesh send`/`mesh receive` work with no monorepo in sight.

### Phase E — Hardening & security pass

- Fix the fileName path-traversal issue if not already done in Phase A.
- Rate-limit/cap simultaneous connections per remote IP on `chunkServer.js` — it's now internet-facing, not LAN-only.
- Validate all CLI-provided paths (no writing outside the intended output directory even via `--out`).
- Cross-platform pass: Windows Ctrl+C/SIGINT behavior differs from POSIX; test UPnP libs and file path handling on Windows specifically, since that's the primary dev machine here.
- Run `/security-review` (skill available in this environment) once Phase A–D are code-complete, before publishing.

### Phase F — Docs, demo, release

- CLI-specific `README.md` inside `packages/cli` (npm renders the package-level README on the registry page).
- Short demo GIF/asciinema of `mesh send` + `mesh receive` across two machines.
- Update `docs/phases.md` Phase 5 status once this lands (it currently understates progress — engine work described there as Phase 2 is done, this whole document is what "Phase 5" actually expands into).
- Tag a release, `npm publish`.

---

## 4. "Will we use TURN?"

Yes, as the **last tier of a connection ladder**, not the primary path: direct dial → UPnP-assisted direct → UDP hole punch (DHT-mediated rendezvous) → TURN relay. This mirrors exactly what the browser/WebRTC side already does (STUN first, TURN only when direct ICE candidates fail), and it can reuse the **same coturn deployment and credential-minting algorithm** already running for the web app — no new server infrastructure, just a TURN client living in the CLI/engine instead of in the browser's WebRTC stack.

---

## 5. Suggested order & effort shape

Phase A is the highest-leverage, lowest-risk work — it makes ~90% of already-built, already-tested code reachable from a terminal. Phase B (NAT traversal) is the hardest and most time-consuming phase by a wide margin; it's also the phase that determines whether this is a genuinely usable public tool or a LAN-only toy. Phases C–F are comparatively mechanical once A and B exist.

Recommended sequencing: **A → E(partial: fix the path bug now) → B → C → D → E(rest) → F.**

---

## 6. Next step

Say the word and Phase A starts: wiring `commander` + real `send`/`receive` commands directly against `transfer.js`, `seed.js`, and `dht.js`, with the path-traversal fix included from the start.
