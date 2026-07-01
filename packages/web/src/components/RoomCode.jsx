import { QRCodeSVG } from 'qrcode.react'
import MonoText from './shared/MonoText.jsx'
import Badge from './shared/Badge.jsx'

export default function RoomCode({ roomCode }) {
  const shareUrl = `${window.location.origin}/receive?code=${roomCode}`

  return (
    <div className="flex flex-col items-center gap-4">
      <Badge color="gray" dot={false}>ROOM CODE</Badge>
      <div className="rounded-xl bg-[var(--bg-secondary)] p-4">
        <QRCodeSVG value={shareUrl} size={180} bgColor="transparent" fgColor="#ffffff" />
      </div>
      <MonoText text={roomCode} copyable className="text-2xl tracking-[0.2em]" />
    </div>
  )
}
