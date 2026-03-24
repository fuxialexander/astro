/**
 * Application Mode Detection (Frontend)
 *
 * Wraps the underlying Supabase detection with clearer semantics.
 * - Local Mode: PGlite database, no auth, single-user
 * - Server Mode: Postgres database, auth required, multi-user
 * - Tauri Mode: Running inside a Tauri desktop app (implies local mode by default)
 */

import { shouldUseSupabase } from './supabase-client'
import { isTauri } from './tauri-detect'

export type AppMode = 'local' | 'server'

export function getAppMode(): AppMode {
  return shouldUseSupabase() ? 'server' : 'local'
}

/**
 * Returns true when running in local-only mode (PGlite database, no auth).
 * API calls go through localhost:3001 → Hono → Drizzle → PGlite.
 */
export function isLocalMode(): boolean {
  return !shouldUseSupabase()
}

/**
 * Returns true when running in server mode (Supabase + Postgres).
 * dataClient calls go through /api/data → Hono → Drizzle → Postgres.
 */
export function isServerMode(): boolean {
  return shouldUseSupabase()
}

/**
 * Returns true when running inside a Tauri desktop app.
 * Tauri mode implies local mode by default (PGlite, no auth),
 * but can be configured for connected/team mode via Supabase env vars.
 */
export function isTauriMode(): boolean {
  return isTauri()
}
