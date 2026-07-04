import { useState, useCallback } from 'react'
import { formatBytes } from '../lib/format.js'
import { looksLikeVideo } from '../lib/videoFormat.js'
import Badge from './shared/Badge.jsx'
import Card from './shared/Card.jsx'
import VideoPlayerModal from './VideoPlayerModal.jsx'

function FileEntry({ file, depth = 0, selectable, selected, onToggle, downloaded, onRedownload, onPlay }) {
  const indent = depth * 20
  return (
    <div
      className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-[var(--surface-hover)]"
      style={{ paddingLeft: `${12 + indent}px` }}
    >
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(file.path)}
          className="h-4 w-4 shrink-0 rounded border-[var(--border-light)] text-[var(--accent)] focus:ring-[var(--accent)] focus:ring-offset-[var(--bg-primary)] bg-[var(--surface)] cursor-pointer"
        />
      )}
      <span className={`flex-1 truncate text-sm ${selectable && !selected ? 'text-[var(--txt-muted)] line-through' : 'text-[var(--txt-primary)]'}`}>{file.name}</span>
      <span className="text-xs text-[var(--txt-secondary)]">{formatBytes(file.size)}</span>
      {!selectable && looksLikeVideo(file.name) && file.size > 0 && (
        <button
          type="button"
          onClick={() => onPlay(file)}
          title="Play this video"
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent)] hover:bg-[var(--accent)]/10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 4l12 8-12 8V4z" />
          </svg>
          Play
        </button>
      )}
      {downloaded && !selectable && (
        <button
          type="button"
          onClick={() => onRedownload(file.path)}
          title="Downloaded — click to save again"
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--success)] hover:bg-[var(--success)]/10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Saved
        </button>
      )}
    </div>
  )
}

export default function FileManifest({ fileMeta, selectable = false, deselectedPaths, onToggleFile, onToggleAll, downloadedPaths, onRedownloadFile }) {
  const [expandedHash, setExpandedHash] = useState(false)
  const [playingFile, setPlayingFile] = useState(null)

  if (!fileMeta) return null

  const files = fileMeta.files || [{ path: fileMeta.fileName, name: fileMeta.fileName, size: fileMeta.fileSize, startChunk: 0, chunkCount: fileMeta.totalChunks }]
  const isFolder = fileMeta.files && fileMeta.files.length > 1
  const rootHash = fileMeta.merkleRoot || fileMeta.fileMerkleRoot || ''
  const deselected = deselectedPaths || new Set()
  const downloaded = downloadedPaths || new Set()

  const selectedFiles = files.filter((f) => !deselected.has(f.path))
  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0)

  const copyHash = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rootHash)
      setHashCopied(true)
      setTimeout(() => setHashCopied(false), 1500)
    } catch {}
  }, [rootHash])
  const [hashCopied, setHashCopied] = useState(false)

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
          {selectable && files.length > 1 && (
            <button
              type="button"
              onClick={() => onToggleAll(deselected.size > 0)}
              className="cursor-pointer text-xs text-[var(--accent)] hover:underline"
            >
              {deselected.size > 0 ? 'Select all' : 'Deselect all'}
            </button>
          )}
        </div>

        <p className="text-xs text-[var(--txt-secondary)]">
          <span className="font-mono">{selectedFiles.length}</span> of <span className="font-mono">{files.length}</span> {files.length === 1 ? 'file' : 'files'} selected —{' '}
          <span className="font-mono">{formatBytes(totalSize)}</span>
        </p>

        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {files.map((file) => (
            <FileEntry
              key={file.path}
              file={file}
              depth={isFolder && file.path.includes('/') ? file.path.split('/').length - 1 : 0}
              selectable={selectable}
              selected={!deselected.has(file.path)}
              onToggle={onToggleFile}
              downloaded={downloaded.has(file.path)}
              onRedownload={onRedownloadFile}
              onPlay={setPlayingFile}
            />
          ))}
        </div>
      </Card>

      {playingFile && (
        <VideoPlayerModal key={playingFile.path} fileEntry={playingFile} onClose={() => setPlayingFile(null)} />
      )}
    </div>
  )
}
