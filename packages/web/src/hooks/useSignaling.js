import { useCallback } from 'react'
import { useSignalingStore } from '../store/useSignalingStore.js'

export function useSignaling() {
  const status = useSignalingStore((s) => s.status)
  const roomCode = useSignalingStore((s) => s.roomCode)
  const peerId = useSignalingStore((s) => s.peerId)
  const peers = useSignalingStore((s) => s.peers)
  const error = useSignalingStore((s) => s.error)
  const client = useSignalingStore((s) => s.client)

  const connect = useSignalingStore((s) => s.connect)
  const createRoom = useSignalingStore((s) => s.createRoom)
  const joinRoom = useSignalingStore((s) => s.joinRoom)
  const disconnect = useSignalingStore((s) => s.disconnect)
  const reset = useSignalingStore((s) => s.reset)

  const createAndWait = useCallback(async (password) => {
    const result = await createRoom(password)
    return result
  }, [createRoom])

  return {
    client, status, roomCode, peerId, peers, error,
    connect, createRoom: createAndWait, joinRoom, disconnect, reset,
  }
}
