import { QRCodeSVG } from 'qrcode.react'

export default function RoomCodeDisplay({ roomCode }) {
  const shareUrl = `${window.location.origin}/receive?code=${roomCode}`

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-xl bg-white p-3">
        <QRCodeSVG value={shareUrl} size={140} />
      </div>
      <div className="text-center">
        <p className="text-sm text-black/50 dark:text-white/50">Room code</p>
        <p className="font-mono text-4xl font-semibold tracking-[0.2em]">{roomCode}</p>
      </div>
    </div>
  )
}