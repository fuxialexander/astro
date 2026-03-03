/**
 * GitHub Comment Deduplication Cache
 *
 * When users post comments through Astro's API, the webhook will echo
 * those comments back. This cache tracks recently posted comment IDs
 * so the webhook handler can skip processing duplicates.
 *
 * Uses an in-memory TTL cache (no persistence needed — only for the
 * short window between POST and webhook delivery, typically < 30s).
 */

const CACHE_TTL_MS = 120_000 // 2 minutes — generous window for webhook delay
const MAX_CACHE_SIZE = 1000

interface CacheEntry {
  expiresAt: number
  projectId?: string
}

class GitHubCommentDedupCache {
  private cache = new Map<number, CacheEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Periodic cleanup every 60s
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000)
  }

  /**
   * Record a comment ID that was posted from Astro.
   * This comment will be ignored when echoed back via webhook.
   */
  recordPosted(commentId: number, projectId?: string): void {
    // Evict oldest entries if cache is too large
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(commentId, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      projectId,
    })
  }

  /**
   * Check if a comment was posted from Astro (and should be skipped).
   * Returns true if the comment is an echo and should be ignored.
   * Does NOT consume the entry — allows webhook retries to also be deduplicated.
   * The TTL-based cleanup handles expiration.
   */
  isEcho(commentId: number): boolean {
    const entry = this.cache.get(commentId)
    if (!entry) return false

    if (entry.expiresAt < Date.now()) {
      this.cache.delete(commentId)
      return false
    }

    return true
  }

  /**
   * Get the number of tracked comments (for diagnostics).
   */
  get size(): number {
    return this.cache.size
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt < now) {
        this.cache.delete(key)
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.cache.clear()
  }
}

export const githubCommentDedup = new GitHubCommentDedupCache()
