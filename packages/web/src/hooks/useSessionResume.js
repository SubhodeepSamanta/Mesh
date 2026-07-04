import { useEffect, useRef } from 'react'
import { useTransferStore } from '../store/useTransferStore.js'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useToastStore } from '../store/useToastStore.js'
import { useTransfer, runDiskResumePreflight } from './useTransfer.js'
import { transferManager as M } from '../lib/transferManager.js'
import { loadDirHandle } from '../lib/dirHandleStore.js'

const SWARM_APPEAR_TIMEOUT_MS = 12000
const SWARM_POLL_MS = 200

// Runs once at app mount. If a reload interrupted a live receiver transfer
// and the signaling session is still resumable, this rejoins the room,
// re-dials whichever peers are still there, and — since the user already
// consented to this transfer before the reload — jumps straight to
// 'transferring' instead of re-showing the file-offer accept screen.
//
// Before that final jump, if the transfer was streaming to a picked folder
// (saveMode 'auto'), it also tries a Stage C byte-level resume: reopen the
// persisted FileSystemDirectoryHandle and, only if the browser silently
// still grants write access (no guarantee — Chromium may require a fresh
// user gesture after a reload), proof-verify whatever's already on disk so
// the swarm doesn't re-fetch it. If that permission isn't silently granted,
// this falls back to Stage B's plain restart — no worse than before.
export function useSessionResume() {
  const attempted = useRef(false)
  const { dialPeer, addReceiverPeer } = useTransfer()

  useEffect(() => {
    if (attempted.current) return
    const { status, role } = useTransferStore.getState()
    if (status !== 'reconnecting' || role !== 'receiver') return
    attempted.current = true

    let cancelled = false

    ;(async () => {
      try {
        const client = await useSignalingStore.getState().resumeSession()
        if (!client) throw new Error('No resumable session')

        const existingPeers = await new Promise((resolve, reject) => {
          const onReconnect = (e) => { cleanup(); resolve(e.detail?.existingPeers || []) }
          const onFailed = () => { cleanup(); reject(new Error('Rejoin failed')) }
          function cleanup() {
            client.removeEventListener('reconnect', onReconnect)
            client.removeEventListener('reconnectFailed', onFailed)
          }
          client.addEventListener('reconnect', onReconnect, { once: true })
          client.addEventListener('reconnectFailed', onFailed, { once: true })
        })

        if (cancelled) return

        if (existingPeers.length === 0) {
          useTransferStore.getState().setError('Transfer interrupted — the sender is no longer connected. Ask them for a new room code.')
          return
        }

        // Deliberately do NOT pre-set 'transferring' here (unlike a plain
        // Stage B restart) — status stays whatever loadSaved() set so
        // dialPeer's file-offer handler creates the swarm but does not yet
        // start pulling chunks, giving the disk-resume preflight below a
        // window to run first.
        await Promise.allSettled(existingPeers.map((peerId) => dialPeer(peerId)))
        if (cancelled) return

        const swarmAppeared = M.swarm || await new Promise((resolve) => {
          const start = Date.now()
          const interval = setInterval(() => {
            if (cancelled || M.swarm || Date.now() - start > SWARM_APPEAR_TIMEOUT_MS) {
              clearInterval(interval)
              resolve(!!M.swarm)
            }
          }, SWARM_POLL_MS)
        })

        if (cancelled) return
        if (!swarmAppeared) {
          useTransferStore.getState().setError('Transfer interrupted — could not reconnect to the sender.')
          return
        }

        const { saveMode, fileMeta } = useTransferStore.getState()
        if (saveMode === 'auto' && fileMeta) {
          try {
            const savedHandle = await loadDirHandle()
            if (savedHandle) {
              const perm = await savedHandle.queryPermission({ mode: 'readwrite' })
              if (perm === 'granted') {
                M.streamHandle = { dirHandle: savedHandle }
                const transport = [...M.transports.values()].find((t) => t.offeredRoot === M.swarm.merkleRoot)
                if (transport) await runDiskResumePreflight(transport, M.swarm, fileMeta)
              } else {
                useToastStore.getState().addToast('Reconnected — the browser needs a fresh permission click to keep writing into the same folder, so this download restarts into memory instead.', 'info', 6000)
              }
            }
          } catch { /* best-effort — falls back to restarting into memory/a new folder pick */ }
        }

        if (cancelled) return

        useTransferStore.getState().setTransferring()
        for (const [, transport] of M.transports) {
          if (transport.offeredRoot === M.swarm.merkleRoot) {
            addReceiverPeer(transport, M.swarm)
          }
        }
      } catch {
        if (!cancelled) useTransferStore.getState().setError('Transfer interrupted — connection lost on refresh')
      }
    })()

    return () => { cancelled = true }
  }, [dialPeer, addReceiverPeer])
}
