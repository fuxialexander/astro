/**
 * External Agent Sessions Store
 *
 * Fetches and caches on-disk sessions from connected machines across
 * Claude Code, Codex, and Pi via GET /api/relay/sessions. Supports
 * optional `providers` and `cwd` filters for scoped discovery (used by
 * the inbox "Import from history" picker).
 *
 * Uses stale-while-revalidate:
 *   - Shows cached sessions immediately.
 *   - Refreshes in background with delta updates (only fetching sessions
 *     modified since last load) when no filters are active.
 *   - Scoped loads (providers / cwd) bypass the cache and the SWR delta
 *     path entirely so the picker sees fresh, narrowly-scoped results.
 */

import { create } from "zustand"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import type { ExternalAgentProvider, ExternalAgentSession } from "@/types/imports"

/**
 * @deprecated Use `ExternalAgentSession` from `@/types/imports`. Retained
 * as a structural alias so existing call sites continue to compile. This
 * alias will be removed after the "Import from history" feature ships.
 */
export type ClaudeCodeSession = ExternalAgentSession

export type { ExternalAgentSession } from "@/types/imports"

export interface LoadSessionsOptions {
  /** Restrict to a subset of providers. Omit for all supported providers. */
  providers?: ExternalAgentProvider[]
  /** If set, only sessions whose cwd equals this absolute path are returned. */
  cwd?: string
}

interface ExternalSessionsState {
  sessions: ExternalAgentSession[]
  loading: boolean
  /** True when refreshing in background (cached data still visible). */
  refreshing: boolean
  error: string | null
  lastLoadedAt: number | null
  /**
   * Load sessions. Call with no args for the normal stale-while-revalidate
   * fan-out; pass `{providers, cwd}` for a scoped, always-fresh load
   * (e.g. from the Import-from-history picker).
   */
  loadSessions: (opts?: LoadSessionsOptions) => Promise<void>
}

/** Merge delta sessions into existing cached list. New/updated sessions replace old ones by sessionId+machineId. */
function mergeSessions(existing: ExternalAgentSession[], delta: ExternalAgentSession[]): ExternalAgentSession[] {
  const map = new Map<string, ExternalAgentSession>()
  for (const s of existing) {
    map.set(`${s.machineId}:${s.sessionId}`, s)
  }
  for (const s of delta) {
    map.set(`${s.machineId}:${s.sessionId}`, s)
  }
  return Array.from(map.values()).sort((a, b) => b.lastModified - a.lastModified)
}

/**
 * @deprecated Use `useExternalSessionsStore`. This name is retained for
 * backward compatibility with existing call sites.
 */
export const useClaudeSessionsStore = create<ExternalSessionsState>((set, get) => ({
  sessions: [],
  loading: false,
  refreshing: false,
  error: null,
  lastLoadedAt: null,

  loadSessions: async (opts?: LoadSessionsOptions) => {
    const { lastLoadedAt, loading, sessions } = get()
    if (loading) return

    const scoped = Boolean(opts?.providers?.length || opts?.cwd)

    // Debounce only unscoped loads — scoped requests are user-driven and
    // should always hit the backend.
    if (!scoped && lastLoadedAt && Date.now() - lastLoadedAt < 5000) return

    const hasCachedData = !scoped && sessions.length > 0
    if (hasCachedData) {
      set({ refreshing: true, error: null })
    } else {
      set({ loading: true, error: null })
    }

    try {
      const token = await getAccessToken()
      const headers: HeadersInit = { "Content-Type": "application/json" }
      if (token) headers["Authorization"] = `Bearer ${token}`

      const params = new URLSearchParams()
      if (hasCachedData && lastLoadedAt) params.set("since", String(lastLoadedAt))
      if (opts?.providers?.length) params.set("providers", opts.providers.join(","))
      if (opts?.cwd) params.set("cwd", opts.cwd)
      const qs = params.toString()
      const url = apiUrl(qs ? `/api/relay/sessions?${qs}` : "/api/relay/sessions")

      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`Failed to fetch sessions: ${response.statusText}`)
      }

      const data = await response.json() as {
        sessions: ExternalAgentSession[]
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

      // Scoped loads always replace; unscoped loads delta-merge when possible.
      const currentSessions = get().sessions
      const merged = !scoped && data.delta
        ? mergeSessions(currentSessions, data.sessions)
        : data.sessions

      set({
        sessions: merged,
        loading: false,
        refreshing: false,
        lastLoadedAt: scoped ? lastLoadedAt : Date.now(),
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

/** Preferred hook name going forward; `useClaudeSessionsStore` is a deprecated alias. */
export const useExternalSessionsStore = useClaudeSessionsStore
