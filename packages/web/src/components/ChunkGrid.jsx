import { useMemo, useRef, useEffect } from 'react'

const CHUNK_COLORS = {
  pending: 'bg-[var(--surface-hover)]',
  requested: 'bg-[var(--accent)]/40',
  verified: 'bg-[var(--success)]',
  failed: 'bg-[var(--error)]',
}

export default function ChunkGrid({ chunkStates = [], transferStatus }) {
  const scrollRef = useRef(null)

  const { displayStates, cols, completePercent } = useMemo(() => {
    const total = chunkStates.length
    if (total === 0) return { displayStates: [], cols: 0, completePercent: 0 }

    let compressed = []
    if (total > 1000) {
      const ratio = total / 1000
      for (let i = 0; i < 1000; i++) {
        const realIdx = Math.floor(i * ratio)
        compressed.push({ state: chunkStates[realIdx], index: realIdx })
      }
    } else {
      compressed = chunkStates.map((state, i) => ({ state, index: i }))
    }

    const sqrt = Math.ceil(Math.sqrt(compressed.length))
    const verified = chunkStates.filter((s) => s === 'verified').length
    const percent = total > 0 ? Math.round((verified / total) * 100) : 0

    return { displayStates: compressed, cols: Math.min(sqrt, 50), completePercent: percent }
  }, [chunkStates])

  const focusIndex = useMemo(() => {
    const idx = displayStates.findIndex(item => item.state !== 'verified')
    return idx !== -1 ? idx : displayStates.length - 1
  }, [displayStates])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || displayStates.length === 0) return

    const total = displayStates.length
    const totalRows = Math.ceil(total / cols)
    if (totalRows <= 1) return

    const activeRow = Math.floor(focusIndex / cols)
    const rowHeight = el.scrollHeight / totalRows
    
    const targetScrollTop = (activeRow * rowHeight) - (el.clientHeight / 2) + (rowHeight / 2)
    
    el.scrollTo({
      top: Math.max(0, Math.min(el.scrollHeight - el.clientHeight, targetScrollTop)),
      behavior: 'smooth'
    })
  }, [focusIndex, cols, displayStates.length])

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
          {displayStates.map((item, i) => (
            <div
              key={i}
              className={`aspect-square rounded-sm ${CHUNK_COLORS[item.state] || CHUNK_COLORS.pending}`}
              title={`Chunk ${item.index}: ${item.state}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
