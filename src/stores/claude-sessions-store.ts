/**
 * Claude Code Sessions Store
 *
 * Fetches and caches Claude Code sessions from connected machines
 * via GET /api/relay/sessions.
 *
 * Uses stale-while-revalidate pattern:
 * - Shows cached sessions immediately
 * - Refreshes in background with delta updates (only fetching sessions modified since last load)
 * - Merges new/updated sessions into the cached list
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
  /** True when refreshing in background (cached data still visible) */
  refreshing: boolean
  error: string | null
  lastLoadedAt: number | null
  loadSessions: () => Promise<void>
}

/** Merge delta sessions into existing cached list. New/updated sessions replace old ones by sessionId+machineId. */
function mergeSessions(existing: ClaudeCodeSession[], delta: ClaudeCodeSession[]): ClaudeCodeSession[] {
  const map = new Map<string, ClaudeCodeSession>()
  for (const s of existing) {
    map.set(`${s.machineId}:${s.sessionId}`, s)
  }
  for (const s of delta) {
    map.set(`${s.machineId}:${s.sessionId}`, s)
  }
  return Array.from(map.values()).sort((a, b) => b.lastModified - a.lastModified)
}

export const useClaudeSessionsStore = create<ClaudeSessionsState>((set, get) => ({
  sessions: [],
  loading: false,
  refreshing: false,
  error: null,
  lastLoadedAt: null,

  loadSessions: async () => {
    const { lastLoadedAt, loading, sessions } = get()
    if (loading) return

    // Debounce: skip if loaded within last 5 seconds
    if (lastLoadedAt && Date.now() - lastLoadedAt < 5000) return

    const hasCachedData = sessions.length > 0
    // If we have cached data, show it immediately and refresh in background
    if (hasCachedData) {
      set({ refreshing: true, error: null })
    } else {
      set({ loading: true, error: null })
    }

    try {
      const token = await getAccessToken()
      const headers: HeadersInit = { "Content-Type": "application/json" }
      if (token) headers["Authorization"] = `Bearer ${token}`

      // If we have cached data, request only sessions modified since last load (delta)
      const url = hasCachedData && lastLoadedAt
        ? apiUrl(`/api/relay/sessions?since=${lastLoadedAt}`)
        : apiUrl("/api/relay/sessions")

      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`Failed to fetch sessions: ${response.statusText}`)
      }

      const data = await response.json() as {
        sessions: ClaudeCodeSession[]
        errors: Array<{ machineId: string; machineName?: string; error: string }>
        delta?: boolean
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

      // Delta merge or full replace
      const currentSessions = get().sessions
      const merged = data.delta
        ? mergeSessions(currentSessions, data.sessions)
        : data.sessions

      set({
        sessions: merged,
        loading: false,
        refreshing: false,
        lastLoadedAt: Date.now(),
        error: errorMsg,
      })
    } catch (err) {
      set({
        loading: false,
        refreshing: false,
        error: err instanceof Error ? err.message : "Failed to load sessions",
      })
    }
  },
}))
