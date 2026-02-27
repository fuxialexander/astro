/**
 * Claude Code Sessions Store
 *
 * Fetches and caches Claude Code sessions from connected machines
 * via GET /api/relay/sessions.
 */

import { create } from "zustand"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"

export interface ClaudeCodeSession {
  sessionId: string
  summary: string
  lastModified: number
  fileSize: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  machineId: string
  machineName: string
}

interface ClaudeSessionsState {
  sessions: ClaudeCodeSession[]
  loading: boolean
  error: string | null
  lastLoadedAt: number | null
  loadSessions: () => Promise<void>
}

export const useClaudeSessionsStore = create<ClaudeSessionsState>((set, get) => ({
  sessions: [],
  loading: false,
  error: null,
  lastLoadedAt: null,

  loadSessions: async () => {
    // Debounce: skip if loaded within last 5 seconds
    const { lastLoadedAt, loading } = get()
    if (loading) return
    if (lastLoadedAt && Date.now() - lastLoadedAt < 5000) return

    set({ loading: true, error: null })

    try {
      const token = await getAccessToken()
      const headers: HeadersInit = { "Content-Type": "application/json" }
      if (token) headers["Authorization"] = `Bearer ${token}`

      const response = await fetch(apiUrl("/api/relay/sessions"), { headers })
      if (!response.ok) {
        throw new Error(`Failed to fetch sessions: ${response.statusText}`)
      }

      const data = await response.json() as {
        sessions: ClaudeCodeSession[]
        errors: Array<{ machineId: string; machineName?: string; error: string }>
      }

      // Build a friendly per-machine error summary
      let errorMsg: string | null = null
      if (data.errors.length > 0) {
        const parts = data.errors.map((e) => {
          const name = e.machineName || e.machineId.slice(0, 12)
          return `${name}: ${e.error}`
        })
        const total = data.errors.length
        errorMsg = total === 1
          ? parts[0]
          : `${total} machines unreachable — ${parts.join("; ")}`
      }

      set({
        sessions: data.sessions,
        loading: false,
        lastLoadedAt: Date.now(),
        error: errorMsg,
      })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load sessions",
      })
    }
  },
}))
