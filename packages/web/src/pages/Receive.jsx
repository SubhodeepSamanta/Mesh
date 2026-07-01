import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import { MSG } from '../webrtc/protocol.js'
import { motion } from 'framer-motion'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import Card from '../components/shared/Card.jsx'
import ProgressBar from '../components/shared/ProgressBar.jsx'
import ConnectionCode from '../components/ConnectionCode.jsx'
import FileManifest from '../components/FileManifest.jsx'

export default function Receive() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [joining, setJoining] = useState(false)
  const swarmRef = useRef(null)
  const transportsRef = useRef([])
  const downloadGuardRef = useRef(false)

  const joinRoom = useSignalingStore((s) => s.joinRoom)
  const roomCode = useSignalingStore((s) => s.roomCode)

  const fileMeta = useTransferStore((s) => s.fileMeta)
  const status = useTransferStore((s) => s.status)
  const progress = useTransferStore((s) => s.progress)

  const { startReceiving, addReceiverPeer, triggerDownload, disconnectAll } = useTransfer()

  async function handleJoin(code) {
    setJoining(true)
    try {
      const result = await joinRoom(code)
      useTransferStore.getState().startAsReceiver()
      for (const peerId of result.existingPeers || []) {
        const client = useSignalingStore.getState().client
        const transport = new WebRTCTransport(client, peerId, { initiator: false })
        transport.onJSON((msg) => {
          if (msg.type === MSG.FILE_OFFER && !swarmRef.current) {
            swarmRef.current = startReceiving(msg)
          }
        })
        await transport.connect()
        transportsRef.current.push(transport)
      }
    } finally {
      setJoining(false)
    }
  }

  function handleBeginTransfer() {
    if (!swarmRef.current) return
    for (const transport of transportsRef.current) {
      addReceiverPeer(transport, swarmRef.current)
    }
  }

  useEffect(() => {
    if (status === 'transferring') navigate('/dashboard')
  }, [status, navigate])

  useEffect(() => {
    if (status === 'complete' && fileMeta && !downloadGuardRef.current) {
      downloadGuardRef.current = true
      triggerDownload()
    }
  }, [status, fileMeta, triggerDownload])

  const prefillCode = searchParams.get('code') || ''

  const showFileMeta = !!fileMeta

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col gap-8 px-6 ${showFileMeta ? 'py-12 lg:flex-row' : 'pt-16 pb-8'}`}
    >
      <div className={`flex flex-col gap-6 ${showFileMeta ? 'lg:w-[35%]' : 'w-full max-w-md'}`}>
        <div>
          <p className="text-xs uppercase tracking-widest text-amber-400">Receive Data</p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--txt-primary)]">Receive</h1>
        </div>

        {!roomCode && (
          <ConnectionCode onJoin={handleJoin} joining={joining} defaultValue={prefillCode} />
        )}

        {roomCode && (
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge color="green" dot>LINK ESTABLISHED</Badge>
              <span className="text-sm text-[var(--txt-secondary)]">&lt;10ms</span>
            </div>
            <p className="text-sm leading-relaxed text-[var(--txt-secondary)]">
              End-to-end encrypted via X25519 key exchange. All data is encrypted before leaving the sender and can only be decrypted by your device.
            </p>
            <p className="font-mono text-sm text-[var(--txt-dim)]">{roomCode}</p>
          </Card>
        )}
      </div>

      {showFileMeta && (
        <div className="flex-1 lg:w-[65%]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
          >
            <FileManifest fileMeta={fileMeta} />

            {status === 'file-offered' && (
              <Button onClick={handleBeginTransfer} className="w-full py-3 text-base">
                BEGIN TRANSFER
              </Button>
            )}

            {status === 'transferring' && (
              <Card className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--txt-secondary)]">Receiving...</span>
                    <span className="font-mono text-sm text-[var(--txt-dim)]">
                      {progress.verified} / {progress.total} chunks
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar percent={progress.percent || 0} />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-[var(--txt-secondary)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400/60" />
                  Downloading via encrypted channel
                </div>
              </Card>
            )}

            {status === 'complete' && (
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                className="rounded-lg border border-green-500/20 bg-green-500/5 px-5 py-4 text-center"
              >
                <p className="font-medium text-green-400">Download Complete</p>
                <p className="mt-1 text-xs text-green-400/60">File saved successfully</p>
              </motion.div>
            )}
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}
