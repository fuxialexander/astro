/**
 * Supabase Client (Frontend)
 *
 * Uses the anon key for client-side access with RLS.
 * Handles session management and provides typed helpers.
 */

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

let supabaseClient: SupabaseClient | null = null

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
 * Check if Supabase is configured.
 */
export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY)
}

/**
 * Get the current access token for Hono API calls.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase()
  if (!supabase) return null

  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

/**
 * Get the current session.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase()
  if (!supabase) return null

  const { data: { session } } = await supabase.auth.getSession()
  return session
}
