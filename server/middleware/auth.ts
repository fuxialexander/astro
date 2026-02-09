/**
 * Authentication Middleware
 *
 * Validates Supabase JWT from the Authorization header.
 * Attaches user info to the Hono context for downstream handlers.
 */

import type { Context, Next } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase.js'

export interface AuthUser {
  id: string
  email?: string
}

/**
 * Middleware that requires a valid Supabase JWT.
 *
 * In development without Supabase configured, passes through with a
 * default user ID (preserving the current zero-auth dev experience).
 */
export async function requireAuth(c: Context, next: Next) {
  // If Supabase is not configured, allow unauthenticated access (dev mode)
  if (!isSupabaseConfigured()) {
    c.set('user', { id: 'dev-user', email: 'dev@localhost' } satisfies AuthUser)
    return next()
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)

  try {
    // Verify the token by calling Supabase auth.getUser()
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }

    c.set('user', { id: user.id, email: user.email } satisfies AuthUser)
    return next()
  } catch {
    return c.json({ error: 'Authentication failed' }, 401)
  }
}

/**
 * Optional auth middleware - attaches user if present, continues regardless.
 */
export async function optionalAuth(c: Context, next: Next) {
  if (!isSupabaseConfigured()) {
    c.set('user', { id: 'dev-user', email: 'dev@localhost' } satisfies AuthUser)
    return next()
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return next()
  }

  const token = authHeader.slice(7)

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user } } = await supabase.auth.getUser(token)
    if (user) {
      c.set('user', { id: user.id, email: user.email } satisfies AuthUser)
    }
  } catch {
    // Continue without auth
  }

  return next()
}
