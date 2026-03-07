/**
 * Notification Store
 *
 * Persistent notifications that appear on the dashboard and must be
 * manually dismissed by the user (unlike ephemeral toasts).
 *
 * Used for project completion messages, PR creation confirmations, etc.
 */

import { create } from "zustand"

export type NotificationType = "info" | "success" | "warning" | "error"

export interface Notification {
  id: string
  type: NotificationType
  title: string
  /** Supports markdown backticks for inline code rendering */
  description: string
  /** ISO timestamp */
  createdAt: string
  /** Optional project ID for linking */
  projectId?: string
  /** Optional PR URL for direct linking */
  prUrl?: string
}

interface NotificationState {
  notifications: Notification[]
  add: (notification: Omit<Notification, "id" | "createdAt">) => void
  dismiss: (id: string) => void
  dismissAll: () => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  add: (notification) => {
    const id = Math.random().toString(36).slice(2, 11)
    const entry: Notification = {
      ...notification,
      id,
      createdAt: new Date().toISOString(),
    }
    set((state) => ({
      notifications: [entry, ...state.notifications],
    }))
  },

  dismiss: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }))
  },

  dismissAll: () => {
    set({ notifications: [] })
  },
}))
