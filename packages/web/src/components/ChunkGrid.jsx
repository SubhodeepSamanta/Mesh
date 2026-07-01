import { useMemo, useRef, useEffect } from 'react'

const CHUNK_COLORS = {
  pending: 'bg-[var(--surface-hover)]',
  requested: 'bg-[var(--accent)]/40',
  verified: 'bg-[var(--success)]',
  failed: 'bg-[var(--error)]',
}

export default function ChunkGrid({ chunkStates = [], transferStatus }) {
  const scrollRef = useRef(null)
  const atBottomRef = useRef(true)

  const { displayStates, cols, completePercent } = useMemo(() => {
    const total = chunkStates.length
    if (total === 0) return { displayStates: [], cols: 0, completePercent: 0 }

    let compressed = chunkStates
    if (total > 1000) {
      const ratio = total / 1000
      compressed = []
      for (let i = 0; i < 1000; i++) {
        compressed.push(chunkStates[Math.floor(i * ratio)])
      }
    }

    const sqrt = Math.ceil(Math.sqrt(compressed.length))
    const verified = chunkStates.filter((s) => s === 'verified').length
    const percent = total > 0 ? Math.round((verified / total) * 100) : 0

    return { displayStates: compressed, cols: Math.min(sqrt, 50), completePercent: percent }
  }, [chunkStates])

  useEffect(() => {
    if (scrollRef.current && atBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [completePercent])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handleScroll = () => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  if (chunkStates.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="py-8 text-center text-sm text-[var(--txt-secondary)]">No chunk data</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-widest text-[var(--txt-secondary)]">
          Chunks
        </span>
        <span className="text-sm font-medium text-[var(--accent)]">
          {completePercent}% COMPLETE
        </span>
      </div>
      <div ref={scrollRef} className="max-h-[200px] overflow-y-auto">
        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {displayStates.map((state, i) => (
            <div
              key={i}
              className={`aspect-square rounded-sm ${CHUNK_COLORS[state] || CHUNK_COLORS.pending}`}
              title={`Chunk ${i}: ${state}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
