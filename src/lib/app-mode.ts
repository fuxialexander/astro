/**
 * Application Mode Detection (Frontend)
 *
 * Wraps the underlying Supabase detection with clearer semantics.
 * - Local Mode: PGlite database, no auth, single-user
 * - Server Mode: Postgres database, auth required, multi-user
 */

import { shouldUseSupabase } from './supabase-client'

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
