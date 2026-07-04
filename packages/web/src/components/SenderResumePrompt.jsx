import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { transferManager as M } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import { indexFilesAsync } from '../lib/indexFilesAsync.js'
import Card from './shared/Card.jsx'
import FileDropZone from './FileDropZone.jsx'

// Stage D: sender-side reload recovery. Shown wherever the sender might land
// on reload (Send.jsx before a peer ever joined, Dashboard.jsx afterward) —
// the original File handles are gone after a reload, so this can't be
// automatic. The user re-selects the same file(s), we rehash them
// client-side and only proceed if the resulting merkleRoot matches what was
// actually being sent before the reload, then rejoin the room and resume
// seeding.
export default function SenderResumePrompt() {
  const navigate = useNavigate()
  const roomCode = useSignalingStore((s) => s.roomCode)
  const fileMeta = useTransferStore((s) => s.fileMeta)
  const persistedRoomCode = useTransferStore((s) => s.roomCode)
  const { startSending, addSenderPeer, disconnectAll } = useTransfer()
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState(null)

  const handleResumeSending = useCallback(async (files, fileRefs) => {
    setResendError(null)
    setResending(true)
    try {
      const index = await indexFilesAsync(files, () => {})
      const expectedRoot = useTransferStore.getState().fileMeta?.merkleRoot
      if (index.merkleRoot !== expectedRoot) {
        setResendError("That doesn't match the file(s) you were sending before — please pick the exact same file(s).")
        return
      }

      const client = await useSignalingStore.getState().resumeSession()
      if (!client) {
        setResendError('Could not rejoin the room — the session may have expired. Start a fresh send instead.')
        return
      }

      await new Promise((resolve, reject) => {
        const onReconnect = () => { cleanup(); resolve() }
        const onFailed = () => { cleanup(); reject(new Error('Rejoin failed')) }
        function cleanup() {
          client.removeEventListener('reconnect', onReconnect)
          client.removeEventListener('reconnectFailed', onFailed)
        }
        client.addEventListener('reconnect', onReconnect, { once: true })
        client.addEventListener('reconnectFailed', onFailed, { once: true })
      })

      await startSending(files[0], index, fileRefs)
      M.startSeederListener(useSignalingStore.getState().client, (fromPeerId, offerPayload) => {
        if (M.transports.has(fromPeerId)) return
        const c = useSignalingStore.getState().client
        const t = new WebRTCTransport(c, fromPeerId, { initiator: false })
        t.connect(offerPayload).then(() => addSenderPeer(t, index)).catch(() => {})
      })
      navigate('/dashboard')
    } catch {
      setResendError('Could not rejoin the room — the session may have expired. Start a fresh send instead.')
    } finally {
      setResending(false)
    }
  }, [startSending, addSenderPeer, navigate])

  const handleStartFresh = useCallback(() => {
    try { useSignalingStore.getState().disconnect() } catch {}
    try { disconnectAll() } catch {}
    navigate('/send')
  }, [disconnectAll, navigate])

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Card className="space-y-4">
        <div>
          <p className="mb-1 text-xs uppercase tracking-widest text-[var(--accent)]">Transfer interrupted</p>
          <h1 className="text-xl font-bold text-[var(--txt-primary)]">Resume sending {fileMeta?.fileName ? `"${fileMeta.fileName}"` : 'your file(s)'}?</h1>
          <p className="mt-2 text-sm text-[var(--txt-secondary)]">
            This page reloaded mid-transfer. Your browser can't keep hold of a file across a reload, so re-select the exact same file{fileMeta?.files?.length > 1 ? 's' : ''} to resume seeding in room <span className="font-mono text-[var(--txt-primary)]">{roomCode || persistedRoomCode || '—'}</span>.
          </p>
        </div>

        {resending ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]" />
            <p className="text-sm text-[var(--txt-secondary)]">Verifying and rejoining...</p>
          </div>
        ) : (
          <FileDropZone onFilesSelected={handleResumeSending} />
        )}

        {resendError && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-4 py-3">
            <p className="text-xs text-[var(--error)]">{resendError}</p>
          </div>
        )}

        <button
          onClick={handleStartFresh}
          className="w-full cursor-pointer text-center text-xs text-[var(--txt-secondary)] underline-offset-2 hover:text-[var(--txt-primary)] hover:underline"
        >
          Give up and start a new send instead
        </button>
      </Card>
    </div>
  )
}
