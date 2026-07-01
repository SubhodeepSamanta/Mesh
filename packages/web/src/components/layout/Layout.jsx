import { useEffect } from 'react'
import { useTransferStore } from '../../store/useTransferStore.js'
import { useSignalingStore } from '../../store/useSignalingStore.js'
import { useTransfer } from '../../hooks/useTransfer.js'
import { transferManager as M } from '../../lib/transferManager.js'
import Header from './Header.jsx'
import Toaster from '../Toaster.jsx'
import ConfirmModal from '../ConfirmModal.jsx'

export default function Layout({ children }) {
  const status = useTransferStore((s) => s.status)
  const roomCode = useSignalingStore((s) => s.roomCode)
  const role = useTransferStore((s) => s.role)
  const { dialPeer } = useTransfer()

  useEffect(() => {
    const active = status === 'transferring' || status === 'file-offered' || status === 'waiting-for-peer' || status === 'waiting-for-file'
    if (active) {
      const handler = (e) => { e.preventDefault(); e.returnValue = '' }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    }
  }, [status])

  useEffect(() => {
    if (!roomCode || status === 'complete' || status === 'error' || role === 'sender') return

    const interval = setInterval(() => {
      const currentPeers = useSignalingStore.getState().peers
      for (const peerId of currentPeers) {
        const hasActive = M.transports.has(peerId)
        if (!hasActive) {
          dialPeer(peerId)
        }
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [roomCode, status, role, dialPeer])

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-primary)]">
      <Header />
      <main className="flex-1">{children}</main>
      <Toaster />
      <ConfirmModal />
    </div>
  )
}
