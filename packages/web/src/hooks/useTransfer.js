import { useCallback } from 'react'
import { SwarmManager } from '../lib/swarmManager.js'
import { transferManager as M, BATCH_STRIDE, MAX_BATCH_ID } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import { MSG } from '../webrtc/protocol.js'
import { readChunk, getFileForChunk } from '../lib/fileChunker.js'
import { sha256Hex, getMerkleProof, buildMerkleTree, verifyChunk } from '../lib/browserCrypto.js'
import { indexFilesAsync } from '../lib/indexFilesAsync.js'
import { clearDirHandle } from '../lib/dirHandleStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useToastStore } from '../store/useToastStore.js'
import { useSignalingStore } from '../store/useSignalingStore.js'

const VALID_MERKLE = /^[0-9a-f]{64}$/
const PATH_UNSAFE = /(?:^\/|[\\:]|(?:^|[/\\])\.\.(?:[/\\]|$)|[\x00-\x1f])/

function validateFileMeta(meta) {
  if (!meta || typeof meta !== 'object') return 'Missing file offer'
  if (typeof meta.totalChunks !== 'number' || !Number.isInteger(meta.totalChunks) || meta.totalChunks < 0 || meta.totalChunks > 1_000_000) return 'Invalid totalChunks'
  if (typeof meta.chunkSize !== 'number' || !Number.isInteger(meta.chunkSize) || meta.chunkSize < 1 || meta.chunkSize > 262144) return 'Invalid chunkSize'
  if (!meta.merkleRoot || typeof meta.merkleRoot !== 'string' || !VALID_MERKLE.test(meta.merkleRoot)) return 'Invalid merkleRoot'
  if (!meta.fileName || typeof meta.fileName !== 'string') return 'Missing fileName'
  if (typeof meta.fileSize === 'number') {
    const expectedMax = meta.totalChunks * meta.chunkSize
    if (meta.fileSize < 0 || meta.fileSize > expectedMax) return 'fileSize inconsistent with chunk parameters'
  }
  // Validate file paths
  if (meta.files) {
    if (!Array.isArray(meta.files) || meta.files.length > 10_000) return 'Invalid files array'
    for (const f of meta.files) {
      if (!f || typeof f.path !== 'string') return 'Invalid file entry path'
      if (PATH_UNSAFE.test(f.path)) return 'Unsafe file path detected'
    }
  }
  return null
}

const PEER_CHECK_GRACE_MS = 3000

function checkPeersRemaining(swarm) {
  if (swarm.isComplete() || swarm.aborted) return false
  // Cancel any existing pending check
  if (M._peerCheckTimer) { clearTimeout(M._peerCheckTimer); M._peerCheckTimer = null }
  const stats = swarm.getPeerStats()
  const alive = stats.filter(p => !p.failed)
  if (alive.length === 0) {
    // Don't error immediately — give reconnect / late-join a grace window
    if (M.pendingDials > 0) return false
    M._peerCheckTimer = setTimeout(() => {
      M._peerCheckTimer = null
      if (swarm.isComplete() || swarm.aborted) return
      if (M.pendingDials > 0) return
      const freshStats = swarm.getPeerStats()
      const freshAlive = freshStats.filter(p => !p.failed)
      if (freshAlive.length === 0) {
        useTransferStore.getState().setError('All peers disconnected. The transfer has stalled — try asking the sender to reconnect, or start a new transfer.')
        useToastStore.getState().addToast('All peers disconnected. The transfer has stalled.', 'error')
      }
    }, PEER_CHECK_GRACE_MS)
  }
  return false
}


async function writeChunkStreaming(chunkIndex, chunkData, meta) {
  if (!M.streamHandle || !M.streamHandle.dirHandle) return false
  const files = meta?.files
  if (!files) return false
  const dirHandle = M.streamHandle.dirHandle
  const chunkSize = meta?.chunkSize || 65536

  const result = getFileForChunk(files, chunkIndex)
  if (!result) return false
  const entry = result.fileEntry

  if (!M.streamWriters.has(entry.path)) {
    try {
      const parts = entry.path.replace(/\\/g, '/').split('/')
      let handle = dirHandle
      for (let p = 0; p < parts.length - 1; p++) {
        handle = await handle.getDirectoryHandle(parts[p], { create: true })
      }
      const fileHandle = await handle.getFileHandle(parts[parts.length - 1], { create: true })
      // keepExistingData is safe unconditionally: for a brand-new file there's
      // nothing to preserve, and after a reload-resume (Stage C) it's required
      // — chunks already proof-verified on disk (see runDiskResumePreflight)
      // must survive this writer being (re)opened for the file's remaining
      // chunks.
      const writer = await fileHandle.createWritable({ keepExistingData: true })
      M.streamWriters.set(entry.path, { writer, written: 0 })
    } catch {
      return false
    }
  }

  const sw = M.streamWriters.get(entry.path)
  if (!sw) return false
  const localIndex = chunkIndex - entry.startChunk
  const position = localIndex * chunkSize
  try {
    await sw.writer.write({ type: 'write', data: chunkData, position })
    sw.written += chunkData.byteLength || chunkData.length || 0
    return true
  } catch {
    return false
  }
}

async function closeStreamWriters() {
  for (const [, sw] of M.streamWriters) {
    try { await sw.writer.close() } catch {}
  }
  M.streamWriters.clear()
}

const PROOF_TIMEOUT_MS = 4000
const PROOF_CONCURRENCY = 8

// Stage C: after a reload, check whether files streamed to the reopened
// directory handle already have some whole chunks on disk from before the
// reload, and — rather than trusting file size alone — ask the peer for
// just that chunk's hash+proof (no chunk bytes) and verify our own on-disk
// bytes against the transfer's trusted merkleRoot before accepting them as
// already-downloaded. Anything that doesn't check out (missing file, no
// response, proof mismatch) is simply left for the normal swarm to
// re-request — this is a pure optimization, never a correctness risk.
export async function runDiskResumePreflight(transport, swarm, meta) {
  const dirHandle = M.streamHandle?.dirHandle
  if (!dirHandle || !meta.files) return

  const chunkSize = meta.chunkSize
  const candidates = []
  for (const entry of meta.files) {
    if (!entry.chunkCount) continue
    let file
    try {
      const parts = entry.path.replace(/\\/g, '/').split('/')
      let h = dirHandle
      for (let p = 0; p < parts.length - 1; p++) h = await h.getDirectoryHandle(parts[p])
      const fh = await h.getFileHandle(parts[parts.length - 1])
      file = await fh.getFile()
    } catch { continue }
    const wholeChunks = Math.min(entry.chunkCount, Math.floor(file.size / chunkSize))
    for (let i = 0; i < wholeChunks; i++) {
      candidates.push({ entry, index: entry.startChunk + i, byteStart: i * chunkSize, byteLength: chunkSize, file })
    }
    // A file's last chunk is usually shorter than chunkSize, so dividing the
    // total on-disk size by chunkSize always excludes it — check it
    // separately whenever the file's true full size is already present.
    if (wholeChunks < entry.chunkCount && file.size >= entry.size) {
      const lastLocalIndex = entry.chunkCount - 1
      const byteStart = lastLocalIndex * chunkSize
      const byteLength = entry.size - byteStart
      if (byteLength > 0) {
        candidates.push({ entry, index: entry.startChunk + lastLocalIndex, byteStart, byteLength, file })
      }
    }
  }
  if (candidates.length === 0) return

  const pending = new Map()
  transport.onJSON((msg) => {
    if (msg.type !== MSG.CHUNK_PROOF) return
    const p = pending.get(msg.index)
    if (p) { pending.delete(msg.index); p(msg) }
  })

  const verifiedIndices = []
  const queue = [...candidates]
  async function worker() {
    while (queue.length) {
      const c = queue.shift()
      const result = await new Promise((resolve) => {
        pending.set(c.index, resolve)
        transport.sendJSON({ type: MSG.CHUNK_PROOF_REQUEST, index: c.index })
        setTimeout(() => {
          if (pending.has(c.index)) { pending.delete(c.index); resolve(null) }
        }, PROOF_TIMEOUT_MS)
      })
      if (!result) continue
      try {
        const buf = new Uint8Array(await c.file.slice(c.byteStart, c.byteStart + c.byteLength).arrayBuffer())
        if (await verifyChunk(buf, result.proof, meta.merkleRoot)) {
          verifiedIndices.push(c.index)
          M.chunks[c.index] = true
          const remaining = M.fileRemaining.get(c.entry.path)
          if (remaining != null) {
            const next = remaining - 1
            M.fileRemaining.set(c.entry.path, next)
            if (next <= 0) useTransferStore.getState().markFileDownloaded(c.entry.path)
          }
        }
      } catch { /* leave unverified — normal swarm request will cover it */ }
    }
  }
  await Promise.all(new Array(Math.min(PROOF_CONCURRENCY, candidates.length)).fill(0).map(worker))

  if (verifiedIndices.length > 0) {
    swarm.markAlreadyVerified(verifiedIndices)
    for (const i of verifiedIndices) useTransferStore.getState().updateChunkState(i, 'verified')
    useTransferStore.getState().updateProgress({
      verified: swarm.verifiedCount, total: swarm.neededCount,
      percent: swarm.neededCount > 0 ? (swarm.verifiedCount / swarm.neededCount) * 100 : 100,
    })
  }
}

// Sender-side chunk serving for a mid-session "added" batch. Unlike the main
// transfer, extra batches always have live File refs (they were just picked
// locally), so this skips the in-memory/streamed-to-disk fallback branches
// that batch 0 needs to support reseeding.
async function serveExtraBatchChunk(transport, batchId, localIndex) {
  const batch = M.extraBatches.get(batchId)
  if (!batch || batch.role !== 'sender') return
  const { indexRef, fileRefs, servedRef } = batch
  const entry = getFileForChunk(indexRef.files, localIndex)
  if (!entry) return
  const targetFile = fileRefs[entry.fileEntry.path]
  if (!targetFile) return
  const buf = await readChunk(targetFile, entry.localIndex, indexRef.chunkSize)
  const chunkData = new Uint8Array(buf)
  const chunkHash = indexRef.hashes[localIndex]
  const chunkProof = getMerkleProof(indexRef.tree, localIndex)
  await transport.sendChunk(batchId * BATCH_STRIDE + localIndex, chunkHash, chunkProof, chunkData)
  servedRef.add(localIndex)
  const total = indexRef.totalChunks
  useTransferStore.getState().updateExtraBatch(batchId, {
    progress: { verified: servedRef.size, total, percent: (servedRef.size / total) * 100 },
  })
  if (servedRef.size >= total) {
    useTransferStore.getState().updateExtraBatch(batchId, { status: 'complete' })
    transport.sendJSON({ type: MSG.TRANSFER_COMPLETE, batchId })
  }
}

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
    const validationError = validateFileMeta(meta)
    if (validationError) {
      useTransferStore.getState().setError(validationError)
      return null
    }

    M.downloadGuard = false
    M.chunks = new Array(meta.totalChunks)
    M.streamHandle = null
    M.excludedPaths = new Set()
    M.fileRemaining = new Map()
    if (meta.files) {
      for (const entry of meta.files) M.fileRemaining.set(entry.path, entry.chunkCount)
    }
    M.receivedMeta = { files: meta.files, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks, merkleRoot: meta.merkleRoot }
    useTransferStore.getState().setIncomingFile(meta)

    if (meta.totalChunks === 0) {
      useTransferStore.getState().setComplete()
      return null
    }

    const swarm = new SwarmManager(meta.totalChunks, meta.merkleRoot, meta.chunkSize)
    M.swarm = swarm

    let speedBytes = 0
    let speedTime = Date.now()
    const chunkSize = meta.chunkSize

    swarm.addEventListener('chunkVerified', async (e) => {
      const { chunkIndex, chunkData, verified, total } = e.detail
      const streamed = await writeChunkStreaming(chunkIndex, chunkData, meta)
      M.chunks[chunkIndex] = streamed ? true : chunkData

      // Streamed-to-disk files can be marked "downloaded" the moment their
      // last chunk lands, without waiting for the whole (possibly
      // multi-file) transfer to finish — the in-memory/blob-download path
      // marks files downloaded separately, at actual save time.
      if (streamed && meta.files) {
        const entry = getFileForChunk(meta.files, chunkIndex)
        if (entry && entry.fileEntry.chunkCount > 0) {
          const path = entry.fileEntry.path
          const remaining = M.fileRemaining.get(path)
          if (remaining != null) {
            const next = remaining - 1
            M.fileRemaining.set(path, next)
            if (next <= 0) useTransferStore.getState().markFileDownloaded(path)
          }
        }
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
      // 0-byte files have no chunks, so they never go through writeChunkStreaming —
      // create their (empty) file handles explicitly when streaming a folder to disk.
      if (M.streamHandle && M.streamHandle.dirHandle && meta.files) {
        const dirHandle = M.streamHandle.dirHandle
        for (const entry of meta.files) {
          if (entry.size === 0 && !M.excludedPaths.has(entry.path)) {
            try {
              const parts = entry.path.replace(/\\/g, '/').split('/')
              let handle = dirHandle
              for (let p = 0; p < parts.length - 1; p++) {
                handle = await handle.getDirectoryHandle(parts[p], { create: true })
              }
              await handle.getFileHandle(parts[parts.length - 1], { create: true })
              useTransferStore.getState().markFileDownloaded(entry.path)
            } catch { /* best-effort; missing an empty file isn't fatal */ }
          }
        }
      }

      await closeStreamWriters()
      clearDirHandle() // nothing left to resume once the transfer is done
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

    swarm.addEventListener('peerFailed', () => {
      useTransferStore.getState().updatePeerStats(swarm.getPeerStats())
      checkPeersRemaining(swarm)
    })

    swarm.addEventListener('peerRemoved', () => {
      checkPeersRemaining(swarm)
    })

    return swarm
  }, [])

  const addSenderPeer = useCallback(async (transport, fileIndex) => {
    if (!M.servedRef) M.servedRef = new Set()
    const total = fileIndex.totalChunks
    let peerSent = 0
    let speedBytes = 0
    let speedTime = Date.now()

    transport.onJSON(async (msg) => {
      if (msg.type === MSG.TRANSFER_COMPLETE) {
        if (M.transports.has(transport.remotePeerId)) {
          M.transports.delete(transport.remotePeerId)
        }
        transport.close()
        return
      }
      if (msg.type === MSG.FILE_OFFER_ADD_ACCEPT) {
        useTransferStore.getState().markExtraBatchAcceptedBy(msg.batchId, transport.remotePeerId)
        return
      }
      if (msg.type === MSG.CHUNK_PROOF_REQUEST) {
        // Reload-resume preflight (Stage C) — hash+proof only, no chunk
        // bytes; only supported against this sender's own live File refs
        // (not a reseeding receiver, which has no per-chunk hash/tree data
        // for a disk-streamed transfer).
        const idx = M.indexRef
        if (!msg.batchId && idx && M.fileRef && M.fileRefs && Number.isInteger(msg.index) && msg.index >= 0 && msg.index < idx.totalChunks) {
          const hash = idx.hashes[msg.index]
          const proof = getMerkleProof(idx.tree, msg.index)
          if (hash) transport.sendJSON({ type: MSG.CHUNK_PROOF, index: msg.index, hash, proof })
        }
        return
      }
      if (msg.type !== MSG.CHUNK_REQUEST) return
      if (!useTransferStore.getState().seeding) return

      if (msg.batchId) {
        await serveExtraBatchChunk(transport, msg.batchId, msg.index)
        return
      }

      const file = M.fileRef
      const idx = M.indexRef
      const refs = M.fileRefs
      let chunkData = null
      let chunkHash = null
      let chunkProof = null

      if (file && idx && refs) {
        const entry = getFileForChunk(idx.files, msg.index)
        if (!entry) { return }
        const targetFile = refs[entry.fileEntry.path]
        if (!targetFile) { return }
        const b = await readChunk(targetFile, entry.localIndex, idx.chunkSize)
        chunkData = new Uint8Array(b)
        chunkHash = idx.hashes[msg.index]
        chunkProof = getMerkleProof(idx.tree, msg.index)
      } else if (M.chunks && M.chunks[msg.index] && M.chunks[msg.index] !== true) {
        chunkData = M.chunks[msg.index] instanceof Uint8Array
          ? M.chunks[msg.index]
          : new Uint8Array(M.chunks[msg.index])
        chunkHash = M.receivedMeta?.hashes?.[msg.index] || await sha256Hex(chunkData)
        chunkProof = M.receivedMeta?.tree ? getMerkleProof(M.receivedMeta.tree, msg.index) : null
      } else if (M.receivedMeta && M.streamHandle && M.streamHandle.dirHandle) {
        const { files: fileEntries, chunkSize: cs } = M.receivedMeta
        if (fileEntries && cs) {
          for (const entry of fileEntries) {
            const start = entry.startChunk
            const count = entry.chunkCount || 1
            if (msg.index >= start && msg.index < start + count) {
              try {
                const parts = entry.path.replace(/\\/g, '/').split('/')
                let h = M.streamHandle.dirHandle
                for (let p = 0; p < parts.length - 1; p++) {
                  h = await h.getDirectoryHandle(parts[p])
                }
                const fh = await h.getFileHandle(parts[parts.length - 1])
                const f = await fh.getFile()
                const localIndex = msg.index - start
                const byteStart = localIndex * cs
                const byteEnd = Math.min(byteStart + cs, f.size)
                const buf = await f.slice(byteStart, byteEnd).arrayBuffer()
                chunkData = new Uint8Array(buf)
                chunkHash = M.receivedMeta?.hashes?.[msg.index] || await sha256Hex(chunkData)
                chunkProof = M.receivedMeta?.tree ? getMerkleProof(M.receivedMeta.tree, msg.index) : null
              } catch { return }
              break
            }
          }
        }
      }

      if (!chunkData) return
      await transport.sendChunk(msg.index, chunkHash, chunkProof, chunkData)
      M.servedRef.add(msg.index)
      peerSent++
      useTransferStore.getState().updateChunkState(msg.index, 'verified')
      useTransferStore.getState().updateProgress({
        verified: M.servedRef.size,
        total,
        percent: (M.servedRef.size / total) * 100,
      })

      speedBytes += idx ? (idx.chunkSize || 65536) : 65536
      const now = Date.now()
      const elapsed = (now - speedTime) / 1000
      if (elapsed >= 0.5) {
        const mbps = (speedBytes / elapsed) / (1024 * 1024)
        useTransferStore.getState().recordSpeedSample(mbps)
        speedBytes = 0
        speedTime = now
      }

      if (M.servedRef.size >= total) {
        useTransferStore.getState().setComplete()
        transport.sendJSON({ type: MSG.TRANSFER_COMPLETE })
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
    // A peer that joined before an "add files" batch was created wouldn't
    // otherwise learn about it — re-offer every batch this sender has
    // broadcast so far to every newly connected transport too.
    for (const [batchId, batch] of M.extraBatches) {
      if (batch.role !== 'sender') continue
      transport.sendJSON({
        type: MSG.FILE_OFFER_ADD,
        batchId,
        fileName: batch.indexRef.fileName,
        fileSize: batch.indexRef.fileSize,
        totalChunks: batch.indexRef.totalChunks,
        chunkSize: batch.indexRef.chunkSize,
        merkleRoot: batch.indexRef.merkleRoot,
        files: batch.indexRef.files,
      })
    }
    transport.pc.addEventListener('connectionstatechange', () => {
      if (transport.pc.connectionState === 'disconnected' || transport.pc.connectionState === 'failed') {
        transport.close()
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
 
    transport.onJSON((msg) => {
      if (msg.type === MSG.TRANSFER_COMPLETE) {
        if (!msg.batchId) {
          useTransferStore.getState().setComplete(M.receivedMeta?.tree != null)
        } else if (M.extraBatches.has(msg.batchId)) {
          useTransferStore.getState().updateExtraBatch(msg.batchId, { status: 'complete' })
        }
        return
      }
      if (msg.type === MSG.FILE_OFFER_ADD) {
        if (!Number.isInteger(msg.batchId) || msg.batchId <= 0 || msg.batchId > MAX_BATCH_ID) return
        if (M.extraBatches.has(msg.batchId)) return
        // Same validation the main FILE_OFFER goes through — an added batch
        // is just as capable of OOM-ing the tab (bogus totalChunks) or
        // carrying unsafe paths as the original offer.
        if (validateFileMeta(msg)) return
        M.extraBatches.set(msg.batchId, { role: 'receiver', offeredBy: transport, meta: msg })
        useTransferStore.getState().addExtraBatchOffer({
          batchId: msg.batchId,
          fromPeerId: transport.remotePeerId,
          fileMeta: {
            fileName: msg.fileName, fileSize: msg.fileSize, totalChunks: msg.totalChunks,
            chunkSize: msg.chunkSize, merkleRoot: msg.merkleRoot, files: msg.files,
          },
        })
      }
    })

    transport.onChunk(async (msg) => {
      const batchId = Math.floor(msg.chunkIndex / BATCH_STRIDE)
      const localIndex = msg.chunkIndex % BATCH_STRIDE
      if (batchId === 0) {
        if (!M.swarm || M.swarm.isComplete() || M.swarm.aborted) return
        try {
          await M.swarm.onChunkReceived(
            transport.remotePeerId,
            localIndex,
            msg.chunkData,
            msg.chunkHash,
            msg.proof
          )
        } catch {}
        return
      }
      const batch = M.extraBatches.get(batchId)
      if (!batch || !batch.swarm || batch.swarm.isComplete() || batch.swarm.aborted) return
      try {
        await batch.swarm.onChunkReceived(
          transport.remotePeerId,
          localIndex,
          msg.chunkData,
          msg.chunkHash,
          msg.proof
        )
      } catch {}
    })
 
    swarm.addPeer(transport.remotePeerId, requestFn)
    M.transports.set(transport.remotePeerId, transport)
    useTransferStore.getState().setTransferring()
  }, [])

  const blobForEntry = useCallback((entry) => {
    const ordered = []
    for (let i = 0; i < entry.chunkCount; i++) {
      const c = M.chunks[entry.startChunk + i]
      if (c === true) return null
      ordered.push(c)
    }
    return new Blob(ordered, { type: 'application/octet-stream' })
  }, [])

  const triggerDownload = useCallback(async (options) => {
    if (M.downloadGuard) return
    M.downloadGuard = true
    const meta = useTransferStore.getState().fileMeta
    const saveMode = useTransferStore.getState().saveMode
    if (!meta) return

    const allStreamed = M.streamWriters.size > 0
    const files = meta.files || [{ path: meta.fileName, name: meta.fileName, size: meta.fileSize, startChunk: 0, chunkCount: meta.totalChunks }]
    const isMulti = files.length > 1

    if (allStreamed) {
      await closeStreamWriters()
      return
    }

    // Skip files that were deselected before the transfer started (never
    // downloaded — no bytes to write) and files already downloaded, unless
    // the caller explicitly asked to re-download specific paths (B6 fix).
    const onlyPaths = options?.onlyPaths ? new Set(options.onlyPaths) : null
    const downloaded = new Set(useTransferStore.getState().downloadedPaths)
    const pending = files.filter((f) => {
      if (M.excludedPaths.has(f.path)) return false
      if (onlyPaths) return onlyPaths.has(f.path)
      return !downloaded.has(f.path)
    })
    if (pending.length === 0) return

    if (isMulti && saveMode === 'auto') {
      let wroteAny = false
      try {
        const dirHandle = M.streamHandle?.dirHandle || await window.showDirectoryPicker?.({ mode: 'readwrite' })
        if (dirHandle) {
          for (const entry of pending) {
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
            useTransferStore.getState().markFileDownloaded(entry.path)
            wroteAny = true
          }
          if (wroteAny) return
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          useToastStore.getState().addToast('Save cancelled — file kept in memory, use the download button', 'info')
        } else {
          useToastStore.getState().addToast('Folder selection failed. File remains in memory.', 'error')
        }
      }
      if (wroteAny) return
    }

    if (isMulti || saveMode === 'files') {
      const nameCount = {}
      for (const entry of pending) {
        let name = entry.name
        if (nameCount[name] !== undefined) {
          nameCount[name]++
          const dot = name.lastIndexOf('.')
          if (dot > 0) {
            name = name.slice(0, dot) + ` (${nameCount[name]})` + name.slice(dot)
          } else {
            name = name + ` (${nameCount[name]})`
          }
        } else {
          nameCount[name] = 0
        }
        const blob = blobForEntry(entry)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        URL.revokeObjectURL(url)
        useTransferStore.getState().markFileDownloaded(entry.path)
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
        await writable.write(blobForEntry(pending[0]))
        await writable.close()
        useTransferStore.getState().markFileDownloaded(pending[0].path)
        return
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        useToastStore.getState().addToast('Save cancelled — file kept in memory, use the download button', 'info')
      } else {
        useToastStore.getState().addToast('Save failed. File remains in memory.', 'error')
      }
    }

    const blob = blobForEntry(pending[0])
    useTransferStore.getState().markFileDownloaded(pending[0].path)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = meta.fileName
    a.click()
    URL.revokeObjectURL(url)
  }, [blobForEntry])

  // Per-file "redownload" affordance (B6): re-saves one already-downloaded
  // file without re-writing everything else.
  const redownloadFile = useCallback((path) => {
    useTransferStore.getState().unmarkFileDownloaded(path)
    M.downloadGuard = false
    triggerDownload({ onlyPaths: [path] })
  }, [triggerDownload])

  const disconnectAll = useCallback(() => {
    if (M.swarm) {
      M.swarm.abort()
      M.swarm = null
    }
    for (const [, batch] of M.extraBatches) {
      if (batch.swarm) batch.swarm.abort()
    }
    for (const [id, t] of M.transports) {
      t.close()
    }
    closeStreamWriters()
    clearDirHandle()
    M.streamHandle = null
    M.reset()
    useTransferStore.getState().reset()
  }, [])

  // Sender side: index a newly picked batch of files and broadcast an offer
  // for them to everyone currently in the room (and, via addSenderPeer, to
  // anyone who joins later). Each receiver decides independently whether to
  // accept — this never touches the original transfer's manifest or swarm.
  const addFilesToSession = useCallback(async (files, fileRefs, onProgress) => {
    const batchId = M.nextBatchId++
    const index = await indexFilesAsync(files, onProgress)
    M.extraBatches.set(batchId, {
      role: 'sender',
      indexRef: index,
      fileRefs,
      servedRef: new Set(),
    })
    const meta = {
      fileName: index.fileName,
      fileSize: index.fileSize,
      totalChunks: index.totalChunks,
      chunkSize: index.chunkSize,
      merkleRoot: index.merkleRoot,
      files: index.files,
    }
    useTransferStore.getState().addExtraBatchSent({ batchId, fileMeta: meta })
    for (const [, transport] of M.transports) {
      transport.sendJSON({ type: MSG.FILE_OFFER_ADD, batchId, ...meta })
    }
    return batchId
  }, [])

  // Receiver side: accept a pending FILE_OFFER_ADD, spinning up a second
  // SwarmManager scoped to this batch's own chunk range/root but reusing the
  // exact same WebRTCTransport/data channel as the main transfer.
  const acceptBatchOffer = useCallback((batchId) => {
    const batch = M.extraBatches.get(batchId)
    if (!batch || batch.role !== 'receiver' || batch.swarm) return
    const meta = batch.meta
    batch.chunks = new Array(meta.totalChunks)

    if (meta.totalChunks === 0) {
      useTransferStore.getState().updateExtraBatch(batchId, { status: 'complete' })
      return
    }

    const swarm = new SwarmManager(meta.totalChunks, meta.merkleRoot, meta.chunkSize)
    batch.swarm = swarm

    swarm.addEventListener('chunkVerified', (e) => {
      const { chunkIndex, chunkData, verified, total } = e.detail
      batch.chunks[chunkIndex] = chunkData
      useTransferStore.getState().updateExtraBatch(batchId, {
        progress: { verified, total, percent: (verified / total) * 100 },
      })
    })
    swarm.addEventListener('complete', () => {
      useTransferStore.getState().updateExtraBatch(batchId, { status: 'complete' })
    })

    const requestFn = (index) => {
      batch.offeredBy.sendJSON({ type: MSG.CHUNK_REQUEST, batchId, index })
      return Promise.resolve()
    }
    swarm.addPeer(batch.offeredBy.remotePeerId, requestFn)
    useTransferStore.getState().updateExtraBatch(batchId, { status: 'transferring' })
    batch.offeredBy.sendJSON({ type: MSG.FILE_OFFER_ADD_ACCEPT, batchId })
  }, [])

  const declineBatchOffer = useCallback((batchId) => {
    M.extraBatches.delete(batchId)
    useTransferStore.getState().removeExtraBatch(batchId)
  }, [])

  // Receiver side: extra batches are kept in memory only (no directory-picker
  // streaming for v1) — download each of the batch's files as individual
  // browser downloads, same as the main transfer's default "Files" save mode.
  const triggerBatchDownload = useCallback(async (batchId) => {
    const batch = M.extraBatches.get(batchId)
    if (!batch || !batch.chunks) return
    const meta = batch.meta
    const files = meta.files || [{ path: meta.fileName, name: meta.fileName, size: meta.fileSize, startChunk: 0, chunkCount: meta.totalChunks }]
    const nameCount = {}
    for (const entry of files) {
      let name = entry.name
      if (nameCount[name] !== undefined) {
        nameCount[name]++
        const dot = name.lastIndexOf('.')
        name = dot > 0 ? `${name.slice(0, dot)} (${nameCount[name]})${name.slice(dot)}` : `${name} (${nameCount[name]})`
      } else {
        nameCount[name] = 0
      }
      const ordered = []
      for (let i = 0; i < entry.chunkCount; i++) ordered.push(batch.chunks[entry.startChunk + i])
      const blob = new Blob(ordered, { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      await new Promise(r => setTimeout(r, 200))
    }
  }, [])

  const stopSeeding = useCallback(() => {
    useTransferStore.getState().setSeeding(false)
    M.stopSeederListener()
    for (const [id, t] of M.transports) {
      t.close()
    }
    M.transports.clear()
  }, [])

  const resumeSeeding = useCallback(() => {
    useTransferStore.getState().setSeeding(true)
  }, [])

  const resetDownload = useCallback(() => {
    M.downloadGuard = false
  }, [])

  const dialPeer = useCallback(async (peerId) => {
    const client = useSignalingStore.getState().client
    if (!client) return

    // Avoid double-dialing
    if (M.dialingPeers.has(peerId) || M.transports.has(peerId)) return

    M.dialingPeers.add(peerId)
    const t = new WebRTCTransport(client, peerId, { initiator: true })

    let resolved = false
    const offerTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        t.close()
        M.dialingPeers.delete(peerId)
      }
    }, 10000)

    t.onJSON(async (msg) => {
      if (msg.type === MSG.FILE_OFFER) {
        t.offeredRoot = msg.merkleRoot
        if (!M.swarm) {
          M.swarm = await startReceiving(msg)
        }
        if (M.swarm && msg.merkleRoot === M.swarm.merkleRoot) {
          if (!resolved) {
            resolved = true
            clearTimeout(offerTimeout)
            M.dialingPeers.delete(peerId)
          }
          const currentStatus = useTransferStore.getState().status
          if (currentStatus === 'transferring') {
            addReceiverPeer(t, M.swarm)
          }
        } else {
          if (!resolved) {
            resolved = true
            clearTimeout(offerTimeout)
            M.dialingPeers.delete(peerId)
          }
          t.close()
          M.transports.delete(peerId)
        }
      }
    })

    M.pendingDials++
    try {
      await t.connect()
      t.pc.addEventListener('connectionstatechange', () => {
        if (t.pc.connectionState === 'disconnected' || t.pc.connectionState === 'failed') {
          t.close()
          M.transports.delete(peerId)
          if (M.swarm) M.swarm.removePeer(peerId)
        }
      })
      M.transports.set(peerId, t)
    } catch {
      t.close()
      M.transports.delete(peerId)
    } finally {
      M.dialingPeers.delete(peerId)
      M.pendingDials = Math.max(0, M.pendingDials - 1)
    }
  }, [startReceiving, addReceiverPeer])

  return {
    startSending,
    startReceiving,
    addSenderPeer,
    addReceiverPeer,
    triggerDownload,
    redownloadFile,
    resetDownload,
    disconnectAll,
    stopSeeding,
    resumeSeeding,
    dialPeer,
    addFilesToSession,
    acceptBatchOffer,
    declineBatchOffer,
    triggerBatchDownload,
  }
}
