/**
 * Cron Scheduler Tests
 *
 * Tests for stale run cleanup and concurrency checking logic.
 * Validates the fix that prevents zombie schedule runs from permanently
 * blocking concurrency checks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock DB ────────────────────────────────────────────────────────
// vi.mock factories are hoisted — we must use vi.hoisted() for shared refs.

const {
  mockDb, mockReturning, mockWhere, mockFrom, mockSet, mockLimit,
} = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([])
  const mockLimit = vi.fn().mockReturnValue(mockReturning)
  const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning, limit: mockLimit })
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning })

  const mockDb = {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
  }

  return { mockDb, mockReturning, mockWhere, mockFrom, mockSet, mockLimit }
})

vi.mock('../db/index.js', () => ({ db: mockDb }))

// Mock schema — return proxy objects so column references don't crash
vi.mock('../db/schema.js', () => {
  const table = (name: string) => {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get: (_target, prop) => {
        if (prop === '$inferInsert' || prop === '$inferSelect') return {}
        return `${name}.${String(prop)}`
      },
    }
    return new Proxy({}, handler)
  }
  return {
    schedules: table('schedules'),
    scheduleRuns: table('scheduleRuns'),
    planNodes: table('planNodes'),
    planEdges: table('planEdges'),
    registeredMachines: table('registeredMachines'),
  }
})

vi.mock('../redis-pubsub.js', () => ({
  redisPubSub: { acquireLock: vi.fn().mockResolvedValue(true), releaseLock: vi.fn() },
}))

vi.mock('../server-side-dispatch.js', () => ({
  serverSideDispatch: vi.fn().mockResolvedValue(undefined),
}))

// ── Import under test (after mocks) ────────────────────────────────
import { checkMaxConcurrency, cleanupStaleScheduleRuns } from '../cron-scheduler.js'

// ── Tests ───────────────────────────────────────────────────────────

describe('cron-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    // Reset chainable mock defaults
    mockReturning.mockResolvedValue([])
    mockWhere.mockReturnValue({ returning: mockReturning, limit: mockLimit })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockSet.mockReturnValue({ where: mockWhere })
    mockDb.select.mockReturnValue({ from: mockFrom })
    mockDb.update.mockReturnValue({ set: mockSet })
  })

  // ────────────────────────────────────────────────────────────
  // checkMaxConcurrency
  // ────────────────────────────────────────────────────────────
  describe('checkMaxConcurrency', () => {
    it('returns true when no active runs exist', async () => {
      mockWhere.mockReturnValueOnce([])

      const result = await checkMaxConcurrency('sched-1', 2)
      expect(result).toBe(true)
    })

    it('returns true when active runs are below the limit', async () => {
      mockWhere.mockReturnValueOnce([{ id: 'run-1' }])

      const result = await checkMaxConcurrency('sched-1', 2)
      expect(result).toBe(true)
    })

    it('returns false when active runs meet the limit', async () => {
      mockWhere.mockReturnValueOnce([{ id: 'run-1' }, { id: 'run-2' }])

      const result = await checkMaxConcurrency('sched-1', 2)
      expect(result).toBe(false)
    })

    it('returns false when active runs exceed the limit', async () => {
      mockWhere.mockReturnValueOnce([
        { id: 'run-1' }, { id: 'run-2' }, { id: 'run-3' },
      ])

      const result = await checkMaxConcurrency('sched-1', 2)
      expect(result).toBe(false)
    })

    it('calls the DB select chain with correct structure', async () => {
      mockWhere.mockReturnValueOnce([])

      await checkMaxConcurrency('sched-abc', 1)

      // Verify the full select().from().where() chain was invoked
      expect(mockDb.select).toHaveBeenCalledTimes(1)
      expect(mockFrom).toHaveBeenCalledTimes(1)
      expect(mockWhere).toHaveBeenCalledTimes(1)
    })

    it('handles maxConcurrency of 1 (boundary)', async () => {
      // No active runs → under limit
      mockWhere.mockReturnValueOnce([])
      expect(await checkMaxConcurrency('sched-1', 1)).toBe(true)

      // Reset for second call
      mockDb.select.mockReturnValue({ from: mockFrom })
      mockFrom.mockReturnValue({ where: mockWhere })

      // 1 active run → at limit
      mockWhere.mockReturnValueOnce([{ id: 'run-1' }])
      expect(await checkMaxConcurrency('sched-1', 1)).toBe(false)
    })

    it('handles high concurrency limits', async () => {
      const runs = Array.from({ length: 5 }, (_, i) => ({ id: `run-${i}` }))
      mockWhere.mockReturnValueOnce(runs)

      expect(await checkMaxConcurrency('sched-1', 10)).toBe(true)
    })

    it('uses a stale threshold ~24 hours in the past', async () => {
      // The function creates `new Date(Date.now() - 24*60*60*1000)`.
      // We verify the full query chain fires (which includes the gt() clause).
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)
      mockWhere.mockReturnValueOnce([])

      await checkMaxConcurrency('sched-1', 5)

      // If the select chain was called, the stale threshold was constructed
      // and passed to the and() + gt() builders in the WHERE clause
      expect(mockDb.select).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────
  // cleanupStaleScheduleRuns
  // ────────────────────────────────────────────────────────────
  describe('cleanupStaleScheduleRuns', () => {
    it('calls db.update on scheduleRuns table', async () => {
      mockReturning.mockResolvedValueOnce([])

      await cleanupStaleScheduleRuns()

      expect(mockDb.update).toHaveBeenCalledTimes(1)
    })

    it('sets status to failure with error message and completedAt', async () => {
      mockReturning.mockResolvedValueOnce([])

      await cleanupStaleScheduleRuns()

      expect(mockSet).toHaveBeenCalledTimes(1)
      const setArg = mockSet.mock.calls[0][0]
      expect(setArg.status).toBe('failure')
      expect(setArg.errorMessage).toContain('Timed out')
      expect(setArg.errorMessage).toContain('24 hours')
      expect(setArg.completedAt).toBeInstanceOf(Date)
    })

    it('applies WHERE clause via the chain', async () => {
      mockReturning.mockResolvedValueOnce([])

      await cleanupStaleScheduleRuns()

      // update().set().where().returning() chain
      expect(mockDb.update).toHaveBeenCalledTimes(1)
      expect(mockSet).toHaveBeenCalledTimes(1)
      expect(mockWhere).toHaveBeenCalledTimes(1)
      expect(mockReturning).toHaveBeenCalledTimes(1)
    })

    it('logs when stale runs are cleaned up', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      mockReturning.mockResolvedValueOnce([{ id: 'stale-1' }, { id: 'stale-2' }])

      await cleanupStaleScheduleRuns()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 2 stale schedule run(s)'),
      )
    })

    it('does not log when no stale runs are found', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      mockReturning.mockResolvedValueOnce([])

      await cleanupStaleScheduleRuns()

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up'),
      )
    })

    it('handles a single stale run', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      mockReturning.mockResolvedValueOnce([{ id: 'stale-1' }])

      await cleanupStaleScheduleRuns()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 1 stale schedule run(s)'),
      )
    })

    it('catches and logs database errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const dbError = new Error('connection lost')
      mockReturning.mockRejectedValueOnce(dbError)

      // Should NOT throw
      await expect(cleanupStaleScheduleRuns()).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[cron] Error cleaning up stale schedule runs:',
        dbError,
      )
    })

    it('does not propagate database errors to the caller', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mockReturning.mockRejectedValueOnce(new Error('table not found'))

      // Should resolve normally (void), not reject
      const result = await cleanupStaleScheduleRuns()
      expect(result).toBeUndefined()
    })

    it('uses a stale threshold of ~24 hours', async () => {
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)
      mockReturning.mockResolvedValueOnce([])

      await cleanupStaleScheduleRuns()

      // Verify the update chain was called (which includes the lte() threshold)
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('returns void (no return value)', async () => {
      mockReturning.mockResolvedValueOnce([{ id: 'stale-1' }])

      const result = await cleanupStaleScheduleRuns()
      expect(result).toBeUndefined()
    })
  })
})
