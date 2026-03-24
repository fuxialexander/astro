/**
 * Terminal store — manages multiple terminal sessions.
 * Each session corresponds to a Rust PTY spawned via Tauri IPC.
 */
import { create } from 'zustand'

export interface TerminalSession {
  id: string
  label: string
  cwd: string
  alive: boolean
  createdAt: number
}

interface TerminalState {
  sessions: TerminalSession[]
  activeSessionId: string | null

  addSession: (session: TerminalSession) => void
  removeSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  markDead: (id: string) => void
  updateLabel: (id: string, label: string) => void
}

export const useTerminalStore = create<TerminalState>()((set) => ({
  sessions: [],
  activeSessionId: null,

  addSession: (session) =>
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: session.id,
    })),

  removeSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((t) => t.id !== id)
      const activeSessionId =
        s.activeSessionId === id
          ? (sessions[sessions.length - 1]?.id ?? null)
          : s.activeSessionId
      return { sessions, activeSessionId }
    }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  markDead: (id) =>
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === id ? { ...t, alive: false } : t,
      ),
    })),

  updateLabel: (id, label) =>
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === id ? { ...t, label } : t,
      ),
    })),
}))
