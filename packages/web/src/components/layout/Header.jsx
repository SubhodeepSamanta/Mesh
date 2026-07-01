import { Link, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle.jsx'

const NAV_LINKS = [
  { to: '/send', label: 'Send' },
  { to: '/receive', label: 'Receive' },
  { to: '/history', label: 'History' },
]

export default function Header() {
  const location = useLocation()

  return (
    <header className="sticky top-0 z-40 border-b border-black/5 dark:border-white/5 bg-white/80 dark:bg-[#0e0e14]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-500" />
          Mesh
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                location.pathname === link.to
                  ? 'bg-brand-500 text-white'
                  : 'text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10'
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