import { useToastStore } from '../store/useToastStore.js'
import { AnimatePresence, motion } from 'framer-motion'

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`pointer-events-auto flex items-center justify-between gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-md ${
              toast.type === 'error'
                ? 'border-[var(--error)]/20 bg-[var(--error)]/10 text-[var(--error)]'
                : toast.type === 'success'
                ? 'border-[var(--success)]/20 bg-[var(--success)]/10 text-[var(--success)]'
                : 'border-[var(--border-light)] bg-[var(--surface)]/90 text-[var(--txt-primary)]'
            }`}
          >
            <p className="text-xs font-medium leading-relaxed">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-[var(--txt-secondary)] hover:text-[var(--txt-primary)] transition-colors cursor-pointer"
              aria-label="Dismiss notification"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
