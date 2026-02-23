/**
 * Application Mode Detection (Core)
 *
 * Pure env-var-based check. Works in Node.js (server, CLI, sidecar).
 * Frontend has its own detection via Vite env vars (src/lib/app-mode.ts).
 *
 * - Local Mode: PGlite database, no auth, single-user
 * - Server Mode: Supabase-backed, auth required, multi-user
 */

export type AppMode = 'local' | 'server'

/**
 * Returns true when running in local-only mode (PGlite database, no auth).
 */
export function isLocalMode(): boolean {
  // Explicit override
  if (process.env.ASTRO_LOCAL_MODE === 'true') {
    return true;
  }

  // Auto-detect: if Supabase env vars not set, use local mode
  const hasSupabase = !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY
  );

  return !hasSupabase;
}

/**
 * Returns true when running in server mode (Supabase + Postgres).
 */
export function isServerMode(): boolean {
  return !isLocalMode()
}

export function getAppMode(): AppMode {
  return isLocalMode() ? 'local' : 'server'
}
