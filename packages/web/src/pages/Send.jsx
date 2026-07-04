import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { transferManager as M } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import { indexFilesAsync } from '../lib/indexFilesAsync.js'
import Card from '../components/shared/Card.jsx'
import Badge from '../components/shared/Badge.jsx'
import Button from '../components/shared/Button.jsx'
import Accordion from '../components/shared/Accordion.jsx'
import FileDropZone from '../components/FileDropZone.jsx'
import RoomCode from '../components/RoomCode.jsx'
import StatusLog from '../components/StatusLog.jsx'
import { useConfirmStore } from '../store/useConfirmStore.js'
import { useToastStore } from '../store/useToastStore.js'
import SenderResumePrompt from '../components/SenderResumePrompt.jsx'

export default function Send() {
  const navigate = useNavigate()
  const [pickedFiles, setPickedFiles] = useState(null)
  const [sending, setSending] = useState(false)
  const [fileIndex, setFileIndex] = useState(null)
  const [indexProgress, setIndexProgress] = useState({ hashed: 0, total: 0 })
  const [lines, setLines] = useState([])
  const startRef = useRef(null)
  const fileIdxRef = useRef(null)
  const indexReadyRef = useRef(false)
  const offerQueueRef = useRef([])

  const [usePassword, setUsePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  const roomCode = useSignalingStore((s) => s.roomCode)
  const peers = useSignalingStore((s) => s.peers)
  const createRoom = useSignalingStore((s) => s.createRoom)
  const client = useSignalingStore((s) => s.client)

  const st = useTransferStore((s) => s.status)
  const prog = useTransferStore((s) => s.progress)
  const meta = useTransferStore((s) => s.fileMeta)

  const { startSending, addSenderPeer, disconnectAll } = useTransfer()

  function addLine(t) { setLines((p) => [...p, t]) }

  function handleFilesSelected(files, fileRefs) {
    setPickedFiles({ files, fileRefs })
  }

  function handleChooseDifferent() {
    setPickedFiles(null)
  }

  function handleOffer(fromPeerId, offerPayload) {
    addLine(`Peer connected: ${fromPeerId.slice(0, 12)}...`)
    addLine('Establishing WebRTC data channel...')
    const c = useSignalingStore.getState().client
    if (!c) return
    let t
    try {
      // Constructing WebRTCTransport can throw synchronously (a malformed
      // ICE server config makes `new RTCPeerConnection` reject it outright)
      // — this used to have no try/catch at all around it, so that failure
      // mode showed literally nothing: no console output, no "Connection
      // error" line, just a peer that silently never got a file offer.
      t = new WebRTCTransport(c, fromPeerId, { initiator: false })
    } catch (e) {
      addLine(`Connection error: ${e.message}`)
      return
    }
    t.connect(offerPayload).then(() => {
      addLine('Channel open — encrypted')
      addLine('Sending file offer...')
      addSenderPeer(t, fileIdxRef.current)
      addLine('Transfer started!')
    }).catch((e) => {
      addLine(`Connection error: ${e.message}`)
    })
  }

  async function handleStartSending() {
    if (!pickedFiles) return
    if (usePassword && !password.trim()) return
    const { files, fileRefs } = pickedFiles
    setSending(true)
    indexReadyRef.current = false
    offerQueueRef.current = []

    const totalSize = files.reduce((s, f) => s + f.size, 0)
    addLine(`${files.length > 1 ? files.length + ' files' : files[0].name} (${(totalSize / 1e6).toFixed(1)} MB)`)
    addLine('Indexing & hashing chunks for verification...')

    const indexPromise = indexFilesAsync(files, (hashed, total) => {
      setIndexProgress({ hashed, total })
    })

    addLine('Creating encrypted relay room...')
    let room
    try {
      room = await createRoom(usePassword ? password.trim() : undefined)
    } catch (e) {
      addLine(`Failed to create room: ${e.message}`)
      useToastStore.getState().addToast(`Failed to create room: ${e.message}`, 'error')
      setSending(false)
      return
    }
    useTransferStore.getState().setRoomCode(room.roomCode)
    addLine(`Room active: ${room.roomCode}`)
    startRef.current = Date.now()

    M.startSeederListener(useSignalingStore.getState().client, (fromPeerId, offerPayload) => {
      // Relay events aren't replayed to late listeners, but hashing may still
      // be running, so queue offers instead of dropping the listener attach.
      if (!indexReadyRef.current) {
        offerQueueRef.current.push([fromPeerId, offerPayload])
        addLine(`Peer connected: ${fromPeerId.slice(0, 12)}... (waiting for indexing)`)
        return
      }
      handleOffer(fromPeerId, offerPayload)
    })
    addLine('Waiting for someone to join with your room code...')

    try {
      const index = await indexPromise
      setFileIndex(index)
      fileIdxRef.current = index
      await startSending(files[0], index, fileRefs)
      indexReadyRef.current = true
      addLine('Indexing complete — ready to serve chunks')
      const queued = offerQueueRef.current
      offerQueueRef.current = []
      for (const [fromPeerId, offerPayload] of queued) {
        handleOffer(fromPeerId, offerPayload)
      }
    } catch (e) {
      addLine(`Indexing error: ${e.message}`)
      useTransferStore.getState().setError(e.message)
    }
  }

  useEffect(() => {
    if (peers.length > 0) {
      addLine(`${peers.length} peer${peers.length > 1 ? 's' : ''} in room`)
    }
  }, [peers.length])

  useEffect(() => {
    if (st === 'transferring') navigate('/dashboard')
  }, [st, navigate])

  useEffect(() => {
    return () => M.stopSeederListener()
  }, [])

  useEffect(() => {
    if (st === 'complete') { addLine('All chunks sent and verified'); addLine('Transfer complete!') }
    else if (st === 'error') { addLine(`Error: ${useTransferStore.getState().error}`) }
  }, [st])

  async function handleCancel() {
    if (peers.length > 0) {
      const confirmed = await useConfirmStore.getState().confirm('Peers are still connected. Are you sure you want to stop seeding and close the room?', 'Stop Seeding')
      if (!confirmed) {
        return
      }
    }
    M.stopSeederListener()
    useSignalingStore.getState().disconnect()
    disconnectAll(); startRef.current = null; fileIdxRef.current = null
    M.streamHandle = null
    indexReadyRef.current = false
    offerQueueRef.current = []
    setSending(false)
    setPickedFiles(null)
    setFileIndex(null)
    setIndexProgress({ hashed: 0, total: 0 })
    setLines([])
  }

  const done = st === 'complete'
  const xfer = st === 'transferring'
  const hp = peers.length > 0
  const secs = startRef.current ? Math.floor((Date.now() - startRef.current) / 1000) : 0
  const uptime = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
  const pickedFileCount = pickedFiles?.files?.length || 0
  const pickedTotalSize = pickedFiles?.files?.reduce((s, f) => s + f.size, 0) || 0
  const fileCount = fileIndex?.files?.length || pickedFileCount || 1
  const totalSize = fileIndex?.fileSize ?? pickedTotalSize
  const displayName = fileIndex?.fileName || pickedFiles?.files?.[0]?.name

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

  if (st === 'reconnecting-sender') {
    return <SenderResumePrompt />
  }

  if (!sending) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--accent)]">Secure Peer-to-Peer</p>
        <h1 className="text-3xl font-bold text-[var(--txt-primary)]">Send a File</h1>
        <p className="mt-2 mb-8 text-base text-[var(--txt-secondary)]">
          Drop any file or folder below to start sharing. Mesh creates a private room and gives you a code — share it with anyone to begin the transfer.
        </p>

        {!pickedFiles ? (
          <FileDropZone onFilesSelected={handleFilesSelected} />
        ) : (
          <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-secondary)] p-5">
            <div className="flex items-center gap-3">
              <svg className="h-8 w-8 shrink-0 text-[var(--accent)]/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6" />
              </svg>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--txt-primary)]">
                  {pickedFileCount > 1 ? `${pickedFileCount} files` : pickedFiles.files[0].name}
                </p>
                <p className="text-xs text-[var(--txt-secondary)]">{(pickedTotalSize / 1e6).toFixed(1)} MB ready to send</p>
              </div>
            </div>
            <button
              onClick={handleChooseDifferent}
              className="mt-4 cursor-pointer text-xs font-medium text-[var(--txt-secondary)] underline-offset-2 hover:text-[var(--txt-primary)] hover:underline"
            >
              Choose a different file
            </button>
          </div>
        )}

        <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 shadow-sm">
          <label className="flex cursor-pointer items-center gap-3 select-none">
            <input
              type="checkbox"
              checked={usePassword}
              onChange={(e) => {
                setUsePassword(e.target.checked)
                if (!e.target.checked) setPassword('')
              }}
              className="h-4 w-4 rounded border-[var(--border-light)] text-[var(--accent)] focus:ring-[var(--accent)] focus:ring-offset-[var(--bg-primary)] bg-[var(--surface)] cursor-pointer"
            />
            <div>
              <p className="text-sm font-semibold text-[var(--txt-primary)]">Password Protect Room</p>
              <p className="text-xs text-[var(--txt-secondary)]">Require receivers to enter a password to join</p>
            </div>
          </label>

          <AnimatePresence>
            {usePassword && (
              <motion.div
                initial={{ height: 0, opacity: 0, marginTop: 0 }}
                animate={{ height: 'auto', opacity: 1, marginTop: 12 }}
                exit={{ height: 0, opacity: 0, marginTop: 0 }}
                className="overflow-hidden"
              >
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter room password"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 pr-10 text-sm text-[var(--txt-primary)] outline-none transition-colors focus:border-[var(--accent)]/50 placeholder:text-[var(--txt-muted)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--txt-secondary)] hover:text-[var(--txt-primary)]"
                  >
                    {showPass ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {pickedFiles && (
          <>
            <Button
              onClick={handleStartSending}
              disabled={usePassword && !password.trim()}
              className="mt-6 w-full"
            >
              Start Sending
            </Button>
            {usePassword && !password.trim() && (
              <p className="mt-2 text-center text-xs text-[var(--error)]">Enter a password or uncheck "Password Protect Room" to continue.</p>
            )}
          </>
        )}

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
          <Badge color="amber" dot>{fileCount > 1 ? `${fileCount} files` : displayName}</Badge>
          <span className="text-sm text-[var(--txt-secondary)]">{(totalSize / 1e6).toFixed(1)} MB</span>
          {fileIndex ? (
            <Badge color="gray" dot={false}>{fileIndex.totalChunks} chunks</Badge>
          ) : (
            <Badge color="gray" dot={false}>Indexing...</Badge>
          )}
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

      {!fileIndex && (
        <Card className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--txt-primary)]">Indexing & hashing chunks</span>
            <span className="font-mono text-sm text-[var(--txt-secondary)]">
              {indexProgress.total ? `${indexProgress.hashed.toLocaleString()} / ${indexProgress.total.toLocaleString()}` : 'Starting...'}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${indexProgress.total ? Math.min(100, (indexProgress.hashed / indexProgress.total) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--txt-dim)]">
            The room is already open — your peer can join now while chunks finish hashing in the background.
          </p>
        </Card>
      )}

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

      <div className="mt-8 flex flex-col gap-3 items-center border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-center sm:gap-5">
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
            className="w-full cursor-pointer rounded-md border border-[var(--border-light)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--txt-secondary)] transition-colors hover:border-[var(--error)]/30 hover:text-[var(--error)] sm:w-auto"
          >
            Cancel
          </button>
        )}
        {done && (
          <button
            onClick={handleCancel}
            className="w-full cursor-pointer rounded-md border border-[var(--border-light)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--txt-secondary)] transition-colors hover:border-[var(--accent)]/30 hover:text-[var(--accent)] sm:w-auto"
          >
            Send Another
          </button>
        )}
      </div>
    </div>
  )
}
