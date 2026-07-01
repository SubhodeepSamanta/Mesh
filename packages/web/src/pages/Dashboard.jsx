import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { transferManager as M } from '../lib/transferManager.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import Card from '../components/shared/Card.jsx'
import PeerList from '../components/PeerList.jsx'
import ChunkGrid from '../components/ChunkGrid.jsx'
import SpeedChart from '../components/SpeedChart.jsx'
import PeerGraph from '../components/PeerGraph.jsx'
import { formatEta } from '../lib/format.js'

export default function Dashboard() {
  const navigate = useNavigate()
  const roomCode = useSignalingStore((s) => s.roomCode)
  const { role, peerStats, chunkStates, speedHistory, status, fileMeta, progress, seeding } = useTransferStore()
  const { disconnectAll, triggerDownload, stopSeeding, resumeSeeding, addSenderPeer } = useTransfer()
  const downloadFired = useRef(false)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (status === 'idle') navigate('/', { replace: true })
  }, [status])

  useEffect(() => {
    if (status === 'transferring' && !startRef.current) {
      startRef.current = Date.now()
    }
    if (status === 'transferring') {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      }, 1000)
    }
    if (status === 'complete' || status === 'idle' || status === 'error') {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [status])

  useEffect(() => {
    if (status === 'idle') {
      startRef.current = null
      setElapsed(0)
    }
  }, [status])

  useEffect(() => {
    if (status === 'complete' && role === 'receiver' && !downloadFired.current) {
      downloadFired.current = true
      triggerDownload()
    }
  }, [status, role, triggerDownload])

  useEffect(() => {
    const c = useSignalingStore.getState().client
    if (!c || !fileMeta) return
    const hasData = M.indexRef || (M.receivedMeta && M.chunks.length > 0)
    if (!hasData) return
    const idx = M.indexRef || {
      totalChunks: M.receivedMeta.totalChunks,
      chunkSize: M.receivedMeta.chunkSize,
      merkleRoot: M.receivedMeta.merkleRoot,
      files: M.receivedMeta.files,
      fileName: fileMeta.fileName,
      fileSize: fileMeta.fileSize,
    }
    M.startSeederListener(c, (fromPeerId) => {
      if (M.transports.has(fromPeerId)) return
      const t = new WebRTCTransport(c, fromPeerId, { initiator: false })
      t.connect().then(() => addSenderPeer(t, idx)).catch(() => {})
    })
    return () => M.stopSeederListener()
  }, [fileMeta, addSenderPeer])

  const handleDismiss = useCallback(() => {
    const currentStatus = useTransferStore.getState().status
    if (currentStatus !== 'complete' && currentStatus !== 'error') {
      if (!window.confirm('Active transfer in progress. Are you sure you want to abort?')) {
        return
      }
    }
    const currentRole = useTransferStore.getState().role
    M.stopSeederListener()
    try {
      const signal = useSignalingStore.getState()
      if (signal.client) signal.disconnect()
    } catch {}
    try { disconnectAll() } catch {}
    startRef.current = null
    setElapsed(0)
    navigate(currentRole === 'sender' ? '/send' : '/receive')
  }, [disconnectAll, navigate])

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const fileCount = fileMeta?.files?.length || 1
  const totalChunks = progress.total || 0
  const verifiedChunks = progress.verified || 0
  const percent = totalChunks > 0 ? (verifiedChunks / totalChunks) * 100 : 0
  const speed = speedHistory.length > 0 ? speedHistory[speedHistory.length - 1].mbps || 0 : 0
  const done = status === 'complete' || status === 'error'

  const bytesRemaining = fileMeta ? Math.max(0, fileMeta.fileSize - (verifiedChunks * (fileMeta.chunkSize || 65536))) : 0
  const eta = formatEta(bytesRemaining, speed)

  if (status === 'idle') {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-8 py-16">
          <svg className="mb-4 h-12 w-12 text-[var(--txt-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <p className="text-lg font-medium text-[var(--txt-primary)]">No Active Transfer</p>
          <p className="mt-1 text-sm text-[var(--txt-secondary)] text-center max-w-sm">
            Start a new transfer from the Send page, or join one from the Receive page.
          </p>
          <div className="mt-6 flex gap-3">
            <Button variant="primary" onClick={() => navigate('/send')}>
              SEND A FILE
            </Button>
            <Button variant="secondary" onClick={() => navigate('/receive')}>
              RECEIVE
            </Button>
          </div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Card className="text-center">
            <p className="text-2xl font-bold text-[var(--accent)]">0</p>
            <p className="mt-1 text-xs text-[var(--txt-secondary)] uppercase tracking-wider">Active Transfers</p>
          </Card>
          <Card className="text-center">
            <p className="text-2xl font-bold text-[var(--txt-primary)]">—</p>
            <p className="mt-1 text-xs text-[var(--txt-secondary)] uppercase tracking-wider">Peers Connected</p>
          </Card>
          <Card className="text-center">
            <p className="text-2xl font-bold text-[var(--txt-primary)]">—</p>
            <p className="mt-1 text-xs text-[var(--txt-secondary)] uppercase tracking-wider">Data Transferred</p>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-4">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-wider text-[var(--accent)]">mesh</span>
          <Badge color="amber">{roomCode || '\u2014\u2014'}</Badge>
          {fileMeta && (
            <span className="hidden items-center gap-2 text-sm sm:flex">
              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                role === 'sender' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-[var(--success)]/10 text-[var(--success)]'
              }`}>
                {role === 'sender' ? 'SENDER' : 'RECEIVER'}
              </span>
              <span className="text-[var(--txt-secondary)]">{fileMeta.fileName} · {fileCount} file{fileCount > 1 ? 's' : ''}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-2xl font-bold tracking-wider text-[var(--txt-primary)]">{mmss}</span>
          <div className="hidden items-center gap-1.5 text-xs text-[var(--txt-secondary)] sm:flex">
            <span>{verifiedChunks}/{totalChunks} chunks</span>
            <span className="text-[var(--txt-dim)]">·</span>
            <span className={speed > 0 ? 'text-[var(--accent)]' : ''}>{speed.toFixed(1)} MB/s</span>
            {status === 'transferring' && speed > 0 && (
              <>
                <span className="text-[var(--txt-dim)]">·</span>
                <span>ETA: {eta}</span>
              </>
            )}
          </div>
          {(status === 'transferring' || status === 'complete') && (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="secondary"
                disabled={role === 'receiver' && M.receivedMeta?.tree == null}
                onClick={seeding ? stopSeeding : resumeSeeding}
              >
                {seeding ? 'STOP SEED' : 'RESUME SEED'}
              </Button>
              {role === 'receiver' && M.receivedMeta?.tree == null && (
                <span className="text-[10px] text-[var(--txt-secondary)]">Seeding disabled for streamed folders</span>
              )}
            </div>
          )}
          <Button variant={done ? 'primary' : 'danger'} onClick={handleDismiss}>
            {done ? 'DISMISS' : 'ABORT'}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 lg:flex-row">
        <div className="w-full shrink-0 lg:w-80">
          <Card className="h-full">
            <PeerList peerStats={peerStats} />
            <div className="mt-4 border-t border-[var(--border)] pt-4 space-y-3">
              <div className="space-y-2 text-xs text-[var(--txt-secondary)]">
                <div className="flex justify-between">
                  <span>Role</span>
                  <span className={`font-mono ${role === 'sender' ? 'text-[var(--accent)]' : 'text-[var(--success)]'}`}>
                    {role === 'sender' ? 'Seeder' : 'Leecher'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Files</span>
                  <span className="font-mono text-[var(--txt-primary)]">{fileCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Size</span>
                  <span className="font-mono text-[var(--txt-primary)]">{fileMeta ? (fileMeta.fileSize / 1e6).toFixed(1) : '—'} MB</span>
                </div>
                <div className="flex justify-between">
                  <span>Chunks</span>
                  <span className="font-mono text-[var(--txt-primary)]">{totalChunks}</span>
                </div>
                <div className="flex justify-between">
                  <span>Speed</span>
                  <span className="font-mono text-[var(--accent)]">{speed.toFixed(1)} MB/s</span>
                </div>
                {status === 'transferring' && (
                  <div className="flex justify-between">
                    <span>ETA</span>
                    <span className="font-mono text-[var(--txt-primary)]">{eta}</span>
                  </div>
                )}
              </div>
              <div className="border-t border-[var(--border)] pt-3 space-y-1.5 text-[10px] leading-relaxed text-[var(--txt-muted)]">
                <p>🔐 <span className="text-[var(--txt-secondary)]">DTLS 1.3 encrypted · P2P channel</span></p>
                <p>🧩 <span className="text-[var(--txt-secondary)]">{fileMeta?.chunkSize || '—'} bytes per chunk · Merkle verified</span></p>
                <p>📡 <span className="text-[var(--txt-secondary)]">{roomCode ? `Room ${roomCode}` : 'Direct connection'}</span></p>
                {verifiedChunks > 0 && (
                  <p>📊 <span className="text-[var(--txt-secondary)]">{((verifiedChunks * (fileMeta?.chunkSize || 0)) / 1e6).toFixed(1)} MB verified so far</span></p>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-1 flex-col gap-4 min-w-0">
          <Card role="status" aria-live="polite">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-[var(--txt-secondary)]">
                {role === 'sender' ? 'Upload Progress' : 'Download Progress'}
              </span>
              <span className="font-mono text-sm font-bold text-[var(--accent)]">{Math.round(percent)}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-500 ease-out"
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-[var(--txt-muted)]">
              <span>0%</span>
              <span>{verifiedChunks} / {totalChunks} chunks</span>
              <span>100%</span>
            </div>
          </Card>

          <div className="hidden lg:block">
            <ChunkGrid chunkStates={chunkStates} transferStatus={status} />
          </div>

          <Card className="flex-1">
            <PeerGraph className="h-80 w-full" chunkStates={chunkStates} role={role} peerStats={peerStats} seeding={seeding} />
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--txt-secondary)]">
              {role === 'sender' ? (
                <>
                  <span>
                    SENT:{' '}
                    <span className="font-mono text-[var(--accent)]">{verifiedChunks}</span>
                    <span className="text-[var(--txt-dim)]"> / {totalChunks} chunks</span>
                  </span>
                  <span>
                    SEEDING:{' '}
                    <span className={`font-mono ${seeding ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                      {seeding ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span>
                    RECEIVED:{' '}
                    <span className="font-mono text-[var(--success)]">{verifiedChunks}</span>
                    <span className="text-[var(--txt-dim)]"> / {totalChunks} chunks</span>
                  </span>
                  <span>
                    FILES:{' '}
                    <span className="font-mono text-[var(--accent)]">{fileCount}</span>
                  </span>
                </>
              )}
              <span>
                PEERS:{' '}
                <span className="font-mono text-[var(--accent)]">{peerStats.length}</span>
              </span>
              <span>
                SIZE:{' '}
                <span className="font-mono text-[var(--txt-primary)]">
                  {fileMeta ? (fileMeta.fileSize / 1e6).toFixed(1) : 0} MB
                </span>
              </span>
            </div>
          </Card>

          <SpeedChart data={speedHistory} peerCount={peerStats.length} />
        </div>
      </div>
    </div>
  )
}
