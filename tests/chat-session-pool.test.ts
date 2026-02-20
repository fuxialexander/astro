/**
 * Chat Session Pool Unit Tests
 *
 * Tests the server-side TTL map that stores SDK session IDs for chat
 * session resume/fallback. Covers CRUD, TTL expiration, sliding TTL,
 * key isolation, and diagnostics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  storeSession,
  getSession,
  removeSession,
  cleanupExpired,
  poolSize,
  clearAll,
} from '../server/lib/chat-session-pool.js'

beforeEach(() => {
  clearAll()
})

describe('Chat Session Pool', () => {
  describe('storeSession / getSession basic CRUD', () => {
    it('stores an entry and retrieves it with correct fields', () => {
      storeSession('proj-1:plan-chat', 'sdk-session-abc', 'claude-code')

      const entry = getSession('proj-1:plan-chat')
      expect(entry).toBeDefined()
      expect(entry!.sdkSessionId).toBe('sdk-session-abc')
      expect(entry!.providerId).toBe('claude-code')
      expect(typeof entry!.createdAt).toBe('number')
      expect(typeof entry!.lastUsedAt).toBe('number')
    })

    it('createdAt and lastUsedAt are set on store', () => {
      const before = Date.now()
      storeSession('key-1', 'sid-1', 'provider-x')
      const after = Date.now()

      const entry = getSession('key-1')
      expect(entry!.createdAt).toBeGreaterThanOrEqual(before)
      expect(entry!.createdAt).toBeLessThanOrEqual(after)
      expect(entry!.lastUsedAt).toBeGreaterThanOrEqual(before)
      expect(entry!.lastUsedAt).toBeLessThanOrEqual(after)
    })
  })

  describe('getSession returns undefined for non-existent key', () => {
    it('returns undefined when key is not in pool', () => {
      const entry = getSession('no-such-key')
      expect(entry).toBeUndefined()
    })

    it('returns undefined after entry has been removed', () => {
      storeSession('key-gone', 'sid', 'provider')
      removeSession('key-gone')
      expect(getSession('key-gone')).toBeUndefined()
    })
  })

  describe('TTL expiration', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns undefined when entry has exceeded TTL', () => {
      vi.useFakeTimers()

      storeSession('key-ttl', 'sid-ttl', 'provider-ttl')

      // Advance time past a custom TTL of 5000ms
      vi.advanceTimersByTime(6000)

      const entry = getSession('key-ttl', 5000)
      expect(entry).toBeUndefined()
    })

    it('returns entry when TTL has not been exceeded', () => {
      vi.useFakeTimers()

      storeSession('key-valid', 'sid-valid', 'provider-valid')

      // Advance time less than the TTL
      vi.advanceTimersByTime(3000)

      const entry = getSession('key-valid', 5000)
      expect(entry).toBeDefined()
      expect(entry!.sdkSessionId).toBe('sid-valid')
    })

    it('removes expired entry from pool on getSession', () => {
      vi.useFakeTimers()

      storeSession('key-cleanup', 'sid-cleanup', 'p')
      expect(poolSize()).toBe(1)

      vi.advanceTimersByTime(10000)
      getSession('key-cleanup', 5000)

      expect(poolSize()).toBe(0)
    })
  })

  describe('cleanupExpired', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('removes only expired entries', () => {
      vi.useFakeTimers()

      storeSession('key-expires', 'sid-1', 'p1')

      // Advance time so first entry is old
      vi.advanceTimersByTime(6000)

      // Store a second entry after time advance (fresh)
      storeSession('key-fresh', 'sid-2', 'p2')

      // Cleanup with TTL of 5000ms — only first entry should be removed
      const cleaned = cleanupExpired(5000)
      expect(cleaned).toBe(1)

      expect(getSession('key-expires', 5000)).toBeUndefined()
      expect(getSession('key-fresh', 5000)).toBeDefined()
    })

    it('returns 0 when no entries have expired', () => {
      vi.useFakeTimers()

      storeSession('k1', 'sid-1', 'p')
      storeSession('k2', 'sid-2', 'p')

      vi.advanceTimersByTime(1000)

      const cleaned = cleanupExpired(5000)
      expect(cleaned).toBe(0)
      expect(poolSize()).toBe(2)
    })

    it('returns count of all removed entries when all expired', () => {
      vi.useFakeTimers()

      storeSession('k1', 'sid-1', 'p')
      storeSession('k2', 'sid-2', 'p')
      storeSession('k3', 'sid-3', 'p')

      vi.advanceTimersByTime(10000)

      const cleaned = cleanupExpired(5000)
      expect(cleaned).toBe(3)
      expect(poolSize()).toBe(0)
    })
  })

  describe('removeSession', () => {
    it('clears a specific entry from the pool', () => {
      storeSession('key-rm', 'sid-rm', 'provider-rm')
      expect(poolSize()).toBe(1)

      removeSession('key-rm')
      expect(getSession('key-rm')).toBeUndefined()
      expect(poolSize()).toBe(0)
    })

    it('is a no-op when key does not exist', () => {
      storeSession('keep-me', 'sid', 'p')
      removeSession('not-in-pool')

      expect(poolSize()).toBe(1)
      expect(getSession('keep-me')).toBeDefined()
    })
  })

  describe('lastUsedAt updated on getSession (sliding TTL)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('refreshes lastUsedAt so entry survives longer than original TTL window', () => {
      vi.useFakeTimers()

      storeSession('sliding-key', 'sid-slide', 'p')

      // Advance 4000ms (less than 5000ms TTL) — entry still valid
      vi.advanceTimersByTime(4000)

      // Access it — this updates lastUsedAt
      const firstAccess = getSession('sliding-key', 5000)
      expect(firstAccess).toBeDefined()

      // Advance another 4000ms — if lastUsedAt wasn't updated, the entry
      // would be 8000ms old (> 5000ms TTL). But since lastUsedAt was
      // refreshed, it's only 4000ms since last access.
      vi.advanceTimersByTime(4000)

      const secondAccess = getSession('sliding-key', 5000)
      expect(secondAccess).toBeDefined()
      expect(secondAccess!.sdkSessionId).toBe('sid-slide')
    })

    it('entry still expires after TTL of inactivity following access', () => {
      vi.useFakeTimers()

      storeSession('inactivity-key', 'sid-inactive', 'p')

      // Access to refresh lastUsedAt
      vi.advanceTimersByTime(1000)
      getSession('inactivity-key', 5000)

      // Now go idle for longer than TTL
      vi.advanceTimersByTime(6000)

      const entry = getSession('inactivity-key', 5000)
      expect(entry).toBeUndefined()
    })
  })

  describe('Key isolation', () => {
    it('different keys do not collide', () => {
      storeSession('proj-a:plan-chat', 'sid-a', 'provider-a')
      storeSession('proj-b:plan-chat', 'sid-b', 'provider-b')
      storeSession('proj-a:task-chat:node-1', 'sid-c', 'provider-c')

      const a = getSession('proj-a:plan-chat')
      const b = getSession('proj-b:plan-chat')
      const c = getSession('proj-a:task-chat:node-1')

      expect(a!.sdkSessionId).toBe('sid-a')
      expect(a!.providerId).toBe('provider-a')

      expect(b!.sdkSessionId).toBe('sid-b')
      expect(b!.providerId).toBe('provider-b')

      expect(c!.sdkSessionId).toBe('sid-c')
      expect(c!.providerId).toBe('provider-c')
    })

    it('overwriting a key replaces only that entry', () => {
      storeSession('shared-key', 'sid-old', 'old-provider')
      storeSession('other-key', 'sid-other', 'other-provider')

      storeSession('shared-key', 'sid-new', 'new-provider')

      expect(getSession('shared-key')!.sdkSessionId).toBe('sid-new')
      expect(getSession('other-key')!.sdkSessionId).toBe('sid-other')
      expect(poolSize()).toBe(2)
    })
  })

  describe('clearAll', () => {
    it('removes all entries from the pool', () => {
      storeSession('k1', 'sid-1', 'p')
      storeSession('k2', 'sid-2', 'p')
      storeSession('k3', 'sid-3', 'p')

      expect(poolSize()).toBe(3)
      clearAll()
      expect(poolSize()).toBe(0)
    })

    it('all entries are inaccessible after clearAll', () => {
      storeSession('k1', 'sid-1', 'p')
      storeSession('k2', 'sid-2', 'p')

      clearAll()

      expect(getSession('k1')).toBeUndefined()
      expect(getSession('k2')).toBeUndefined()
    })
  })

  describe('poolSize', () => {
    it('returns 0 initially', () => {
      expect(poolSize()).toBe(0)
    })

    it('increments as entries are added', () => {
      storeSession('k1', 'sid-1', 'p')
      expect(poolSize()).toBe(1)

      storeSession('k2', 'sid-2', 'p')
      expect(poolSize()).toBe(2)
    })

    it('decrements after removeSession', () => {
      storeSession('k1', 'sid-1', 'p')
      storeSession('k2', 'sid-2', 'p')

      removeSession('k1')
      expect(poolSize()).toBe(1)
    })

    it('returns correct count after overwriting a key', () => {
      storeSession('k1', 'sid-a', 'p')
      storeSession('k1', 'sid-b', 'p')
      expect(poolSize()).toBe(1)
    })
  })

  describe('Provider ID matching', () => {
    it('retrieved entry has matching providerId', () => {
      storeSession('key-provider', 'sdk-123', 'claude-code')

      const entry = getSession('key-provider')
      expect(entry).toBeDefined()
      expect(entry!.providerId).toBe('claude-code')
    })

    it('different providers stored under different keys retain their own providerId', () => {
      storeSession('task:node-1', 'sdk-aaa', 'claude-code')
      storeSession('task:node-2', 'sdk-bbb', 'codex')

      expect(getSession('task:node-1')!.providerId).toBe('claude-code')
      expect(getSession('task:node-2')!.providerId).toBe('codex')
    })
  })
})
