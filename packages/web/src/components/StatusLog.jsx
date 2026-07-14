import { useEffect, useRef } from 'react'

export default function StatusLog({ lines = [], blinking = false }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [lines])

  return (
    <div
      ref={containerRef}
      role="log"
      aria-live="polite"
      className="max-h-48 overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3 font-mono text-xs text-[var(--txt-dim)] sm:text-sm"
    >
      {lines.map((line, i) => (
        <div key={i} className="break-words leading-5">
          <span className="text-[var(--accent)]">[SYS]</span> {line}
        </div>
      ))}
      {blinking && (
        <span className="inline-block animate-blink text-[var(--accent)]">▌</span>
      )}
    </div>
  )
}
