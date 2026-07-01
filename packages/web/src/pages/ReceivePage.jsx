import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RoomCodeInput from '../components/receive/RoomCodeInput.jsx'
import IncomingFileCard from '../components/receive/IncomingFileCard.jsx'
import ProgressBar from '../components/shared/ProgressBar.jsx'
import Button from '../components/shared/Button.jsx'
import Card from '../components/shared/Card.jsx'
import { useSignalingStore } from '../store/useSignalingStore.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { useReceiveTransfer } from '../hooks/useReceiveTransfer.js'

export default function ReceivePage() {
  const [searchParams] = useSearchParams()
  const [joining, setJoining] = useState(false)
  const peerRef = useRef(null)
  const downloadTriggeredRef = useRef(false)

  const joinRoom = useSignalingStore((s) => s.joinRoom)

  const status = useTransferStore((s) => s.status)
  const fileMeta = useTransferStore((s) => s.fileMeta)
  const progress = useTransferStore((s) => s.progress)
  const startAsReceiver = useTransferStore((s) => s.startAsReceiver)

  const { connectToPeer, startDownload, getAssembledBlob } = useReceiveTransfer()

  async function handleJoin(code) {
    setJoining(true)
    startAsReceiver()
    try {
      const result = await joinRoom(code)
      if (result.existingPeers.length > 0) {
        peerRef.current = await connectToPeer(useSignalingStore.getState().client, result.existingPeers[0])
      }
    } finally {
      setJoining(false)
    }
  }

useEffect(() => {
    if (status === 'complete' && fileMeta && !downloadTriggeredRef.current) {
      downloadTriggeredRef.current = true
      const blob = getAssembledBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileMeta.fileName
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [status, fileMeta, getAssembledBlob])

  const prefillCode = searchParams.get('code') || ''

  if (status === 'idle') {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-3xl font-semibold">Receive a file</h1>
        <p className="mt-2 text-black/60 dark:text-white/60">Enter the room code from the sender.</p>
        <div className="mt-8">
          <RoomCodeInput onJoin={handleJoin} joining={joining} defaultValue={prefillCode} />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Card className="flex flex-col items-center gap-6">
        {status === 'waiting-for-file' && <p className="text-black/60 dark:text-white/60">Connecting…</p>}

        {fileMeta && <IncomingFileCard fileMeta={fileMeta} />}

        {status === 'file-offered' && (
          <Button onClick={() => startDownload(peerRef.current)}>Accept and download</Button>
        )}

        {status === 'transferring' && (
          <div className="w-full">
            <ProgressBar percent={progress.percent} />
            <p className="mt-2 text-center text-sm text-black/50 dark:text-white/50">
              {progress.verified} / {progress.total} chunks received
            </p>
          </div>
        )}

        {status === 'complete' && <p className="font-medium text-green-600">Download complete</p>}
      </Card>
    </div>
  )
}