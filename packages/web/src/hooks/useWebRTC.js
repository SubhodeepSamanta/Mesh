import { useRef, useCallback } from 'react'
import { WebRTCTransport } from '../lib/webrtc.js'

export function useWebRTC(signalingClient) {
  const transports = useRef(new Map())

  const createTransport = useCallback(async (remotePeerId, initiator) => {
    const existing = transports.current.get(remotePeerId)
    if (existing) return existing

    const t = new WebRTCTransport(signalingClient, remotePeerId, { initiator })
    try {
      await t.connect()
      transports.current.set(remotePeerId, t)
      return t
    } catch (err) {
      t.close()
      throw err
    }
  }, [signalingClient])

  const getTransport = useCallback((peerId) => {
    return transports.current.get(peerId)
  }, [])

  const destroyTransport = useCallback((peerId) => {
    const t = transports.current.get(peerId)
    if (t) {
      t.close()
      transports.current.delete(peerId)
    }
  }, [])

  const destroyAll = useCallback(() => {
    for (const [id, t] of transports.current) {
      t.close()
    }
    transports.current.clear()
  }, [])

  return { createTransport, getTransport, destroyTransport, destroyAll }
}
