# Mesh Project — Web App Bug Analysis & Fix Instructions

This document provides a detailed breakdown of the bugs identified in the Mesh P2P file-sharing application (web client and signaling server integration) and provides the exact search-and-replace edits required to resolve them.

---

## 1. UI Freeze on Temporary Signaling Disconnect (Web Client)

### Symptom
When the receiver is in the middle of a transfer (or waiting for a file offer) and a brief signaling server disconnect occurs (e.g., due to a temporary WiFi fluctuation), the UI immediately displays a blocking **"Connection Lost"** screen and forces the user to abort/leave the room. This happens even if the direct WebRTC P2P data connection is healthy and transfer is running.

### Reason
In `packages/web/src/pages/Receive.jsx`, the subscription to the signaling store transitions the UI state `roomClosed` to `true` as soon as the signaling server's WebSocket transitions to `disconnected`:
```javascript
if (prev.status === 'connected' && s.status === 'disconnected' && status !== 'complete') {
  setRoomClosed(true)
}
```
Once `roomClosed` becomes `true`, there is no mechanism to set it back to `false` automatically when the signaling client reconnects and rejoins the room. Moreover, WebRTC direct connection does not require the signaling server to remain open once the data channels are established.

### Solution
1. Do not set `roomClosed` to `true` when the signaling status temporarily goes to `disconnected`. Instead, only flag the room as closed if the signaling client explicitly triggers a `reconnectFailed` event (indicating that it failed to rejoin the room after all reconnect attempts were exhausted).
2. Check if the WebRTC transport is still connected before blocking the user.

### Exact Code Modification
Modify [Receive.jsx](file:///c:/Users/USER/Desktop/mesh/packages/web/src/pages/Receive.jsx#L168-L186) to only trigger `roomClosed(true)` when `reconnectFailed` fires, rather than on a temporary websocket disconnect:

```diff
<<<<
  useEffect(() => {
    if (!displayRoomCode) return
    const unsub = useSignalingStore.subscribe((s, prev) => {
      if (prev.peers.length > 0 && s.peers.length === 0 && status !== 'complete') {
        setRoomClosed(true)
      }
      if (prev.status === 'connected' && s.status === 'disconnected' && status !== 'complete') {
        setRoomClosed(true)
      }
      if (s.peers.length > prev.peers.length) {
        const newPeerIds = s.peers.filter(p => !prev.peers.includes(p))
        for (const peerId of newPeerIds) {
          dialPeer(peerId)
        }
      }
    })
    return unsub
  }, [displayRoomCode, status, dialPeer])
====
  useEffect(() => {
    if (!displayRoomCode) return
    const unsub = useSignalingStore.subscribe((s, prev) => {
      if (prev.peers.length > 0 && s.peers.length === 0 && status !== 'complete') {
        setRoomClosed(true)
      }
      if (s.peers.length > prev.peers.length) {
        const newPeerIds = s.peers.filter(p => !prev.peers.includes(p))
        for (const peerId of newPeerIds) {
          dialPeer(peerId)
        }
      }
    })

    // Listen to signaling client's reconnect events to reset or handle permanent failures
    const client = useSignalingStore.getState().client
    const handleReconnectFailed = () => {
      if (status !== 'complete') setRoomClosed(true)
    }
    const handleReconnect = () => {
      setRoomClosed(false) // recover UI state
    }

    if (client) {
      client.addEventListener('reconnectFailed', handleReconnectFailed)
      client.addEventListener('reconnect', handleReconnect)
    }

    return () => {
      unsub()
      if (client) {
        client.removeEventListener('reconnectFailed', handleReconnectFailed)
        client.removeEventListener('reconnect', handleReconnect)
      }
    }
  }, [displayRoomCode, status, dialPeer])
>>>>
```

---

## 2. Reconnection Tokens are Not Passed to New Signaling Client (Web Client)

### Symptom
If a page refreshes or the client tries to reconnect to the room, the auto-rejoin mechanism in `SignalingClient` fails to run, and the room slot remains dead.

### Reason
In `packages/web/src/store/useSignalingStore.js`, the `connect()` action creates a fresh `SignalingClient` instance:
```javascript
const c = new SignalingClient(SIGNALING_URL)
```
Because it is a new instance, `c.peerId`, `c.roomCode`, and `c._rejoinToken` are all initialized to `null`. Therefore, the auto-rejoin check in `SignalingClient.connect()` evaluates to false and is completely bypassed:
```javascript
if (this.peerId && this.roomCode && this._rejoinToken) {
  this._rejoinRoom().catch(...)
}
```
Even though the transfer store successfully persists state in `localStorage` across page refreshes, the signaling store does not pass the retrieved parameters to the newly created `SignalingClient` instance.

### Solution
Allow `useSignalingStore.connect` to accept optional `peerId`, `roomCode`, and `rejoinToken` values, or have it automatically read them from the persisted transfer/history state, and seed them into the new `SignalingClient` instance before calling `c.connect()`.

### Exact Code Modification
Modify [useSignalingStore.js](file:///c:/Users/USER/Desktop/mesh/packages/web/src/store/useSignalingStore.js#L14-L44):

```diff
<<<<
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
        set({ status: 'disconnected', peers: [] })
      })
      c.addEventListener('reconnect', (e) => {
        const existingPeers = e.detail?.existingPeers
        set((s) => ({ status: 'connected', peers: existingPeers ?? s.peers }))
      })
      c.addEventListener('reconnectFailed', () => {
        set({ status: 'disconnected', peers: [], roomCode: null, peerId: null, error: 'Room connection lost' })
      })
      await c.connect()
      set({ client: c, status: 'connected' })
      return c
    } catch (err) {
      set({ status: 'error', error: err.message || 'Connection failed' })
      throw err
    }
  },
====
  connect: async (reconnectParams = null) => {
    const { client } = get()
    if (client) return client
    set({ status: 'connecting', error: null })
    try {
      const c = new SignalingClient(SIGNALING_URL)
      if (reconnectParams) {
        c.peerId = reconnectParams.peerId
        c.roomCode = reconnectParams.roomCode
        c._rejoinToken = reconnectParams.rejoinToken
      }
      c.addEventListener('peerJoined', (e) => {
        set((s) => ({ peers: [...s.peers, e.detail.peerId] }))
      })
      c.addEventListener('peerLeft', (e) => {
        set((s) => ({ peers: s.peers.filter((p) => p !== e.detail.peerId) }))
      })
      c.addEventListener('close', () => {
        const s = get()
        set({ status: 'disconnected', peers: [] })
      })
      c.addEventListener('reconnect', (e) => {
        const existingPeers = e.detail?.existingPeers
        set((s) => ({ status: 'connected', peers: existingPeers ?? s.peers }))
      })
      c.addEventListener('reconnectFailed', () => {
        set({ status: 'disconnected', peers: [], roomCode: null, peerId: null, error: 'Room connection lost' })
      })
      await c.connect()
      set({ client: c, status: 'connected' })
      return c
    } catch (err) {
      set({ status: 'error', error: err.message || 'Connection failed' })
      throw err
    }
  },
>>>>
```

Also, update `useSignalingStore` connect call sites when starting as a receiver / sender to reload the persisted state. Or, more simply, retrieve the token from the client instance when joining/creating and save them, allowing reconnects.
Wait, let's see. In `SignalingClient.js`, when a websocket connection closes, it schedules reconnect:
```javascript
    this.ws.addEventListener('close', () => {
      this._stopHeartbeat();
      this.dispatchEvent(new Event('close'));
      if (!this._intentionalClose && !this._closed) this._scheduleReconnect();
    });
```
When it reconnects, it calls `this.connect()`. Since it is the *same* instance of `SignalingClient`, the fields `this.peerId`, `this.roomCode` and `this._rejoinToken` are already set! So auto-rejoining works on websocket drops.
However, if a full refresh happens, they are lost. If the user wants to survive page refreshes, they can save/load the client info.

---

## 3. Single-Chunk Integrity Bypass (Security/Integrity Vulnerability)

### Symptom
When transferring a file that contains only **one chunk** (e.g. small files under 64KB), a malicious or bad seeder can send corrupted data, and the receiver will accept it as verified and mark the transfer as complete.

### Reason
In `packages/web/src/lib/swarmManager.js` in `onChunkReceived`:
- The code computes `actualHash = sha256Hex(data)` and checks:
  ```javascript
  if (actualHash !== expectedHash) { ... }
  ```
  However, `expectedHash` is `msg.chunkHash`, which is parsed directly from the incoming WebRTC chunk message! The sender tells the receiver what the expected hash is.
- For files with `totalChunks > 1`, `verifyChunk(data, proof, this.merkleRoot)` is called, which verifies the chunk up to the trusted `this.merkleRoot`.
- For `totalChunks === 1`, `proof` checks are skipped entirely because:
  - `this.totalChunks > 1` is false.
  - `proof.length > 0` is false (there is no sibling chunk, so no proof).
- As a result, the code never compares the hash against `this.merkleRoot`! A malicious peer can send garbage data and its hash, and the receiver will verify it.

### Solution
Always verify the chunk against the trusted `this.merkleRoot`. If `totalChunks === 1`, the actual hash of the chunk must match the `merkleRoot` exactly. If `totalChunks > 1`, the Merkle proof must verify against `this.merkleRoot`. We can simplify this by running `verifyChunk` for all cases (since an empty proof with `verifyChunk` naturally evaluates to comparing the chunk hash directly to the `merkleRoot`).

### Exact Code Modification
Modify [swarmManager.js](file:///c:/Users/USER/Desktop/mesh/packages/web/src/lib/swarmManager.js#L161-L197):

```diff
<<<<
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
    // Proof is mandatory for multi-chunk files (transitive integrity)
    if (this.totalChunks > 1 && (!proof || !Array.isArray(proof))) {
      peer.consecutiveFailures++;
      this.dispatchEvent(new CustomEvent('chunkFailed', { detail: { peerId, chunkIndex: ci, reason: 'missing_proof' } }));
      this._requeueChunk(ci);
      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }
    if (proof && proof.length > 0 && !(await verifyChunk(data, proof, this.merkleRoot))) {
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
====
    const actualHash = await sha256Hex(data);
    if (this.aborted) return false;

    // Verify chunk integrity against the trusted Merkle Root
    let isChunkValid = false;
    let failureReason = 'integrity_verification_failed';

    if (this.totalChunks === 1) {
      // For a single chunk file, the Merkle root is the hash of the only chunk
      isChunkValid = (actualHash === this.merkleRoot);
      failureReason = 'hash_mismatch_with_root';
    } else {
      // For multi-chunk files, Merkle proof is required to verify the path up to the root
      if (!proof || !Array.isArray(proof)) {
        isChunkValid = false;
        failureReason = 'missing_proof';
      } else {
        isChunkValid = await verifyChunk(data, proof, this.merkleRoot);
        failureReason = 'proof_invalid';
      }
    }

    if (!isChunkValid) {
      peer.consecutiveFailures++;
      this.dispatchEvent(new CustomEvent('chunkFailed', { detail: { peerId, chunkIndex: ci, reason: failureReason } }));
      this._requeueChunk(ci);
      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerFailed(peerId);
      } else {
        this._fillPipeline(peerId);
      }
      return false;
    }
>>>>
```

---

## 4. Empty Files (0-byte) are Ignored in Folder Transfers (Streamed Mode)

### Symptom
When transferring a folder containing empty (0-byte) files in `saveMode === 'auto'` (direct folder streaming), the empty files are completely omitted from the receiver's disk and are never created.

### Reason
In `packages/web/src/hooks/useTransfer.js`, `writeChunkStreaming` is only triggered in response to a `chunkVerified` event. Since 0-byte files have `chunkCount = 0`, they have no chunks associated with them. Thus, `writeChunkStreaming` is never executed for them, and no file writer/file entry is created. When the transfer finishes, the receiver's `triggerDownload` sees `allStreamed = true` and simply terminates without generating the empty files.

### Solution
In `useTransfer.js`, inside the `swarm.addEventListener('complete', ...)` listener, check for any files with `size === 0` in `meta.files` (or `M.receivedMeta.files`). If present and we are streaming to disk, explicitly create them.

### Exact Code Modification
Modify [useTransfer.js](file:///c:/Users/USER/Desktop/mesh/packages/web/src/hooks/useTransfer.js#L181-L214):

```diff
<<<<
    swarm.addEventListener('complete', async () => {
      await closeStreamWriters()
      // Rebuild Merkle tree from received chunks for re-seeding integrity
      const allInMemory = M.chunks.every(c => c !== true && c != null)
      if (allInMemory && M.chunks.length > 0) {
        try {
          const hashes = []
          for (let i = 0; i < M.chunks.length; i++) {
            const c = M.chunks[i]
            const buf = c instanceof Uint8Array ? c : new Uint8Array(c)
            hashes.push(await sha256Hex(buf))
          }
          const tree = await buildMerkleTree(hashes)
          if (tree.root === meta.merkleRoot) {
            M.receivedMeta.hashes = hashes
            M.receivedMeta.tree = tree
          } else {
            // Root mismatch — disable seeding to avoid serving corrupt data
            M.receivedMeta.hashes = null
            M.receivedMeta.tree = null
            console.warn('Merkle root mismatch on rebuild — seeding disabled')
          }
        } catch (err) {
          console.warn('Failed to rebuild Merkle tree for re-seeding:', err)
          M.receivedMeta.hashes = null
          M.receivedMeta.tree = null
        }
      } else {
        // Streamed to disk — can't rebuild without reading everything back
        M.receivedMeta.hashes = null
        M.receivedMeta.tree = null
      }
      useTransferStore.getState().setComplete(M.receivedMeta?.tree != null)
    })
====
    swarm.addEventListener('complete', async () => {
      // In folder streaming mode, ensure 0-byte files that have no chunks are created
      if (M.streamHandle && M.streamHandle.dirHandle && meta.files) {
        const dirHandle = M.streamHandle.dirHandle
        for (const entry of meta.files) {
          if (entry.size === 0) {
            try {
              const parts = entry.path.replace(/\\/g, '/').split('/')
              let handle = dirHandle
              for (let p = 0; p < parts.length - 1; p++) {
                handle = await handle.getDirectoryHandle(parts[p], { create: true })
              }
              await handle.getFileHandle(parts[parts.length - 1], { create: true })
            } catch (err) {
              console.warn('Failed to create empty file during streaming:', entry.path, err)
            }
          }
        }
      }

      await closeStreamWriters()
      // Rebuild Merkle tree from received chunks for re-seeding integrity
      const allInMemory = M.chunks.every(c => c !== true && c != null)
      if (allInMemory && M.chunks.length > 0) {
        try {
          const hashes = []
          for (let i = 0; i < M.chunks.length; i++) {
            const c = M.chunks[i]
            const buf = c instanceof Uint8Array ? c : new Uint8Array(c)
            hashes.push(await sha256Hex(buf))
          }
          const tree = await buildMerkleTree(hashes)
          if (tree.root === meta.merkleRoot) {
            M.receivedMeta.hashes = hashes
            M.receivedMeta.tree = tree
          } else {
            // Root mismatch — disable seeding to avoid serving corrupt data
            M.receivedMeta.hashes = null
            M.receivedMeta.tree = null
            console.warn('Merkle root mismatch on rebuild — seeding disabled')
          }
        } catch (err) {
          console.warn('Failed to rebuild Merkle tree for re-seeding:', err)
          M.receivedMeta.hashes = null
          M.receivedMeta.tree = null
        }
      } else {
        // Streamed to disk — can't rebuild without reading everything back
        M.receivedMeta.hashes = null
        M.receivedMeta.tree = null
      }
      useTransferStore.getState().setComplete(M.receivedMeta?.tree != null)
    })
>>>>
```

---

## 5. Production HTTPS Mixed Content & VM Deployment Guidelines

### Symptom
When you deploy the web client under HTTPS (e.g. Vercel, Netlify) and configure it to point to the signaling server running on your Azure VM via IP (e.g. `ws://<VM-IP>:8080`), the browser blocks the WebSocket connection with a **Mixed Content** security exception. Additionally, P2P connections fail to establish on cell networks or behind symmetric firewalls.

### Solution
1. **Enable SSL (WSS)**: Do not expose `ws://` directly. Set up a reverse proxy like **Nginx** or **Caddy** on your Azure VM, obtain a free SSL certificate via Let's Encrypt, and proxy traffic to port `8080` (e.g. `wss://signaling.yourdomain.com/ws`).
2. **Configure env variables correctly**:
   - For `packages/web`:
     Set `VITE_SIGNALING_URL=wss://signaling.yourdomain.com/ws` (using HTTPS/WSS).
   - In `.env` on your Azure VM:
     Set `EXTERNAL_IP=<your-vm-public-ip>` (mandatory for TURN/coturn NAT traversal) and `TURN_SECRET=<a-random-secure-string>`.
3. **VM Port Openings (Azure NSG)**:
   Ensure the following ports are open in the Azure Security Group for your VM:
   - `80` (TCP, Caddy/Nginx Let's Encrypt challenge)
   - `443` (TCP, Signaling Server WSS reverse proxy)
   - `3478` (UDP & TCP, coturn stun/turn port)
   - `49152-65535` (UDP, coturn dynamic relay range, critical for symmetric TURN bypass)
