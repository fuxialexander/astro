/**
 * Authentication Middleware
 *
 * Validates Supabase JWT from the Authorization header.
 * Attaches user info to the Hono context for downstream handlers.
 *
 * CSRF Protection:
 * This app uses stateless JWT tokens in Authorization headers (Bearer tokens), not cookies.
 * CSRF attacks are NOT a concern because:
 * - CSRF requires browsers to automatically send credentials (cookies)
 * - Authorization headers are not automatically sent by browsers
 * - Attackers cannot make browsers send custom headers due to CORS restrictions
 *
 * If cookies were used for session management, we would need:
 * - SameSite=Strict or SameSite=Lax on all auth cookies
 * - CSRF tokens for state-changing requests
 */

import type { Context, Next } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { shouldUseSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase.js'

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
  // If Supabase is not configured or IndexedDB-only mode, allow unauthenticated access (dev mode)
  if (!shouldUseSupabase()) {
    // Use a fixed UUID for dev-user to satisfy PostgreSQL UUID constraints
    c.set('user', { id: '00000000-0000-0000-0000-000000000000', email: 'dev@localhost' } satisfies AuthUser)
    return next()
  }

  // Extract token from Authorization header or query param (for SSE/EventSource)
  let token: string | undefined
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    // Fallback to query param for EventSource connections (can't send custom headers)
    token = c.req.query('token')
  }

  if (!token) {
    return c.json({ error: 'Missing or invalid Authorization header or token query param' }, 401)
  }

  // Test token bypass for e2e testing (only in test mode with explicit flag)
  if (process.env.NODE_ENV === 'test' && process.env.ALLOW_E2E_BYPASS === 'true' && token === 'test-e2e-token') {
    console.warn('[auth] ⚠️  WARNING: Using test token bypass - only for testing!')
    c.set('user', { id: '00000000-0000-0000-0000-000000000000', email: 'dev@localhost' } satisfies AuthUser)
    return next()
  }

  try {
    // Verify the token by calling Supabase auth.getUser()
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      console.error('[auth] Token validation failed:', error?.message || 'No user')
      return c.json({ error: 'Invalid or expired token' }, 401)
    }

    // Success - only log errors to reduce noise
    c.set('user', { id: user.id, email: user.email } satisfies AuthUser)
    return next()
  } catch (err) {
    console.error('[auth] Token validation error:', err)
    return c.json({ error: 'Authentication failed' }, 401)
  }
}

/**
 * Optional auth middleware - attaches user if present, continues regardless.
 */
export async function optionalAuth(c: Context, next: Next) {
  if (!shouldUseSupabase()) {
    // Use a fixed UUID for dev-user to satisfy PostgreSQL UUID constraints
    c.set('user', { id: '00000000-0000-0000-0000-000000000000', email: 'dev@localhost' } satisfies AuthUser)
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
