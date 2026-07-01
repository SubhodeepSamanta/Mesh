import { useCallback, useState, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { indexFiles } from '../lib/fileChunker.js'

export default function FileDropZone({ onFileReady }) {
  const [indexing, setIndexing] = useState(false)
  const [statusText, setStatusText] = useState('')
  const fileRefs = useRef({})

  const traverseDir = useCallback(async (entry, path = '') => {
    const reader = entry.createReader()
    const files = []
    const readBatch = () => new Promise((r) => reader.readEntries((e) => r(e)))
    let batch = await readBatch()
    while (batch.length > 0) {
      for (const e of batch) {
        const p = path ? `${path}/${e.name}` : e.name
        if (e.isFile) {
          const file = await new Promise((r) => e.file(r))
          file.relativePath = p
          files.push(file)
        } else if (e.isDirectory) {
          files.push(...await traverseDir(e, p))
        }
      }
      batch = await readBatch()
    }
    return files
  }, [])

  const onDrop = useCallback(async (accepted, rejections, event) => {
    const item = event?.dataTransfer?.items?.[0]
    const entry = item?.webkitGetAsEntry?.()
    let files = []

    if (entry?.isDirectory) {
      setStatusText('Reading folder...')
      setIndexing(true)
      try {
        files = await traverseDir(entry)
      } finally {
        setIndexing(false)
      }
    } else if (accepted.length > 0) {
      files = [accepted[0]]
    }

    if (files.length === 0) return
    setStatusText(`Indexing ${files.length} file${files.length > 1 ? 's' : ''}...`)
    setIndexing(true)
    try {
      const fileMap = {}
      files.forEach(f => { fileMap[f.relativePath || f.name] = f })
      fileRefs.current = fileMap
      const fileIndex = await indexFiles(files)
      onFileReady(files[0], fileIndex, fileMap)
    } finally {
      setIndexing(false)
      setStatusText('')
    }
  }, [onFileReady, traverseDir])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
  })

  return (
    <div
      {...getRootProps()}
      className={`relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
        isDragActive
          ? 'border-amber-500/60 bg-amber-500/5'
          : 'border-[var(--border-light)] bg-[var(--bg-secondary)] hover:border-[var(--border-hover)]'
      }`}
    >
      <input {...getInputProps()} />
      <svg className="mb-3 h-10 w-10 text-amber-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
      {indexing ? (
        <p className="text-sm text-amber-400/80">{statusText}</p>
      ) : isDragActive ? (
        <p className="text-sm font-medium text-amber-400">Drop it here</p>
      ) : (
        <>
          <p className="text-sm font-medium text-[var(--txt-primary)]">Select or drop file</p>
          <p className="mt-1 text-xs text-[var(--txt-secondary)]">Any file or folder, any size</p>
        </>
      )}
      <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-light)] bg-[var(--bg-secondary)] px-3 py-1 text-[11px] uppercase tracking-widest text-[var(--txt-secondary)]">
        AES-256-GCM · E2E encrypted
      </span>
    </div>
  )
}
