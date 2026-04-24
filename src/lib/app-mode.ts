/**
 * Application Mode Detection (Frontend)
 *
 * Wraps the underlying Supabase detection with clearer semantics.
 * - Local Mode: PGlite database, no auth, single-user
 * - Server Mode: Postgres database, auth required, multi-user
 * - HIPAA Mode: AWS-only deployment, real auth required, no external vendors.
 *   Detected via VITE_ASTRO_HIPAA_MODE=true; wins over local/server.
 *
 * Note: at runtime the source of truth is the backend's /api/config endpoint
 * (see useIsHipaaMode). This Vite-env detection is only for early-boot checks
 * before the config is fetched.
 */

import { shouldUseSupabase } from './supabase-client'

export type AppMode = 'local' | 'server' | 'hipaa'

export function isHipaaMode(): boolean {
  return import.meta.env.VITE_ASTRO_HIPAA_MODE === 'true'
}

export function getAppMode(): AppMode {
  if (isHipaaMode()) return 'hipaa'
  return shouldUseSupabase() ? 'server' : 'local'
}

/**
 * Returns true when running in local-only mode (PGlite database, no auth).
 * API calls go through localhost:3001 → Hono → Drizzle → PGlite.
 */
export function isLocalMode(): boolean {
  if (isHipaaMode()) return false
  return !shouldUseSupabase()
}

/**
 * Returns true when running in server mode (Supabase + Postgres).
 * dataClient calls go through /api/data → Hono → Drizzle → Postgres.
 */
export function isServerMode(): boolean {
  if (isHipaaMode()) return false
  return shouldUseSupabase()
}
