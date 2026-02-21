import { create } from "zustand"

export type ToastType = "info" | "success" | "warning" | "error"

export interface Toast {
  id: string
  type: ToastType
  title: string
  description?: string
  duration?: number // ms, defaults to 4000
}

interface ToastState {
  toasts: Toast[]
  add: (toast: Omit<Toast, "id">) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  add: (toast) => {
    const id = Math.random().toString(36).slice(2, 11)
    const newToast: Toast = { ...toast, id }

    set((state) => ({
      toasts: [...state.toasts, newToast],
    }))

    // Auto-dismiss after duration
    const duration = toast.duration ?? 4000
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }))
    }, duration)
  },

  dismiss: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },
}))
