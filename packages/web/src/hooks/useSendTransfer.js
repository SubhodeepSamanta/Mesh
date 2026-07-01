import { useCallback, useRef } from 'react'
import { WebRTCPeer } from '../webrtc/webrtcPeer.js'
import { MSG } from '../webrtc/protocol.js'
import { readChunk } from '../lib/fileChunker.js'
import { getMerkleProof } from '../lib/browserCrypto.js'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'

export function useSendTransfer() {
  const fileRef = useRef(null)
  const indexRef = useRef(null)
  const servedRef = useRef(new Set())

  const startSending = useCallback(async (file, fileIndex) => {
    fileRef.current = file
    indexRef.current = fileIndex
    servedRef.current = new Set()
    useTransferStore.getState().startAsSender({
      fileName: fileIndex.fileName,
      fileSize: fileIndex.fileSize,
      totalChunks: fileIndex.totalChunks,
      chunkSize: fileIndex.chunkSize,
      merkleRoot: fileIndex.merkleRoot,
    })
  }, [])

  const handleChunkRequest = useCallback(async (peer, index) => {
    const file = fileRef.current
    const idx = indexRef.current
    const buf = await readChunk(file, index, idx.chunkSize)
    const proof = getMerkleProof(idx.tree, index)
    peer.sendChunk(index, idx.hashes[index], proof, new Uint8Array(buf))

    servedRef.current.add(index)
    const total = idx.totalChunks
    useTransferStore.getState().updateProgress({
      verified: servedRef.current.size,
      total,
      percent: (servedRef.current.size / total) * 100,
    })
    if (servedRef.current.size === total) {
      useTransferStore.getState().setComplete()
    }
  }, [])

  const connectToPeer = useCallback(async (remotePeerId) => {
    const client = useSignalingStore.getState().client
    const peer = new WebRTCPeer(client, remotePeerId, { initiator: true })

    peer.addEventListener('jsonMessage', (e) => {
      if (e.detail.type === MSG.CHUNK_REQUEST) {
        handleChunkRequest(peer, e.detail.index)
      }
    })
    peer.addEventListener('close', () => {
      if (useTransferStore.getState().status !== 'complete') {
        useTransferStore.getState().setError('Connection closed')
      }
    })

    await peer.connect()

    const idx = indexRef.current
    peer.sendJSON({
      type: MSG.FILE_OFFER,
      fileName: idx.fileName,
      fileSize: idx.fileSize,
      totalChunks: idx.totalChunks,
      chunkSize: idx.chunkSize,
      merkleRoot: idx.merkleRoot,
    })
    useTransferStore.getState().setTransferring()
    return peer
  }, [handleChunkRequest])

  return { startSending, connectToPeer }
}