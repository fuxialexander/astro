/**
 * HIPAA Auth Helpers — self-signed JWT mint + verify, and PGlite user creation.
 *
 * In HIPAA mode there is no Supabase Auth. Sessions are signed JWTs (HS256)
 * keyed by RELAY_JWT_SECRET (already required by assertHipaaStartupConfig()).
 * Tokens carry the same `sub` / `email` / `iat` / `exp` shape used downstream
 * by the auth middleware so the rest of the stack does not care about mode.
 *
 * User rows live in the `user_profiles` table (Drizzle source of truth). On
 * first registration we insert a row directly — there is no Supabase trigger
 * to do it for us.
 */
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from './db/index.js'
import { userProfiles, teams, teamMembers } from './db/schema.js'
import { PERSONAL_WORKSPACE_DESCRIPTION } from './team-utils.js'

/** 24h session — HIPAA Phase 2 explicitly defers refresh-token rotation. */
const HIPAA_JWT_EXPIRES_IN_SECONDS = 24 * 60 * 60

export interface HipaaJwtPayload {
  sub: string       // user id (uuid)
  email: string
  iat: number
  exp: number
}

function getSecret(): string {
  const secret = process.env.RELAY_JWT_SECRET
  if (!secret) {
    // assertHipaaStartupConfig() refuses to boot HIPAA without this — but in
    // SaaS / dev runs of the test suite the helper might still be imported.
    throw new Error('RELAY_JWT_SECRET is required to mint HIPAA session tokens')
  }
  return secret
}

/**
 * Mint a HIPAA session JWT for the given user.
 * 24-hour expiry, HS256 with RELAY_JWT_SECRET.
 */
export function mintHipaaSessionToken(user: { id: string; email: string }): {
  token: string
  expiresAt: number
} {
  const nowSec = Math.floor(Date.now() / 1000)
  const exp = nowSec + HIPAA_JWT_EXPIRES_IN_SECONDS
  const token = jwt.sign(
    { sub: user.id, email: user.email, iat: nowSec, exp },
    getSecret(),
    { algorithm: 'HS256' },
  )
  return { token, expiresAt: exp }
}

/**
 * Verify a HIPAA session JWT. Returns the payload on success, null on failure.
 * Callers should treat any error (expired, malformed, bad signature) as
 * unauthenticated — the middleware logs and returns 401.
 */
export function verifyHipaaSessionToken(token: string): HipaaJwtPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: ['HS256'] }) as HipaaJwtPayload
    if (!decoded.sub || !decoded.email) return null
    return decoded
  } catch {
    return null
  }
}

/**
 * Create a HIPAA user row in user_profiles + an owning personal team.
 * Idempotent on email — returns the existing user if one is present.
 *
 * In SaaS this is normally done by a Supabase auth trigger; HIPAA mode does
 * the equivalent inline. Caller is responsible for ensuring the email was
 * verified by a successful WebAuthn ceremony.
 */
export async function createHipaaUser(input: {
  email: string
  name?: string
}): Promise<{ id: string; email: string; name: string }> {
  // Self-heal: if a profile already exists for this email, reuse it.
  const existing = await db
    .select({ id: userProfiles.id, email: userProfiles.email, name: userProfiles.name })
    .from(userProfiles)
    .where(eq(userProfiles.email, input.email))
    .limit(1)
  if (existing.length > 0) {
    return existing[0]
  }

  const id = randomUUID()
  const name = input.name?.trim() || input.email
  await db.insert(userProfiles).values({
    id,
    email: input.email,
    name,
  })

  // Auto-create a personal team for the new user (mirrors SaaS behavior).
  try {
    const [team] = await db
      .insert(teams)
      .values({
        name: `${name}'s workspace`,
        description: PERSONAL_WORKSPACE_DESCRIPTION,
      })
      .returning()
    await db.insert(teamMembers).values({
      teamId: team.id,
      userId: id,
      role: 'owner',
    })
  } catch (err) {
    // Non-fatal: requireAuth.resolveTeams() auto-creates a team on first request.
    console.error('[hipaa-auth] Failed to create personal team (will retry on login):', err)
  }

  return { id, email: input.email, name }
}

/** Look up a HIPAA user by email. Returns null if not present. */
export async function findHipaaUserByEmail(email: string): Promise<{
  id: string
  email: string
  name: string
} | null> {
  const rows = await db
    .select({ id: userProfiles.id, email: userProfiles.email, name: userProfiles.name })
    .from(userProfiles)
    .where(eq(userProfiles.email, email))
    .limit(1)
  return rows[0] ?? null
}
