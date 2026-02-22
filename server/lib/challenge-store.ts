/**
 * Challenge Store — DB-backed WebAuthn challenge storage
 *
 * Replaces the in-memory Map in auth.ts. Challenges are stored in Postgres
 * so that any server instance can verify a challenge created by any other instance.
 * This fixes the production auth bug where WebAuthn challenges on Fly Machine A
 * were invisible to Machine B → "Authentication failed" errors.
 */

import { db } from './db/index.js'
import { webauthnChallenges } from './db/schema.js'
import { eq, and, gt, lt } from 'drizzle-orm'

const CHALLENGE_TTL_MS = parseInt(process.env.CHALLENGE_TTL_MS || '300000') // 5 minutes default

/**
 * Store a challenge with TTL. Upserts — if the same key exists, it's overwritten.
 */
export async function storeChallenge(key: string, challenge: string): Promise<void> {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)

  await db.insert(webauthnChallenges)
    .values({ key, challenge, expiresAt })
    .onConflictDoUpdate({
      target: webauthnChallenges.key,
      set: { challenge, expiresAt },
    })
}

/**
 * Get and atomically delete a challenge (one-time use).
 * Returns null if challenge doesn't exist or has expired.
 */
export async function getAndDeleteChallenge(key: string): Promise<string | null> {
  const now = new Date()
  const rows = await db.delete(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.key, key),
        gt(webauthnChallenges.expiresAt, now),
      )
    )
    .returning({ challenge: webauthnChallenges.challenge })

  if (rows.length === 0) return null
  return rows[0].challenge
}

/**
 * Clean up expired challenges. Called periodically from server/index.ts.
 * Returns the number of entries removed.
 */
export async function cleanupExpiredChallenges(): Promise<number> {
  const now = new Date()
  const rows = await db.delete(webauthnChallenges)
    .where(lt(webauthnChallenges.expiresAt, now))
    .returning({ key: webauthnChallenges.key })

  return rows.length
}
