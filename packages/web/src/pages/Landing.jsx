import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Button from '../components/shared/Button.jsx'
import Badge from '../components/shared/Badge.jsx'
import LandingGraph from '../components/LandingGraph.jsx'

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6 } },
}

export default function Landing() {
  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col sm:min-h-[calc(100vh-65px)]">
      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="flex flex-col justify-center gap-6 px-6 pt-12 pb-6 sm:px-8 sm:pt-16 sm:pb-8 lg:w-2/5 lg:px-16 lg:py-16">
          <motion.div {...fadeUp} className="flex flex-col gap-1">
            <h1 className="text-4xl font-bold tracking-tight text-[var(--txt-primary)] sm:text-5xl lg:text-7xl">Decentralized.</h1>
            <h1 className="text-4xl font-bold tracking-tight text-[var(--txt-primary)] sm:text-5xl lg:text-7xl">Unstoppable.</h1>
            <h1 className="text-4xl font-bold tracking-tight text-[var(--accent)] sm:text-5xl lg:text-7xl">Data Transfer.</h1>
          </motion.div>

          <motion.p {...fadeUp} className="max-w-md text-sm leading-relaxed text-[var(--txt-secondary)] sm:text-base">
            Mesh moves files straight between browsers over an encrypted P2P connection. Files never touch a server — only encrypted connection setup is relayed.
          </motion.p>

          <motion.div {...fadeUp} className="flex flex-col sm:flex-row gap-3 w-full">
            <Link to="/send" className="w-full sm:w-auto">
              <Button variant="primary" className="w-full sm:w-40">Start Transfer</Button>
            </Link>
            <Link to="/receive" className="w-full sm:w-auto">
              <Button variant="secondary" className="w-full sm:w-40">Receive File</Button>
            </Link>
          </motion.div>

          <motion.div {...fadeUp} className="flex flex-wrap gap-2">
            <Badge color="gray" dot={false}>WebRTC DTLS Encrypted</Badge>
            <Badge color="gray" dot={false}>Merkle verified</Badge>
          </motion.div>
        </div>

        <div className="relative min-h-[300px] sm:min-h-[400px] lg:min-h-auto lg:w-3/5">
          <LandingGraph className="absolute inset-0 h-full w-full" />
        </div>
      </div>

      <footer className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4 text-xs text-[var(--txt-muted)] sm:px-8">
        <span>MESH v0.1.0</span>
        <span>&copy; {new Date().getFullYear()} Mesh</span>
      </footer>
    </div>
  )
}
