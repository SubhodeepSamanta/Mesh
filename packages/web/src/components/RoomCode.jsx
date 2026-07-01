import { QRCodeSVG } from 'qrcode.react'
import MonoText from './shared/MonoText.jsx'
import Badge from './shared/Badge.jsx'
import { useUIStore } from '../store/useUIStore.js'

import { useToastStore } from '../store/useToastStore.js'

export default function RoomCode({ roomCode }) {
  const theme = useUIStore((s) => s.theme)
  const shareUrl = `${window.location.origin}/receive?code=${roomCode}`

  return (
    <div className="flex flex-col items-center gap-4">
      <Badge color="gray" dot={false}>ROOM CODE</Badge>
      <div className="rounded-xl bg-[var(--bg-secondary)] p-4">
        <QRCodeSVG value={shareUrl} size={180} bgColor="transparent" fgColor={theme === 'dark' ? '#ffffff' : '#111111'} />
      </div>
      <div className="flex items-center gap-2">
        <MonoText text={roomCode} copyable className="text-2xl tracking-[0.2em]" />
        <button
          onClick={() => {
            navigator.clipboard?.writeText(shareUrl)
              .then(() => useToastStore.getState().addToast('Share link copied to clipboard', 'success'))
              .catch(() => useToastStore.getState().addToast('Failed to copy link', 'error'))
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border-light)] px-2.5 py-1.5 text-xs font-medium text-[var(--txt-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
          aria-label="Copy share link"
          title="Copy share link"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          Copy link
        </button>
      </div>
    </div>
  )
}
