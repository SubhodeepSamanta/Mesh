# Mesh — Architecture Review, Bug Report & Roadmap

Living document. Written 2026-07-04, updated as work lands. If a section says "not implemented yet," treat the rest of the doc as still accurate — this file is kept in sync with the actual code, not aspirational.

---

## 1. Architecture assessment — is this "the best," and where does it fall short?

### What's already genuinely best-in-class

- **True zero-server-storage P2P.** File bytes never touch the signaling server — only SDP offers/answers and small JSON control messages pass through it. This is the correct architecture for a privacy-focused transfer tool and matches what tools like Wormhole/Snapdrop/ShareDrop aim for.
- **DTLS-encrypted transport for free.** WebRTC data channels are encrypted by the browser (DTLS 1.2/1.3) — no custom crypto to get wrong.
- **Merkle-proof integrity, not just a single whole-file hash.** Verifying per-chunk against a Merkle root (rather than hashing the whole file at the end) means corruption is caught immediately per-chunk and a bad chunk can be re-requested from a different peer without restarting the transfer. As of this session, this is now actually enforced for every chunk count (see Bug Report #3 below — it previously had a hole for single-chunk files).
- **Streaming straight to disk via the File System Access API.** This is the single biggest reason this can handle multi-GB files without crashing the tab — most "instant P2P share" competitors buffer in memory or IndexedDB and choke on large files.
- **Reseeding/swarm behavior.** Any peer holding verified chunks can seed a late joiner, which is genuinely more resilient than a strict single-sender model.
- **TURN credentials generated dynamically per-connection** (HMAC time-limited, via coturn), not a static secret shipped to the client. Correct pattern.
- **Resource footprint is low by construction.** No app server does file processing; the signaling server is a thin WebSocket router (rooms held in a `Map`, a few hundred bytes each). `docker-compose.yml` caps it at 150MB and coturn at 250MB — that's realistic for the actual workload (control-plane traffic only; the coturn relay only carries bytes when direct P2P fails, e.g. symmetric NAT).

### Where it's genuinely behind "the best possible"

1. **Signaling server is single-instance, in-memory, no persistence.** Fine at moderate scale (rooms are cheap, room codes expire), but it means: (a) you can't horizontally scale past one process/VM, and (b) a server restart drops every active room instantly (no room state survives a deploy). For a "best in class" bar this needs either a Redis-backed room store or an explicit acceptance that this is a deliberate trade-off for simplicity (which is a legitimate choice — just should be a documented one, not an oversight).
2. **No page-reload session resume.** Until this session, any hard reload (or crash/tab-kill) during a transfer was treated as unrecoverable — signaling rejoin tokens existed for *network blips* but were never wired to survive a reload. See Phase 0 below for what's now fixed vs. still open (there are real browser-API limits here, not just missing code — see §3).
3. **No selective/partial download.** The receiver always gets an all-or-nothing "download everything" button; there was no way to pick specific files out of a multi-file offer, and clicking Download twice re-wrote every file to disk again. Being addressed this session (§4).
4. **No mid-session file additions.** The file/folder manifest is fixed at the moment the room is created — a sender can't add "oh, one more file" without starting an entirely new room. Real feature gap for a tool meant for casual multi-file sharing. Designed in §5, not yet implemented (protocol-level change).
5. **No media streaming (play-while-downloading).** Everything is designed around "verify chunk → write to disk," not "verify chunk → hand to a `<video>` element." Feasible (see §6) but nothing today lets you scrub/play a video before the transfer finishes.
6. **Fixed chunk size, fixed pipeline depth (4 in-flight per peer), no real congestion control.** Backpressure exists (`bufferedAmount` high/low watermarks in `webrtc.js`) which prevents OOM/overflow, but there's no bandwidth estimation or adaptive chunk sizing — a peer on a fast connection and a peer on a slow one get treated identically. Not urgent, but a real "best-in-class" transfer tool (e.g. what BitTorrent does with peer choking algorithms) would adapt pipeline depth per peer based on observed throughput.
7. **No mobile/background-tab handling documented or tested.** Browsers throttle timers and can suspend WebSocket/RTCPeerConnection activity when a tab is backgrounded or the phone screen locks. There's a heartbeat (15s ping / 45s timeout) but no explicit handling of the `visibilitychange` / `freeze` lifecycle events, which matters a lot for "share a big file from your phone, then lock the screen."

**Bottom line:** the core transfer engine (integrity, encryption, streaming, TURN fallback) is already near best-practice for a browser-only P2P tool — that part doesn't need a rewrite. What's missing is entirely in the "session resilience" and "UX around multi-file/media" layers, which is exactly what this doc plans out below.

---

## 2. Bug report

### Fixed this session

| # | Bug | File(s) | Status |
|---|---|---|---|
| B1 | Receiver UI froze ("Connection Lost") on any transient signaling blip, before the rejoin logic even got a chance to run; and if reconnection permanently failed after 5 attempts, the client gave up silently with no event at all, which would've left the UI hung forever once B1's naive freeze-trigger was removed. | `Receive.jsx`, `signalingClient.js` | **Fixed** — freeze now only triggers on `reconnectFailed`; `_scheduleReconnect` now emits `reconnectFailed` when attempts are exhausted instead of going silent. |
| B2 | Single-chunk files skipped Merkle proof verification entirely — a malicious peer could serve tampered data for any file ≤1 chunk by just self-reporting a matching hash, and the receiver would accept it as "verified." | `swarmManager.js` | **Fixed** — proof is now mandatory and checked for every chunk count. Regression tests added (`integrity.test.js`). |
| B3 | Empty (0-byte) files inside a folder transfer were silently dropped when streaming to disk — they never appeared in the destination directory. | `useTransfer.js` | **Fixed** — empty files are now explicitly created in the `complete` handler. |
| B4 | Receive-side password prompt let you submit a blank password, round-tripping to the server to get bounced instead of failing fast client-side. | `Receive.jsx` | **Fixed** — mirrors the existing Send-side guard. |

### Found, not yet fixed (pre-existing, low severity)

| # | Bug | File(s) | Notes |
|---|---|---|---|
| B5 | `SwarmManager` constructor accepts an `alreadyVerified` array (meant for resuming a transfer with some chunks already confirmed) but **no caller ever passes it** — dead parameter. | `swarmManager.js:13` | This is exactly the hook needed for reload-resume (§3) and will finally get wired up there. |
| B6 | Clicking "Download" again after a completed transfer re-writes every file from scratch (no per-file "already saved" tracking), and for the `saveMode: 'auto'` folder-picker path, it silently re-prompts for a directory picker each time. | `useTransfer.js` (`triggerDownload`) | Being fixed in §4 (dedupe + selection). |
| B7 | No way to select a subset of files from a multi-file manifest — it's all-or-nothing. | `FileManifest.jsx`, `useTransfer.js` | Being fixed in §4. |
| B8 | The signaling server has no persistence — a server restart mid-transfer drops all rooms with no warning to connected clients beyond the existing reconnect-failure path. Not a "bug" exactly (architecture trade-off, see §1.1) but worth flagging since it interacts with reload-resume: even a perfect client-side resume can't succeed if the server also cycled and forgot the room. | `packages/signaling/src/server.js` | Documented trade-off, not fixed. |

---

## 3. Phase 0 (planned, not started): making fix #2 (session resume) real

### The honest constraint

A full page reload destroys **all** in-memory JS state: the WebSocket, every `RTCPeerConnection`/`RTCDataChannel`, and — critically — any `File` object obtained from a plain `<input type=file>` or drag-and-drop. There is no browser API to get that `File` object back after a reload. This means:

- **Receiver-side resume is achievable** (with caveats, below).
- **Sender-side resume is not fully automatic** — the sender's original `File` handles are gone. The realistic UX is: detect on reload that there was an in-progress *send*, and prompt the user to re-drop/re-select the same file(s); match by `merkleRoot` (recomputed from the re-selected file) to confirm it's actually the same content, then rejoin the same room via the persisted rejoin token and resume seeding. This is a real feature, not a bug fix, and is scoped as its own roadmap item below rather than bolted on under time pressure.

### Concrete implementation plan (staged so each stage is independently shippable)

**Stage A — signaling-level rejoin plumbing.**
- Persist `{roomCode, peerId, rejoinToken}` to `localStorage` whenever a room is created/joined/rejoined (`useSignalingStore.js`).
- On store `connect()`, if a persisted session exists — and the persisted transfer state says the transfer was actually still live, not already complete/errored — seed the new `SignalingClient` with that `peerId`/`roomCode`/`_rejoinToken` **before** calling `connect()`. The existing `REJOIN_ROOM` handshake (built in the earlier session for network-blip recovery) fires automatically on reload too, since the signaling server doesn't actually distinguish "reload" from "network blip" — this reuses that path for free, no server changes needed.
- `useTransferStore`'s reload handler stops immediately force-failing a live transfer; it marks it `reconnecting` and gives Stage B a chance to run before falling back to today's "Transfer interrupted" error.

**Stage B — receiver-side auto-recovery (fully achievable now, no new browser APIs needed).**
This is the high-value, low-risk part. On a reload, the *receiver's* file bytes-in-flight are gone regardless (they lived in JS memory or were never fully written), but the room and the sender are usually still alive. So on reload:
1. Run Stage A's rejoin. On success, `ROOM_REJOINED` returns `existingPeers` (the sender, if still connected).
2. Re-dial each existing peer using the **already-existing** `dialPeer()` in `useTransfer.js:532` — it already does exactly this handshake (creates a `WebRTCTransport`, sends/receives `FILE_OFFER`, wires up `addReceiverPeer`), just currently only called when a *new* peer joins a room you're already in, not after your own reload. No new dialing logic needed, just calling it from the reload path too.
3. Rebuild a fresh `SwarmManager` from chunk 0 (i.e. the transfer restarts rather than resuming mid-file this stage) — that's a real regression vs. a hypothetical perfect resume, but it replaces today's *hard dead end* ("ask the sender for a brand-new room code") with *automatic recovery* ("your download just restarts itself"). That's a meaningful, shippable improvement on its own.
4. If the sender *also* reloaded/left, `existingPeers` will be empty and this degrades gracefully to today's "Transfer interrupted" state — no worse than now.

**Stage C — byte-level resume, not just room-level (bigger, separate piece of work).**
- Wire `SwarmManager`'s currently-dead `alreadyVerified` param (bug B5) using the receiver's `progress.verified` count, so Stage B's "restart" doesn't re-request chunks it provably already wrote to disk.
- For `saveMode: 'auto'` (disk-streamed folders): persist the `FileSystemDirectoryHandle` to IndexedDB (it's structured-cloneable, so this is possible) so the same on-disk destination can be reopened after reload. Needs `queryPermission`/`requestPermission` re-grant handling, since Chromium re-asks for write permission after a reload — this needs a user gesture (a click), so it can't be fully silent.
- This stage needs care because it touches IndexedDB + file-system permission prompts, neither of which the current test setup (`vitest` + `node --test`, no browser/e2e harness) can exercise automatically — it should land with manual browser verification, not just unit tests.

**Stage D — sender-side recovery.**
A reloaded sender has lost its `File` object — there's no browser API to get it back. The honest UX: detect on reload that there was an in-progress *send*, rejoin the room (Stage A), and prompt "please re-select the same file(s) to resume sending." Re-hash the re-selected file(s) client-side and compare the resulting `merkleRoot` to the persisted one to confirm it's actually the same content before resuming seeding in the same room. If it doesn't match (wrong file re-picked) or the user doesn't re-pick anything, fall back to the existing error state.

### Suggested build order
Stage A and B together are the meaningful "fix #2, done properly" deliverable and don't require anything not already unit-testable. C and D are real follow-on features, not bug fixes — recommend scoping them separately once A/B are verified working in a real browser.

---

## 4. Selective per-file download + no-duplicate-download (planned, not started)

**What you asked for:** a tick mark per file in the manifest so the receiver chooses what to download, and files that are already downloaded don't get silently re-downloaded when you click Download again.

**Design:**
- `FileManifest` gains a checkbox per file (default: all checked, preserving today's "download everything" as the default action).
- A `downloadedPaths: Set<string>` is tracked per transfer (in-memory, keyed by file path) so a file that's already been written to disk shows a "Downloaded ✓" state instead of a checkbox, and is skipped on the next Download click unless the user explicitly re-ticks it (a small "redownload" affordance).
- `triggerDownload()` (`useTransfer.js`) is changed to accept an explicit file list (the ticked ones) instead of always iterating every file in the manifest (today it re-writes every file to disk on every click — bug B6).
- Interacts with the `saveMode: 'auto'` (directory-picker streaming) path carefully: files are currently written as each chunk arrives (`writeChunkStreaming`) rather than at download-click time, so "ticking" a file only really changes *download-click* behavior for the in-memory/`saveMode: 'files'` path — for the disk-streaming path, all files already land on disk as they arrive regardless of ticks, so the checkbox there should be reframed as "reveal/open" rather than "download," or ticking should gate which files get requested from peers in the first place (a `SwarmManager`-level change: skip requesting chunks for un-ticked files). Worth deciding which behavior you want before implementing — see note at the end of this doc.

---

## 5. Phase 1: Add a file to an already-open room (sender), with receiver approval

Not implemented this session — this is a genuine protocol change, sketched here so it can be picked up cleanly.

**Why it's a protocol change, not a UI tweak:** today, `FILE_OFFER` carries one fixed manifest + one Merkle root for the whole session, computed once at `startAsSender`. A `SwarmManager` is built once against that single root. Adding a file mid-session means either (a) growing the manifest and rebuilding a Merkle tree that covers old + new chunks (breaks any receiver mid-verification, since indices shift), or (b) treating each "batch" of added files as its own independent Merkle tree/offer, chained onto the same room. **(b) is the right approach** — much less invasive, and mirrors how the existing multi-file manifest already indexes chunks per-file via `startChunk`/`chunkCount`.

**Proposed flow:**
1. New message type `FILE_OFFER_ADD` (sender → all peers in room, over the existing relay channel — no signaling-server changes needed, this rides the same WebRTC data channel as chunks): `{ batchId, files: [...], merkleRoot, totalChunks, chunkSize }`, same shape as the initial offer but scoped to just the new files.
2. Receiver UI shows a non-blocking notification ("Sender added 2 more files — Accept / Decline") rather than auto-starting a download — this is the "tick mark to approve" behavior you described. Accepting sends `FILE_OFFER_ADD_ACCEPT { batchId }` back; declining just drops it (sender isn't blocked either way, it's advisory).
3. On accept, the receiver spins up a **second `SwarmManager`** scoped to `batchId`'s chunk range/root, reusing the exact same `WebRTCTransport`/data channel (no new peer connection needed — it's the same room, same channel, just a new logical batch multiplexed by `batchId` in the chunk-request/response messages).
4. UI-wise, `Dashboard`/`Receive` show multiple manifests (original + each accepted batch) rather than one fixed one.
5. Reseeding/rejoin-token logic is untouched — this only adds a new message type on the existing data channel, no signaling-server involvement.

**Estimated effort:** medium — mostly UI (approval modal, multi-manifest dashboard rendering) plus modest protocol additions (`protocol.js` gets two new JSON message kinds; `SwarmManager` and `useTransfer.js` need to support holding more than one active swarm per room instead of the current singleton `M.swarm`).

---

## 6. Phase 2: Can this stream video (play while downloading)?

**Short answer: yes, feasible, not implemented.**

The pieces already needed are in place: chunks arrive in a verifiable, ordered stream (Merkle-proven), and the transport already delivers them over a reliable, ordered data channel. To turn that into "watch while it downloads":

1. Use the **Media Source Extensions (MSE)** API: create a `MediaSource`, attach it to a `<video>` element via `URL.createObjectURL(mediaSource)`, open a `SourceBuffer` with the right MIME/codec string (e.g. `video/mp4; codecs="avc1.42E01E,mp4a.40.2"`).
2. As each chunk is Merkle-verified (the existing `chunkVerified` event in `swarmManager.js`), append it to the `SourceBuffer` in order via `sourceBuffer.appendBuffer(chunkData)` — chunks must be appended strictly in file order for this to work, which the existing sequential verification/pipeline mostly already gives you (the swarm can verify out of order across peers, but appending needs an ordering buffer in front of MSE — a small queue keyed by chunk index, flushed in order).
3. Caveat: this requires the source video to be in a **fragmented/streamable container** (fragmented MP4 or WebM) — a non-fragmented "regular" MP4 (moov atom at the end) can't be progressively played this way without already having the whole file, since the metadata needed to start playback may be at the end of the file. This would need either (a) requiring/recommending fragmented MP4 for anything meant to be watched live, or (b) detecting this and falling back to "wait for completion, then play" for regular MP4s.
4. This is naturally an **opt-in per-file affordance** — a "Play" button that appears once enough of the file's *start* has arrived (for fragmented formats, MSE can begin as soon as the init segment + first fragment are in), not a default behavior for every file type.

**Effort estimate:** medium-high — mostly because of format-detection edge cases (container format, codec string detection) rather than the streaming mechanics themselves, which are a natural fit for the existing verified-chunk pipeline.

---

## 7. Phase 3: scale & resilience (not urgent, listed for completeness)

- Redis-backed (or similar) signaling room store, to allow horizontal scaling and survive server restarts without dropping active rooms.
- Bandwidth-aware pipeline depth per peer (replace the fixed `pipelineSize = 4` with an estimate based on observed chunk RTT/throughput).
- Explicit `visibilitychange`/tab-backgrounding handling so a transfer initiated on mobile survives the screen locking.

---

## 8. Feature ideas worth considering (brainstorm, unranked)

- **Drag-to-reorder file priority** — let the receiver bump a specific file to the front of the download queue (useful when only one file in a big folder is urgent).
- **QR code for room code** — since this is aimed at phone-to-laptop sharing, a scannable QR of the join URL removes typing an 8-character code entirely.
- **Transfer speed limit / pause-resume UI** — already has pause primitives (`setPaused` in the store) — surfacing a user-facing pause button (not just auto-pause) would be low effort.
- **Link expiration / one-time room codes** — rooms already TTL out; making "burn after one download" explicit and visible to the sender would be a nice trust signal.
- **Clipboard/text snippet sharing** — reuse the exact same room+E2E channel for a quick paste-a-password/paste-a-code use case, without needing to wrap text in a fake "file."
- **Native share sheet integration** (Web Share Target API) — "share to Mesh" from a phone's OS share sheet, skipping the browser entirely for the file-picking step.

---

## 9. Open questions to decide before implementation starts

1. **Selective download semantics for `saveMode: 'auto'` (§4):** should ticking a file gate *which chunks get requested from peers at all* (saves bandwidth, needs a `SwarmManager` change), or just gate the final in-memory/save-dialog step (simpler, but for disk-streaming mode every file already lands on disk regardless of ticks — so the checkbox would only mean "reveal/open," not "download")? Recommend the former if bandwidth matters to you, the latter if it's just about reducing clutter in a downloads folder.
2. **Fix #2 scope for this pass:** Stage A+B (§3) gets you "reload auto-recovers and restarts the transfer" — a real, shippable fix — without touching IndexedDB or file-system permission prompts. Stage C (true byte-level resume) and Stage D (sender re-attach) are bigger, separately-scoped features. Confirm you want A+B first before C/D.
3. **Add-file-mid-session (§5):** confirm the "second independent SwarmManager per batch, same data channel" approach is the right shape before it's built — it's the least invasive option but means the UI needs to render multiple manifests per room instead of one.
4. **Video streaming (§6):** confirm scope — full MSE playback with fragmented-MP4 detection, or a smaller first cut ("Play" button only for files already fully downloaded, deferring true progressive streaming)?

## Status of this session's work

Nothing in sections 3–8 has been implemented yet — this is a planning pass only, per your request to write the plan first. The bug fixes in §2's "Fixed this session" table (B1–B4: reconnect freeze, single-chunk integrity bypass, empty-file folder drops, blank-password validation) were implemented and verified (44/44 tests passing) in the prior turn of this session, before this planning doc was requested.

Say which phase(s) to start on and I'll implement against this plan and update this file as work lands.
