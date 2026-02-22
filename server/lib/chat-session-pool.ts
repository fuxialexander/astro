/**
 * Chat Session Pool
 *
 * Server-side TTL map that stores SDK session IDs returned from chat completions.
 * Enables hybrid resume/fallback: try SDK resume first (fast, preserves context),
 * fall back to inline history if resume fails or session expired.
 *
 * Backed by Postgres via Drizzle ORM (chatSessions table).
 */

import { db } from './db/index.js'
import { chatSessions } from './db/schema.js'
import { eq, lt, sql } from 'drizzle-orm'

export interface ChatSessionEntry {
  /** SDK session ID returned from a successful query/stream */
  sdkSessionId: string
  /** Provider that created this session */
  providerId: string
  /** When the entry was created */
  createdAt: number
  /** When the entry was last accessed (sliding TTL) */
  lastUsedAt: number
}

/** Default TTL: 30 minutes */
const DEFAULT_TTL_MS = 30 * 60 * 1000

// Key format: `${projectId}:plan-chat` or `${projectId}:task-chat:${nodeId}`

/**
 * Store an SDK session ID after a successful chat completion.
 * Upserts: inserts if new, updates if key already exists.
 */
export async function storeSession(key: string, sdkSessionId: string, providerId: string): Promise<void> {
  const now = new Date()
  await db.insert(chatSessions)
    .values({
      key,
      sdkSessionId,
      providerId,
      createdAt: now,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: chatSessions.key,
      set: {
        sdkSessionId,
        providerId,
        lastUsedAt: now,
      },
    })
}

/**
 * Get a session entry if it exists and hasn't expired.
 * Updates `lastUsedAt` for sliding TTL.
 */
export async function getSession(key: string, ttlMs: number = DEFAULT_TTL_MS): Promise<ChatSessionEntry | undefined> {
  const rows = await db.select()
    .from(chatSessions)
    .where(eq(chatSessions.key, key))
    .limit(1)

  if (rows.length === 0) return undefined

  const row = rows[0]
  const now = Date.now()
  const lastUsedAt = row.lastUsedAt.getTime()

  if (now - lastUsedAt > ttlMs) {
    // Expired — delete and return undefined
    await db.delete(chatSessions).where(eq(chatSessions.key, key))
    return undefined
  }

  // Update lastUsedAt for sliding TTL
  const newLastUsed = new Date()
  await db.update(chatSessions)
    .set({ lastUsedAt: newLastUsed })
    .where(eq(chatSessions.key, key))

  return {
    sdkSessionId: row.sdkSessionId,
    providerId: row.providerId,
    createdAt: row.createdAt.getTime(),
    lastUsedAt: newLastUsed.getTime(),
  }
}

/**
 * Remove a specific session entry (e.g., when resume fails).
 */
export async function removeSession(key: string): Promise<void> {
  await db.delete(chatSessions).where(eq(chatSessions.key, key))
}

/**
 * Remove all expired entries from the pool.
 * Returns the number of entries cleaned up.
 */
export async function cleanupExpired(ttlMs: number = DEFAULT_TTL_MS): Promise<number> {
  const cutoff = new Date(Date.now() - ttlMs)
  const rows = await db.delete(chatSessions)
    .where(lt(chatSessions.lastUsedAt, cutoff))
    .returning({ key: chatSessions.key })
  return rows.length
}

/**
 * Get the current pool size (for diagnostics).
 */
export async function poolSize(): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)` })
    .from(chatSessions)
  return Number(rows[0].count)
}

/**
 * Clear all entries (for testing).
 */
export async function clearAll(): Promise<void> {
  await db.delete(chatSessions)
}
