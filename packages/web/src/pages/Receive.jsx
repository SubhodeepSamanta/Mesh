import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import { transferManager as M } from '../lib/transferManager.js'
import { MSG } from '../webrtc/protocol.js'
import { motion, AnimatePresence } from 'framer-motion'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import Card from '../components/shared/Card.jsx'
import Accordion from '../components/shared/Accordion.jsx'
import ProgressBar from '../components/shared/ProgressBar.jsx'
import ConnectionCode from '../components/ConnectionCode.jsx'
import FileManifest from '../components/FileManifest.jsx'
import { useToastStore } from '../store/useToastStore.js'

export default function Receive() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)
  const [roomClosed, setRoomClosed] = useState(false)
  const [startingTransfer, setStartingTransfer] = useState(false)
  const downloadGuardRef = useRef(false)
  const mountedRef = useRef(true)

  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false)
  const [tempRoomCode, setTempRoomCode] = useState('')
  const [roomPassword, setRoomPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const joinRoom = useSignalingStore((s) => s.joinRoom)
  const roomCode = useSignalingStore((s) => s.roomCode)
  const signalingStatus = useSignalingStore((s) => s.status)
  const signalingPeers = useSignalingStore((s) => s.peers)

  const fileMeta = useTransferStore((s) => s.fileMeta)
  const status = useTransferStore((s) => s.status)
  const progress = useTransferStore((s) => s.progress)
  const saveMode = useTransferStore((s) => s.saveMode)
  const setSaveMode = useTransferStore((s) => s.setSaveMode)
  const setComplete = useTransferStore((s) => s.setComplete)
  const error = useTransferStore((s) => s.error)
  const role = useTransferStore((s) => s.role)

  const { startReceiving, addReceiverPeer, triggerDownload, resetDownload, disconnectAll, dialPeer } = useTransfer()

  const prefillCode = searchParams.get('code') || ''
  const activeReceiver = role === 'receiver'
  const displayRoomCode = activeReceiver ? roomCode : null
  const showFileMeta = !!fileMeta && activeReceiver

  async function handleJoin(code) {
    setJoining(true)
    setJoinError(null)
    try {
      const result = await joinRoom(code)
      if (!mountedRef.current) return
      useTransferStore.getState().setRoomCode(code.toUpperCase())
      useTransferStore.getState().startAsReceiver()
      
      if (result.existingPeers && result.existingPeers.length > 0) {
        await Promise.allSettled(
          result.existingPeers.map(peerId => dialPeer(peerId))
        )
      }
    } catch (err) {
      if (err.message === 'Incorrect room password') {
        setShowPasswordPrompt(true)
        setTempRoomCode(code)
      } else {
        setJoinError(err.message || 'Failed to join room')
      }
    } finally {
      setJoining(false)
    }
  }

  async function handleJoinWithPassword(e) {
    if (e) e.preventDefault()
    if (!roomPassword.trim()) return
    setJoining(true)
    setJoinError(null)
    try {
      const result = await joinRoom(tempRoomCode, roomPassword)
      if (!mountedRef.current) return
      setShowPasswordPrompt(false)
      setRoomPassword('')
      useTransferStore.getState().setRoomCode(tempRoomCode.toUpperCase())
      useTransferStore.getState().startAsReceiver()
      
      if (result.existingPeers && result.existingPeers.length > 0) {
        await Promise.allSettled(
          result.existingPeers.map(peerId => dialPeer(peerId))
        )
      }
    } catch (err) {
      setJoinError(err.message || 'Incorrect password')
    } finally {
      setJoining(false)
    }
  }

  function handleCancelPassword() {
    setShowPasswordPrompt(false)
    setTempRoomCode('')
    setRoomPassword('')
    setJoinError(null)
  }

  async function handleBeginTransfer() {
    if (!M.swarm || startingTransfer) return
    setStartingTransfer(true)
    const isFileSystemAccess = typeof window !== 'undefined' && (
      ('showDirectoryPicker' in window) || ('showSaveFilePicker' in window)
    )
    const meta = useTransferStore.getState().fileMeta
    if (meta && isFileSystemAccess && useTransferStore.getState().saveMode === 'auto') {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
        if (dirHandle) {
          M.streamHandle = { dirHandle }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          useToastStore.getState().addToast('Folder selection failed — files will be downloaded individually instead.', 'error')
        } else {
          useToastStore.getState().addToast('No folder selected — files will be kept in memory and downloaded at the end.', 'info')
        }
      }
    }
    for (const [id, transport] of M.transports) {
      if (M.swarm && transport.offeredRoot === M.swarm.merkleRoot) {
        addReceiverPeer(transport, M.swarm)
      }
    }
  }

  function handleRetry() {
    try { useSignalingStore.getState().disconnect() } catch {}
    disconnectAll()
    M.streamHandle = null
    downloadGuardRef.current = false
    setRoomClosed(false)
    navigate('/receive')
  }

  function handleDismiss() {
    handleRetry()
  }

  useEffect(() => {
    if (status === 'transferring') navigate('/dashboard')
  }, [status, navigate])

  const handleManualDownload = () => {
    resetDownload()
    triggerDownload()
  }

  useEffect(() => {
    if (!displayRoomCode) return
    const unsub = useSignalingStore.subscribe((s, prev) => {
      if (prev.peers.length > 0 && s.peers.length === 0 && status !== 'complete') {
        setRoomClosed(true)
      }
      if (s.peers.length > prev.peers.length) {
        const newPeerIds = s.peers.filter(p => !prev.peers.includes(p))
        for (const peerId of newPeerIds) {
          dialPeer(peerId)
        }
      }
    })

    // A dropped signaling socket doesn't mean the room is gone — the client retries
    // and rejoins in the background (WebRTC data channels don't need it to stay open).
    // Only give up once the client itself reports the rejoin failed or is exhausted.
    const client = useSignalingStore.getState().client
    const handleReconnectFailed = () => {
      if (status !== 'complete') setRoomClosed(true)
    }
    const handleReconnect = () => setRoomClosed(false)
    if (client) {
      client.addEventListener('reconnectFailed', handleReconnectFailed)
      client.addEventListener('reconnect', handleReconnect)
    }

    return () => {
      unsub()
      if (client) {
        client.removeEventListener('reconnectFailed', handleReconnectFailed)
        client.removeEventListener('reconnect', handleReconnect)
      }
    }
  }, [displayRoomCode, status, dialPeer])



  const accordionsBefore = (
    <div className="mt-8 space-y-2">
      <Accordion title="How to receive a file">
        <ol className="list-inside list-decimal space-y-1.5">
          <li>Ask the sender for their room code (a 4-character case-insensitive code like <span className="font-mono text-[var(--txt-primary)]">WLF4</span>).</li>
          <li>Type it in above, or scan the QR code directly from their screen.</li>
          <li>Once linked, your browser connects directly to theirs — no middlemen.</li>
          <li>When they send a file offer, review what's being shared and hit "Begin Transfer".</li>
          <li>Your browser downloads chunks, verifies each one, and saves the file.</li>
        </ol>
      </Accordion>
      <Accordion title="Is it secure?">
        <p>Yes. The signaling server only helps establish the connection — it never sees your data. After that, everything flows through a direct encrypted channel between browsers.</p>
        <ul className="mt-2 space-y-1">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">Direct peer-to-peer</strong> — no data touches any server</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">Encrypted in transit</strong> via WebRTC DTLS (same encryption as HTTPS)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--success)]" />
            <span><strong className="text-[var(--txt-primary)]">Integrity checked</strong> — every chunk is verified against a Merkle tree</span>
          </li>
        </ul>
      </Accordion>
      <Accordion title="QR scanning tips">
        <p>Click the QR icon in the input field to open your camera. Point it at the sender's QR code — the room code fills in automatically.</p>
        <p className="mt-2 text-xs text-[var(--txt-dim)]">Works best on devices with rear-facing cameras. If the scanner doesn't start, you can always type the code manually.</p>
      </Accordion>
    </div>
  )

  const accordionsAfter = (
    <div className="mt-6 space-y-2">
      <Accordion title="What happens next?" defaultOpen>
        <p>You're linked to the sender and waiting for them to offer a file. As soon as they do, you'll see the file details here. You can then choose to begin receiving.</p>
        <p className="mt-2 text-xs text-[var(--txt-dim)]">Make sure both browsers stay open and connected. If the connection drops, you'll need a new room code.</p>
      </Accordion>
    </div>
  )

  const accordionsTransfer = (
    <div className="mt-6 space-y-2">
      <Accordion title="What's happening right now?">
        <p>Your browser is downloading chunks from the sender. Each chunk is checked against the file's Merkle tree to make sure it hasn't been tampered with. Once all chunks arrive and verify, the file is reconstructed and saved.</p>
        <p className="mt-2 text-xs text-[var(--txt-dim)]">For larger files, you may be asked where to save — this lets the browser stream data directly to disk instead of holding it all in memory.</p>
      </Accordion>
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`mx-auto min-h-[calc(100vh-4rem)] px-6 ${
        showFileMeta ? 'py-12 lg:flex lg:flex-row lg:gap-8 max-w-6xl' : 'max-w-2xl pt-16 pb-8'
      }`}
    >
      <div className={`flex flex-col gap-6 ${showFileMeta ? 'lg:w-[35%]' : 'w-full'}`}>
        <div>
          <p className="mb-1 text-xs uppercase tracking-widest text-[var(--accent)]">Secure Peer-to-Peer</p>
          <h1 className="text-3xl font-bold text-[var(--txt-primary)]">Receive a File</h1>
          <p className="mt-2 text-base text-[var(--txt-secondary)]">
            {!showFileMeta
              ? 'Enter the room code from the sender to link up. Once connected, you can download files directly from their browser — no servers involved.'
              : fileMeta?.fileName
                ? `Ready to receive "${fileMeta.fileName}"`
                : 'You\'ve linked to the sender. Waiting for them to offer a file...'}
          </p>
        </div>

        {!displayRoomCode && !showFileMeta && (
          <>
            {showPasswordPrompt ? (
              <form onSubmit={handleJoinWithPassword} className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="flex items-center gap-2 text-[var(--accent)] mb-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span className="text-xs uppercase font-bold tracking-wider">Password Protected Room</span>
                </div>
                <p className="text-sm text-[var(--txt-secondary)]">
                  Enter the password to connect to room <span className="font-mono font-semibold text-[var(--txt-primary)]">{tempRoomCode.toUpperCase()}</span>.
                </p>
                <div className="relative mt-1">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value)}
                    placeholder="Room password"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 pr-10 font-mono text-lg tracking-widest text-[var(--txt-primary)] placeholder:text-[var(--txt-secondary)] outline-none transition-colors focus:border-[var(--accent)]/50"
                    maxLength={100}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--txt-secondary)] hover:text-[var(--txt-primary)]"
                  >
                    {showPass ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="flex gap-2 mt-2">
                  <Button type="button" onClick={handleCancelPassword} variant="secondary" className="flex-1">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={joining || !roomPassword.trim()} className="flex-1">
                    {joining ? 'Connecting...' : 'Connect'}
                  </Button>
                </div>
              </form>
            ) : (
              <ConnectionCode onJoin={handleJoin} joining={joining} defaultValue={prefillCode} />
            )}
            <AnimatePresence>
              {joinError && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="flex items-center gap-2 rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-4 py-3">
                  <svg className="h-4 w-4 shrink-0 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-[var(--error)]">{joinError}</p>
                </motion.div>
              )}
              {joining && (
                <div className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/10 bg-[var(--accent)]/5 px-4 py-3">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                  <span className="text-xs text-[var(--accent)]/80">Joining room...</span>
                </div>
              )}
            </AnimatePresence>
          </>
        )}

        {displayRoomCode && !showFileMeta && (
          <>
            <AnimatePresence>
              {roomClosed && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-4 py-4 text-center">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--error)]/10">
                      <svg className="h-5 w-5 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-[var(--error)]">Connection Lost</p>
                    <p className="mt-1 text-xs text-[var(--error)]/70">The sender has disconnected or the room was closed.</p>
                    <button onClick={handleDismiss} className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--error)]/20 px-3 py-1.5 text-xs font-medium text-[var(--error)] transition-colors hover:bg-[var(--error)]/5">
                      Leave Room
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Card className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color="green" dot>LINK ESTABLISHED</Badge>
                  <span className="text-xs text-[var(--txt-secondary)]">via relay</span>
                </div>
                <button onClick={handleDismiss} className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[var(--border-light)] px-2.5 py-1.5 text-xs font-medium text-[var(--txt-secondary)] transition-colors hover:border-[var(--error)]/40 hover:text-[var(--error)] hover:bg-[var(--error)]/5 w-full sm:w-auto">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Dismiss
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--success)]/10">
                  <svg className="h-5 w-5 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--txt-primary)]">Connected to room</p>
                  <p className="font-mono text-xs text-[var(--txt-dim)]">{displayRoomCode}</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-[var(--txt-secondary)]">
                You're in the room. Once the sender offers a file, you'll see the details and can start the transfer. No action needed right now.
              </p>
            </Card>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/10 bg-[var(--accent)]/5 px-4 py-3">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
              <span className="text-xs text-[var(--accent)]/80">Listening for file offer...</span>
            </div>
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-4 py-3">
                <svg className="h-4 w-4 shrink-0 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-[var(--error)]">{error}</p>
              </div>
            )}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="mb-2 text-xs uppercase tracking-widest text-[var(--txt-secondary)]">Save preference</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => setSaveMode('auto')}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                    saveMode === 'auto'
                      ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                      Specific folder
                    </button>
                <button
                  onClick={() => setSaveMode('files')}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                    saveMode === 'files'
                      ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Files
                </button>
              </div>
              <p className="mt-2 text-xs text-[var(--txt-secondary)]">
                {saveMode === 'auto' ? 'Saved to a folder you pick — all files together in one place' : 'Each file downloaded individually to your default downloads location'}
              </p>
            </div>
            {accordionsAfter}
          </>
        )}
      </div>

      {showFileMeta && (
        <div className={`flex-1 ${displayRoomCode ? 'lg:w-[65%]' : ''}`}>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
          >
            <AnimatePresence>
              {roomClosed && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-4 py-4 text-center">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--error)]/10">
                      <svg className="h-5 w-5 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-[var(--error)]">Connection Lost</p>
                    <p className="mt-1 text-xs text-[var(--error)]/70">The sender has disconnected or the room was closed.</p>
                    <button onClick={handleDismiss} className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--error)]/20 px-3 py-1.5 text-xs font-medium text-[var(--error)] transition-colors hover:bg-[var(--error)]/5">
                      Leave Room
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <Badge color={status === 'complete' ? 'green' : 'amber'} dot>
                  {status === 'complete' ? 'RECEIVED' : status === 'transferring' ? 'DOWNLOADING' : 'OFFERED'}
                </Badge>
                <span className="text-xs text-[var(--txt-secondary)]">
                  {status === 'complete' ? 'Done!' : status === 'transferring' ? 'In progress' : 'Review and accept'}
                </span>
              </div>
              <FileManifest fileMeta={fileMeta} />
            </Card>

            {status === 'file-offered' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                  <p className="mb-2 text-xs uppercase tracking-widest text-[var(--txt-secondary)]">Save as</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={() => setSaveMode('auto')}
                      className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                        saveMode === 'auto'
                          ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)]'
                      }`}
                    >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Specific folder
                    </button>
                    <button
                      onClick={() => setSaveMode('files')}
                      className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                        saveMode === 'files'
                          ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)]'
                      }`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Files
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-[var(--txt-secondary)]">
                    {saveMode === 'auto'
                      ? 'Saved to a folder you pick — all files together in one place'
                      : 'Each file downloaded individually to your default downloads location'}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                  <Button onClick={handleBeginTransfer} disabled={startingTransfer} className="w-full py-3.5 text-sm font-bold tracking-widest uppercase">
                    {startingTransfer ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Starting…
                      </span>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Begin Transfer
                      </>
                    )}
                  </Button>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-[var(--txt-dim)]">Files transferred directly peer-to-peer. Browser must stay open.</p>
                    <button onClick={handleDismiss} className="flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[var(--border-light)] px-2.5 py-1.5 text-xs font-medium text-[var(--txt-secondary)] transition-colors hover:border-[var(--error)]/40 hover:text-[var(--error)] hover:bg-[var(--error)]/5 w-full sm:w-auto">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            {status === 'transferring' && (
              <Card className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                    <span className="text-sm font-medium text-[var(--txt-primary)]">Downloading...</span>
                  </div>
                  <span className="font-mono text-sm text-[var(--txt-dim)]">
                    {progress.verified} / {progress.total} chunks
                  </span>
                </div>
                <ProgressBar percent={progress.percent || 0} />
                <p className="text-xs text-[var(--txt-dim)]">
                  Each chunk is verified against the Merkle tree before being accepted.
                </p>
              </Card>
            )}

            {status === 'complete' && (
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                className="rounded-lg border border-[var(--success)]/20 bg-[var(--success)]/5 px-6 py-5 text-center"
              >
                <svg className="mx-auto mb-2 h-8 w-8 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-lg font-medium text-[var(--success)]">Download Complete</p>
                <p className="mt-1 text-sm text-[var(--success)]/60">{progress.verified} chunks verified and saved</p>
                <p className="mt-3 text-xs text-[var(--txt-dim)]">
                  File has been saved to your downloads. You can also manually trigger download if needed.
                </p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:gap-3">
                  <Button onClick={handleManualDownload} variant="secondary" className="flex-1 py-3 text-sm font-semibold">
                    REDOWNLOAD FILE
                  </Button>
                  <Button onClick={handleDismiss} variant="primary" className="flex-1 py-3 text-sm font-semibold">
                    RECEIVE ANOTHER FILE
                  </Button>
                </div>
              </motion.div>
            )}

            {status === 'error' && (
              <Card className="border-[var(--error)]/20 bg-[var(--error)]/5 text-center">
                <svg className="mx-auto mb-2 h-8 w-8 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-lg font-medium text-[var(--error)]">Transfer Failed</p>
                <p className="mt-1 text-sm text-[var(--error)]/60">Something went wrong — the connection may have dropped or a chunk failed verification.</p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:gap-3">
                  <Button onClick={handleRetry} variant="secondary" className="flex-1 py-3 text-sm font-semibold">
                    TRY AGAIN
                  </Button>
                  <Button onClick={handleDismiss} variant="primary" className="flex-1 py-3 text-sm font-semibold">
                    RECEIVE ANOTHER FILE
                  </Button>
                </div>
              </Card>
            )}

            {status === 'transferring' && accordionsTransfer}

            {status === 'file-offered' && (
              <div className="space-y-2">
                <Accordion title="What am I agreeing to?">
                  <p>By clicking Begin Transfer, your browser will receive encrypted chunks directly from the sender. Each chunk is verified for integrity. Once all chunks arrive, the file is reconstructed and saved automatically.</p>
                  <p className="mt-2 text-xs text-[var(--txt-dim)]">The sender will see that you've started receiving. You can close your browser at any time to cancel.</p>
                </Accordion>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {!displayRoomCode && !showFileMeta && accordionsBefore}
    </motion.div>
  )
}
