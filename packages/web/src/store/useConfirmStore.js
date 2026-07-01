import { create } from 'zustand'

export const useConfirmStore = create((set) => ({
  isOpen: false,
  title: '',
  message: '',
  onConfirm: null,
  onCancel: null,

  confirm: (message, title = 'Confirm Action') => {
    return new Promise((resolve) => {
      set({
        isOpen: true,
        title,
        message,
        onConfirm: () => {
          set({ isOpen: false, onConfirm: null, onCancel: null })
          resolve(true)
        },
        onCancel: () => {
          set({ isOpen: false, onConfirm: null, onCancel: null })
          resolve(false)
        },
      })
    })
  },
}))
