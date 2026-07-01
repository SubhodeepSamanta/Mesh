import { useEffect } from 'react'
import { useTransferStore } from '../../store/useTransferStore.js'
import Header from './Header.jsx'
import Toaster from '../Toaster.jsx'
import ConfirmModal from '../ConfirmModal.jsx'

export default function Layout({ children }) {
  const status = useTransferStore((s) => s.status)

  useEffect(() => {
    const active = status === 'transferring' || status === 'file-offered' || status === 'waiting-for-peer' || status === 'waiting-for-file'
    if (active) {
      const handler = (e) => { e.preventDefault(); e.returnValue = '' }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    }
  }, [status])

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-primary)]">
      <Header />
      <main className="flex-1">{children}</main>
      <Toaster />
      <ConfirmModal />
    </div>
  )
}
