const VARIANTS = {
  primary: 'bg-[var(--accent)] text-black hover:bg-[var(--accent-hover)] font-medium',
  secondary: 'border border-[var(--border-light)] text-[var(--txt-primary)] hover:bg-[var(--surface-hover)] font-medium',
  ghost: 'text-[var(--txt-secondary)] hover:text-[var(--txt-primary)] hover:bg-[var(--surface-hover)]',
  danger: 'bg-[var(--error)] text-white hover:bg-[var(--error)] font-medium',
}

export default function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
