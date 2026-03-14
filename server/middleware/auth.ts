/**
 * Authentication Middleware
 *
 * Validates Supabase JWT from the Authorization header.
 * Attaches user info to the Hono context for downstream handlers.
 *
 * JWT Verification Strategy:
 * Uses local JWT signature verification instead of calling Supabase Auth API
 * (supabase.auth.getUser()) on every request. This eliminates ~11,000+ auth
 * API calls/hour that were the second-largest contributor to Supabase egress.
 *
 * Trade-off: local verification doesn't detect token revocation (e.g., after
 * password change). Supabase tokens have a 1-hour expiry by default, so
 * revoked tokens are valid for at most 1 hour — acceptable for this app.
 *
 * CSRF Protection:
 * This app uses stateless JWT tokens in Authorization headers (Bearer tokens), not cookies.
 * CSRF attacks are NOT a concern because:
 * - CSRF requires browsers to automatically send credentials (cookies)
 * - Authorization headers are not automatically sent by browsers
 * - Attackers cannot make browsers send custom headers due to CORS restrictions
 */

import type { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { isLocalMode } from '../lib/app-mode.js'
import { LOCAL_USER_ID, LOCAL_TEAM_ID } from '../lib/db/bootstrap-local.js'

export interface AuthUser {
  id: string
  email?: string
  teamId: string      // Active team
  teamIds: string[]   // All user's teams
}

// Supabase JWT secret for local token verification.
// Found in Supabase Dashboard → Settings → API → JWT Secret.
// Falls back to SUPABASE_ANON_KEY for backwards compatibility (will use
// Supabase API verification if JWT secret is not set).
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || ''

interface SupabaseJwtPayload {
  sub: string       // User UUID
  email?: string
  role?: string     // 'authenticated' | 'anon'
  aud?: string      // 'authenticated'
  iss?: string      // Supabase project URL
  iat?: number
  exp?: number
}

/**
 * Verify a Supabase JWT locally using the JWT secret.
 * Returns the decoded payload or null if verification fails.
 */
function verifySupabaseJwt(token: string): SupabaseJwtPayload | null {
  if (!SUPABASE_JWT_SECRET) return null

  try {
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, {
      algorithms: ['HS256'],
    }) as SupabaseJwtPayload

    // Ensure it's an authenticated user token (not anon)
    if (!decoded.sub || decoded.role === 'anon') return null

    return decoded
  } catch {
    return null
  }
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
  // In local mode (PGlite, no auth), allow unauthenticated access
  if (isLocalMode()) {
    // In local mode, use fixed local user and team IDs
    const browserUserId = c.req.header('X-User-Id')
    const userId = browserUserId || LOCAL_USER_ID

    if (browserUserId && browserUserId !== LOCAL_USER_ID) {
      // Resolve actual team membership for non-default users (enables integration test isolation)
      const { teamId, teamIds } = await resolveTeams(userId)
      c.set('user', { id: userId, email: 'dev@localhost', teamId, teamIds } satisfies AuthUser)
    } else {
      c.set('user', {
        id: userId,
        email: 'dev@localhost',
        teamId: LOCAL_TEAM_ID,
        teamIds: [LOCAL_TEAM_ID],
      } satisfies AuthUser)
    }
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
    // Internal server-side dispatch bypass: allow requests from the server itself
    // when dispatching downstream tasks without a browser session.
    // Only accepts requests with X-Internal-Dispatch header and resolves user from X-User-Id.
    const internalDispatch = c.req.header('X-Internal-Dispatch')
    const internalUserId = c.req.header('X-User-Id')
    const internalTeamId = c.req.header('X-Team-Id')
    if (internalDispatch === 'true' && internalUserId && internalTeamId) {
      const { teamId, teamIds } = await resolveTeams(internalUserId, internalTeamId)
      c.set('user', { id: internalUserId, teamId, teamIds } satisfies AuthUser)
      return next()
    }
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
    // Try local JWT verification first (zero network calls)
    const jwtPayload = verifySupabaseJwt(token)
    if (jwtPayload) {
      const requestedTeamId = c.req.header('X-Team-Id')
      const { teamId, teamIds } = await resolveTeams(jwtPayload.sub, requestedTeamId || undefined)

      c.set('user', {
        id: jwtPayload.sub,
        email: jwtPayload.email,
        teamId,
        teamIds,
      } satisfies AuthUser)
      return next()
    }

    // Try device auth JWT fallback (CLI tokens)
    const { verifyAccessToken } = await import('../lib/token-manager.js')
    const devicePayload = verifyAccessToken(token)
    if (devicePayload) {
      const requestedTeamId = c.req.header('X-Team-Id')
      const { teamId, teamIds } = await resolveTeams(devicePayload.userId, requestedTeamId || undefined)
      c.set('user', { id: devicePayload.userId, teamId, teamIds } satisfies AuthUser)
      return next()
    }

    // If SUPABASE_JWT_SECRET is not configured, fall back to Supabase API verification
    if (!SUPABASE_JWT_SECRET) {
      const { createClient } = await import('@supabase/supabase-js')
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('../lib/supabase.js')
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      })

      const { data: { user }, error } = await supabase.auth.getUser(token)

      if (error || !user) {
        console.error('[auth] Token validation failed:', error?.message || 'No user')
        return c.json({ error: 'Invalid or expired token' }, 401)
      }

      const requestedTeamId = c.req.header('X-Team-Id')
      const { teamId, teamIds } = await resolveTeams(user.id, requestedTeamId || undefined)

      c.set('user', {
        id: user.id,
        email: user.email,
        teamId,
        teamIds,
      } satisfies AuthUser)
      return next()
    }

    console.error('[auth] Token validation failed: JWT verification failed and no fallback matched')
    return c.json({ error: 'Invalid or expired token' }, 401)
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
    // Try local JWT verification first (zero network calls)
    const jwtPayload = verifySupabaseJwt(token)
    if (jwtPayload) {
      const requestedTeamId = c.req.header('X-Team-Id')
      const { teamId, teamIds } = await resolveTeams(jwtPayload.sub, requestedTeamId || undefined)

      c.set('user', {
        id: jwtPayload.sub,
        email: jwtPayload.email,
        teamId,
        teamIds,
      } satisfies AuthUser)
      return next()
    }

    // Try device auth JWT fallback (CLI tokens)
    const { verifyAccessToken } = await import('../lib/token-manager.js')
    const devicePayload = verifyAccessToken(token)
    if (devicePayload) {
      const requestedTeamId = c.req.header('X-Team-Id')
      const { teamId, teamIds } = await resolveTeams(devicePayload.userId, requestedTeamId || undefined)
      c.set('user', { id: devicePayload.userId, teamId, teamIds } satisfies AuthUser)
      return next()
    }

    // If SUPABASE_JWT_SECRET is not configured, fall back to Supabase API verification
    if (!SUPABASE_JWT_SECRET) {
      const { createClient } = await import('@supabase/supabase-js')
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('../lib/supabase.js')
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
    }
  } catch {
    // Continue without auth
  }

  return next()
}
