/**
 * Application Mode Detection (Core)
 *
 * Pure env-var-based check. Works in Node.js (server, CLI, sidecar).
 * Frontend has its own detection via Vite env vars (src/lib/app-mode.ts).
 *
 * - Local Mode: PGlite database, no auth, single-user
 * - Server Mode: Supabase-backed, auth required, multi-user
 * - HIPAA Mode: AWS-only deployment, PGlite, real auth required, Bedrock AI,
 *   no external vendors (no Supabase, Cloudflare, Fly). Detected via
 *   ASTRO_HIPAA_MODE=true; wins over local/server detection.
 */

export type AppMode = 'local' | 'server' | 'hipaa'

/**
 * Returns true when running in HIPAA-compliance mode (AWS-only deployment).
 * Takes precedence over isLocalMode() / isServerMode().
 */
export function isHipaaMode(): boolean {
  return process.env.ASTRO_HIPAA_MODE === 'true'
}

/**
 * Returns true when running in local-only mode (PGlite database, no auth).
 */
export function isLocalMode(): boolean {
  // HIPAA mode is its own thing — not local
  if (isHipaaMode()) return false

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
 * HIPAA mode is not server mode — it has its own detection.
 */
export function isServerMode(): boolean {
  if (isHipaaMode()) return false
  return !isLocalMode()
}

export function getAppMode(): AppMode {
  if (isHipaaMode()) return 'hipaa'
  return isLocalMode() ? 'local' : 'server'
}
