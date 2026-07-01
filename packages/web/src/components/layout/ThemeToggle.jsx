import { useUIStore } from '../../store/useUIStore.js'

export default function ThemeToggle() {
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)

  return (
    <button
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-lg transition hover:bg-black/5 dark:hover:bg-white/10"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}
