import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useTransfer } from '../hooks/useTransfer.js'
import { WebRTCTransport } from '../lib/webrtc.js'
import Card from '../components/shared/Card.jsx'
import Badge from '../components/shared/Badge.jsx'
import FileDropZone from '../components/FileDropZone.jsx'
import RoomCode from '../components/RoomCode.jsx'
import StatusLog from '../components/StatusLog.jsx'

export default function Send() {
  const navigate = useNavigate()
  const [fileIndex, setFileIndex] = useState(null)
  const [lines, setLines] = useState([])
  const connectedRef = useRef(false)
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

  async function handleFileReady(file, index) {
    fileIdxRef.current = index
    setFileIndex(index)
    addLine(`File selected: ${index.fileName} (${(index.fileSize / 1e6).toFixed(1)} MB)`)
    addLine('Indexing file…')
    await startSending(file, index)
    addLine('Creating room…')
    await createRoom()
    addLine(`Room: ${useSignalingStore.getState().roomCode}`)
    startRef.current = Date.now()
    addLine('Waiting for receiver…')
  }

  useEffect(() => {
    if (peers.length > 0 && !connectedRef.current && client && fileIdxRef.current) {
      connectedRef.current = true
      addLine(`Peer joined: ${peers[0]}`)
      addLine('WebRTC connecting…')
      const t = new WebRTCTransport(client, peers[0], { initiator: true })
      t.connect()
        .then(() => { addLine('Channel open'); addLine('Offering file…'); addSenderPeer(t, fileIdxRef.current); addLine('Transfer started') })
        .catch((e) => { addLine(`Connection error: ${e.message}`) })
    }
  }, [peers, client, addSenderPeer])

  useEffect(() => {
    if (st === 'transferring') navigate('/dashboard')
  }, [st, navigate])

  useEffect(() => {
    if (st === 'complete') { addLine('All chunks sent'); addLine('Transfer complete') }
    else if (st === 'error') { addLine(`Error: ${useTransferStore.getState().error}`) }
  }, [st])

  function handleCancel() {
    useSignalingStore.getState().disconnect()
    disconnectAll(); connectedRef.current = false; startRef.current = null; fileIdxRef.current = null
    setFileIndex(null); setLines([])
  }

  const done = st === 'complete'
  const xfer = st === 'transferring'
  const hp = peers.length > 0
  const secs = startRef.current ? Math.floor((Date.now() - startRef.current) / 1000) : 0
  const uptime = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`

  if (!fileIndex) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--txt-secondary)]">Secure Transfer</p>
        <h1 className="text-2xl font-semibold text-[var(--txt-primary)]">Send File</h1>
        <p className="mt-1 mb-8 text-sm text-[var(--txt-secondary)]">Select a file or folder to share directly with a peer.</p>
        <FileDropZone onFileReady={handleFileReady} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <p className="mb-1 text-xs uppercase tracking-[0.15em] text-[var(--txt-secondary)]">Secure Transfer</p>
      <h1 className="text-2xl font-semibold text-[var(--txt-primary)]">Send File</h1>
      {meta && <p className="mb-8 text-sm text-[var(--txt-secondary)]">{meta.fileName} · {(meta.fileSize / 1e6).toFixed(1)} MB</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col items-center">{roomCode && <RoomCode roomCode={roomCode} />}</Card>
        <Card><StatusLog lines={lines} blinking={!done && hp} /></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm uppercase tracking-wider text-[var(--txt-secondary)]">Active Peers</span>
            <div className="flex items-center gap-2">
              {hp ? peers.map((p) => <Badge key={p} color="amber" dot>{p.slice(0, 8)}</Badge>) : <span className="text-sm text-[var(--txt-secondary)]">No peers connected</span>}
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm uppercase tracking-wider text-[var(--txt-secondary)]">Session Key</span>
            <span className="font-mono text-xs text-[var(--txt-dim)]">{roomCode ? `room:${roomCode}` : '—'}</span>
          </div>
        </Card>
      </div>

      {done && (
        <div className="mt-6 animate-glow rounded-lg border border-green-500/20 bg-green-500/5 py-3 text-center">
          <Badge color="green" dot>Transfer Complete</Badge>
          <p className="mt-2 text-xs text-green-400/60">{prog.verified} / {prog.total} chunks verified</p>
        </div>
      )}

      {xfer && (
        <div className="mt-6">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div className="h-full rounded-full bg-amber-500 transition-all duration-300" style={{ width: `${Math.min(100, prog.percent)}%` }} />
          </div>
          <p className="mt-2 text-center font-mono text-xs text-[var(--txt-secondary)]">{prog.verified} / {prog.total} chunks</p>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-5 border-t border-[var(--border)] pt-4">
        <span className="text-xs uppercase tracking-[0.15em] text-[var(--txt-secondary)]">STATUS <span className="ml-1 text-amber-400">{done ? 'COMPLETE' : xfer ? 'TRANSFERRING' : 'WAITING'}</span></span>
        <span className="text-xs uppercase tracking-[0.15em] text-[var(--txt-secondary)]">PEERS <span className="ml-1 text-amber-400">{peers.length}/8</span></span>
        {startRef.current && <span className="text-xs uppercase tracking-[0.15em] text-[var(--txt-secondary)]">UPTIME <span className="ml-1 text-amber-400">{uptime}</span></span>}
        <button onClick={handleCancel} className="cursor-pointer rounded-md border border-[var(--border-light)] px-3 py-1 text-xs uppercase tracking-wider text-[var(--txt-secondary)] transition-colors hover:border-red-500/30 hover:text-red-400">Cancel</button>
      </div>
    </div>
  )
}
