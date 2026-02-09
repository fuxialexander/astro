/**
 * Supabase Service Role Client
 *
 * Used by the Hono backend for server-side operations that bypass RLS.
 * The service role key should NEVER be exposed to the client.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''

let serviceClient: SupabaseClient | null = null
let anonClient: SupabaseClient | null = null

/**
 * Get the service-role Supabase client (bypasses RLS).
 * Use for server-side writes like execution result writeback.
 */
export function getServiceClient(): SupabaseClient {
  if (!serviceClient) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. ' +
        'See supabase/config.toml for local dev setup.'
      )
    }
    serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return serviceClient
}

/**
 * Get an anon Supabase client for verifying user tokens.
 */
export function getAnonClient(): SupabaseClient {
  if (!anonClient) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_ANON_KEY must be set.'
      )
    }
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return anonClient
}

/**
 * Create a Supabase client scoped to a specific user's JWT.
 * Used to execute queries with RLS applied for that user.
 */
export function createUserClient(accessToken: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set.')
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Check if Supabase is configured.
 */
export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && (SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY))
}

export { SUPABASE_URL, SUPABASE_ANON_KEY }
