import { useState } from 'react'

export default function MonoText({ text, copyable = false, className = '' }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard denied */ }
  }

  return (
    <span className={`inline-flex items-center gap-2 font-mono tracking-wide ${className}`}>
      <span className="text-[var(--txt-dim)]">{text}</span>
      {copyable && (
        <button
          onClick={handleCopy}
          className="cursor-pointer rounded p-1 text-[var(--txt-secondary)] transition-colors hover:text-[var(--accent)] hover:bg-[var(--surface-hover)]"
          title="Copy"
        >
          {copied ? (
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
      )}
    </span>
  )
}
