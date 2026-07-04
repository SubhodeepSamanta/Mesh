import { useState, useCallback } from 'react'
import Card from './shared/Card.jsx'
import Badge from './shared/Badge.jsx'
import Button from './shared/Button.jsx'
import ProgressBar from './shared/ProgressBar.jsx'
import FileDropZone from './FileDropZone.jsx'
import { formatBytes } from '../lib/format.js'

function OfferCard({ batch, onAccept, onDecline }) {
  const fileCount = batch.fileMeta?.files?.length || 1
  return (
    <Card className="space-y-3 border-[var(--accent)]/30">
      <div className="flex items-center gap-2">
        <Badge color="amber" dot>NEW FILES OFFERED</Badge>
      </div>
      <p className="text-sm text-[var(--txt-primary)]">
        The sender wants to add <span className="font-medium">{fileCount > 1 ? `${fileCount} files` : batch.fileMeta?.fileName}</span> to this session — <span className="font-mono text-xs text-[var(--txt-secondary)]">{formatBytes(batch.fileMeta?.fileSize || 0)}</span>
      </p>
      <div className="flex gap-2">
        <Button onClick={() => onAccept(batch.batchId)} className="flex-1 py-2 text-xs font-semibold">ACCEPT</Button>
        <Button onClick={() => onDecline(batch.batchId)} variant="secondary" className="flex-1 py-2 text-xs font-semibold">DECLINE</Button>
      </div>
    </Card>
  )
}

function ReceiverBatchCard({ batch, onDownload }) {
  const fileCount = batch.fileMeta?.files?.length || 1
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="truncate text-sm font-medium text-[var(--txt-primary)]">
          {fileCount > 1 ? `${fileCount} added files` : batch.fileMeta?.fileName}
        </span>
        <Badge color={batch.status === 'complete' ? 'green' : 'amber'} dot>
          {batch.status === 'complete' ? 'DONE' : 'RECEIVING'}
        </Badge>
      </div>
      <ProgressBar percent={batch.progress?.percent || 0} />
      <div className="flex items-center justify-between text-xs text-[var(--txt-secondary)]">
        <span>{batch.progress?.verified || 0} / {batch.progress?.total || 0} chunks</span>
        {batch.status === 'complete' && (
          <button onClick={() => onDownload(batch.batchId)} className="cursor-pointer font-medium text-[var(--accent)] hover:underline">
            Download
          </button>
        )}
      </div>
    </Card>
  )
}

function SenderBatchCard({ batch }) {
  const fileCount = batch.fileMeta?.files?.length || 1
  const acceptedCount = batch.acceptedBy?.length || 0
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="truncate text-sm font-medium text-[var(--txt-primary)]">
          {fileCount > 1 ? `${fileCount} added files` : batch.fileMeta?.fileName}
        </span>
        <Badge color={acceptedCount > 0 ? 'green' : 'gray'} dot>
          {acceptedCount > 0 ? `ACCEPTED · ${acceptedCount}` : 'OFFERED'}
        </Badge>
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--txt-secondary)]">
        <span>{formatBytes(batch.fileMeta?.fileSize || 0)}</span>
        <span>{batch.progress?.verified || 0} / {batch.progress?.total || 0} chunks sent</span>
      </div>
    </Card>
  )
}

export default function ExtraBatches({ role, extraBatches, acceptBatchOffer, declineBatchOffer, triggerBatchDownload, addFilesToSession }) {
  const [showAdd, setShowAdd] = useState(false)
  const [adding, setAdding] = useState(false)

  const handleFilesSelected = useCallback(async (files, fileRefs) => {
    setAdding(true)
    try {
      await addFilesToSession(files, fileRefs)
      setShowAdd(false)
    } finally {
      setAdding(false)
    }
  }, [addFilesToSession])

  if (role === 'sender') {
    return (
      <div className="space-y-3">
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full cursor-pointer rounded-lg border border-dashed border-[var(--border-light)] px-4 py-3 text-xs font-medium uppercase tracking-wider text-[var(--txt-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
          >
            + Add more files to this session
          </button>
        ) : (
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-[var(--txt-secondary)]">Add files</span>
              <button onClick={() => setShowAdd(false)} className="cursor-pointer text-xs text-[var(--txt-secondary)] hover:text-[var(--txt-primary)]">Cancel</button>
            </div>
            {adding ? (
              <p className="py-4 text-center text-sm text-[var(--txt-secondary)]">Indexing & hashing...</p>
            ) : (
              <FileDropZone onFilesSelected={handleFilesSelected} />
            )}
          </Card>
        )}
        {extraBatches.filter((b) => b.role === 'sender').map((b) => (
          <SenderBatchCard key={b.batchId} batch={b} />
        ))}
      </div>
    )
  }

  const offered = extraBatches.filter((b) => b.role === 'receiver' && b.status === 'offered')
  const active = extraBatches.filter((b) => b.role === 'receiver' && b.status !== 'offered')

  if (offered.length === 0 && active.length === 0) return null

  return (
    <div className="space-y-3">
      {offered.map((b) => (
        <OfferCard key={b.batchId} batch={b} onAccept={acceptBatchOffer} onDecline={declineBatchOffer} />
      ))}
      {active.map((b) => (
        <ReceiverBatchCard key={b.batchId} batch={b} onDownload={triggerBatchDownload} />
      ))}
    </div>
  )
}
