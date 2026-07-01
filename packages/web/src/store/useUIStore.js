import { create } from 'zustand'

const KEY = 'mesh-theme'

export const useUIStore = create((set, get) => ({
  theme: 'dark',

  initTheme: () => {
    const stored = localStorage.getItem(KEY)
    const theme = stored === 'light' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', next === 'dark')
    localStorage.setItem(KEY, next)
    set({ theme: next })
  },

  setPage: (page) => set({ page }),
}))
