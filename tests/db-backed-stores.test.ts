/**
 * Comprehensive Unit Tests for DB-Backed Stores
 *
 * Tests all modules refactored from in-memory Maps to Postgres (via Drizzle ORM):
 * 1. Challenge Store — WebAuthn challenge storage (fixes multi-instance auth bug)
 * 2. Device Code Store — OAuth2 device authorization codes
 * 3. Share Route — Shared plan bundles
 * 4. Dispatch Queue — Task dispatch queue (already has its own test file, we add edge cases)
 *
 * Uses an in-memory PGlite instance so tests are fast and isolated.
 */

// Must set before any server imports
process.env.USE_INDEXEDDB_ONLY = 'true'

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Unique temp dir per test file so parallel test files don't collide
process.env.PGLITE_DATA_DIR = mkdtempSync(join(tmpdir(), 'astro-db-stores-test-'))

import { runMigrations } from '../server/lib/db/migrate.js'
import { db } from '../server/lib/db/index.js'
import {
  webauthnChallenges,
  deviceCodes,
  sharedBundles,
  dispatchQueueEntries,
} from '../server/lib/db/schema.js'
import { eq } from 'drizzle-orm'

// Modules under test
import {
  storeChallenge,
  getAndDeleteChallenge,
  cleanupExpiredChallenges,
} from '../server/lib/challenge-store.js'

import {
  createDeviceCode,
  getDeviceCodeByUserCode,
  getDeviceCodeByDeviceCode,
  checkPollRate,
  authorizeDeviceCode,
  denyDeviceCode,
  markDeviceCodeUsed,
  getPendingDeviceCodes,
  cleanupExpiredDeviceCodes,
  getDeviceCodeStats,
} from '../server/lib/device-code-store.js'

import { createDispatchQueue } from '../server/lib/dispatch/dispatch-queue.js'

beforeAll(async () => {
  await runMigrations()
})

// ============================================================================
// 1. Challenge Store Tests
// ============================================================================

describe('Challenge Store', () => {
  beforeEach(async () => {
    await db.delete(webauthnChallenges)
  })

  describe('storeChallenge + getAndDeleteChallenge', () => {
    it('stores and retrieves a challenge', async () => {
      await storeChallenge('reg:user@test.com', 'challenge-abc')
      const result = await getAndDeleteChallenge('reg:user@test.com')
      expect(result).toBe('challenge-abc')
    })

    it('returns null for non-existent key', async () => {
      const result = await getAndDeleteChallenge('no-such-key')
      expect(result).toBeNull()
    })

    it('is one-time use — second get returns null', async () => {
      await storeChallenge('auth:one-time', 'challenge-xyz')
      const first = await getAndDeleteChallenge('auth:one-time')
      const second = await getAndDeleteChallenge('auth:one-time')

      expect(first).toBe('challenge-xyz')
      expect(second).toBeNull()
    })

    it('upserts — overwriting an existing key', async () => {
      await storeChallenge('auth:upsert', 'old-challenge')
      await storeChallenge('auth:upsert', 'new-challenge')

      const result = await getAndDeleteChallenge('auth:upsert')
      expect(result).toBe('new-challenge')
    })

    it('returns null for expired challenge', async () => {
      // Insert a challenge with expiry in the past
      await db.insert(webauthnChallenges).values({
        key: 'auth:expired',
        challenge: 'expired-challenge',
        expiresAt: new Date(Date.now() - 10000), // 10 seconds ago
        createdAt: new Date(),
      })

      const result = await getAndDeleteChallenge('auth:expired')
      expect(result).toBeNull()
    })

    it('handles concurrent operations on different keys', async () => {
      await Promise.all([
        storeChallenge('key1', 'challenge1'),
        storeChallenge('key2', 'challenge2'),
        storeChallenge('key3', 'challenge3'),
      ])

      const [r1, r2, r3] = await Promise.all([
        getAndDeleteChallenge('key1'),
        getAndDeleteChallenge('key2'),
        getAndDeleteChallenge('key3'),
      ])

      expect(r1).toBe('challenge1')
      expect(r2).toBe('challenge2')
      expect(r3).toBe('challenge3')
    })
  })

  describe('cleanupExpiredChallenges', () => {
    it('removes expired challenges and returns count', async () => {
      // Insert one valid and one expired challenge
      const future = new Date(Date.now() + 300000)
      const past = new Date(Date.now() - 10000)

      await db.insert(webauthnChallenges).values([
        { key: 'valid', challenge: 'v', expiresAt: future },
        { key: 'expired1', challenge: 'e1', expiresAt: past },
        { key: 'expired2', challenge: 'e2', expiresAt: past },
      ])

      const cleaned = await cleanupExpiredChallenges()
      expect(cleaned).toBe(2)

      // Valid one should still exist
      const remaining = await db.select().from(webauthnChallenges)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].key).toBe('valid')
    })

    it('returns 0 when nothing to clean', async () => {
      const cleaned = await cleanupExpiredChallenges()
      expect(cleaned).toBe(0)
    })
  })
})

// ============================================================================
// 2. Device Code Store Tests
// ============================================================================

describe('Device Code Store', () => {
  beforeEach(async () => {
    await db.delete(deviceCodes)
  })

  describe('createDeviceCode', () => {
    it('creates a device code and returns expected shape', async () => {
      const result = await createDeviceCode({
        scopes: ['machine:connect'],
        machineInfo: { hostname: 'test-host', platform: 'darwin' },
      })

      expect(result.deviceCode).toBeDefined()
      expect(result.userCode).toBeDefined()
      expect(result.expiresIn).toBeGreaterThan(0)
      expect(result.interval).toBeGreaterThan(0)
    })

    it('persists to database', async () => {
      const result = await createDeviceCode({})
      const rows = await db.select().from(deviceCodes)
        .where(eq(deviceCodes.userCode, result.userCode))

      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('pending')
      expect(rows[0].deviceCode).toBe(result.deviceCode)
    })
  })

  describe('getDeviceCodeByUserCode / getDeviceCodeByDeviceCode', () => {
    it('retrieves by user code', async () => {
      const created = await createDeviceCode({ scopes: ['machine:connect'] })
      const entry = await getDeviceCodeByUserCode(created.userCode)

      expect(entry).not.toBeNull()
      expect(entry!.deviceCode).toBe(created.deviceCode)
      expect(entry!.status).toBe('pending')
      expect(entry!.scopes).toEqual(['machine:connect'])
    })

    it('retrieves by device code', async () => {
      const created = await createDeviceCode({})
      const entry = await getDeviceCodeByDeviceCode(created.deviceCode)

      expect(entry).not.toBeNull()
      expect(entry!.userCode).toBe(created.userCode)
    })

    it('returns null for non-existent code', async () => {
      expect(await getDeviceCodeByUserCode('XXXX-YYYY')).toBeNull()
      expect(await getDeviceCodeByDeviceCode('no-such-device-code')).toBeNull()
    })

    it('marks expired codes as expired', async () => {
      // Insert a code with past expiry
      await db.insert(deviceCodes).values({
        userCode: 'EXP-CODE',
        deviceCode: 'exp-device-code',
        scopes: [],
        status: 'pending',
        expiresAt: new Date(Date.now() - 60000),
        createdAt: new Date(),
      })

      const entry = await getDeviceCodeByUserCode('EXP-CODE')
      expect(entry).not.toBeNull()
      expect(entry!.status).toBe('expired')

      // Verify DB was updated too
      const rows = await db.select().from(deviceCodes)
        .where(eq(deviceCodes.userCode, 'EXP-CODE'))
      expect(rows[0].status).toBe('expired')
    })
  })

  describe('authorizeDeviceCode', () => {
    it('authorizes a pending code', async () => {
      const created = await createDeviceCode({})
      const success = await authorizeDeviceCode(created.deviceCode, 'user-123')

      expect(success).toBe(true)

      const entry = await getDeviceCodeByDeviceCode(created.deviceCode)
      expect(entry!.status).toBe('authorized')
      expect(entry!.authorizedBy).toBe('user-123')
      expect(entry!.authorizedAt).toBeInstanceOf(Date)
    })

    it('fails for non-pending code', async () => {
      const created = await createDeviceCode({})
      await authorizeDeviceCode(created.deviceCode, 'user-123')
      // Try to authorize again
      const secondAttempt = await authorizeDeviceCode(created.deviceCode, 'user-456')
      expect(secondAttempt).toBe(false)
    })

    it('fails for non-existent code', async () => {
      const result = await authorizeDeviceCode('fake-device-code', 'user-123')
      expect(result).toBe(false)
    })

    it('fails for expired code', async () => {
      await db.insert(deviceCodes).values({
        userCode: 'AUTH-EXP',
        deviceCode: 'auth-exp-dc',
        scopes: [],
        status: 'pending',
        expiresAt: new Date(Date.now() - 60000),
        createdAt: new Date(),
      })

      const result = await authorizeDeviceCode('auth-exp-dc', 'user-123')
      expect(result).toBe(false)
    })
  })

  describe('denyDeviceCode', () => {
    it('denies a pending code', async () => {
      const created = await createDeviceCode({})
      const success = await denyDeviceCode(created.deviceCode)

      expect(success).toBe(true)

      const entry = await getDeviceCodeByDeviceCode(created.deviceCode)
      expect(entry!.status).toBe('denied')
    })

    it('fails for non-pending code', async () => {
      const created = await createDeviceCode({})
      await denyDeviceCode(created.deviceCode)
      const secondAttempt = await denyDeviceCode(created.deviceCode)
      expect(secondAttempt).toBe(false)
    })
  })

  describe('markDeviceCodeUsed', () => {
    it('marks an authorized code as used', async () => {
      const created = await createDeviceCode({})
      await authorizeDeviceCode(created.deviceCode, 'user-123')
      const success = await markDeviceCodeUsed(created.userCode)

      expect(success).toBe(true)

      const entry = await getDeviceCodeByUserCode(created.userCode)
      expect(entry!.status).toBe('used')
    })
  })

  describe('checkPollRate', () => {
    it('returns false on first poll', async () => {
      const created = await createDeviceCode({})
      const tooFast = await checkPollRate(created.userCode)
      expect(tooFast).toBe(false)
    })

    it('returns false for non-existent code', async () => {
      const tooFast = await checkPollRate('NONEXISTENT')
      expect(tooFast).toBe(false)
    })
  })

  describe('getPendingDeviceCodes', () => {
    it('returns only pending non-expired codes', async () => {
      await createDeviceCode({ scopes: ['connect'] })
      await createDeviceCode({ scopes: ['execute'] })

      // Insert an expired one
      await db.insert(deviceCodes).values({
        userCode: 'PEND-EXP',
        deviceCode: 'pend-exp-dc',
        scopes: [],
        status: 'pending',
        expiresAt: new Date(Date.now() - 60000),
        createdAt: new Date(),
      })

      const pending = await getPendingDeviceCodes()
      expect(pending).toHaveLength(2)
      pending.forEach(p => expect(p.status).toBe('pending'))
    })
  })

  describe('cleanupExpiredDeviceCodes', () => {
    it('removes expired and used codes', async () => {
      // Create a normal pending code
      const good = await createDeviceCode({})

      // Create and mark one as used
      const used = await createDeviceCode({})
      await authorizeDeviceCode(used.deviceCode, 'user-1')
      await markDeviceCodeUsed(used.userCode)

      // Insert an expired one
      await db.insert(deviceCodes).values({
        userCode: 'CLN-EXP',
        deviceCode: 'cln-exp-dc',
        scopes: [],
        status: 'pending',
        expiresAt: new Date(Date.now() - 60000),
        createdAt: new Date(),
      })

      const cleaned = await cleanupExpiredDeviceCodes()
      expect(cleaned).toBe(2) // one used + one expired

      // The good pending code should still be there
      const remaining = await getDeviceCodeByUserCode(good.userCode)
      expect(remaining).not.toBeNull()
      expect(remaining!.status).toBe('pending')
    })
  })

  describe('getDeviceCodeStats', () => {
    it('returns accurate stats', async () => {
      await createDeviceCode({})
      await createDeviceCode({})
      const toAuth = await createDeviceCode({})
      await authorizeDeviceCode(toAuth.deviceCode, 'user-1')

      const stats = await getDeviceCodeStats()
      expect(stats.total).toBe(3)
      expect(stats.pending).toBe(2)
      expect(stats.authorized).toBe(1)
    })
  })
})

// ============================================================================
// 3. Shared Bundles (share route) Tests — via direct DB queries
//    (Route handler tests require Hono test setup, but we test the DB layer)
// ============================================================================

describe('Shared Bundles (DB layer)', () => {
  beforeEach(async () => {
    await db.delete(sharedBundles)
  })

  it('inserts a bundle and returns a UUID id', async () => {
    const bundle = { $schema: 'astro-export', name: 'test-plan', nodes: [] }
    const rows = await db.insert(sharedBundles)
      .values({ bundle })
      .returning({ id: sharedBundles.id })

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('retrieves a bundle by id', async () => {
    const bundle = { $schema: 'astro-export', data: 'hello' }
    const [{ id }] = await db.insert(sharedBundles)
      .values({ bundle })
      .returning({ id: sharedBundles.id })

    const rows = await db.select()
      .from(sharedBundles)
      .where(eq(sharedBundles.id, id))

    expect(rows).toHaveLength(1)
    expect(rows[0].bundle).toEqual(bundle)
    expect(rows[0].downloads).toBe(0)
  })

  it('returns empty for non-existent id', async () => {
    const rows = await db.select()
      .from(sharedBundles)
      .where(eq(sharedBundles.id, '00000000-0000-4000-8000-000000000099'))

    expect(rows).toHaveLength(0)
  })

  it('stores complex JSON bundles', async () => {
    const bundle = {
      $schema: 'astro-export',
      nodes: [{ id: 'n1', title: 'Task 1' }],
      edges: [{ source: 'n1', target: 'n2' }],
      meta: { nested: { deep: true } },
    }

    const [{ id }] = await db.insert(sharedBundles)
      .values({ bundle })
      .returning({ id: sharedBundles.id })

    const [row] = await db.select()
      .from(sharedBundles)
      .where(eq(sharedBundles.id, id))

    expect(row.bundle).toEqual(bundle)
  })
})

// ============================================================================
// 4. Dispatch Queue — Additional Edge Case Tests
// ============================================================================

describe('Dispatch Queue (edge cases)', () => {
  const TEST_PROJECT = '00000000-0000-4000-8000-000000000002'

  beforeEach(async () => {
    await db.delete(dispatchQueueEntries)
  })

  it('getStats returns all-zero for empty queue', async () => {
    const queue = createDispatchQueue()
    const stats = await queue.getStats()

    expect(stats.total).toBe(0)
    expect(stats.activeTotal).toBe(0)
    expect(stats.byStatus.ready).toBe(0)
    expect(stats.byStatus.dispatched).toBe(0)
  })

  it('cancelByProject cancels multiple entries', async () => {
    const queue = createDispatchQueue()

    await queue.enqueue({ nodeId: 'n1', projectId: TEST_PROJECT })
    await queue.enqueue({ nodeId: 'n2', projectId: TEST_PROJECT })
    await queue.enqueue({ nodeId: 'n3', projectId: TEST_PROJECT })

    const cancelled = await queue.cancelByProject(TEST_PROJECT)
    expect(cancelled).toBe(3)

    const stats = await queue.getStats()
    expect(stats.byStatus.cancelled).toBe(3)
    expect(stats.byStatus.ready).toBe(0)
  })

  it('getByNodeId returns undefined for terminal entries', async () => {
    const queue = createDispatchQueue()
    const entry = await queue.enqueue({ nodeId: 'n-terminal', projectId: TEST_PROJECT })
    await queue.markCompleted(entry.id)

    const found = await queue.getByNodeId('n-terminal')
    expect(found).toBeUndefined()
  })

  it('cleanup removes old terminal entries but keeps recent ones', async () => {
    const queue = createDispatchQueue()

    // Enqueue and complete
    const e1 = await queue.enqueue({ nodeId: 'old-n', projectId: TEST_PROJECT })
    await queue.markCompleted(e1.id)

    // Backdate the creation time
    await db.update(dispatchQueueEntries)
      .set({ createdAt: new Date(Date.now() - 7200000) }) // 2 hours ago
      .where(eq(dispatchQueueEntries.id, e1.id))

    const e2 = await queue.enqueue({ nodeId: 'new-n', projectId: TEST_PROJECT })
    await queue.markCompleted(e2.id)

    // Cleanup entries older than 1 hour
    const cleaned = await queue.cleanup(3600000)
    expect(cleaned).toBe(1) // Only the old one

    // The new one should still be there
    const remaining = await queue.get(e2.id)
    expect(remaining).toBeDefined()
  })

  it('dequeue returns null when queue is empty', async () => {
    const queue = createDispatchQueue()
    const entry = await queue.dequeue()
    expect(entry).toBeNull()
  })

  it('enqueue is idempotent for same nodeId', async () => {
    const queue = createDispatchQueue()
    const e1 = await queue.enqueue({ nodeId: 'idem-n', projectId: TEST_PROJECT })
    const e2 = await queue.enqueue({ nodeId: 'idem-n', projectId: TEST_PROJECT })

    expect(e1.id).toBe(e2.id) // Same entry returned
  })

  it('markFailed with retries remaining re-queues as ready', async () => {
    const queue = createDispatchQueue({ defaultMaxRetries: 3 })
    await queue.enqueue({ nodeId: 'retry-n', projectId: TEST_PROJECT, maxRetries: 3 })

    const dq = await queue.dequeue()
    expect(dq).not.toBeNull()
    await queue.markDispatched(dq!.id, 'exec-1')

    const result = await queue.markFailed(dq!.id, 'Network error')
    expect(result).not.toBeNull()
    expect(result!.retry).toBe(true)
    expect(result!.entry.retryCount).toBe(1)
    expect(result!.entry.status).toBe('ready')
    expect(result!.entry.lastError).toBe('Network error')
  })

  it('markFailed with no retries remaining sets status to failed', async () => {
    const queue = createDispatchQueue({ defaultMaxRetries: 0 })
    await queue.enqueue({ nodeId: 'no-retry', projectId: TEST_PROJECT, maxRetries: 0 })

    const dq = await queue.dequeue()
    await queue.markDispatched(dq!.id, 'exec-1')

    const result = await queue.markFailed(dq!.id, 'Fatal error')
    expect(result).not.toBeNull()
    expect(result!.retry).toBe(false)
    expect(result!.entry.status).toBe('failed')
  })

  it('clear removes all entries', async () => {
    const queue = createDispatchQueue()
    await queue.enqueue({ nodeId: 'c1', projectId: TEST_PROJECT })
    await queue.enqueue({ nodeId: 'c2', projectId: TEST_PROJECT })

    await queue.clear()

    const stats = await queue.getStats()
    expect(stats.total).toBe(0)
  })
})
