import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { transferManager as M } from '../lib/transferManager.js'
import { useTransferStore } from '../store/useTransferStore.js'
import { getVideoContainer, detectMp4Fragmentation, pickSupportedMimeCodec } from '../lib/videoFormat.js'
import { formatBytes } from '../lib/format.js'
import Button from './shared/Button.jsx'

const POLL_MS = 300
const DETECT_BYTES_TARGET = 512 * 1024

async function readChunkBytes(index, fileEntry, chunkSize) {
  const c = M.chunks[index]
  if (c && c !== true) return c instanceof Uint8Array ? c : new Uint8Array(c)
  if (c === true && M.streamHandle?.dirHandle) {
    try {
      const parts = fileEntry.path.replace(/\\/g, '/').split('/')
      let h = M.streamHandle.dirHandle
      for (let p = 0; p < parts.length - 1; p++) h = await h.getDirectoryHandle(parts[p])
      const fh = await h.getFileHandle(parts[parts.length - 1])
      const file = await fh.getFile()
      const localIndex = index - fileEntry.startChunk
      const start = localIndex * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      if (end <= start) return null
      const buf = await file.slice(start, end).arrayBuffer()
      return new Uint8Array(buf)
    } catch { return null }
  }
  return null
}

function fileIsComplete(fileEntry) {
  for (let i = fileEntry.startChunk; i < fileEntry.startChunk + fileEntry.chunkCount; i++) {
    if (M.chunks[i] == null) return false
  }
  return true
}

export default function VideoPlayerModal({ fileEntry, onClose }) {
  const fileMeta = useTransferStore((s) => s.fileMeta)
  const videoRef = useRef(null)
  const [phase, setPhase] = useState('detecting') // detecting | ask-stream | streaming | wait-complete | ready-complete | stream-error
  const [detectPercent, setDetectPercent] = useState(0)
  const [waitPercent, setWaitPercent] = useState(0)
  const blobUrlRef = useRef(null)
  const cancelledRef = useRef(false)
  const codecRef = useRef(null)

  const chunkSize = fileMeta?.chunkSize || 65536
  const container = getVideoContainer(fileEntry.name)

  const cleanupPlayback = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
  }, [])

  const playFromBlob = useCallback(() => {
    const ordered = []
    for (let i = fileEntry.startChunk; i < fileEntry.startChunk + fileEntry.chunkCount; i++) {
      const c = M.chunks[i]
      if (c === true) { ordered.length = 0; break } // streamed to disk — read it back as a whole file instead
      ordered.push(c)
    }
    if (ordered.length > 0 || fileEntry.chunkCount === 0) {
      const blob = new Blob(ordered, { type: container || 'video/mp4' })
      blobUrlRef.current = URL.createObjectURL(blob)
      setPhase('ready-complete')
      return
    }
    // Streamed-to-disk: read the finished file back from the directory handle.
    ;(async () => {
      try {
        const parts = fileEntry.path.replace(/\\/g, '/').split('/')
        let h = M.streamHandle.dirHandle
        for (let p = 0; p < parts.length - 1; p++) h = await h.getDirectoryHandle(parts[p])
        const fh = await h.getFileHandle(parts[parts.length - 1])
        const file = await fh.getFile()
        blobUrlRef.current = URL.createObjectURL(file)
        if (!cancelledRef.current) setPhase('ready-complete')
      } catch {
        if (!cancelledRef.current) setPhase('stream-error')
      }
    })()
  }, [fileEntry, container])

  // Phase 1: detect whether progressive (MSE) playback is even feasible,
  // by accumulating this file's own head bytes as they arrive.
  useEffect(() => {
    cancelledRef.current = false
    if (fileEntry.chunkCount === 0) { playFromBlob(); return }
    if (fileIsComplete(fileEntry)) { playFromBlob(); return }
    if (!container) { setPhase('wait-complete'); return }

    let prefix = new Uint8Array(0)
    let cursor = fileEntry.startChunk
    const target = Math.min(fileEntry.size, DETECT_BYTES_TARGET)

    const interval = setInterval(async () => {
      if (cancelledRef.current) return
      if (fileIsComplete(fileEntry)) { clearInterval(interval); playFromBlob(); return }

      while (prefix.length < target) {
        const bytes = await readChunkBytes(cursor, fileEntry, chunkSize)
        if (!bytes) break
        const merged = new Uint8Array(prefix.length + bytes.length)
        merged.set(prefix, 0)
        merged.set(bytes, prefix.length)
        prefix = merged
        cursor++
      }
      if (cancelledRef.current) return
      setDetectPercent(Math.min(100, Math.round((prefix.length / target) * 100)))

      const enoughData = prefix.length >= target
      if (!enoughData) return

      let feasible = container === 'video/webm'
      if (container === 'video/mp4') {
        const result = detectMp4Fragmentation(prefix)
        feasible = result === 'fragmented'
      }
      const codec = feasible ? pickSupportedMimeCodec(container) : null
      clearInterval(interval)
      if (cancelledRef.current) return
      if (codec) {
        codecRef.current = codec
        setPhase((p) => (p === 'detecting' ? 'ask-stream' : p))
      } else {
        setPhase('wait-complete')
      }
    }, POLL_MS)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileEntry, container, chunkSize])

  // 'wait-complete': just poll progress and flip to playback once the file
  // (not necessarily the whole transfer) is fully in.
  useEffect(() => {
    if (phase !== 'wait-complete') return
    const interval = setInterval(() => {
      if (cancelledRef.current) return
      let have = 0
      for (let i = fileEntry.startChunk; i < fileEntry.startChunk + fileEntry.chunkCount; i++) {
        if (M.chunks[i] != null) have++
      }
      setWaitPercent(fileEntry.chunkCount > 0 ? Math.round((have / fileEntry.chunkCount) * 100) : 100)
      if (fileIsComplete(fileEntry)) {
        clearInterval(interval)
        playFromBlob()
      }
    }, POLL_MS)
    return () => clearInterval(interval)
  }, [phase, fileEntry, playFromBlob])

  // 'streaming': MSE wiring — append this file's chunks in strict order as
  // they verify (or are read back off disk), one at a time.
  useEffect(() => {
    if (phase !== 'streaming') return
    const video = videoRef.current
    const codec = codecRef.current
    if (!video || !codec) { setPhase('stream-error'); return }

    const mediaSource = new MediaSource()
    const url = URL.createObjectURL(mediaSource)
    blobUrlRef.current = url
    video.src = url

    let sourceBuffer = null
    let nextIndex = fileEntry.startChunk
    const endIndex = fileEntry.startChunk + fileEntry.chunkCount
    let appending = false
    let pollTimer = null
    let ended = false

    function tryAppendNext() {
      if (cancelledRef.current || appending || ended || !sourceBuffer || sourceBuffer.updating) return
      if (nextIndex >= endIndex) {
        if (mediaSource.readyState === 'open') {
          try { mediaSource.endOfStream() } catch {}
        }
        ended = true
        return
      }
      appending = true
      readChunkBytes(nextIndex, fileEntry, chunkSize).then((bytes) => {
        appending = false
        if (cancelledRef.current) return
        if (!bytes) return // not arrived yet — next poll tick will retry
        try {
          sourceBuffer.appendBuffer(bytes)
          nextIndex++
        } catch {
          setPhase('stream-error')
        }
      })
    }

    function onSourceOpen() {
      if (cancelledRef.current) return
      try {
        sourceBuffer = mediaSource.addSourceBuffer(codec)
      } catch {
        setPhase('stream-error')
        return
      }
      sourceBuffer.addEventListener('updateend', tryAppendNext)
      sourceBuffer.addEventListener('error', () => { if (!cancelledRef.current) setPhase('stream-error') })
      tryAppendNext()
      pollTimer = setInterval(tryAppendNext, POLL_MS)
    }

    mediaSource.addEventListener('sourceopen', onSourceOpen, { once: true })
    video.play().catch(() => {})

    return () => {
      if (pollTimer) clearInterval(pollTimer)
      mediaSource.removeEventListener('sourceopen', onSourceOpen)
    }
  }, [phase, fileEntry, chunkSize])

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      cleanupPlayback()
    }
  }, [cleanupPlayback])

  const handleClose = useCallback(() => {
    cancelledRef.current = true
    cleanupPlayback()
    onClose()
  }, [cleanupPlayback, onClose])

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={handleClose}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', duration: 0.3 }}
          className="relative z-10 w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <p className="truncate text-sm font-medium text-[var(--txt-primary)]" title={fileEntry.name}>{fileEntry.name}</p>
            <button onClick={handleClose} className="cursor-pointer rounded p-1 text-[var(--txt-secondary)] hover:text-[var(--txt-primary)]">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5">
            {phase === 'detecting' && (
              <div className="flex flex-col items-center gap-3 py-14">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]" />
                <p className="text-sm text-[var(--txt-secondary)]">Checking whether this video can stream while downloading... {detectPercent}%</p>
              </div>
            )}

            {phase === 'ask-stream' && (
              <div className="flex flex-col items-center gap-4 py-10 text-center">
                <svg className="h-10 w-10 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-base font-medium text-[var(--txt-primary)]">This video can stream while it downloads</p>
                  <p className="mt-1 text-sm text-[var(--txt-secondary)]">Start watching now — it'll keep buffering as more chunks verify. Playback may pause briefly if downloading falls behind.</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => setPhase('streaming')} className="px-5 py-2.5 text-sm font-semibold">▶ Start watching</Button>
                  <Button onClick={() => setPhase('wait-complete')} variant="secondary" className="px-5 py-2.5 text-sm font-semibold">Wait until it's done</Button>
                </div>
              </div>
            )}

            {phase === 'wait-complete' && (
              <div className="flex flex-col items-center gap-3 py-14 text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]" />
                <p className="text-sm font-medium text-[var(--txt-primary)]">
                  {container ? "This video will play automatically once it's fully downloaded." : "This file type can't stream progressively — it'll play once fully downloaded."}
                </p>
                <p className="text-xs text-[var(--txt-secondary)]">{waitPercent}% of {fileEntry.name} ({formatBytes(fileEntry.size)}) downloaded</p>
              </div>
            )}

            {phase === 'ready-complete' && (
              <video ref={videoRef} src={blobUrlRef.current} controls autoPlay className="max-h-[70vh] w-full rounded-lg bg-black" />
            )}

            {phase === 'streaming' && (
              <video ref={videoRef} controls className="max-h-[70vh] w-full rounded-lg bg-black" />
            )}

            {phase === 'stream-error' && (
              <div className="flex flex-col items-center gap-3 py-14 text-center">
                <p className="text-sm font-medium text-[var(--error)]">Couldn't stream this video.</p>
                <p className="text-xs text-[var(--txt-secondary)]">It'll still be available as a regular download once the transfer finishes.</p>
                <Button onClick={handleClose} variant="secondary" className="px-5 py-2 text-sm">Close</Button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
  )
}
