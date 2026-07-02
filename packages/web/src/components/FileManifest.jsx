import { useState, useCallback } from 'react'
import { formatBytes } from '../lib/format.js'
import Badge from './shared/Badge.jsx'
import Card from './shared/Card.jsx'

function FileEntry({ file, depth = 0 }) {
  const indent = depth * 20
  return (
    <div
      className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-[var(--surface-hover)]"
      style={{ paddingLeft: `${12 + indent}px` }}
    >
      <span className="flex-1 truncate text-sm text-[var(--txt-primary)]">{file.name}</span>
      <span className="text-xs text-[var(--txt-secondary)]">{formatBytes(file.size)}</span>
    </div>
  )
}

export default function FileManifest({ fileMeta }) {
  const [expandedHash, setExpandedHash] = useState(false)

  if (!fileMeta) return null

  const files = fileMeta.files || [{ path: fileMeta.fileName, name: fileMeta.fileName, size: fileMeta.fileSize }]
  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const isFolder = fileMeta.files && fileMeta.files.length > 1
  const rootHash = fileMeta.merkleRoot || fileMeta.fileMerkleRoot || ''
  const [hashCopied, setHashCopied] = useState(false)

  const copyHash = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rootHash)
      setHashCopied(true)
      setTimeout(() => setHashCopied(false), 1500)
    } catch {}
  }, [rootHash])

  return (
    <div className="flex flex-col gap-4">
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-medium text-[var(--txt-primary)]">{fileMeta.fileName}</p>
            <p className="text-sm text-[var(--txt-secondary)]">{formatBytes(fileMeta.fileSize)}</p>
          </div>
          {fileMeta.senderId && <Badge color="amber">SENDER ID</Badge>}
        </div>

        {fileMeta.senderId && (
          <p className="font-mono text-xs text-[var(--txt-dim)]">{fileMeta.senderId.length > 16 ? `${fileMeta.senderId.slice(0, 16)}...` : fileMeta.senderId}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-[var(--txt-secondary)]">
          <span className="font-mono">{fileMeta.totalChunks || '—'} CHUNKS</span>
          <span className="text-[var(--border-light)]">|</span>
          <span className="font-mono">MERKLE ROOT</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpandedHash(!expandedHash)}
            className="flex-1 cursor-pointer truncate rounded bg-[var(--bg-primary)] px-3 py-2 text-left font-mono text-xs text-[var(--txt-dim)] transition-colors hover:text-[var(--accent)]"
            title={rootHash}
          >
            {expandedHash ? rootHash : `${rootHash.slice(0, 24)}...`}
          </button>
          <button
            type="button"
            onClick={copyHash}
            className="cursor-pointer rounded p-2 text-[var(--txt-secondary)] transition-colors hover:text-[var(--accent)]"
            title="Copy hash"
          >
            {hashCopied ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        </div>
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-widest text-[var(--txt-secondary)]">Content Manifest</span>
        </div>

        <p className="text-xs text-[var(--txt-secondary)]">
          <span className="font-mono">{files.length}</span> {files.length === 1 ? 'file' : 'files'} —{' '}
          <span className="font-mono">{formatBytes(totalSize)}</span>
        </p>

        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {files.map((file) => (
            <FileEntry
              key={file.path}
              file={file}
              depth={isFolder && file.path.includes('/') ? file.path.split('/').length - 1 : 0}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}
