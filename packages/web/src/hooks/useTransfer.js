import { useCallback } from 'react'
import { SwarmManager } from '../lib/swarmManager.js'
import { transferManager as M } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import { MSG } from '../webrtc/protocol.js'
import { readChunk, getFileForChunk } from '../lib/fileChunker.js'
import { sha256Hex, getMerkleProof, buildMerkleTree } from '../lib/browserCrypto.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useToastStore } from '../store/useToastStore.js'

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
        useTransferStore.getState().setError('All peers disconnected')
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
      const writer = await fileHandle.createWritable({ keepExistingData: false })
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
      if (msg.type !== MSG.CHUNK_REQUEST) return
      if (!useTransferStore.getState().seeding) return

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
    transport.pc.addEventListener('connectionstatechange', () => {
      if (transport.pc.connectionState === 'disconnected' || transport.pc.connectionState === 'failed') {
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
        useTransferStore.getState().setComplete(M.receivedMeta?.tree != null)
      }
    })

    transport.onChunk(async (msg) => {
      if (!M.swarm || M.swarm.isComplete() || M.swarm.aborted) return
      try {
        await M.swarm.onChunkReceived(
          transport.remotePeerId,
          msg.chunkIndex,
          msg.chunkData,
          msg.chunkHash,
          msg.proof
        )
      } catch {}
    })

    swarm.addPeer(transport.remotePeerId, requestFn)
    transport.pc.addEventListener('connectionstatechange', () => {
      if (transport.pc.connectionState === 'disconnected' || transport.pc.connectionState === 'failed') {
        M.transports.delete(transport.remotePeerId)
        swarm.removePeer(transport.remotePeerId)
      }
    })
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
    return ordered.length > 0 ? new Blob(ordered, { type: 'application/octet-stream' }) : null
  }, [])

  const triggerDownload = useCallback(async () => {
    if (M.downloadGuard) return
    M.downloadGuard = true
    const meta = useTransferStore.getState().fileMeta
    const saveMode = useTransferStore.getState().saveMode
    if (!meta || M.chunks.length === 0) return

    const allStreamed = M.streamWriters.size > 0
    const files = meta.files || [{ path: meta.fileName, name: meta.fileName, size: meta.fileSize, startChunk: 0, chunkCount: meta.totalChunks }]
    const isMulti = files.length > 1

    if (allStreamed) {
      await closeStreamWriters()
      return
    }

    if (isMulti && saveMode === 'auto') {
      let wroteAny = false
      try {
        const dirHandle = await window.showDirectoryPicker?.({ mode: 'readwrite' })
        if (dirHandle) {
          for (const entry of files) {
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
      for (const entry of files) {
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
        await writable.write(blobForEntry(files[0]))
        await writable.close()
        return
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        useToastStore.getState().addToast('Save cancelled — file kept in memory, use the download button', 'info')
      } else {
        useToastStore.getState().addToast('Save failed. File remains in memory.', 'error')
      }
    }

    const blob = blobForEntry(files[0])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = meta.fileName
    a.click()
    URL.revokeObjectURL(url)
  }, [blobForEntry])

  const disconnectAll = useCallback(() => {
    if (M.swarm) {
      M.swarm.abort()
      M.swarm = null
    }
    for (const [id, t] of M.transports) {
      t.close()
    }
    closeStreamWriters()
    M.streamHandle = null
    M.reset()
    useTransferStore.getState().reset()
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

  return {
    startSending,
    startReceiving,
    addSenderPeer,
    addReceiverPeer,
    triggerDownload,
    resetDownload,
    disconnectAll,
    stopSeeding,
    resumeSeeding,
  }
}
