/**
 * Chat Session Pool
 *
 * Server-side TTL map that stores SDK session IDs returned from chat completions.
 * Enables hybrid resume/fallback: try SDK resume first (fast, preserves context),
 * fall back to inline history if resume fails or session expired.
 */

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
const pool = new Map<string, ChatSessionEntry>()

/**
 * Store an SDK session ID after a successful chat completion.
 */
export function storeSession(key: string, sdkSessionId: string, providerId: string): void {
  const now = Date.now()
  pool.set(key, {
    sdkSessionId,
    providerId,
    createdAt: now,
    lastUsedAt: now,
  })
}

/**
 * Get a session entry if it exists and hasn't expired.
 * Updates `lastUsedAt` for sliding TTL.
 */
export function getSession(key: string, ttlMs: number = DEFAULT_TTL_MS): ChatSessionEntry | undefined {
  const entry = pool.get(key)
  if (!entry) return undefined

  const now = Date.now()
  if (now - entry.lastUsedAt > ttlMs) {
    pool.delete(key)
    return undefined
  }

  entry.lastUsedAt = now
  return entry
}

/**
 * Remove a specific session entry (e.g., when resume fails).
 */
export function removeSession(key: string): void {
  pool.delete(key)
}

/**
 * Remove all expired entries from the pool.
 * Returns the number of entries cleaned up.
 */
export function cleanupExpired(ttlMs: number = DEFAULT_TTL_MS): number {
  const now = Date.now()
  let cleaned = 0
  for (const [key, entry] of pool) {
    if (now - entry.lastUsedAt > ttlMs) {
      pool.delete(key)
      cleaned++
    }
  }
  return cleaned
}

/**
 * Get the current pool size (for diagnostics).
 */
export function poolSize(): number {
  return pool.size
}

/**
 * Clear all entries (for testing).
 */
export function clearAll(): void {
  pool.clear()
}
