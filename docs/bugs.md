# Mesh — Final Pre-Deploy Pass (for IDE agent)

Good progress since the last audit. Most P0/P1 items landed: signaling reconnect + heartbeat, streaming writers, `Promise.allSettled` join, offer validation, save-picker moved into the click handler, persistence throttled, chunk-state restore fixed, late-joiner dialing, sender speed/chunkgrid, TURN env plumbing, the web test file rewritten. This pass covers what's **still broken or newly broken**, remaining UI/UX polish, and makes the whole thing deployable on Render via Docker.

Work top-to-bottom. Run `npm test` (root — now runs all three workspaces) after each group. Then a real two-browser + three-peer smoke test. Do not skip the CRASH item.

---

## GROUP A — Blocking bugs (fix first)

### A1. CRASH: `Receive.jsx` references `M` without importing it
**File:** `packages/web/src/pages/Receive.jsx`

`handleBeginTransfer` does `M.streamHandle = { dirHandle }` and `handleRetry` does `M.streamHandle = null`, but the file never imports the transfer manager. This throws `ReferenceError: M is not defined` the instant a user clicks **Begin Transfer** (or Retry). It survives casual testing only because the "Files" save-mode path may not reach the folder branch depending on timing — but folder mode hits it immediately, and `handleRetry` hits it always.

**Fix:** add at the top with the other imports:
```js
import { transferManager as M } from '../lib/transferManager.js'
```
Then grep the whole `packages/web/src` tree for other files using `M.` without the import (Dashboard and Send already import it; confirm). Add a smoke test that mounts Receive, sets a fake offer, and calls the Begin handler without throwing.

### A2. Streamed download never actually verifies against the tree — and the download "completes" with an empty file
**Files:** `packages/web/src/hooks/useTransfer.js`, `packages/web/src/pages/Receive.jsx`

Two coupled problems in the new streaming path:

1. **`triggerDownload` short-circuits on `M.streamWriters.size > 0`** and returns after `closeStreamWriters()`. But `writeChunkStreaming` only creates a writer entry when `M.streamHandle.dirHandle` exists (folder mode). In **single-file** mode there's no `dirHandle`, so nothing streams, `M.streamWriters` stays empty, and it correctly falls through to the blob path — OK. But in **folder mode**, chunks were streamed and `M.chunks[chunkIndex]` was **also** still populated (the handler does `M.chunks[chunkIndex] = chunkData` unconditionally), so you keep the whole file in RAM *and* stream it — defeating the memory win. Set `M.chunks[chunkIndex] = true` (a marker) instead of the data once a streaming write succeeds, and only keep the bytes when streaming didn't happen.

2. **Re-seed after a streamed download reads back from disk with `sha256Hex` but no proof** (the `M.receivedMeta && M.streamHandle` branch in `addSenderPeer` sends `chunkProof = null`). Same integrity hole as the old in-memory reseed. Rebuild `{hashes, tree}` from the received data (see A3) and serve real proofs, or disable seeding for streamed downloads and grey out the seed toggle with a note.

**Fix:** make `writeChunkStreaming` return whether it wrote, and in the `chunkVerified` handler:
```js
const streamed = await writeChunkStreaming(chunkIndex, chunkData, meta)
M.chunks[chunkIndex] = streamed ? true : chunkData
```
Guard `blobForEntry` — if `M.chunks[i] === true`, the bytes aren't in memory; that entry must be served from disk, not blobbed. In practice: if folder-streamed, `triggerDownload` should just `closeStreamWriters()` and return (files are already on disk) — which it does — but make sure the completion UI doesn't then also try to blob-download. Today `downloadFired`/`downloadGuard` covers it; verify with a folder transfer.

### A3. Re-seed integrity (the in-memory path still trusts self-attested hashes)
**Files:** `packages/web/src/hooks/useTransfer.js` (`addSenderPeer`, `startReceiving`), `packages/web/src/lib/browserCrypto.js`

When a completed receiver re-seeds from `M.chunks`, it computes the hash itself and sends `proof = null`. On the downloader, `swarmManager.onChunkReceived` skips Merkle verification when `proof` is falsy (`if (proof && !verifyChunk(...))`). So a corrupted/malicious reseeder can serve arbitrary bytes that pass. This is the core integrity guarantee — it must hold transitively, not just for the original sender.

**Fix:**
1. In `startReceiving`, on `complete`, rebuild the tree from received chunks: hash each `M.chunks[i]` with `sha256Hex`, `buildMerkleTree(hashes)`, assert `tree.root === meta.merkleRoot` (abort seeding if not), store `M.receivedMeta.hashes = hashes; M.receivedMeta.tree = tree`.
2. In `addSenderPeer` memory path, send `chunkHash = M.receivedMeta.hashes[msg.index]` and `chunkProof = getMerkleProof(M.receivedMeta.tree, msg.index)`.
3. In `swarmManager.onChunkReceived`, make proof **mandatory for multi-chunk files**: if `!proof` and `totalChunks > 1`, emit `chunkFailed` reason `missing_proof`, don't accept. (Single-chunk files have an empty proof legitimately — allow `proof === []` there.)
4. Vitest: chunk with valid hash + null proof on a multi-chunk file → rejected; with real proof → accepted.

### A4. `checkPeersRemaining` fires false "All peers disconnected" during normal reconnect churn
**File:** `packages/web/src/hooks/useTransfer.js`

`peerRemoved` and `peerFailed` both call `checkPeersRemaining`, which errors the whole transfer if `getPeerStats()` has no alive peers. But during the late-joiner / reconnect flow a peer can be briefly removed and re-added; if the removal lands in a window where it's the only peer, the transfer flips to `error` even though a new transport is about to connect. Add a short grace debounce: on "no peers", wait ~3s and re-check before erroring, and skip erroring if a connection attempt is in flight (track a `M.pendingDials` counter incremented before `transport.connect()` and decremented in its `.then/.catch`).

---

## GROUP B — Correctness / robustness

### B1. Chunk size can still exceed the SCTP message limit
**File:** `packages/web/src/lib/fileChunker.js`

`MAX_CHUNK_SIZE = 4 * 1024 * 1024` (4MB). Cross-browser data-channel messages must stay ≤ ~256KB to be safe (Chrome↔Firefox negotiate lower than 4MB; oversized `send()` throws or silently drops). Any file big enough to scale chunks past 256KB breaks for exactly the large files this was meant to serve.

**Fix:** `const MAX_CHUNK_SIZE = 262144` and bump `TARGET_CHUNK_COUNT` to `50000` so large files still fit within reasonable chunk counts. Also read `pc.sctp?.maxMessageSize` in `WebRTCTransport` after connect and `console.warn` if `meta.chunkSize` exceeds it.

### B2. No data-channel backpressure — fast sender can kill its own channel
**File:** `packages/web/src/lib/webrtc.js` (`sendChunk`), `useTransfer.js` (`addSenderPeer`)

`sendChunk` calls `channel.send()` unconditionally. Under pipelined requests on a slow link, `bufferedAmount` climbs past the internal cap and Chrome closes the channel. Add backpressure:
```js
async sendChunk(index, hashHex, proof, data) {
  if (!this.channel || this.channel.readyState !== 'open') return
  const HIGH = 8 * 1024 * 1024
  if (this.channel.bufferedAmount > HIGH) {
    this.channel.bufferedAmountLowThreshold = 1024 * 1024
    await new Promise(res => {
      const h = () => { this.channel.removeEventListener('bufferedamountlow', h); res() }
      this.channel.addEventListener('bufferedamountlow', h)
    })
  }
  this.channel.send(buildChunkBody(index, hashHex, proof, data))
}
```
Make the `addSenderPeer` request handler `await transport.sendChunk(...)` so it serializes.

### B3. `getFileForChunk` vs `getFileEntryForChunk` — two functions, one off-by-fallback
**Files:** `useTransfer.js`, `fileChunker.js`

`fileChunker.getFileForChunk` uses `entry.chunkCount` (no fallback); the local `getFileEntryForChunk` in `useTransfer.js` uses `entry.chunkCount || 1`. For a legitimately empty file entry (`chunkCount === 0`), `|| 1` makes it claim chunk index `startChunk`, which belongs to the next file. Unify on one helper (import the fileChunker one) and treat `chunkCount === 0` as "owns no chunks."

### B4. Late-joiner dial has no offer-root check
**File:** `packages/web/src/pages/Receive.jsx`

The new peer-join subscription dials every new peer as initiator and immediately `addReceiverPeer`. If a peer in the room is another *receiver* (not a seeder), its transport never sends a matching `FILE_OFFER`, but you've already added it to the swarm as a chunk source — its requests go nowhere, chunks time out, and it counts toward peer-failure logic. Before `addReceiverPeer`, wait for that transport to deliver a `FILE_OFFER` whose `merkleRoot === swarmRef.current.merkleRoot`; on timeout (say 10s) close it silently. Store per-transport offer state via `onJSON`.

### B5. FILE_OFFER validation is too loose — allocation DoS still possible
**File:** `packages/web/src/hooks/useTransfer.js` (`validateFileMeta`)

Current `validateFileMeta` checks types but not bounds. A malicious `totalChunks: 1e9` still hits `new SwarmManager(1e9, …)` → `new Array(1e9)` → tab OOM. Add bounds:
- `totalChunks` integer in `[0, 1_000_000]`
- `chunkSize` in `[1, 262144]`
- `fileSize` within `±chunkSize` of `totalChunks*chunkSize`
- `merkleRoot` matches `/^[0-9a-f]{64}$/`
- each `files[i].path`: reject absolute paths, `..` segments, backslashes-as-separators outside normalization, control chars; cap `files.length` (e.g. 10_000)

Also sanitize paths again inside `writeChunkStreaming` / `triggerDownload` before `getDirectoryHandle` (defense in depth against path traversal into the user's chosen folder).

### B6. `Send.jsx` seeder-listener cleanup runs on every status change
**File:** `packages/web/src/pages/Send.jsx`

```js
useEffect(() => {
  if (st === 'transferring') navigate('/dashboard')
  return () => M.stopSeederListener()
}, [st, navigate])
```
The cleanup runs on every `st` change, tearing down the seeder listener mid-flow; only the relay-buffer replay saves it. Split into two effects: one that navigates on `transferring`, and a separate unmount-only `useEffect(() => () => M.stopSeederListener(), [])`. Dashboard re-registers on mount, and `startSeederListener` is idempotent — keep that.

### B7. `verifyChunk`/`sha256Hex` are passed `Uint8Array` in some places, `ArrayBuffer` in others
**Files:** `browserCrypto.js`, `swarmManager.js`, `useTransfer.js`

`crypto.subtle.digest` accepts BufferSource, so both work, but `verifyChunk(chunkBuffer, …)` then does `sha256Hex(chunkBuffer)` where `chunkBuffer` may be a `Uint8Array` whose `.buffer` is larger than its view (subarrays from `parseMessage`!). `parseMessage` returns `chunkData = bytes.subarray(41 + proofLen)` — a **view** into a larger buffer. If anything ever passes `.buffer` instead of the view, you'll hash the wrong bytes. Audit: always hash the *view* (`data`), never `data.buffer`. Add a test that round-trips a chunk sitting at a non-zero offset in a larger buffer.

---

## GROUP C — UI / UX polish

### C1. `index.html` still titled "web"
Set a real `<title>Mesh — Encrypted P2P File Transfer</title>`, add `<meta name="description">`, `<meta name="theme-color" content="#0a0a0a">`, Open Graph + Twitter card tags, and confirm `<html lang="en">`. This is the browser-tab title and the social preview — visible everywhere.

### C2. QR code invisible in light mode
**File:** `packages/web/src/components/RoomCode.jsx`
`fgColor="#ffffff"` on a light background disappears. Drive it from theme: read `useUIStore(s => s.theme)` and pass `fgColor={theme === 'dark' ? '#ffffff' : '#111111'}`, `bgColor="transparent"`.

### C3. Landing page shows fake hardcoded stats
**File:** `packages/web/src/pages/Landing.jsx`
"6 PEERS ACTIVE / 132 GB TRANSFERRED" are invented. For launch either delete those two badges or wire "peers/rooms active" to the signaling `/health` endpoint (see D3). Keep the "AES-256-GCM E2EE" badge. Also the copy "Nothing touches a server" isn't strictly true — soften to "Files never touch a server — only encrypted connection setup is relayed" in the security accordion.

### C4. Hidden scrollbars everywhere kill affordance
**File:** `packages/web/src/index.css`
`::-webkit-scrollbar { width: 0 }` + `scrollbar-width: none` globally. On long peer lists / manifests / history the user can't tell content scrolls. Switch to thin styled scrollbars: `scrollbar-width: thin; scrollbar-color: var(--border-hover) transparent;` and a slim `::-webkit-scrollbar { width: 6px }` with a subtle thumb. Keep hiding only on intentionally-decorative containers if any.

### C5. No React error boundary
A render throw (e.g. A1 before it's fixed) blanks the whole app. Add a top-level class error boundary in `App.jsx` wrapping `<Layout>` that renders a "Something went wrong — reload" card and a reset button. Cheap insurance for prod.

### C6. Silent `catch {}` on user-facing failures
Clipboard denied, camera denied, save-picker cancelled, join failures mid-flow — all swallowed. Add a tiny toast store (Zustand) + a `<Toaster>` in Layout, and route the *user-relevant* catches through it (not the ICE/relay ones). At minimum: save cancelled ("Save cancelled — file kept in memory, use the download button"), clipboard denied, camera denied.

### C7. Room-code input inconsistencies
**Files:** `ConnectionCode.jsx`, Receive accordion copy
Placeholder `WOLF-4821` (8+dash), accordion says `WOLF482` (7), server emits 6 chars from a charset excluding `I/O/0/1`, but the input accepts dashes and those chars up to length 9. Normalize: strip non-charset chars, uppercase, `maxLength={6}`, placeholder `e.g. WLF482`. Update the QR regex (`[?&]code=([A-Z0-9-]{6,9})`) to `{6}` and drop the dash allowance so scans and manual entry agree.

### C8. Accessibility pass
- `aria-label` on icon-only buttons (copy hash, QR scan, remove-history, dismiss).
- `role="status" aria-live="polite"` on `StatusLog` and the progress region so screen readers announce progress.
- Peer connected/disconnected is conveyed by dot color only in `PeerList` — you already add SEED/LEECH text; also add an sr-only "connected"/"disconnected" span.
- Several custom buttons remove focus outlines via Tailwind resets — ensure visible focus rings (`focus-visible:ring-2 ring-[var(--accent)]`).
- `--txt-muted #4b5563` on `#0a0a0a` is ~3.5:1 — under AA for small text. Bump muted small text to `#6b7280`+.

### C9. `prefers-reduced-motion` not honored for framer-motion / blink
LandingGraph and PeerGraph respect it; the page-fade transitions, the `animate-blink` cursor, and the `animate-glow` don't. Wrap those in a `useReducedMotion()` check (framer exports it) and disable the CSS animations under the media query.

### C10. ChunkGrid tooltip shows the compressed index, not the real chunk
**File:** `packages/web/src/components/ChunkGrid.jsx`
For >1000 chunks it maps via `Math.floor(i * ratio)` but the `title` says `Chunk ${i}`. Show the mapped real index so the tooltip isn't misleading.

### C11. PeerGraph hardcodes dark hex colors
**File:** `packages/web/src/components/PeerGraph.jsx`
`#3a3a3a`, `#2a2a2a`, `#6b7280` etc. are baked in, so light mode looks muddy. Read the CSS vars (`getComputedStyle(document.documentElement).getPropertyValue('--border')` etc.) or pass a palette derived from theme. Same for `SpeedChart` axis colors.

### C12. ETA + transferred bytes on Dashboard
`format.js` already has `formatEta`. Show ETA next to speed on the dashboard header/sidebar: `bytesRemaining = (total - verified) * chunkSize`, average the last ~10 speed samples (not the instantaneous last one), `formatEta(bytesRemaining, avgMbps)`. Nice, and makes the demo feel real.

### C13. Copy-share-link button
Next to the QR in `RoomCode`, add a "Copy link" button that copies `${origin}/receive?code=${roomCode}` — most people paste a link, not type a code.

### C14. Send "Send Another" kills the room with receivers still attached
**File:** `Send.jsx`
After COMPLETE the sender is still seeding; "Send Another" calls `handleCancel` → disconnects, silently dropping any receiver still pulling from a late join. Add a confirm ("Still seeding to N peer(s) — end session?") when peers are connected, or an explicit "End session" vs "Send another" split.

---

## GROUP D — Deployment (Docker + Render, env-driven)

You're deploying the **signaling server** as a Docker service on Render, and the **web** as a static site (Render Static Site or any static host). The engine/CLI don't deploy here.

### D1. Signaling: bind to `0.0.0.0` and honor Render's `PORT`
**File:** `packages/signaling/src/server.js`
Render injects `PORT` and requires binding to `0.0.0.0`. `WebSocketServer({ port })` binds all interfaces by default — OK — but make the entrypoint explicit and read `process.env.PORT` (already does: `const PORT = process.env.PORT || 8080`). Confirm no hardcoded host. Keep `8080` as the dev default.

### D2. Signaling: trust proxy for real client IPs
**File:** `packages/signaling/src/server.js`
Render terminates TLS at a proxy, so `req.socket.remoteAddress` is the proxy for everyone → your per-IP rate limit locks out all users at once. Add:
```js
const TRUST_PROXY = process.env.TRUST_PROXY === '1'
// in connection handler:
ws._ip = TRUST_PROXY
  ? (req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress)
  : (req.socket.remoteAddress || '127.0.0.1')
```
Set `TRUST_PROXY=1` in the Render service env. (Only trust the header when the flag is on, so it's not spoofable in dev.)

### D3. Signaling: HTTP `/health` endpoint (Render health checks + uptime)
**File:** `packages/signaling/src/server.js`
Render pings an HTTP path to know the service is up; a bare WS server answers nothing on GET. Create an `http.createServer` that returns `200 {json of metrics}` on `GET /health`, and attach the WS server to it via the `upgrade` event (or `WebSocketServer({ server })`). This finally gives `metrics.js` a consumer. Point Render's Health Check Path at `/health`.
```js
import http from 'http'
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', ...metrics }))
    return
  }
  res.writeHead(404); res.end()
})
this.wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 })
httpServer.listen(port, '0.0.0.0', () => resolve(...))
```

### D4. Signaling: hardening for a public endpoint
Same file:
- `maxPayload: 64 * 1024` on the WS server (signaling messages are tiny; block megabyte RELAY floods).
- `MAX_PEERS_PER_ROOM` (env, default 16) — reject join past it with a clear error.
- `MAX_ROOMS` global cap (env, default e.g. 5000) — reject create past it.
- Explicit RELAY payload size guard (stringify length) + per-connection RELAY rate limit (e.g. 300/min) — ICE is chatty but bounded.
- Optional `ALLOWED_ORIGINS` (comma-sep env): in the `upgrade`/`connection` check `req.headers.origin`; destroy non-matching sockets. Leave unset in dev.
Add tests for join-at-cap and oversized-payload.

### D5. Signaling Dockerfile — build only that package, add healthcheck
**File:** `packages/signaling/Dockerfile`
The current Dockerfile copies `package.json` + `src` and installs — fine, since signaling only depends on `ws` and has no workspace deps. Verify it does **not** rely on the monorepo root. Add:
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-8080}/health || exit 1
CMD ["node", "src/server.js"]
```
On Render, set the service root/Docker context to `packages/signaling` (or use a root Dockerfile that `cd`s in). Because `ws` is the only dep, a standalone build is clean — no workspace hoisting needed.

### D6. Web: `wss://` in prod (mixed-content will block `ws://`)
The web app is HTTPS in prod; `ws://` is mixed content and browsers block it. Set the Render/host env `VITE_SIGNALING_URL=wss://<your-signaling-service>.onrender.com`. Because Vite inlines `VITE_*` at **build time**, this must be present when the static build runs (Render Static Site env vars are available at build). Confirm `useSignalingStore` reads `import.meta.env.VITE_SIGNALING_URL` (it does).

### D7. Web: SPA rewrite so deep links don't 404
Deep links like `/receive?code=ABC123` must serve `index.html`. On Render Static Sites add a rewrite rule: source `/*` → destination `/index.html`, action Rewrite. (If you ever host on Vercel instead, add `vercel.json` with the same rewrite.) Without this, shared receive links 404 in production — a launch blocker.

### D8. Web: TURN for real-world NAT traversal
STUN alone fails for symmetric NAT / CGNAT (most mobile carriers). The env plumbing exists (`VITE_TURN_URL/USERNAME/CREDENTIAL` → `buildIceServers`). For launch, provision TURN (managed: Metered/Cloudflare/Twilio, or self-hosted coturn) and set those envs at build time. **Important:** hardcoding long-lived TURN creds in the client bundle is a leak risk — acceptable for a portfolio/demo, but the "right" version serves short-lived HMAC creds from the signaling server (add a `TURN_CREDENTIALS` message or include in `ROOM_CREATED/JOINED`). At minimum, document the tradeoff and use a rotating credential from a managed provider.

### D9. `.env.example` files — make them the source of truth
Root `.env.example` and `packages/web/.env.example` exist; add/confirm:
- root/signaling: `PORT=8080`, `TRUST_PROXY=0`, `MAX_PEERS_PER_ROOM=16`, `MAX_ROOMS=5000`, `ALLOWED_ORIGINS=`
- web: `VITE_SIGNALING_URL=ws://localhost:8080`, `VITE_STUN_URL=...`, `VITE_TURN_URL=`, `VITE_TURN_USERNAME=`, `VITE_TURN_CREDENTIAL=`
Add a short "Deploying to Render" section to a top-level README: create a Docker Web Service from `packages/signaling` (health path `/health`, env `TRUST_PROXY=1`), create a Static Site from `packages/web` (build `npm run build`, publish `dist`, env `VITE_SIGNALING_URL=wss://…`, add the SPA rewrite).

### D10. `docker-compose.yml` — align with the new health/port setup
Root compose builds signaling with `PORT=8080`. Add a `healthcheck` mirroring D5 and confirm the port mapping. Optionally add a `web` build stage for local full-stack testing (nginx serving `dist`, `VITE_SIGNALING_URL=ws://localhost:8080` baked at build). Not required for Render but makes local E2E easy.

---

## GROUP E — Cleanup before tagging the release

- **Delete dead files:** `packages/web/src/hooks/useWebRTC.js` (never imported), `packages/web/src/hooks/useSignaling.js` (pages use the store directly). Remove `setPage` from `useUIStore`.
- **Remove committed binaries:** `docs/sig-test-out.txt`, `docs/test-out.txt` (they're gitignored patterns yet committed). Confirm `received/`, `testfile.bin`, `*-out.txt` are gone from git history's working tree.
- **`SpeedChart` per-peer branch is dead** (`recordSpeedSample` only writes `{t, mbps}`, never `{peers:[…]}`). Either implement per-peer series or delete the `d.peers` branch and the `peerCount` prop.
- **Update docs:** `docs/phases.md` still says Phase 3 & 4 "NOT STARTED" though both ship. Mark them done, add a Phase 4 section, and record these fixes as `checkpoint 4-x` entries so the Phase 5 README/demo is written from accurate docs.
- **Sender progress semantics with multiple receivers:** `M.servedRef` is a single union Set, so with two receivers on different halves the sender shows COMPLETE while neither finished. If you want it correct for the multi-peer demo, track per-peer served Sets and mark the *session* complete only when at least one peer received all chunks (the receiver already sends `TRANSFER_COMPLETE` now — use it as the authoritative per-peer signal). If you're demoing 1-sender-1-receiver, note it as a known limitation instead.

---

## Suggested order
1. A1 (crash) → A2/A3 (streaming + integrity) → A4 (false-error debounce). Test.
2. B1+B2 (chunk cap + backpressure) → B4+B5 (offer-root check + bounds) → B3/B6/B7. Test + 3-peer smoke.
3. D1–D5 (signaling deploy hardening + health + Dockerfile) → D6–D10 (web env, SPA rewrite, TURN, compose). Deploy to Render staging, hit `/health`, run a real cross-network transfer (phone on cellular ↔ laptop) to validate TURN.
4. C1–C14 UI polish. E cleanup. Update docs. Tag.

After D, do the real-world test that matters most: **one browser on mobile data, one on home wifi, 500MB file.** If that completes, your NAT/TURN/backpressure/streaming are all actually working — which is the thing demos and interviewers poke at first.