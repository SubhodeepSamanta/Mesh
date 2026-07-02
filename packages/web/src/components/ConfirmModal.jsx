import { motion, AnimatePresence } from 'framer-motion'
import { useConfirmStore } from '../store/useConfirmStore.js'
import Button from './shared/Button.jsx'

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
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <Button
                variant="secondary"
                onClick={onCancel}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={onConfirm}
                className="w-full sm:w-auto"
              >
                Confirm
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
