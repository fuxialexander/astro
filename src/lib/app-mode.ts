/**
 * Application Mode Detection (Frontend)
 *
 * Wraps the underlying Supabase detection with clearer semantics.
 * - Local Mode: IndexedDB only, no auth, single-user
 * - Server Mode: Supabase-backed, auth required, multi-user
 */

import { shouldUseSupabase } from './supabase-client'

/**
 * Returns true when running in local-only mode (IndexedDB, no server).
 * dataClient will throw immediately, stores fall back to IndexedDB.
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
