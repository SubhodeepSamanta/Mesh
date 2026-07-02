import { useCallback, useState, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { indexFiles } from '../lib/fileChunker.js'

const MODES = [
  { key: 'single', label: 'File', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M12 18v-6 M9 15l3-3 3 3' },
  { key: 'multiple', label: 'Files', icon: 'M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z M16 2v6h6' },
  { key: 'folder', label: 'Folder', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
]

export default function FileDropZone({ onFileReady }) {
  const [mode, setMode] = useState('multiple')
  const [indexing, setIndexing] = useState(false)
  const [statusText, setStatusText] = useState('')
  const fileRefs = useRef({})
  const inputRef = useRef(null)

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

  const handleFiles = useCallback(async (files) => {
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
  }, [onFileReady])

  const onDrop = useCallback(async (accepted, rejections, event) => {
    const item = event?.dataTransfer?.items?.[0]
    const entry = item?.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      setStatusText('Reading folder...')
      setIndexing(true)
      try {
        const files = await traverseDir(entry)
        await handleFiles(files)
      } finally {
        setIndexing(false)
      }
    } else if (accepted.length > 0) {
      await handleFiles(accepted)
    }
  }, [handleFiles, traverseDir])

  const handleClick = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    if (mode === 'folder') {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
    } else if (mode === 'multiple') {
      input.multiple = true
    }
    input.onchange = async () => {
      const fileList = input.files
      if (!fileList || fileList.length === 0) return
      const files = Array.from(fileList)
      if (mode === 'folder') {
        files.forEach(f => { f.relativePath = f.webkitRelativePath || f.name })
      }
      await handleFiles(files)
    }
    input.click()
  }, [mode, handleFiles])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    multiple: mode === 'multiple' || mode === 'folder',
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium uppercase tracking-wider transition-all cursor-pointer ${
              mode === m.key
                ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'border-[var(--border-light)] text-[var(--txt-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--txt-primary)]'
            }`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={m.icon} />
            </svg>
            {m.label}
          </button>
        ))}
      </div>

      <div
        {...getRootProps()}
        onClick={handleClick}
        className={`relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
          isDragActive
            ? 'border-[var(--accent)]/60 bg-[var(--accent)]/5'
            : 'border-[var(--border-light)] bg-[var(--bg-secondary)] hover:border-[var(--border-hover)]'
        }`}
      >
        <input {...getInputProps()} />
        <svg className="mb-3 h-10 w-10 text-[var(--accent)]/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          {mode === 'folder'
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          }
        </svg>
        {indexing ? (
          <p className="text-sm text-[var(--accent)]/80">{statusText}</p>
        ) : isDragActive ? (
          <p className="text-sm font-medium text-[var(--accent)]">Drop here</p>
        ) : (
          <>
            <p className="text-sm font-medium text-[var(--txt-primary)]">
              {mode === 'single' ? 'Select a file or drag here' : mode === 'multiple' ? 'Select files or drag them here' : 'Select a folder or drag here'}
            </p>
            <p className="mt-1 text-xs text-[var(--txt-secondary)]">
              {mode === 'single' ? 'Upload a single file' : mode === 'multiple' ? 'Upload multiple files at once' : 'Upload an entire folder with all contents'}
            </p>
          </>
        )}
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-light)] bg-[var(--bg-secondary)] px-3 py-1 text-[11px] uppercase tracking-widest text-[var(--txt-secondary)]">
          WebRTC DTLS · Peer-to-peer encrypted
        </span>
      </div>
    </div>
  )
}
