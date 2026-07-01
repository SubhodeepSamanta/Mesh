import { useMemo } from 'react'

const CHUNK_COLORS = {
  pending: 'bg-[var(--surface-hover)]',
  requested: 'bg-amber-500/40',
  verified: 'bg-green-500',
  failed: 'bg-red-500',
}

export default function ChunkGrid({ chunkStates = [], transferStatus }) {
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

    return { displayStates: compressed, cols: Math.min(sqrt, 30), completePercent: percent }
  }, [chunkStates])

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
        <span className="text-sm font-medium text-amber-400">
          {completePercent}% COMPLETE
        </span>
      </div>
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
  )
}
