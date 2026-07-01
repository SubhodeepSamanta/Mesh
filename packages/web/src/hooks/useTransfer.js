import { useCallback } from 'react'
import { SwarmManager } from '../lib/swarmManager.js'
import { transferManager as M } from '../lib/transferManager.js'
import { MSG } from '../webrtc/protocol.js'
import { readChunk, getFileForChunk } from '../lib/fileChunker.js'
import { getMerkleProof } from '../lib/browserCrypto.js'
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
    M.servedRef = new Set()
    const total = fileIndex.totalChunks
    transport.onJSON((msg) => {
      if (msg.type !== MSG.CHUNK_REQUEST) return
      const file = M.fileRef
      const idx = M.indexRef
      const refs = M.fileRefs
      if (!file || !idx || !refs) return

      const entry = getFileForChunk(idx.files, msg.index)
      if (!entry) return
      const targetFile = refs[entry.fileEntry.path]
      if (!targetFile) return

      readChunk(targetFile, entry.localIndex, idx.chunkSize).then((buf) => {
        const proof = getMerkleProof(idx.tree, msg.index)
        transport.sendChunk(msg.index, idx.hashes[msg.index], proof, new Uint8Array(buf))
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
    M.transports.set(transport.remotePeerId, transport)
    useTransferStore.getState().setTransferring()
  }, [])

  const triggerDownload = useCallback(async () => {
    if (M.downloadGuard) return
    M.downloadGuard = true
    const meta = useTransferStore.getState().fileMeta
    if (!meta || M.chunks.length === 0) return

    const files = meta.files || [{ path: meta.fileName, name: meta.fileName, size: meta.fileSize, startChunk: 0, chunkCount: meta.totalChunks }]

    try {
      const handle = await window.showSaveFilePicker?.({
        suggestedName: meta.fileName,
        types: [{ accept: { 'application/octet-stream': [] } }],
      })
      if (handle) {
        M.streamHandle = await handle.createWritable()
        for (const entry of files) {
          const ordered = []
          for (let i = 0; i < entry.chunkCount; i++) {
            ordered.push(M.chunks[entry.startChunk + i])
          }
          const blob = new Blob(ordered, { type: 'application/octet-stream' })
          await M.streamHandle.write(blob)
        }
        await M.streamHandle.close()
        M.streamHandle = null
        return
      }
    } catch {}

    const ordered = []
    for (let i = 0; i < meta.totalChunks; i++) {
      ordered.push(M.chunks[i])
    }
    const blob = new Blob(ordered, { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = meta.fileName
    a.click()
    URL.revokeObjectURL(url)
  }, [])

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

  return {
    startSending,
    startReceiving,
    addSenderPeer,
    addReceiverPeer,
    triggerDownload,
    disconnectAll,
  }
}
