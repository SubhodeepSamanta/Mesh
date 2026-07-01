import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import Card from '../components/shared/Card.jsx'
import PeerList from '../components/PeerList.jsx'
import ChunkGrid from '../components/ChunkGrid.jsx'
import SpeedChart from '../components/SpeedChart.jsx'
import PeerGraph from '../components/PeerGraph.jsx'

export default function Dashboard() {
  const navigate = useNavigate()
  const roomCode = useSignalingStore((s) => s.roomCode)
  const { role, peerStats, chunkStates, speedHistory, status } = useTransferStore()
  const { disconnectAll, triggerDownload } = useTransfer()
  const downloadFired = useRef(false)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (status !== 'idle') return
    try {
      const raw = localStorage.getItem('mesh-transfer-state')
      if (!raw) return
      const saved = JSON.parse(raw)
      if (!saved || !saved.fileMeta || saved.status === 'idle') return
      const store = useTransferStore.getState()
      if (store.status !== 'idle') return
      const chunks = saved.progress?.total ? new Array(saved.progress.total).fill('pending') : []
      if (saved.progress?.verified > 0) {
        for (let i = 0; i < saved.progress.verified && i < chunks.length; i++) chunks[i] = 'verified'
      }
      useTransferStore.setState({ ...saved, chunkStates: chunks })
    } catch {}
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

  const handleAbort = useCallback(() => {
    try {
      const signal = useSignalingStore.getState()
      if (signal.client) signal.disconnect()
    } catch {}
    try { disconnectAll() } catch {}
    startRef.current = null
    setElapsed(0)
    navigate('/')
  }, [disconnectAll, navigate])

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  if (status === 'idle') {
    return (
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col items-center justify-center py-24">
          <p className="text-lg text-[var(--txt-secondary)]">No active transfer</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/')}>
            Back to Home
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-6">
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-4">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-wider text-amber-400">mesh</span>
          <Badge color="amber">{roomCode || '\u2014\u2014'}</Badge>
        </div>
        <div className="flex items-center gap-5">
          <span className="font-mono text-2xl font-bold tracking-wider text-[var(--txt-primary)]">{mmss}</span>
          <Button variant={status === 'complete' || status === 'error' ? 'ghost' : 'danger'} onClick={handleAbort}>
            {status === 'complete' || status === 'error' ? 'Dismiss' : 'Abort'}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-6">
        <div className="w-80 shrink-0">
          <Card className="h-full">
            <PeerList peerStats={peerStats} />
          </Card>
        </div>

        <div className="flex flex-1 flex-col gap-6">
          <ChunkGrid chunkStates={chunkStates} transferStatus={status} />

          <Card className="flex-1">
            <PeerGraph className="h-96 w-full" chunkStates={chunkStates} role={role} />
            <div className="mt-4 flex gap-6 text-sm text-[var(--txt-secondary)]">
              <span>
                SEED:{' '}
                <span className="font-mono text-green-400">
                  {peerStats.filter((p) => !p.failed && p.chunksServed > 0).length}
                </span>
              </span>
              <span>
                LEECH:{' '}
                <span className="font-mono text-amber-400">
                  {peerStats.filter((p) => !p.failed && p.chunksServed === 0).length}
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
