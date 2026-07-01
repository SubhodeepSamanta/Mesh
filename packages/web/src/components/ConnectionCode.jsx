import { useState, useRef, useEffect } from 'react'
import jsQR from 'jsqr'
import Button from './shared/Button.jsx'

export default function ConnectionCode({ onJoin, joining = false, defaultValue = '' }) {
  const [code, setCode] = useState(defaultValue)
  const [scanning, setScanning] = useState(false)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const animRef = useRef(null)

  useEffect(() => {
    return () => stopCamera()
  }, [])

  function stopCamera() {
    cancelAnimationFrame(animRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setScanning(false)
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setScanning(true)

      if (!videoRef.current) { stopCamera(); return }
      videoRef.current.srcObject = stream
      await new Promise((resolve, reject) => {
        const v = videoRef.current
        if (!v) { resolve(); return }
        v.onloadedmetadata = resolve
        v.onerror = reject
        setTimeout(resolve, 3000)
      })

      videoRef.current?.play()
      scanFrame()
    } catch {
      setScanning(false)
    }
  }

  function scanFrame() {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const result = jsQR(imageData.data, imageData.width, imageData.height)

    if (result) {
      const match = result.data.match(/[?&]code=([A-Z0-9]{6})/)
      if (match) {
        setCode(match[1])
        stopCamera()
        return
      }
    }

    animRef.current = requestAnimationFrame(scanFrame)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const cleaned = code.trim().toUpperCase()
    if (cleaned.length >= 6) onJoin(cleaned)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="relative">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9))}
          placeholder="e.g. WOLF-4821"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-lg tracking-widest text-[var(--txt-primary)] placeholder:text-[var(--txt-secondary)] outline-none transition-colors focus:border-[var(--accent)]/50"
          maxLength={9}
        />
        <button
          type="button"
          onClick={scanning ? stopCamera : startCamera}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-[var(--txt-secondary)] transition-colors hover:text-[var(--accent)]"
          title={scanning ? 'Close scanner' : 'Scan QR code'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <rect x="7" y="7" width="5" height="5" rx="0.5" />
            <rect x="12" y="12" width="5" height="5" rx="0.5" />
            <line x1="7" y1="12" x2="7" y2="12" />
            <line x1="17" y1="12" x2="17" y2="12" />
            <line x1="12" y1="7" x2="12" y2="7" />
            <line x1="12" y1="17" x2="12" y2="17" />
          </svg>
        </button>
      </div>

      {scanning && (
        <div className="relative overflow-hidden rounded-lg border border-[var(--accent)]/30 bg-black">
          <video ref={videoRef} className="h-48 w-full object-cover" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-32 rounded-lg border-2 border-[var(--accent)]/60" />
          </div>
          <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-[var(--accent)]/70">Align QR code within the frame</p>
        </div>
      )}

      <Button type="submit" disabled={code.trim().length < 6 || joining} className="w-full">
        {joining ? 'CONNECTING...' : 'ESTABLISH LINK'}
      </Button>
    </form>
  )
}
