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
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase.js'
import { isLocalMode } from '../lib/app-mode.js'
import { LOCAL_USER_ID, LOCAL_TEAM_ID } from '../lib/db/bootstrap-local.js'

export interface AuthUser {
  id: string
  email?: string
  teamId: string      // Active team
  teamIds: string[]   // All user's teams
}

/**
 * Resolve the user's teams and active team.
 *
 * In server mode, queries team_members to find all teams and resolves
 * the active team from the X-Team-Id header (falling back to the first team).
 */
async function resolveTeams(userId: string, requestedTeamId?: string): Promise<{ teamId: string; teamIds: string[] }> {
  const { db } = await import('../lib/db/index.js')
  const { teamMembers, teams } = await import('../lib/db/schema.js')
  const { eq } = await import('drizzle-orm')

  let memberships = await db.select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))

  // Auto-create a personal team if user has no team memberships.
  // This handles users who registered before team auto-creation was added.
  if (memberships.length === 0) {
    console.log('[auth] No team found for user', userId, '— auto-creating personal team')
    const [team] = await db.insert(teams).values({
      name: 'Personal',
      description: 'Auto-created personal workspace',
    }).returning()

    await db.insert(teamMembers).values({
      teamId: team.id,
      userId,
      role: 'owner',
    })

    memberships = [{ teamId: team.id }]
  }

  const teamIds = memberships.map(m => m.teamId)

  // Determine active team: prefer X-Team-Id header, fall back to first team
  let teamId = teamIds[0]
  if (requestedTeamId && teamIds.includes(requestedTeamId)) {
    teamId = requestedTeamId
  }

  return { teamId, teamIds }
}

/**
 * Middleware that requires a valid Supabase JWT.
 *
 * In development without Supabase configured, accepts a browser user ID
 * from the X-User-Id header to provide per-browser user isolation.
 */
export async function requireAuth(c: Context, next: Next) {
  // If Supabase is not configured or IndexedDB-only mode, allow unauthenticated access (dev mode)
  if (isLocalMode()) {
    // In local mode, use fixed local user and team IDs
    const browserUserId = c.req.header('X-User-Id')
    const userId = browserUserId || LOCAL_USER_ID

    c.set('user', {
      id: userId,
      email: 'dev@localhost',
      teamId: LOCAL_TEAM_ID,
      teamIds: [LOCAL_TEAM_ID],
    } satisfies AuthUser)
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
    c.set('user', {
      id: LOCAL_USER_ID,
      email: 'dev@localhost',
      teamId: LOCAL_TEAM_ID,
      teamIds: [LOCAL_TEAM_ID],
    } satisfies AuthUser)
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

    // Resolve team memberships
    const requestedTeamId = c.req.header('X-Team-Id')
    const { teamId, teamIds } = await resolveTeams(user.id, requestedTeamId || undefined)

    // Success - only log errors to reduce noise
    c.set('user', {
      id: user.id,
      email: user.email,
      teamId,
      teamIds,
    } satisfies AuthUser)
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
  if (isLocalMode()) {
    // Use fixed local user and team IDs
    c.set('user', {
      id: LOCAL_USER_ID,
      email: 'dev@localhost',
      teamId: LOCAL_TEAM_ID,
      teamIds: [LOCAL_TEAM_ID],
    } satisfies AuthUser)
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
      const requestedTeamId = c.req.header('X-Team-Id')
      const { teamId, teamIds } = await resolveTeams(user.id, requestedTeamId || undefined)

      c.set('user', {
        id: user.id,
        email: user.email,
        teamId,
        teamIds,
      } satisfies AuthUser)
    }
  } catch {
    // Continue without auth
  }

  return next()
}
