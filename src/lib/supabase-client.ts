/**
 * Supabase Client (Frontend)
 *
 * Uses the anon key for client-side access with RLS.
 * Handles session management and provides typed helpers.
 *
 * Token caching: The access token is cached in memory after the initial
 * auth initialization. Subsequent calls to getAccessToken() return the
 * cached value instead of calling supabase.auth.getSession() each time,
 * which internally acquires a lock and can serialize concurrent requests.
 * The cache is updated on every onAuthStateChange event and on token refresh.
 */

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

let supabaseClient: SupabaseClient | null = null

// ── Token cache ──────────────────────────────────────────────────────
// Avoids calling supabase.auth.getSession() (which acquires an internal
// lock) on every API request.  The auth-store populates this on init and
// on every onAuthStateChange event.
let _cachedToken: string | null = null
let _cachedExpiresAt = 0 // epoch seconds

/**
 * Push a fresh session into the token cache.
 * Called by auth-store after getSession() and on every onAuthStateChange.
 */
export function setCachedSession(session: Session | null): void {
  _cachedToken = session?.access_token ?? null
  _cachedExpiresAt = session?.expires_at ?? 0
}

/**
 * Get the Supabase client singleton.
 * Returns null if Supabase is not configured.
 */
export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  }
  return supabaseClient
}

/**
 * Check if Supabase should be used.
 * Returns false if:
 * - Supabase is not configured
 * - VITE_ASTRO_LOCAL_MODE flag is explicitly set
 */
export function shouldUseSupabase(): boolean {
  // Explicit override to force local-only mode
  if (import.meta.env.VITE_ASTRO_LOCAL_MODE === 'true') {
    return false
  }
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY)
}

/**
 * Check if Supabase is configured.
 * @deprecated Use shouldUseSupabase() instead
 */
export function isSupabaseConfigured(): boolean {
  return shouldUseSupabase()
}

/**
 * Get the current access token for Hono API calls.
 * Uses the in-memory cache when the token is still valid (>60 s remaining).
 * Falls back to supabase.auth.getSession() if the cache is stale or empty.
 */
export async function getAccessToken(): Promise<string | null> {
  // Fast path: return cached token if it has >60 seconds remaining
  const nowSec = Math.floor(Date.now() / 1000)
  if (_cachedToken && _cachedExpiresAt > nowSec + 60) {
    return _cachedToken
  }

  // Slow path: refresh from Supabase (also triggers onAuthStateChange → setCachedSession)
  const supabase = getSupabase()
  if (!supabase) return null

  const { data: { session } } = await supabase.auth.getSession()
  setCachedSession(session)
  return session?.access_token ?? null
}

/**
 * Get the current session.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase()
  if (!supabase) return null

  const { data: { session } } = await supabase.auth.getSession()
  setCachedSession(session)
  return session
}
