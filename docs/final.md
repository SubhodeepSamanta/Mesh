# Mesh — Architecture Review, Bug Report & Roadmap

Living document. Written 2026-07-04, updated as work lands. If a section says "not implemented yet," treat the rest of the doc as still accurate — this file is kept in sync with the actual code, not aspirational.

---

## 1. Architecture assessment — is this "the best," and where does it fall short?

### What's already genuinely best-in-class

- **True zero-server-storage P2P.** File bytes never touch the signaling server — only SDP offers/answers and small JSON control messages pass through it. This is the correct architecture for a privacy-focused transfer tool and matches what tools like Wormhole/Snapdrop/ShareDrop aim for.
- **DTLS-encrypted transport for free.** WebRTC data channels are encrypted by the browser (DTLS 1.2/1.3) — no custom crypto to get wrong.
- **Merkle-proof integrity, not just a single whole-file hash.** Verifying per-chunk against a Merkle root (rather than hashing the whole file at the end) means corruption is caught immediately per-chunk and a bad chunk can be re-requested from a different peer without restarting the transfer. Enforced for every chunk count, including single-chunk files (see Bug Report B2).
- **Streaming straight to disk via the File System Access API.** This is the single biggest reason this can handle multi-GB files without crashing the tab — most "instant P2P share" competitors buffer in memory or IndexedDB and choke on large files.
- **Reseeding/swarm behavior.** Any peer holding verified chunks can seed a late joiner, which is genuinely more resilient than a strict single-sender model.
- **TURN credentials generated dynamically per-connection** (HMAC time-limited, via coturn), not a static secret shipped to the client. Correct pattern.
- **Resource footprint is low by construction.** No app server does file processing; the signaling server is a thin WebSocket router (rooms held in a `Map`, a few hundred bytes each). `docker-compose.yml` caps it at 150MB and coturn at 250MB — that's realistic for the actual workload (control-plane traffic only; the coturn relay only carries bytes when direct P2P fails, e.g. symmetric NAT).
- **Reload session resume (receiver and sender), byte-level resume of disk-streamed downloads, adaptive per-peer pipelining, selective/deduped downloads, mid-session file additions, and opt-in video preview** are all now implemented — see §3–§6.

### Where it's genuinely behind "the best possible"

1. **Signaling server is single-instance, in-memory, no persistence.** Fine at moderate scale (rooms are cheap, room codes expire), but it means: (a) you can't horizontally scale past one process/VM, and (b) a server restart drops every active room instantly. **Decision (this session): explicitly deferred, not a gap.** You confirmed this isn't worth building yet at the current scale — a Redis-backed room store remains a known, well-understood option (see §7) if/when horizontal scaling actually becomes necessary, rather than something to build speculatively now.
2. **No page-reload session resume.** ~~Until this session~~ **Fully fixed this session.** A hard reload (or crash/tab-kill) during a transfer used to be treated as unrecoverable. All four stages of §3 are now implemented: receivers auto-rejoin and re-dial (restarting the transfer, or — for disk-streamed folders — resuming byte-for-byte where it left off when the browser cooperates), and senders get a guided re-pick-the-file prompt that verifies content via `merkleRoot` before resuming seeding.
3. **No selective/partial download.** ~~The receiver always gets an all-or-nothing "download everything" button~~ **Fixed this session (§4).** Per-file checkboxes before "Begin Transfer" now gate which chunks are ever requested from peers (real bandwidth savings, not just a save-time filter), and downloaded files are tracked so re-clicking Download doesn't rewrite everything.
4. **No mid-session file additions.** ~~The file/folder manifest is fixed at the moment the room is created~~ **Fixed (§5).** A sender can now broadcast an "add more files" offer mid-transfer; each receiver accepts or declines independently, and accepted batches transfer over the same data channel. Cross-peer reseeding of *added* batches (only the original sender serves them) remains a scope cut — see §5.
5. **No media streaming (play-while-downloading).** ~~Everything is designed around "verify chunk → write to disk"~~ **Fixed this session (§6).** An opt-in "Play" button + modal lets you stream a video while it's still downloading, when the container supports it, with a clear choice presented up front rather than silently attempting it.
6. **Fixed chunk size, fixed pipeline depth, no real congestion control.** ~~a peer on a fast connection and a peer on a slow one get treated identically~~ **Fixed this session (§7).** Per-peer pipeline depth is now adaptive (AIMD, same principle as TCP congestion control) instead of one fixed depth shared by every peer.
7. **No mobile/background-tab handling.** ~~no explicit handling of the `visibilitychange` / `freeze` lifecycle events~~ **Fixed this session (§7).** The signaling heartbeat and the receiver's peer-redial loop now both force an immediate check the moment a tab becomes visible again, instead of waiting on a `setInterval` tick that mobile browsers throttle or pause while backgrounded.

**Bottom line:** the core transfer engine (integrity, encryption, streaming, TURN fallback) was already near best-practice for a browser-only P2P tool. This session closed essentially every gap called out in the original assessment except horizontal scaling, which you've confirmed is intentionally out of scope for now.

---

## 2. Bug report

### Fixed this session

| # | Bug | File(s) | Status |
|---|---|---|---|
| B1 | Receiver UI froze ("Connection Lost") on any transient signaling blip, before the rejoin logic even got a chance to run; and if reconnection permanently failed after 5 attempts, the client gave up silently with no event at all. | `Receive.jsx`, `signalingClient.js` | **Fixed** — freeze now only triggers on `reconnectFailed`; `_scheduleReconnect` emits `reconnectFailed` when attempts are exhausted instead of going silent. |
| B2 | Single-chunk files skipped Merkle proof verification entirely — a malicious peer could serve tampered data for any file ≤1 chunk by just self-reporting a matching hash. | `swarmManager.js` | **Fixed** — proof is now mandatory and checked for every chunk count. |
| B3 | Empty (0-byte) files inside a folder transfer were silently dropped when streaming to disk. | `useTransfer.js` | **Fixed** — empty files are now explicitly created in the `complete` handler, and skipped correctly if deselected (B7). |
| B4 | Receive-side password prompt let you submit a blank password, round-tripping to the server to get bounced instead of failing fast client-side. | `Receive.jsx` | **Fixed** — mirrors the existing Send-side guard. |
| B5 | `SwarmManager` constructor accepted an `alreadyVerified` array but no caller ever passed it — dead parameter. | `swarmManager.js` | **Fixed** — now wired up two ways: `applySelection()` for deselected files (B7) and `markAlreadyVerified()` for Stage C's disk-resume preflight (§3). |
| B6 | Clicking "Download" again after a completed transfer re-wrote every file from scratch, and for `saveMode: 'auto'`, silently re-prompted for a directory picker each time even with nothing left to write. | `useTransfer.js` (`triggerDownload`) | **Fixed (§4)** — `downloadedPaths` tracking skips already-saved files; the picker is only shown when there's actually something pending. |
| B7 | No way to select a subset of files from a multi-file manifest — it's all-or-nothing. | `FileManifest.jsx`, `useTransfer.js`, `swarmManager.js` | **Fixed (§4)** — per-file checkboxes before "Begin Transfer"; deselected files' chunks are never requested from any peer. |
| B9 *(found this session)* | The disk-resume preflight (Stage C) computed "whole chunks already on disk" via `Math.floor(fileSize / chunkSize)`, which always excludes a file's **last** chunk (normally shorter than `chunkSize`) from candidacy — so every resumed file always re-downloaded its final chunk needlessly. | `useTransfer.js` (`runDiskResumePreflight`) | **Fixed** — the last chunk is now checked separately using the file's declared true size. Regression test added. |
| B10 *(found this session)* | After a signaling client exhausted its reconnect attempts (`reconnectFailed`), the dead client stayed cached in `useSignalingStore`. Any later retry through `connect()`/`resumeSession()`'s `"if (client) return client"` guard would hand back that same dead, non-retrying client — and a caller awaiting its `reconnect`/`reconnectFailed` events (e.g. `SenderResumePrompt`'s retry-after-error path) would **hang forever** with no way out except abandoning the page. | `useSignalingStore.js` | **Fixed** — `reconnectFailed` now also drops the client from the store (only if it's still the same instance that failed), so the next `connect()`/`resumeSession()` call builds a genuinely fresh one. Regression test added. This was the most impactful bug found this session — it directly broke the Stage D "pick the wrong file, get an error, try again" retry path. |
| B11 *(found this session)* | `VideoPlayerModal`'s detected MSE codec string was stashed on `videoRef.current.dataset.codec` — but no `<video>` element exists yet during the detection/ask-stream phases, so `videoRef.current` was `null` and the codec was silently lost, making every attempt to actually stream fail immediately with `stream-error`. | `VideoPlayerModal.jsx` | **Fixed** — the codec is now held in a plain ref (`codecRef`) independent of the DOM, not attached to a not-yet-mounted element. |
| B12 *(found this session)* | `FILE_OFFER_ADD`'s `batchId` had a lower-bound check but no upper bound; since wire chunk indices are packed as `batchId * BATCH_STRIDE + localIndex` into a `uint32`, an unusually large `batchId` (e.g. from a buggy/adversarial peer after thousands of "add files" calls) would silently overflow and corrupt chunk routing for that batch. | `transferManager.js`, `useTransfer.js` | **Fixed** — added `MAX_BATCH_ID`, the largest `batchId` that can't overflow the 32-bit wire format, and reject anything above it. Low real-world likelihood (would need ~4,300+ "add files" calls in one session) but a cheap, correct guard. |

### Found, not yet fixed

| # | Bug | File(s) | Notes |
|---|---|---|---|
| B8 | The signaling server has no persistence — a server restart mid-transfer drops all rooms. | `packages/signaling/src/server.js` | **Explicitly deferred, not fixed** — you confirmed a Redis-backed store isn't worth building at the current scale. Interacts with reload-resume (§3): even a perfect client-side resume can't succeed if the server also cycled and forgot the room within the same window. |

---

## 3. Phase 0 — session resume, all four stages

**Fully implemented and tested this session** (`test/sessionResume.test.js`, `test/diskResumePreflight.test.js`, `test/dirHandleStore.test.js`, plus store/protocol tests). Stage C's real-browser permission-prompt behavior is the one part that genuinely needs a manual two-browser pass — see the caveat at the end of Stage C below.

### The honest constraint

A full page reload destroys **all** in-memory JS state: the WebSocket, every `RTCPeerConnection`/`RTCDataChannel`, and — critically — any `File` object obtained from a plain `<input type=file>` or drag-and-drop. There is no browser API to get that `File` object back after a reload. This is why sender-side resume (Stage D) can never be fully silent/automatic the way receiver-side resume (Stage B) can.

### Stage A — signaling-level rejoin plumbing. ✅

- `{roomCode, peerId, rejoinToken}` is persisted to `localStorage` (key `mesh-signaling-session`) whenever a room is created, joined, or successfully rejoined (`useSignalingStore.js`). Cleared on `disconnect()` and on `reconnectFailed`.
- `resumeSession()` rebuilds a fresh `SignalingClient` seeded with the saved `peerId`/`roomCode`/`_rejoinToken` **before** calling `connect()`. The existing `REJOIN_ROOM` handshake fires automatically as soon as the socket opens — no server changes needed, since the server doesn't distinguish "reload" from "network blip."
- `useTransferStore`'s reload handler (`loadSaved()`): if role is `receiver` and a session is resumable → status `reconnecting`. If role is `sender` and a session is resumable → status `reconnecting-sender` (Stage D prompt). Otherwise → hard `error`, same as before this session.
- **Bug found and fixed here (B10):** a client that exhausted its reconnect attempts stayed cached in the store, silently breaking every subsequent resume attempt. See Bug Report.

### Stage B — receiver-side auto-recovery. ✅ (`useSessionResume.js`, mounted once in `App.jsx`)

On mount, if status is `reconnecting` and role is `receiver`:
1. Calls Stage A's `resumeSession()`, awaits `reconnect`/`reconnectFailed` to learn `existingPeers`. No peers left → fails gracefully with "the sender is no longer connected."
2. Re-dials every existing peer via the existing `dialPeer()`. Deliberately does **not** pre-set `transferring` here (unlike a plain restart) — it waits for Stage C's disk-resume preflight to run first, if applicable.
3. Once `M.swarm` exists (a short polling window accounts for `dialPeer` resolving before the `FILE_OFFER` itself arrives), it either runs the Stage C preflight or moves straight to resuming, then sets `transferring` and calls `addReceiverPeer` for each matching transport.
4. Dashboard and Receive both render a "Reconnecting..." state instead of stale progress UI.

### Stage C — byte-level resume for disk-streamed downloads. ✅

For `saveMode: 'auto'` (a picked destination folder), a reload doesn't have to mean starting over:

1. The `FileSystemDirectoryHandle` is persisted to IndexedDB (`dirHandleStore.js`) whenever streaming begins.
2. On resume, `useSessionResume.js` tries to reopen it and calls `queryPermission({mode:'readwrite'})` — **only if the browser silently still grants it** (no user gesture available at this point). If not granted, this falls back cleanly to Stage B's plain restart, with a toast explaining a fresh permission click would be needed to resume into the same folder.
3. If granted: `runDiskResumePreflight()` scans each file for whole chunks already on disk, and — rather than trusting file size alone — asks the peer for just that chunk's **hash + proof** (`CHUNK_PROOF_REQUEST`/`CHUNK_PROOF`, new tiny message pair, no chunk bytes exchanged) and verifies the on-disk bytes against the transfer's trusted `merkleRoot` locally. Anything that doesn't check out (missing file, no response, proof mismatch) is simply left for the normal swarm to re-request — pure optimization, never a correctness risk.
4. Verified indices are applied via `SwarmManager.markAlreadyVerified()` before any peer is added, so the swarm never re-requests them.
5. `writeChunkStreaming`'s writer now always opens with `keepExistingData: true` (safe for both fresh and resumed files) so previously-verified bytes on disk survive the writer being reopened for the file's remaining chunks.
6. **Bug found and fixed here (B9):** the preflight's "whole chunks on disk" math always excluded each file's last (shorter) chunk from consideration. Fixed with a regression test.

**Caveat:** whether the browser actually grants `queryPermission` silently after a reload varies by browser/version — Chromium has been moving toward remembering directory grants across reloads for the same origin, but this isn't guaranteed. This is the one piece of this session's work that should get a real two-browser check rather than relying solely on the (passing) unit tests, which mock the File System Access API.

### Stage D — sender-side recovery. ✅ (`SenderResumePrompt.jsx`, shown from both `Send.jsx` and `Dashboard.jsx`)

A reloaded sender has lost its `File` object — there's no way around prompting for it again:
1. On reload, a sender with a resumable session gets status `reconnecting-sender` and sees a prompt: "Resume sending X? Re-select the same file(s)."
2. The re-picked file(s) are rehashed client-side (`indexFilesAsync`) and the resulting `merkleRoot` is compared against what was actually being sent before the reload. Mismatch → clear error, try again (no silent wrong-file resumption).
3. Match → rejoins the room via `resumeSession()`, then calls `startSending()` + `M.startSeederListener()` exactly as a fresh send would, so any receiver that's independently re-dialing (its own Stage B) connects normally.
4. A "give up and start a new send instead" escape hatch is always available.

---

## 4. Selective per-file download + no-duplicate-download. ✅ Implemented

**What you asked for:** a tick mark per file so the receiver chooses what to download, and already-downloaded files don't get silently rewritten.

**How it works:**
- `FileManifest` shows a checkbox per file while status is `file-offered` (before "Begin Transfer"), defaulting to all-checked — today's behavior is the default, not a departure from it.
- Ticking gates **which chunks are ever requested from any peer** (real bandwidth savings), not just a save-time filter: `SwarmManager` gained `applySelection(excludedIndices)`, which marks deselected chunks `excluded` — never enqueued, never counted toward the completion target (`neededCount`). This resolves Open Question #1 in favor of the bandwidth-saving option.
- `downloadedPaths` (tracked in `useTransferStore`, not persisted across reload) marks a file "Downloaded ✓" the moment it's actually saved — immediately for disk-streamed files (as their last chunk lands), at save-time for the in-memory/blob-download path. `triggerDownload()` skips both deselected and already-downloaded files, and — critically — skips the whole "prompt for a directory" step if there's nothing left to write.
- A small "redownload" affordance next to "Downloaded ✓" lets you re-save one specific file without re-writing everything else.

Tests: `test/swarmManagerSelection.test.js` (exclusion logic), `test/transferStoreBatches.test.js` (downloaded-path tracking).

---

## 5. Phase 1: Add a file to an already-open room (sender), with receiver approval. ✅ Implemented

*(Unchanged from the prior pass of this session — see the code for `FILE_OFFER_ADD`/`FILE_OFFER_ADD_ACCEPT`, `BATCH_STRIDE`-based wire multiplexing, and `ExtraBatches.jsx`.)*

**Scope cuts, still accurate:** no cross-peer reseeding for added batches (only the original offering peer serves them); added-batch files are in-memory-only downloads; a narrow race window exists if a batch is added while a receiver is still on the main transfer's pre-consent screen.

---

## 6. Phase 2: Video streaming (play while downloading). ✅ Implemented, with an upfront choice

Per your ask, this isn't silent/automatic — it's a **"Play" button → modal → explicit choice**, not something that just starts streaming on its own:

1. `FileManifest` shows a "▶ Play" button next to any file that looks like a video (`videoFormat.js`), once the transfer is underway.
2. Clicking it opens `VideoPlayerModal`, which:
   - If the file is already fully downloaded: just plays it via a blob/file URL immediately — no extra choice needed.
   - Otherwise, spends a moment accumulating the file's own head bytes (from memory or by re-reading the growing on-disk file) and checks whether progressive playback is actually feasible: WebM is always eligible; MP4 requires detecting a **fragmented** structure (an `mvex` box inside `moov` — a plain "faststart" MP4 with `moov` merely moved to the front is *not* enough for MSE's `appendBuffer`).
   - **If feasible:** presents the choice explicitly — "▶ Start watching" (streams via MSE, appending verified chunks in order as they arrive) or "Wait until it's done."
   - **If not feasible** (wrong container, or the browser doesn't support any codec string this session tried via `MediaSource.isTypeSupported`): says so plainly and auto-plays once the file completes — no failed streaming attempt, no silent fallback.
3. Codec detection doesn't try to parse the exact encoder profile — it tries a handful of common, broadly-compatible codec strings per container and uses the first the browser accepts. Good enough for "can this browser attempt MSE playback of this container," not exact codec matching.
4. **Bug found and fixed here (B11):** the detected codec was originally stashed on a `<video>` DOM node that doesn't exist yet during detection, silently breaking every streaming attempt. Fixed by holding it in a plain ref instead.

**Known limitation, not fixed:** no sliding-window eviction of already-played `SourceBuffer` data — fine for "preview a video while it downloads," a real constraint for hours-long content given browser MSE memory limits.

Tests: `test/videoFormat.test.js` covers the container/fragmentation/codec-detection logic directly (pure functions, no browser needed for the tricky parts).

---

## 7. Bandwidth-aware pipelining & mobile/background-tab handling. ✅ Implemented (Redis explicitly deferred)

- **Adaptive per-peer pipeline depth:** `SwarmManager` replaced its one fixed `pipelineSize = 4` shared by every peer with a per-peer AIMD window (same principle as TCP congestion control): +1 on every verified chunk from that peer, halved on any timeout/failure from that peer, bounded `[2, 32]` and still capped by the existing global outstanding-request limit. A fast, reliable peer's window grows; a slow or lossy one settles smaller — instead of every peer being treated identically regardless of how well it's actually keeping up.
- **Tab-backgrounding:** both the signaling heartbeat (`signalingClient.js`) and the receiver's periodic peer-redial loop (`Layout.jsx`) now listen for `visibilitychange` and force an immediate check/ping the moment a tab becomes visible again, instead of waiting on a `setInterval` tick that mobile Chrome/Safari throttle or fully pause while backgrounded. A pending reconnect timer (scheduled while hidden) also fires immediately on return rather than waiting out its original backoff delay.
- **Redis-backed signaling room store:** discussed and **explicitly not built this session** — you confirmed this isn't needed at the current scale. Left as a known, well-understood option (not a mystery) if/when horizontal scaling or restart-survival actually becomes a real requirement; see B8.

Tests: `test/swarmManagerSelection.test.js` (adaptive pipeline growth/shrink/independence-per-peer), `test/signalingClient.test.js` (visibility-triggered ping/reconnect).

---

## 8. Investigated: sharing over a mobile hotspot with no actual internet

**Question:** if a laptop connects to a phone's mobile hotspot with zero WAN internet, can Mesh still transfer files between them?

**Short answer: not today, and — per your call — not being changed right now.** The blocker isn't the file transfer itself:

1. Both devices loading the Mesh web app needs internet (no service worker / offline cache — a fresh network fetch is required each visit).
2. Room creation/joining needs a reachable signaling **WebSocket** server (`VITE_SIGNALING_URL`, hosted remotely) — this is the actual hard blocker on a zero-internet hotspot. Room creation/joining fails here before anything else can start.
3. **If step 2 succeeded**, the actual file bytes would already take the local path automatically: WebRTC gathers *host* ICE candidates (raw local interface addresses) independently of STUN/TURN reachability, and two devices on the same hotspot subnet can connect directly on those without ever needing the internet-facing STUN server (`stun.l.google.com` by default) to respond. No `iceTransportPolicy: 'relay'` override forces things through TURN, so nothing in the code actively prevents a local-only connection once signaling has happened.

So: today, a *brief* internet connection is required only to set up the connection (steps 1–2), not for the transfer itself (step 3) — a hotspot with even minimal data connectivity already works fine, no different from any other WiFi network. A genuinely zero-internet fallback would mean replacing the signaling step with something like QR-code/manual SDP exchange (no server involved at all) — a real, separate feature, not a bug fix. **You've confirmed this isn't worth building right now**, so it's documented here as a known, understood gap rather than something left silently broken.

---

## 9. Feature ideas worth considering (brainstorm, unranked, unchanged from before)

- **Drag-to-reorder file priority** — let the receiver bump a specific file to the front of the download queue.
- **QR code for room code** — a scannable QR of the join URL removes typing an 8-character code entirely (the app already has QR *scanning* for room codes; this would be the generation side).
- **Transfer speed limit / pause-resume UI** — already has pause primitives (`setPaused`) — surfacing a user-facing pause button would be low effort.
- **Link expiration / one-time room codes** — rooms already TTL out; making "burn after one download" explicit would be a nice trust signal.
- **Clipboard/text snippet sharing** — reuse the exact same room+E2E channel for a quick paste-a-password/paste-a-code use case.
- **Native share sheet integration** (Web Share Target API) — "share to Mesh" from a phone's OS share sheet.

---

## Status of this session's work

**Everything scoped this session is now implemented**, tested, and passing:

- **Phase 0 — all four session-resume stages** (§3): receiver auto-recovery, sender guided re-attach, and byte-level disk resume with proof-verified partial-file reuse.
- **§4 — selective per-file download + no-duplicate-download**, with real bandwidth savings (deselected chunks are never requested), not just a save-time filter.
- **Phase 1 — mid-session file additions** (§5, from earlier in this session), unchanged.
- **§6 — opt-in video streaming** with an explicit modal choice, not silent/automatic.
- **§7 — adaptive per-peer pipelining and tab-backgrounding handling**; Redis-backed signaling explicitly deferred per your decision.
- **Hotspot/no-internet investigation** (§8): confirmed today's real constraint (signaling needs reachability, the transfer itself doesn't), with a possible QR/manual-signaling fallback identified and explicitly declined for now.
- **A thorough bug-hunting pass** across everything built this session, finding and fixing 4 real bugs beyond the original scope (B9–B12), most notably a stale-signaling-client bug (B10) that made the new Stage D retry-after-error path hang forever.

**Verification:**
- `packages/web`: 78/78 tests passing, `npm run build` succeeds.
- `packages/signaling`: unchanged, 23/23 tests still passing — no server-side changes were needed for anything this session.
- **Not covered by automated tests, worth a manual two-browser pass:** Stage C's real-world `queryPermission` behavior after a reload (browser-version-dependent, can't be faithfully mocked), and the end-to-end feel of the video-streaming modal against a real fragmented MP4/WebM file. Both degrade gracefully (to a plain restart, and to "wait for completion," respectively) if the browser doesn't cooperate — this is a UX-polish verification, not a correctness risk.

Nothing from the original roadmap remains open except the explicitly-deferred Redis-backed signaling store (§7) and the explicitly-declined offline/QR signaling fallback (§8) — both documented decisions, not oversights.
