import { useEffect, useRef } from 'react'

export default function StatusLog({ lines = [], blinking = false }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3 font-mono text-sm text-[var(--txt-dim)]">
      {lines.map((line, i) => (
        <div key={i} className="leading-5">
          <span className="text-amber-400">[SYS]</span> {line}
        </div>
      ))}
      {blinking && (
        <span className="inline-block animate-blink text-amber-400">▌</span>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
