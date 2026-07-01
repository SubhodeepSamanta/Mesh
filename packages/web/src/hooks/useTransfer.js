import { useCallback } from 'react'
import { SwarmManager } from '../lib/swarmManager.js'
import { transferManager as M } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import { MSG } from '../webrtc/protocol.js'
import { readChunk, getFileForChunk } from '../lib/fileChunker.js'
import { sha256Hex, getMerkleProof } from '../lib/browserCrypto.js'
import { useTransferStore } from '../store/useTransferStore.js'

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
    M.downloadGuard = false
    M.chunks = new Array(meta.totalChunks)
    M.streamHandle = null
    M.receivedMeta = { files: meta.files, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks, merkleRoot: meta.merkleRoot }
    useTransferStore.getState().setIncomingFile(meta)

    const swarm = new SwarmManager(meta.totalChunks, meta.merkleRoot, meta.chunkSize)
    M.swarm = swarm

    let speedBytes = 0
    let speedTime = Date.now()
    const chunkSize = meta.chunkSize

    swarm.addEventListener('chunkVerified', async (e) => {
      const { chunkIndex, chunkData, verified, total } = e.detail
      M.chunks[chunkIndex] = chunkData

      if (M.streamHandle) {
        try {
          await M.streamHandle.write(chunkData)
        } catch {}
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
      if (M.streamHandle) {
        try { await M.streamHandle.close() } catch {}
        M.streamHandle = null
      }
      useTransferStore.getState().setComplete()
    })

    swarm.addEventListener('peerFailed', () => {
      useTransferStore.getState().updatePeerStats(swarm.getPeerStats())
    })

    return swarm
  }, [])

  const addSenderPeer = useCallback(async (transport, fileIndex) => {
    if (!M.servedRef) M.servedRef = new Set()
    const total = fileIndex.totalChunks
    transport.onJSON(async (msg) => {
      if (msg.type !== MSG.CHUNK_REQUEST) return
      if (!useTransferStore.getState().seeding) return

      const file = M.fileRef
      const idx = M.indexRef
      const refs = M.fileRefs

      if (file && idx && refs) {
        const entry = getFileForChunk(idx.files, msg.index)
        if (!entry) return
        const targetFile = refs[entry.fileEntry.path]
        if (!targetFile) return
        const buf = await (async () => {
          const b = await readChunk(targetFile, entry.localIndex, idx.chunkSize)
          const proof = getMerkleProof(idx.tree, msg.index)
          transport.sendChunk(msg.index, idx.hashes[msg.index], proof, new Uint8Array(b))
          return b
        })()
      } else if (M.chunks && M.chunks[msg.index]) {
        const data = M.chunks[msg.index]
        const arr = data instanceof Uint8Array ? data : new Uint8Array(data)
        const hash = await sha256Hex(arr)
        transport.sendChunk(msg.index, hash, null, arr)
      } else {
        return
      }
      M.servedRef.add(msg.index)
      useTransferStore.getState().updateProgress({
        verified: M.servedRef.size,
        total,
        percent: (M.servedRef.size / total) * 100,
      })
      if (M.servedRef.size >= total) {
        useTransferStore.getState().setComplete()
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

    transport.onChunk(async (msg) => {
      if (!M.swarm || M.swarm.isComplete()) return
      await M.swarm.onChunkReceived(
        transport.remotePeerId,
        msg.chunkIndex,
        msg.chunkData,
        msg.chunkHash,
        msg.proof
      )
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
      ordered.push(M.chunks[entry.startChunk + i])
    }
    return new Blob(ordered, { type: 'application/octet-stream' })
  }, [])

  const triggerDownload = useCallback(async () => {
    if (M.downloadGuard) return
    M.downloadGuard = true
    const meta = useTransferStore.getState().fileMeta
    const saveMode = useTransferStore.getState().saveMode
    if (!meta || M.chunks.length === 0) return

    const files = meta.files || [{ path: meta.fileName, name: meta.fileName, size: meta.fileSize, startChunk: 0, chunkCount: meta.totalChunks }]
    const isMulti = files.length > 1

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
          return
        }
      } catch {}
      if (wroteAny) return
    }

    if (isMulti || saveMode === 'files') {
      for (const entry of files) {
        const blob = blobForEntry(entry)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = entry.name
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
    } catch {}

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
    if (M.streamHandle) {
      try { M.streamHandle.close() } catch {}
      M.streamHandle = null
    }
    M.reset()
    useTransferStore.getState().reset()
  }, [])

  const stopSeeding = useCallback(() => {
    useTransferStore.getState().setSeeding(false)
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
