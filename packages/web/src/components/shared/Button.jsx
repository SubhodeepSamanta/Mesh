const VARIANTS = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/20',
  secondary:
    'bg-black/5 text-black hover:bg-black/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/15',
  ghost: 'text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10',
}

export default function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}