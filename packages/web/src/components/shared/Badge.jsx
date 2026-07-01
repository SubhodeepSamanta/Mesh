const COLORS = {
  green: 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20',
  amber: 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20',
  red: 'bg-[var(--error)]/10 text-[var(--error)] border-[var(--error)]/20',
  gray: 'bg-[var(--surface-hover)] text-[var(--txt-secondary)] border-[var(--border-light)]',
}

const DOTS = {
  green: 'bg-[var(--success)]',
  amber: 'bg-[var(--accent)]',
  red: 'bg-[var(--error)]',
  gray: 'bg-[var(--txt-secondary)]',
}

export default function Badge({ color = 'gray', dot = true, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium tracking-wide uppercase ${COLORS[color]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOTS[color]}`} />}
      {children}
    </span>
  )
}
