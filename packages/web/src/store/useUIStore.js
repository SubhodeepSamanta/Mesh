import { create } from 'zustand'

const THEME_KEY = 'mesh-theme'

export const useUIStore = create((set, get) => ({
  theme: 'light',

  initTheme: () => {
    const stored = localStorage.getItem(THEME_KEY)
    const theme = stored === 'dark' ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', next === 'dark')
    localStorage.setItem(THEME_KEY, next)
    set({ theme: next })
  },
}))