import { Link } from 'react-router-dom'
import Button from '../components/shared/Button.jsx'

export default function LandingPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center px-6 py-24 text-center">
      <span className="mb-4 rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/60 dark:border-white/10 dark:text-white/60">
        Peer-to-peer · Encrypted · No server storage
      </span>
      <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
        Send files, directly.
      </h1>
      <p className="mt-6 max-w-xl text-lg text-black/60 dark:text-white/60">
        Mesh moves files straight between browsers over an encrypted connection.
        Nothing is ever uploaded to a server in between.
      </p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link to="/send">
          <Button variant="primary" className="w-48">Send a file</Button>
        </Link>
        <Link to="/receive">
          <Button variant="secondary" className="w-48">Receive a file</Button>
        </Link>
      </div>
    </div>
  )
}