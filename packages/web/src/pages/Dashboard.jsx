import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
import ExtraBatches from '../components/ExtraBatches.jsx'
import FileManifest from '../components/FileManifest.jsx'
import SenderResumePrompt from '../components/SenderResumePrompt.jsx'
import { formatEta } from '../lib/format.js'
import { useConfirmStore } from '../store/useConfirmStore.js'
import { looksLikeVideo } from '../lib/videoFormat.js'
import VideoPlayerModal from '../components/VideoPlayerModal.jsx'

export default function Dashboard() {
  const navigate = useNavigate()
  const roomCode = useSignalingStore((s) => s.roomCode)
  const { role, peerStats, chunkStates, speedHistory, status, fileMeta, progress, seeding, canReseed, extraBatches, downloadedPaths } = useTransferStore()
  const { disconnectAll, triggerDownload, redownloadFile, resetDownload, stopSeeding, resumeSeeding, addSenderPeer, addFilesToSession, acceptBatchOffer, declineBatchOffer, triggerBatchDownload } = useTransfer()
  const downloadFired = useRef(false)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(null)
  const timerRef = useRef(null)
  const [playingFile, setPlayingFile] = useState(null)

  const videoFile = useMemo(() => {
    if (!fileMeta) return null
    if (fileMeta.files) {
      const found = fileMeta.files.find(f => looksLikeVideo(f.name))
      if (found) {
        return {
          path: found.path,
          name: found.name,
          size: found.size,
          startChunk: found.startChunk,
          chunkCount: found.chunkCount
        }
      }
    } else if (looksLikeVideo(fileMeta.fileName)) {
      return {
        path: fileMeta.fileName,
        name: fileMeta.fileName,
        size: fileMeta.fileSize,
        startChunk: 0,
        chunkCount: fileMeta.totalChunks || 0
      }
    }
    return null
  }, [fileMeta])

  useEffect(() => {
    if (status === 'idle') navigate('/', { replace: true })
  }, [])

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
    if (status === 'complete' && role === 'receiver' && !M.autoDownloaded) {
      M.autoDownloaded = true
      triggerDownload()
    }
  }, [status, role, triggerDownload])

  const handleManualDownload = () => {
    resetDownload()
    triggerDownload()
  }

  useEffect(() => {
    const c = useSignalingStore.getState().client
    if (!c || !fileMeta || !seeding) {
      M.stopSeederListener()
      return
    }
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
    M.startSeederListener(c, (fromPeerId, offerPayload) => {
      if (M.transports.has(fromPeerId)) return
      let t
      try {
        t = new WebRTCTransport(c, fromPeerId, { initiator: false })
      } catch (e) {
        console.warn(`[mesh] failed to construct a reseed transport for ${fromPeerId}:`, e)
        return
      }
      t.connect(offerPayload).then(() => addSenderPeer(t, idx)).catch((e) => {
        console.warn(`[mesh] reseed connection to ${fromPeerId} failed:`, e)
      })
    })
    return () => M.stopSeederListener()
  }, [fileMeta, seeding, addSenderPeer])

  const handleDismiss = useCallback(async () => {
    const currentStatus = useTransferStore.getState().status
    if (currentStatus !== 'complete' && currentStatus !== 'error') {
      const confirmed = await useConfirmStore.getState().confirm('Active transfer in progress. Are you sure you want to abort?', 'Abort Transfer')
      if (!confirmed) return
    }
    const currentRole = useTransferStore.getState().role
    const target = currentRole === 'sender' ? '/send' : '/receive'
    
    M.stopSeederListener()
    try {
      const signal = useSignalingStore.getState()
      if (signal.client) signal.disconnect()
    } catch {}
    try { disconnectAll() } catch {}
    startRef.current = null
    setElapsed(0)
    navigate(target)
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

  if (status === 'reconnecting') {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-8 py-16">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]" />
          <p className="text-lg font-medium text-[var(--txt-primary)]">Reconnecting...</p>
          <p className="mt-1 text-sm text-[var(--txt-secondary)] text-center max-w-sm">
            {fileMeta?.fileName ? `Rejoining the room to resume "${fileMeta.fileName}".` : 'Rejoining the room to resume your transfer.'} The transfer will restart from the beginning.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'reconnecting-sender') {
    return <SenderResumePrompt />
  }

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
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
        {/* Left Side: Logo, Room Code, File Details */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 min-w-0 flex-1">
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-lg font-bold tracking-wider text-[var(--accent)]">mesh</span>
            <Badge color="amber">{roomCode || '\u2014\u2014'}</Badge>
            {/* Mobile-only role badge */}
            {fileMeta && (
              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:hidden ${
                role === 'sender' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-[var(--success)]/10 text-[var(--success)]'
              }`}>
                {role === 'sender' ? 'SENDER' : 'RECEIVER'}
              </span>
            )}
          </div>
          {fileMeta && (
            <div className="flex items-center gap-2 text-xs text-[var(--txt-secondary)] sm:text-sm min-w-0">
              <span className={`hidden rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:inline-block shrink-0 ${
                role === 'sender' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-[var(--success)]/10 text-[var(--success)]'
              }`}>
                {role === 'sender' ? 'SENDER' : 'RECEIVER'}
              </span>
              <span className="truncate max-w-[120px] sm:max-w-[200px] md:max-w-[280px] lg:max-w-[360px]" title={fileMeta.fileName}>
                {fileMeta.fileName} · {fileCount} file{fileCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Right Side: Timer, Speed/Chunk stats, Action Buttons */}
        <div className="flex flex-col gap-3 w-full sm:flex-row sm:items-center sm:justify-end sm:gap-4 sm:w-auto">
          {/* Stats & Timer Row */}
          <div className="flex items-center justify-between gap-4 w-full sm:w-auto">
            <span className="font-mono text-2xl font-bold tracking-wider text-[var(--txt-primary)]">{mmss}</span>
            <div className="flex items-center gap-1.5 text-xs text-[var(--txt-secondary)]">
              <span>{verifiedChunks}/{totalChunks} chunks</span>
              <span className="text-[var(--txt-dim)]">·</span>
              <span className={speed > 0 ? 'text-[var(--accent)]' : ''}>{speed.toFixed(1)} MB/s</span>
            </div>
          </div>

          {/* Action Buttons Container */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {role === 'receiver' && videoFile && (
              <Button
                variant="primary"
                onClick={() => setPlayingFile(videoFile)}
                className="flex-1 px-3 py-2 text-xs sm:flex-initial sm:px-5 sm:py-2.5 sm:text-sm"
              >
                {status === 'complete' ? 'PLAY VIDEO' : 'STREAM VIDEO'}
              </Button>
            )}
            {status === 'complete' && role === 'receiver' && (
              <Button
                variant="secondary"
                onClick={handleManualDownload}
                className="flex-1 px-3 py-2 text-xs sm:flex-initial sm:px-5 sm:py-2.5 sm:text-sm"
              >
                REDOWNLOAD
              </Button>
            )}
            {(status === 'transferring' || status === 'complete') && (
              <div className="flex flex-col items-end gap-1 flex-1 sm:flex-initial">
                <Button
                  variant="secondary"
                  disabled={role === 'receiver' && !canReseed}
                  onClick={seeding ? stopSeeding : resumeSeeding}
                  className="w-full px-3 py-2 text-xs sm:w-auto sm:px-5 sm:py-2.5 sm:text-sm"
                >
                  {seeding ? 'STOP SEED' : 'RESUME SEED'}
                </Button>
                {role === 'receiver' && !canReseed && (
                  <span className="hidden text-[10px] text-[var(--txt-secondary)] sm:inline">Seeding disabled for streamed folders</span>
                )}
              </div>
            )}
            <Button
              variant={done ? 'primary' : 'danger'}
              onClick={handleDismiss}
              className="flex-1 px-3 py-2 text-xs sm:flex-initial sm:px-5 sm:py-2.5 sm:text-sm"
            >
              {done ? 'DISMISS' : 'ABORT'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 lg:flex-row">
        <div className="w-full shrink-0 lg:w-80">
          <Card className="h-full">
            <PeerList peerStats={peerStats} />
            <div className="mt-4 border-t border-[var(--border)] pt-4 space-y-3">
              <div className="space-y-2 text-sm text-[var(--txt-secondary)]">
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
              <div className="border-t border-[var(--border)] pt-3 space-y-1.5 text-xs leading-relaxed text-[var(--txt-muted)]">
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

          {role === 'receiver' && fileMeta && (status === 'transferring' || status === 'complete') && (
            <FileManifest
              fileMeta={fileMeta}
              selectable={false}
              deselectedPaths={M.excludedPaths}
              downloadedPaths={new Set(downloadedPaths)}
              onRedownloadFile={redownloadFile}
            />
          )}

          {(status === 'transferring' || status === 'complete') && (
            <ExtraBatches
              role={role}
              extraBatches={extraBatches}
              acceptBatchOffer={acceptBatchOffer}
              declineBatchOffer={declineBatchOffer}
              triggerBatchDownload={triggerBatchDownload}
              addFilesToSession={addFilesToSession}
            />
          )}

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
      {playingFile && (
        <VideoPlayerModal fileEntry={playingFile} onClose={() => setPlayingFile(null)} />
      )}
    </div>
  )
}
