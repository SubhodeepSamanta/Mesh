import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { transferManager as M } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import Card from '../components/shared/Card.jsx'
import Badge from '../components/shared/Badge.jsx'
import Accordion from '../components/shared/Accordion.jsx'
import FileDropZone from '../components/FileDropZone.jsx'
import RoomCode from '../components/RoomCode.jsx'
import StatusLog from '../components/StatusLog.jsx'

export default function Send() {
  const navigate = useNavigate()
  const [fileIndex, setFileIndex] = useState(null)
  const [lines, setLines] = useState([])
  const startRef = useRef(null)
  const fileIdxRef = useRef(null)

  const roomCode = useSignalingStore((s) => s.roomCode)
  const peers = useSignalingStore((s) => s.peers)
  const createRoom = useSignalingStore((s) => s.createRoom)
  const client = useSignalingStore((s) => s.client)

  const st = useTransferStore((s) => s.status)
  const prog = useTransferStore((s) => s.progress)
  const meta = useTransferStore((s) => s.fileMeta)

  const { startSending, addSenderPeer, disconnectAll } = useTransfer()

  function addLine(t) { setLines((p) => [...p, t]) }

  async function handleFileReady(file, index, fileRefs) {
    fileIdxRef.current = index
    setFileIndex(index)
    addLine(`${index.files.length > 1 ? index.files.length + ' files' : index.fileName} (${(index.fileSize / 1e6).toFixed(1)} MB)`)
    addLine('Indexing & hashing chunks for verification...')
    await startSending(file, index, fileRefs)
    addLine('Creating encrypted relay room...')
    const room = await createRoom()
    useTransferStore.getState().setRoomCode(room.roomCode)
    addLine(`Room active: ${room.roomCode}`)
    startRef.current = Date.now()
    M.startSeederListener(useSignalingStore.getState().client, (fromPeerId) => {
      addLine(`Peer connected: ${fromPeerId.slice(0, 12)}...`)
      addLine('Establishing WebRTC data channel...')
      const c = useSignalingStore.getState().client
      if (!c) return
      const t = new WebRTCTransport(c, fromPeerId, { initiator: false })
      t.connect().then(() => {
        addLine('Channel open — encrypted')
        addLine('Sending file offer...')
        addSenderPeer(t, fileIdxRef.current)
        addLine('Transfer started!')
      }).catch((e) => {
        addLine(`Connection error: ${e.message}`)
      })
    })
    addLine('Waiting for someone to join with your room code...')
  }

  useEffect(() => {
    if (peers.length > 0) {
      addLine(`${peers.length} peer${peers.length > 1 ? 's' : ''} in room`)
    }
  }, [peers.length])

  useEffect(() => {
    if (st === 'transferring') navigate('/dashboard')
    return () => M.stopSeederListener()
  }, [st, navigate])

  useEffect(() => {
    if (st === 'complete') { addLine('All chunks sent and verified'); addLine('Transfer complete!') }
    else if (st === 'error') { addLine(`Error: ${useTransferStore.getState().error}`) }
  }, [st])

  function handleCancel() {
    M.stopSeederListener()
    useSignalingStore.getState().disconnect()
    disconnectAll(); startRef.current = null; fileIdxRef.current = null
    setFileIndex(null); setLines([])
  }

  const done = st === 'complete'
  const xfer = st === 'transferring'
  const hp = peers.length > 0
  const secs = startRef.current ? Math.floor((Date.now() - startRef.current) / 1000) : 0
  const uptime = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
  const fileCount = fileIndex?.files?.length || 1
  const totalSize = fileIndex?.fileSize || 0

  const infoAccordions = (
    <div className="mt-8 space-y-2">
      <Accordion title="How it works">
        <ol className="list-inside list-decimal space-y-1.5">
          <li>Pick the file or folder you want to send.</li>
          <li>Mesh splits it into encrypted chunks and creates a unique room code.</li>
          <li>Share the code with your friend — it also works as a QR code.</li>
          <li>When they join, a direct WebRTC connection forms between you two.</li>
          <li>Your browser sends chunks peer-to-peer. No servers see your data.</li>
          <li>Done! The receiver can download right from their browser.</li>
        </ol>
        <p className="mt-3 text-xs text-[var(--txt-dim)]">Everything stays in-browser. Nothing is stored on any server.</p>
      </Accordion>
      <Accordion title="Security & encryption">
        <p>Your file never touches any server. The signaling relay only helps peers find each other — after that, it's a direct encrypted WebRTC connection.</p>
        <ul className="mt-2 space-y-1">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">End-to-end encrypted</strong> — DTLS keys negotiated peer-to-peer</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">Chunk verification</strong> — each piece is SHA-256 checked against the Merkle root</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">No account needed</strong> — no sign-up, no tracking, no data collection</span>
          </li>
        </ul>
      </Accordion>
      <Accordion title="Tips & limits">
        <ul className="space-y-1.5">
          <li>Both devices need to stay online during the transfer.</li>
          <li>For large files (&gt;2 GB), the receiver may be prompted to pick a save location.</li>
          <li>Folders with multiple files are sent as one batch — all files arrive together.</li>
          <li>Room codes expire after the transfer ends for security.</li>
        </ul>
      </Accordion>
    </div>
  )

  if (!fileIndex) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--accent)]">Secure Peer-to-Peer</p>
        <h1 className="text-3xl font-bold text-[var(--txt-primary)]">Send a File</h1>
        <p className="mt-2 mb-8 text-base text-[var(--txt-secondary)]">
          Drop any file or folder below to start sharing. Mesh creates a private room and gives you a code — share it with anyone to begin the transfer.
        </p>
        <FileDropZone onFileReady={handleFileReady} />
        {infoAccordions}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8">
        <p className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--accent)]">Secure Peer-to-Peer</p>
        <h1 className="text-3xl font-bold text-[var(--txt-primary)]">Sending...</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Badge color="amber" dot>{fileCount > 1 ? `${fileCount} files` : fileIndex.fileName}</Badge>
          <span className="text-sm text-[var(--txt-secondary)]">{(totalSize / 1e6).toFixed(1)} MB</span>
          <Badge color="gray" dot={false}>{fileIndex.totalChunks} chunks</Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col items-center justify-center py-8">
          {roomCode ? (
            <>
              <p className="mb-3 text-xs uppercase tracking-widest text-[var(--txt-secondary)]">Share this code</p>
              <RoomCode roomCode={roomCode} />
              <p className="mt-4 text-center text-xs text-[var(--txt-dim)]">
                Share the code or let them scan the QR
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)]/30 border-t-amber-400" />
              <p className="text-sm text-[var(--txt-secondary)]">Creating room...</p>
            </div>
          )}
        </Card>
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <Badge color="amber" dot={!done && hp}>{done ? 'COMPLETE' : hp ? 'ACTIVE' : 'WAITING'}</Badge>
            <span className="text-xs text-[var(--txt-secondary)]">
              {done ? 'All done' : hp ? 'Peer connected' : 'Waiting for receiver'}
            </span>
          </div>
          <StatusLog lines={lines} blinking={!done && !hp} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-[var(--txt-secondary)]">Peers</span>
            <span className="font-mono text-sm text-[var(--accent)]">{peers.length}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {hp ? peers.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/10 px-2 py-1 font-mono text-xs text-[var(--accent-dim)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                {p.slice(0, 8)}
              </span>
            )) : (
              <p className="text-xs text-[var(--txt-dim)]">No one joined yet — share the code above</p>
            )}
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-[var(--txt-secondary)]">Session</span>
            <span className="font-mono text-xs text-[var(--txt-dim)]">{startRef.current ? uptime : '—'}</span>
          </div>
          <p className="mt-3 text-xs text-[var(--txt-dim)]">
            {roomCode ? `Room: ${roomCode}` : 'Initializing...'}
          </p>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-[var(--txt-secondary)]">Encryption</span>
            <Badge color="green" dot={false}>DTLS 1.3</Badge>
          </div>
          <p className="mt-3 text-xs text-[var(--txt-dim)]">
            {hp ? 'Peer-to-peer channel active' : 'Waiting for peer to connect'}
          </p>
        </Card>
      </div>

      {xfer && (
        <Card className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--txt-primary)]">Uploading chunks</span>
            <span className="font-mono text-sm text-[var(--txt-secondary)]">{prog.verified} / {prog.total}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${Math.min(100, prog.percent)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--txt-dim)]">
            Each chunk is hashed and sent. The receiver verifies every piece against the Merkle tree.
          </p>
        </Card>
      )}

      {done && (
        <Card className="mt-6 border-[var(--success)]/20 bg-[var(--success)]/5">
          <div className="flex items-center gap-3">
            <svg className="h-6 w-6 shrink-0 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-medium text-[var(--success)]">Transfer Complete</p>
              <p className="text-xs text-[var(--success)]/60">{prog.verified} / {prog.total} chunks · All verified</p>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-8 flex items-center justify-center gap-5 border-t border-[var(--border)] pt-4">
        <span className="text-xs uppercase tracking-[0.15em] text-[var(--txt-secondary)]">
          STATUS <span className={`ml-1 ${done ? 'text-[var(--success)]' : xfer ? 'text-[var(--accent)]' : 'text-[var(--txt-dim)]'}`}>
            {done ? 'COMPLETE' : xfer ? 'SENDING' : hp ? 'CONNECTED' : 'WAITING'}
          </span>
        </span>
        {startRef.current && (
          <span className="text-xs uppercase tracking-[0.15em] text-[var(--txt-secondary)]">
            UPTIME <span className="ml-1 text-[var(--accent)]">{uptime}</span>
          </span>
        )}
        {!done && (
          <button
            onClick={handleCancel}
            className="cursor-pointer rounded-md border border-[var(--border-light)] px-3 py-1 text-xs uppercase tracking-wider text-[var(--txt-secondary)] transition-colors hover:border-[var(--error)]/30 hover:text-[var(--error)]"
          >
            Cancel
          </button>
        )}
        {done && (
          <button
            onClick={handleCancel}
            className="cursor-pointer rounded-md border border-[var(--border-light)] px-3 py-1 text-xs uppercase tracking-wider text-[var(--txt-secondary)] transition-colors hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
          >
            Send Another
          </button>
        )}
      </div>
    </div>
  )
}
