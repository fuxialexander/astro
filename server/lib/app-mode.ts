/**
 * Application Mode Detection (Server)
 *
 * Wraps the underlying environment detection with clearer semantics.
 * - Local Mode: IndexedDB only, no auth middleware, single-user
 * - Server Mode: Supabase-backed, auth required, multi-user
 */

import { isIndexedDBMode } from './environment.js'

export type AppMode = 'local' | 'server'

export function getAppMode(): AppMode {
  return isIndexedDBMode() ? 'local' : 'server'
}

/**
 * Returns true when running in local-only mode (no Supabase).
 */
export function isLocalMode(): boolean {
  return isIndexedDBMode()
}

/**
 * Returns true when running in server mode (Supabase + Postgres).
 */
export function isServerMode(): boolean {
  return !isIndexedDBMode()
}
