import { useState, useEffect } from 'react'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import { formatBytes, formatDuration } from '../lib/format.js'

const KEY = 'mesh-history'

const statusColor = { complete: 'green', failed: 'red', partial: 'amber' }

export default function History() {
  const [entries, setEntries] = useState([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) setEntries(JSON.parse(raw))
    } catch { /* empty */ }
  }, [])

  const handleClear = () => {
    if (!window.confirm('Clear all transfer history?')) return
    localStorage.removeItem(KEY)
    setEntries([])
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-8">
        <p className="text-xs tracking-widest uppercase text-amber-500">History</p>
        <h1 className="text-2xl font-bold text-[var(--txt-primary)]">Transfer History</h1>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center py-24">
          <svg className="mb-4 h-12 w-12 text-[var(--txt-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-lg text-[var(--txt-secondary)]">No transfer history yet</p>
          <p className="mt-1 text-sm text-[var(--txt-secondary)]">Completed transfers will appear here</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm text-[var(--txt-primary)]">
            <thead className="bg-[var(--bg-primary)] text-[var(--txt-secondary)] text-xs uppercase tracking-wider">
              <tr>
                {['File', 'Size', 'Date', 'Duration', 'Speed', 'Peers', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {entries.map((e, i) => (
                <tr key={e.id} className={i % 2 ? 'bg-[var(--bg-secondary)]' : 'bg-transparent'}>
                  <td className="px-4 py-3 font-mono text-xs max-w-[180px] truncate">{e.fileName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--txt-tertiary)]">{formatBytes(e.fileSize)}</td>
                  <td className="px-4 py-3 text-xs text-[var(--txt-tertiary)]">{new Date(e.date).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--txt-tertiary)]">{formatDuration(e.duration)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-amber-500">{e.avgSpeed.toFixed(1)} MB/s</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--txt-tertiary)]">{e.peers}</td>
                  <td className="px-4 py-3">
                    <Badge color={statusColor[e.status] || 'gray'}>{e.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.length > 0 && (
        <Button variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={handleClear}>
          Clear history
        </Button>
      )}
    </div>
  )
}
