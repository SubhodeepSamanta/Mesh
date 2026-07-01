import { motion, AnimatePresence } from 'framer-motion'
import { useConfirmStore } from '../store/useConfirmStore.js'

export default function ConfirmModal() {
  const { isOpen, title, message, onConfirm, onCancel } = useConfirmStore()

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
          >
            {/* Header/Title */}
            <h2
              id="confirm-modal-title"
              className="text-lg font-bold tracking-tight text-[var(--txt-primary)]"
            >
              {title}
            </h2>

            {/* Content/Message */}
            <p className="mt-3 text-sm leading-relaxed text-[var(--txt-secondary)]">
              {message}
            </p>

            {/* Actions */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="cursor-pointer rounded-md border border-[var(--border-light)] bg-transparent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--txt-secondary)] transition-all hover:border-[var(--border-hover)] hover:text-[var(--txt-primary)] focus:outline-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-black transition-all hover:bg-[var(--accent-hover)] hover:shadow-[0_0_12px_rgba(245,158,11,0.3)] focus:outline-none"
              >
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
