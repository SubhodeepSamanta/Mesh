
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import Card from '../components/shared/Card.jsx'
import { getHistory, clearHistory, removeHistoryEntry } from '../store/useHistoryStore.js'
import { formatBytes, formatDuration } from '../lib/format.js'

import { useConfirmStore } from '../store/useConfirmStore.js'

const STATUS_META = {
  complete: { color: 'green', label: 'Complete' },
  failed: { color: 'red', label: 'Failed' },
  partial: { color: 'amber', label: 'Partial' },
}

export default function History() {
  const [entries, setEntries] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    setEntries(getHistory())
    const handler = () => setEntries(getHistory())
    // NOTE: The window 'storage' event listener only fires when localStorage
    // is modified from another tab/window. It does not fire in the current tab.
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  async function handleClear() {
    const confirmed = await useConfirmStore.getState().confirm('Clear all transfer history?', 'Clear History')
    if (!confirmed) return
    setEntries(clearHistory())
  }

  function handleRejoin(e) {
    if (!e.roomCode) return
    navigate(`/receive?code=${e.roomCode}`)
  }

  function handleRemove(id) {
    setEntries(removeHistoryEntry(id))
  }

  function roleLabel(role) {
    return role === 'sender' ? 'Sent' : 'Received'
  }

  if (entries.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8">
          <p className="text-xs tracking-widest uppercase text-[var(--accent)]">History</p>
          <h1 className="text-2xl font-bold text-[var(--txt-primary)]">Transfer History</h1>
        </div>
        <div className="flex flex-col items-center py-24">
          <svg className="mb-4 h-12 w-12 text-[var(--txt-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-lg text-[var(--txt-secondary)]">No transfer history yet</p>
          <p className="mt-1 text-sm text-[var(--txt-secondary)]">Completed transfers will appear here</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs tracking-widest uppercase text-[var(--accent)]">History</p>
          <h1 className="text-2xl font-bold text-[var(--txt-primary)]">Transfer History</h1>
        </div>
        <Button variant="ghost" className="text-xs text-[var(--txt-muted)] hover:text-[var(--error)]" onClick={handleClear}>
          Clear all
        </Button>
      </div>

      <div className="space-y-3">
        {entries.map((e) => {
          const meta = STATUS_META[e.status] || STATUS_META.failed
          return (
            <Card key={e.id} className="relative group transition-all hover:border-[var(--border-hover)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <Badge color={meta.color}>{meta.label}</Badge>
                    <span className="text-xs uppercase tracking-wider text-[var(--txt-muted)]">
                      {roleLabel(e.role)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className="truncate font-mono text-sm font-medium text-[var(--txt-primary)] pr-8 sm:pr-0">
                      {e.fileName}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--txt-secondary)]">
                      <span>{formatBytes(e.fileSize)}</span>
                      {e.fileCount > 1 && <span>{e.fileCount} files</span>}
                      <span>{e.totalChunks} chunks</span>
                      <span>·</span>
                      <span>{formatDuration(e.duration)}</span>
                      {e.avgSpeed > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-[var(--accent)]">{e.avgSpeed.toFixed(1)} MB/s</span>
                        </>
                      )}
                      {e.peers > 0 && (
                        <>
                          <span>·</span>
                          <span>{e.peers} peer{e.peers > 1 ? 's' : ''}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-[var(--txt-muted)]">
                    {new Date(e.date).toLocaleString()}
                  </p>
                </div>

                {e.roomCode && (
                  <div className="flex shrink-0 items-center w-full sm:w-auto">
                    <Button
                      variant="secondary"
                      className="text-xs px-3 py-1.5 w-full sm:w-auto"
                      onClick={() => handleRejoin(e)}
                    >
                      Rejoin room
                    </Button>
                  </div>
                )}
              </div>

              <button
                onClick={() => handleRemove(e.id)}
                className="absolute top-5 right-5 cursor-pointer rounded-md p-1.5 text-[var(--txt-muted)] opacity-100 transition-opacity hover:text-[var(--error)] lg:opacity-0 lg:group-hover:opacity-100"
                title="Remove from history"
                aria-label="Remove from history"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </Card>
          )
        })}
      </div>

      {entries.length > 0 && (
        <p className="mt-4 text-center text-[10px] text-[var(--txt-muted)]">
          {entries.length} transfer{entries.length > 1 ? 's' : ''} · Oldest entries are automatically removed
        </p>
      )}
    </div>
  )
}
