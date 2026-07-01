import { useCallback, useRef } from 'react'
import { WebRTCPeer } from '../webrtc/webrtcPeer.js'
import { MSG } from '../webrtc/protocol.js'
import { verifyChunk } from '../lib/browserCrypto.js'
import { useTransferStore } from '../store/useTransferStore.js'

const PIPELINE_DEPTH = 8

export function useReceiveTransfer() {
  const chunksRef = useRef([])
  const metaRef = useRef(null)
  const nextRequestRef = useRef(0)
  const inFlightRef = useRef(0)
  const startTimeRef = useRef(0)
  const bytesReceivedRef = useRef(0)

  const fillPipeline = useCallback((peer) => {
    const meta = metaRef.current
    while (inFlightRef.current < PIPELINE_DEPTH && nextRequestRef.current < meta.totalChunks) {
      inFlightRef.current++
      peer.sendJSON({ type: MSG.CHUNK_REQUEST, index: nextRequestRef.current })
      nextRequestRef.current++
    }
  }, [])

  const requestOne = useCallback((peer, index) => {
    inFlightRef.current++
    peer.sendJSON({ type: MSG.CHUNK_REQUEST, index })
  }, [])

  const handleChunk = useCallback(async (peer, msg) => {
    const meta = metaRef.current
    inFlightRef.current--

    const view = msg.chunkData
    const buf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    const valid = await verifyChunk(buf, msg.proof, meta.merkleRoot)

    if (!valid) {
      requestOne(peer, msg.chunkIndex)
      return
    }

    chunksRef.current[msg.chunkIndex] = view
    bytesReceivedRef.current += view.byteLength

    const verifiedCount = chunksRef.current.filter(Boolean).length
    useTransferStore.getState().updateProgress({
      verified: verifiedCount,
      total: meta.totalChunks,
      percent: (verifiedCount / meta.totalChunks) * 100,
    })

    const elapsedSec = (Date.now() - startTimeRef.current) / 1000
    if (elapsedSec > 0.2) {
      useTransferStore.getState().recordSpeedSample(bytesReceivedRef.current / 1024 / 1024 / elapsedSec)
    }

    if (verifiedCount === meta.totalChunks) {
      useTransferStore.getState().setComplete()
      return
    }

    fillPipeline(peer)
  }, [fillPipeline, requestOne])

  const connectToPeer = useCallback(async (client, remotePeerId) => {
    const peer = new WebRTCPeer(client, remotePeerId, { initiator: false })

    peer.addEventListener('jsonMessage', (e) => {
      if (e.detail.type === MSG.FILE_OFFER) {
        metaRef.current = e.detail
        chunksRef.current = new Array(e.detail.totalChunks)
        useTransferStore.getState().setIncomingFile(e.detail)
      }
    })
    peer.addEventListener('chunkMessage', (e) => handleChunk(peer, e.detail))
    peer.addEventListener('close', () => {
      if (useTransferStore.getState().status !== 'complete') {
        useTransferStore.getState().setError('Connection closed')
      }
    })

    await peer.connect()
    return peer
  }, [handleChunk])

  const startDownload = useCallback((peer) => {
    startTimeRef.current = Date.now()
    bytesReceivedRef.current = 0
    nextRequestRef.current = 0
    useTransferStore.getState().setTransferring()
    fillPipeline(peer)
  }, [fillPipeline])

  const getAssembledBlob = useCallback(() => {
    return new Blob(chunksRef.current, { type: 'application/octet-stream' })
  }, [])

  return { connectToPeer, startDownload, getAssembledBlob }
}