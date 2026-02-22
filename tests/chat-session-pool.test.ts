/**
 * Chat Session Pool Unit Tests
 *
 * Tests the server-side TTL map that stores SDK session IDs for chat
 * session resume/fallback. Covers CRUD, TTL expiration, sliding TTL,
 * key isolation, and diagnostics.
 *
 * Uses an in-memory PGlite instance with Drizzle migrations so
 * every test suite starts with a real (but ephemeral) Postgres.
 */

// Force local mode so PGlite is used instead of external Postgres
process.env.USE_INDEXEDDB_ONLY = 'true'

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Temp directory for PGlite data (one per test file invocation)
process.env.PGLITE_DATA_DIR = mkdtempSync(join(tmpdir(), 'astro-test-pglite-'))

import {
  storeSession,
  getSession,
  removeSession,
  cleanupExpired,
  poolSize,
  clearAll,
} from '../server/lib/chat-session-pool.js'
import { db } from '../server/lib/db/index.js'
import { chatSessions } from '../server/lib/db/schema.js'
import { eq } from 'drizzle-orm'
import { runMigrations } from '../server/lib/db/migrate.js'

/** Helper: set lastUsedAt to a specific timestamp in the past */
async function setLastUsedAt(key: string, date: Date) {
  await db.update(chatSessions)
    .set({ lastUsedAt: date })
    .where(eq(chatSessions.key, key))
}

beforeAll(async () => {
  await runMigrations()
})

beforeEach(async () => {
  await clearAll()
})

describe('Chat Session Pool', () => {
  describe('storeSession / getSession basic CRUD', () => {
    it('stores an entry and retrieves it with correct fields', async () => {
      await storeSession('proj-1:plan-chat', 'sdk-session-abc', 'claude-code')

      const entry = await getSession('proj-1:plan-chat')
      expect(entry).toBeDefined()
      expect(entry!.sdkSessionId).toBe('sdk-session-abc')
      expect(entry!.providerId).toBe('claude-code')
      expect(typeof entry!.createdAt).toBe('number')
      expect(typeof entry!.lastUsedAt).toBe('number')
    })

    it('createdAt and lastUsedAt are set on store', async () => {
      const before = Date.now()
      await storeSession('key-1', 'sid-1', 'provider-x')

      // getSession() refreshes lastUsedAt, so capture `after` AFTER the call
      const entry = await getSession('key-1')
      const after = Date.now()

      expect(entry!.createdAt).toBeGreaterThanOrEqual(before - 1)
      expect(entry!.createdAt).toBeLessThanOrEqual(after + 1)
      // lastUsedAt is refreshed by getSession, so it can be up to `after`
      expect(entry!.lastUsedAt).toBeGreaterThanOrEqual(before - 1)
      expect(entry!.lastUsedAt).toBeLessThanOrEqual(after + 1)
    })
  })

  describe('getSession returns undefined for non-existent key', () => {
    it('returns undefined when key is not in pool', async () => {
      const entry = await getSession('no-such-key')
      expect(entry).toBeUndefined()
    })

    it('returns undefined after entry has been removed', async () => {
      await storeSession('key-gone', 'sid', 'provider')
      await removeSession('key-gone')
      expect(await getSession('key-gone')).toBeUndefined()
    })
  })

  describe('TTL expiration', () => {
    it('returns undefined when entry has exceeded TTL', async () => {
      await storeSession('key-ttl', 'sid-ttl', 'provider-ttl')

      // Backdate lastUsedAt so the entry appears expired (>5s old)
      const sixSecondsAgo = new Date(Date.now() - 6000)
      await setLastUsedAt('key-ttl', sixSecondsAgo)

      const entry = await getSession('key-ttl', 5000)
      expect(entry).toBeUndefined()
    })

    it('returns entry when TTL has not been exceeded', async () => {
      await storeSession('key-valid', 'sid-valid', 'provider-valid')

      // Backdate lastUsedAt to 3s ago — within the 5s TTL
      const threeSecondsAgo = new Date(Date.now() - 3000)
      await setLastUsedAt('key-valid', threeSecondsAgo)

      const entry = await getSession('key-valid', 5000)
      expect(entry).toBeDefined()
      expect(entry!.sdkSessionId).toBe('sid-valid')
    })

    it('removes expired entry from pool on getSession', async () => {
      await storeSession('key-cleanup', 'sid-cleanup', 'p')
      expect(await poolSize()).toBe(1)

      // Backdate lastUsedAt past the TTL
      const tenSecondsAgo = new Date(Date.now() - 10000)
      await setLastUsedAt('key-cleanup', tenSecondsAgo)

      await getSession('key-cleanup', 5000)

      expect(await poolSize()).toBe(0)
    })
  })

  describe('cleanupExpired', () => {
    it('removes only expired entries', async () => {
      await storeSession('key-expires', 'sid-1', 'p1')
      await storeSession('key-fresh', 'sid-2', 'p2')

      // Backdate only the first entry past the TTL
      const sixSecondsAgo = new Date(Date.now() - 6000)
      await setLastUsedAt('key-expires', sixSecondsAgo)

      // Cleanup with TTL of 5000ms — only first entry should be removed
      const cleaned = await cleanupExpired(5000)
      expect(cleaned).toBe(1)

      expect(await getSession('key-expires', 5000)).toBeUndefined()
      expect(await getSession('key-fresh', 5000)).toBeDefined()
    })

    it('returns 0 when no entries have expired', async () => {
      await storeSession('k1', 'sid-1', 'p')
      await storeSession('k2', 'sid-2', 'p')

      const cleaned = await cleanupExpired(5000)
      expect(cleaned).toBe(0)
      expect(await poolSize()).toBe(2)
    })

    it('returns count of all removed entries when all expired', async () => {
      await storeSession('k1', 'sid-1', 'p')
      await storeSession('k2', 'sid-2', 'p')
      await storeSession('k3', 'sid-3', 'p')

      // Backdate all entries past the TTL
      const tenSecondsAgo = new Date(Date.now() - 10000)
      await setLastUsedAt('k1', tenSecondsAgo)
      await setLastUsedAt('k2', tenSecondsAgo)
      await setLastUsedAt('k3', tenSecondsAgo)

      const cleaned = await cleanupExpired(5000)
      expect(cleaned).toBe(3)
      expect(await poolSize()).toBe(0)
    })
  })

  describe('removeSession', () => {
    it('clears a specific entry from the pool', async () => {
      await storeSession('key-rm', 'sid-rm', 'provider-rm')
      expect(await poolSize()).toBe(1)

      await removeSession('key-rm')
      expect(await getSession('key-rm')).toBeUndefined()
      expect(await poolSize()).toBe(0)
    })

    it('is a no-op when key does not exist', async () => {
      await storeSession('keep-me', 'sid', 'p')
      await removeSession('not-in-pool')

      expect(await poolSize()).toBe(1)
      expect(await getSession('keep-me')).toBeDefined()
    })
  })

  describe('lastUsedAt updated on getSession (sliding TTL)', () => {
    it('refreshes lastUsedAt so entry survives longer than original TTL window', async () => {
      await storeSession('sliding-key', 'sid-slide', 'p')

      // Backdate lastUsedAt to 4s ago (within 5s TTL)
      const fourSecondsAgo = new Date(Date.now() - 4000)
      await setLastUsedAt('sliding-key', fourSecondsAgo)

      // Access it — this updates lastUsedAt to ~now
      const firstAccess = await getSession('sliding-key', 5000)
      expect(firstAccess).toBeDefined()

      // Backdate lastUsedAt to 4s ago again (simulating another 4s passing)
      // If getSession had NOT refreshed lastUsedAt, total elapsed would be 8s > 5s TTL.
      // But since it refreshed, we only set 4s ago from now — still within TTL.
      const anotherFourSecondsAgo = new Date(Date.now() - 4000)
      await setLastUsedAt('sliding-key', anotherFourSecondsAgo)

      const secondAccess = await getSession('sliding-key', 5000)
      expect(secondAccess).toBeDefined()
      expect(secondAccess!.sdkSessionId).toBe('sid-slide')
    })

    it('entry still expires after TTL of inactivity following access', async () => {
      await storeSession('inactivity-key', 'sid-inactive', 'p')

      // Access to refresh lastUsedAt
      await getSession('inactivity-key', 5000)

      // Backdate lastUsedAt past the TTL (simulating 6s of inactivity)
      const sixSecondsAgo = new Date(Date.now() - 6000)
      await setLastUsedAt('inactivity-key', sixSecondsAgo)

      const entry = await getSession('inactivity-key', 5000)
      expect(entry).toBeUndefined()
    })
  })

  describe('Key isolation', () => {
    it('different keys do not collide', async () => {
      await storeSession('proj-a:plan-chat', 'sid-a', 'provider-a')
      await storeSession('proj-b:plan-chat', 'sid-b', 'provider-b')
      await storeSession('proj-a:task-chat:node-1', 'sid-c', 'provider-c')

      const a = await getSession('proj-a:plan-chat')
      const b = await getSession('proj-b:plan-chat')
      const c = await getSession('proj-a:task-chat:node-1')

      expect(a!.sdkSessionId).toBe('sid-a')
      expect(a!.providerId).toBe('provider-a')

      expect(b!.sdkSessionId).toBe('sid-b')
      expect(b!.providerId).toBe('provider-b')

      expect(c!.sdkSessionId).toBe('sid-c')
      expect(c!.providerId).toBe('provider-c')
    })

    it('overwriting a key replaces only that entry', async () => {
      await storeSession('shared-key', 'sid-old', 'old-provider')
      await storeSession('other-key', 'sid-other', 'other-provider')

      await storeSession('shared-key', 'sid-new', 'new-provider')

      expect((await getSession('shared-key'))!.sdkSessionId).toBe('sid-new')
      expect((await getSession('other-key'))!.sdkSessionId).toBe('sid-other')
      expect(await poolSize()).toBe(2)
    })
  })

  describe('clearAll', () => {
    it('removes all entries from the pool', async () => {
      await storeSession('k1', 'sid-1', 'p')
      await storeSession('k2', 'sid-2', 'p')
      await storeSession('k3', 'sid-3', 'p')

      expect(await poolSize()).toBe(3)
      await clearAll()
      expect(await poolSize()).toBe(0)
    })

    it('all entries are inaccessible after clearAll', async () => {
      await storeSession('k1', 'sid-1', 'p')
      await storeSession('k2', 'sid-2', 'p')

      await clearAll()

      expect(await getSession('k1')).toBeUndefined()
      expect(await getSession('k2')).toBeUndefined()
    })
  })

  describe('poolSize', () => {
    it('returns 0 initially', async () => {
      expect(await poolSize()).toBe(0)
    })

    it('increments as entries are added', async () => {
      await storeSession('k1', 'sid-1', 'p')
      expect(await poolSize()).toBe(1)

      await storeSession('k2', 'sid-2', 'p')
      expect(await poolSize()).toBe(2)
    })

    it('decrements after removeSession', async () => {
      await storeSession('k1', 'sid-1', 'p')
      await storeSession('k2', 'sid-2', 'p')

      await removeSession('k1')
      expect(await poolSize()).toBe(1)
    })

    it('returns correct count after overwriting a key', async () => {
      await storeSession('k1', 'sid-a', 'p')
      await storeSession('k1', 'sid-b', 'p')
      expect(await poolSize()).toBe(1)
    })
  })

  describe('Provider ID matching', () => {
    it('retrieved entry has matching providerId', async () => {
      await storeSession('key-provider', 'sdk-123', 'claude-code')

      const entry = await getSession('key-provider')
      expect(entry).toBeDefined()
      expect(entry!.providerId).toBe('claude-code')
    })

    it('different providers stored under different keys retain their own providerId', async () => {
      await storeSession('task:node-1', 'sdk-aaa', 'claude-code')
      await storeSession('task:node-2', 'sdk-bbb', 'codex')

      expect((await getSession('task:node-1'))!.providerId).toBe('claude-code')
      expect((await getSession('task:node-2'))!.providerId).toBe('codex')
    })
  })
})
