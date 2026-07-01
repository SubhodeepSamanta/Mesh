const COLORS = {
  green: 'bg-green-500/10 text-green-400 border-green-500/20',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  red: 'bg-red-500/10 text-red-400 border-red-500/20',
  gray: 'bg-[var(--surface-hover)] text-[var(--txt-secondary)] border-[var(--border-light)]',
}

const DOTS = {
  green: 'bg-green-400',
  amber: 'bg-amber-400',
  red: 'bg-red-400',
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
