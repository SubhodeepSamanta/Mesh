import { Link, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle.jsx'

const NAV_LINKS = [
  { to: '/send', label: 'Send' },
  { to: '/receive', label: 'Receive' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/history', label: 'History' },
]

export default function Header() {
  const location = useLocation()

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg-primary)]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link to="/" className="flex items-center gap-2 text-base font-semibold tracking-tight text-[var(--txt-primary)]">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
          mesh
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`rounded-md px-3 py-1.5 text-xs font-medium tracking-wider uppercase transition-colors ${
                location.pathname === link.to
                  ? 'text-amber-400 bg-amber-500/10'
                  : 'text-[var(--txt-secondary)] hover:text-[var(--txt-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  )
}
