/**
 * Application Mode Detection (Server)
 *
 * Wraps the underlying environment detection with clearer semantics.
 * - Local Mode: PGlite database, no auth, single-user
 * - Server Mode: Supabase-backed, auth required, multi-user
 */

import { isLocalMode as isLocalModeEnv } from './environment.js'

export type AppMode = 'local' | 'server'

export function getAppMode(): AppMode {
  return isLocalModeEnv() ? 'local' : 'server'
}

/**
 * Returns true when running in local-only mode (PGlite database, no auth).
 */
export function isLocalMode(): boolean {
  return isLocalModeEnv()
}

/**
 * Returns true when running in server mode (Supabase + Postgres).
 */
export function isServerMode(): boolean {
  return !isLocalModeEnv()
}
