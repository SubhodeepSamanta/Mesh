import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Button from '../components/shared/Button.jsx'

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/send', label: 'Send' },
  { to: '/receive', label: 'Receive' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/history', label: 'History' },
]

export default function NotFound() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId
    const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dots = Array.from({ length: 60 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2 + 0.5,
    }))

    function resize() {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      if (shouldReduceMotion) {
        draw()
      }
    }
    window.addEventListener('resize', resize)

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const d of dots) {
        if (!shouldReduceMotion) {
          d.x += d.vx
          d.y += d.vy
          if (d.x < 0 || d.x > canvas.width) d.vx *= -1
          if (d.y < 0 || d.y > canvas.height) d.vy *= -1
        }
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(245, 158, 11, 0.15)'
        ctx.fill()
      }
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x
          const dy = dots[i].y - dots[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            ctx.beginPath()
            ctx.moveTo(dots[i].x, dots[i].y)
            ctx.lineTo(dots[j].x, dots[j].y)
            ctx.strokeStyle = `rgba(245, 158, 11, ${(1 - dist / 120) * 0.1})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }
      if (!shouldReduceMotion) {
        animId = requestAnimationFrame(draw)
      }
    }
    resize()
    if (!shouldReduceMotion) {
      draw()
    }

    return () => {
      if (animId) cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="relative flex min-h-[calc(100vh-57px)] flex-col items-center justify-center overflow-hidden px-6 sm:min-h-[calc(100vh-65px)]">
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex flex-col items-center gap-6 text-center"
      >
        <div className="relative">
          <span className="text-[clamp(6rem,20vw,12rem)] font-black leading-none tracking-tighter text-[var(--txt-primary)]/5 select-none">
            404
          </span>
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="absolute inset-0 flex items-center justify-center text-[clamp(3rem,10vw,6rem)] font-black leading-none tracking-tighter text-[var(--accent)]"
          >
            404
          </motion.span>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="text-sm text-[var(--txt-secondary)] sm:text-base"
        >
          This page wandered off the mesh.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.4 }}
          className="flex flex-wrap justify-center gap-3"
        >
          {LINKS.map((link) => (
            <Link key={link.to} to={link.to}>
              <Button variant={link.to === '/' ? 'primary' : 'secondary'} className="text-xs px-4 py-2">
                {link.label}
              </Button>
            </Link>
          ))}
        </motion.div>
      </motion.div>
    </div>
  )
}
