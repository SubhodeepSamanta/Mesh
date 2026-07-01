import { useEffect, useRef, useState } from 'react'
import DropZone from '../components/send/DropZone.jsx'
import RoomCodeDisplay from '../components/send/RoomCodeDisplay.jsx'
import ConnectionStatus from '../components/send/ConnectionStatus.jsx'
import ProgressBar from '../components/shared/ProgressBar.jsx'
import Card from '../components/shared/Card.jsx'
import { formatBytes } from '../lib/format.js'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useSendTransfer } from '../hooks/useSendTransfer.js'

export default function SendPage() {
  const [fileIndex, setFileIndex] = useState(null)
  const connectedRef = useRef(false)

  const roomCode = useSignalingStore((s) => s.roomCode)
  const peers = useSignalingStore((s) => s.peers)
  const createRoom = useSignalingStore((s) => s.createRoom)

  const status = useTransferStore((s) => s.status)
  const progress = useTransferStore((s) => s.progress)
  const fileMeta = useTransferStore((s) => s.fileMeta)

  const { startSending, connectToPeer } = useSendTransfer()

  async function handleFileReady(file, index) {
    setFileIndex(index)
    await startSending(file, index)
    await createRoom()
  }

  useEffect(() => {
    if (peers.length > 0 && !connectedRef.current) {
      connectedRef.current = true
      connectToPeer(peers[0])
    }
  }, [peers, connectToPeer])

  if (!fileIndex) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold">Send a file</h1>
        <p className="mt-2 text-black/60 dark:text-white/60">Pick a file to share directly with someone.</p>
        <div className="mt-8">
          <DropZone onFileReady={handleFileReady} />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Card className="flex flex-col items-center gap-6">
        <div className="text-center">
          <p className="truncate text-lg font-medium">{fileMeta?.fileName}</p>
          <p className="text-sm text-black/50 dark:text-white/50">{formatBytes(fileMeta?.fileSize || 0)}</p>
        </div>

        {roomCode && !connectedRef.current && <RoomCodeDisplay roomCode={roomCode} />}

        <ConnectionStatus status={status} />

        {status === 'transferring' && (
          <div className="w-full">
            <ProgressBar percent={progress.percent} />
            <p className="mt-2 text-center text-sm text-black/50 dark:text-white/50">
              {progress.verified} / {progress.total} chunks sent
            </p>
          </div>
        )}

        {status === 'complete' && <p className="font-medium text-green-600">Transfer complete</p>}
      </Card>
    </div>
  )
}