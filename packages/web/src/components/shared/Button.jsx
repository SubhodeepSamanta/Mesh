const VARIANTS = {
  primary: 'bg-amber-500 text-black hover:bg-amber-400 font-medium',
  secondary: 'border border-[var(--border-light)] text-[var(--txt-primary)] hover:bg-[var(--surface-hover)] font-medium',
  ghost: 'text-[var(--txt-secondary)] hover:text-[var(--txt-primary)] hover:bg-[var(--surface-hover)]',
  danger: 'bg-red-600 text-white hover:bg-red-500 font-medium',
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
