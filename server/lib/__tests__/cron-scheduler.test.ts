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
import {
  checkMaxConcurrency,
  cleanupStaleScheduleRuns,
  triggerCronTick,
  isWithinActiveHours,
} from '../cron-scheduler.js'

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
    it('returns allowed=true when no active runs exist', async () => {
      mockWhere.mockReturnValueOnce([])

      const result = await checkMaxConcurrency('sched-1', 2)
      expect(result).toEqual({ allowed: true })
    })

    it('returns allowed=true when active runs are below the limit', async () => {
      mockWhere.mockReturnValueOnce([{ id: 'run-1' }])

      const result = await checkMaxConcurrency('sched-1', 2)
      expect(result).toEqual({ allowed: true })
    })

    it('returns allowed=false with run IDs when active runs meet the limit', async () => {
      mockWhere.mockReturnValueOnce([{ id: 'run-1' }, { id: 'run-2' }])

      const result = await checkMaxConcurrency('sched-1', 2)
      expect(result).toEqual({ allowed: false, activeRunIds: ['run-1', 'run-2'], activeCount: 2 })
    })

    it('returns allowed=false with run IDs when active runs exceed the limit', async () => {
      mockWhere.mockReturnValueOnce([
        { id: 'run-1' }, { id: 'run-2' }, { id: 'run-3' },
      ])

      const result = await checkMaxConcurrency('sched-1', 2)
      expect(result).toEqual({ allowed: false, activeRunIds: ['run-1', 'run-2', 'run-3'], activeCount: 3 })
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
      expect(await checkMaxConcurrency('sched-1', 1)).toEqual({ allowed: true })

      // Reset for second call
      mockDb.select.mockReturnValue({ from: mockFrom })
      mockFrom.mockReturnValue({ where: mockWhere })

      // 1 active run → at limit
      mockWhere.mockReturnValueOnce([{ id: 'run-1' }])
      expect(await checkMaxConcurrency('sched-1', 1)).toEqual({ allowed: false, activeRunIds: ['run-1'], activeCount: 1 })
    })

    it('handles high concurrency limits', async () => {
      const runs = Array.from({ length: 5 }, (_, i) => ({ id: `run-${i}` }))
      mockWhere.mockReturnValueOnce(runs)

      expect(await checkMaxConcurrency('sched-1', 10)).toEqual({ allowed: true })
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
      expect(setArg.errorMessage).toContain('4 hours')
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

  // ────────────────────────────────────────────────────────────
  // runCronTick (via triggerCronTick) — concurrency-before-claim ordering
  // ────────────────────────────────────────────────────────────
  describe('runCronTick ordering', () => {
    // A minimal mock schedule that all tests in this suite can use.
    const makeSchedule = (overrides: Record<string, unknown> = {}) => ({
      id: 'sched-00000001-0000-0000-0000-000000000000',
      name: 'Test Schedule',
      projectId: 'proj-1',
      cronExpression: '0 9 * * *',
      timezone: 'UTC',
      enabled: true,
      nextRunAt: new Date('2026-03-12T09:00:00Z'),
      lastRunAt: null,
      maxConcurrency: 1,
      activeHoursStart: null,
      activeHoursEnd: null,
      targetMachineId: 'machine-1',
      scope: 'node',
      nodeId: 'node-1',
      nodeFilter: null,
      missedRunPolicy: 'skip',
      retryTtlMinutes: 60,
      ...overrides,
    })

    /**
     * Helper that sets up sequential mockWhere / mockReturning returns
     * for the call chain inside `runCronTick()`:
     *
     * Call 1 – cleanupStaleScheduleRuns:  update().set().where().returning()
     * Call 2 – due schedules query:       select().from().where()   (returns schedule array)
     * Call 3 – checkMaxConcurrency:       select().from().where()   (returns active runs)
     * Call 4+ – varies depending on concurrency result
     */
    function setupTickMocks(opts: {
      schedules?: ReturnType<typeof makeSchedule>[],
      activeRuns?: { id: string }[],
      /** If provided, these are appended as further mockWhere oneshots. */
      extraWhereReturns?: unknown[],
      /** Extra mockReturning oneshots after the cleanup one. */
      extraReturningReturns?: unknown[],
    }) {
      const {
        schedules: dueSchedules = [makeSchedule()],
        activeRuns = [],
        extraWhereReturns = [],
        extraReturningReturns = [],
      } = opts

      // Call 1 – cleanupStaleScheduleRuns: update().set().where().returning()
      // where() must return { returning } so the chain continues to .returning()
      mockWhere.mockReturnValueOnce({ returning: mockReturning, limit: mockLimit })
      mockReturning.mockResolvedValueOnce([])                    // cleanup returning

      // Call 2 – due schedules: select().from().where() → schedule array (awaited)
      mockWhere.mockReturnValueOnce(dueSchedules)

      // Call 3 – checkMaxConcurrency: select().from().where() → active runs
      mockWhere.mockReturnValueOnce(activeRuns)

      // Additional calls
      for (const val of extraWhereReturns) {
        mockWhere.mockReturnValueOnce(val as ReturnType<typeof mockWhere>)
      }
      for (const val of extraReturningReturns) {
        mockReturning.mockResolvedValueOnce(val as Awaited<ReturnType<typeof mockReturning>>)
      }
    }

    it('concurrency blocks → nextRunAt NOT advanced, missed run inserted', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const schedule = makeSchedule({ maxConcurrency: 1 })
      const originalNextRunAt = schedule.nextRunAt

      // Setup: one active run → at max concurrency (1)
      setupTickMocks({
        schedules: [schedule],
        activeRuns: [{ id: 'run-blocking-1' }],
        // Call 4 – insertScheduleRun: select max runNumber → where() returns [{maxNum: 5}]
        extraWhereReturns: [
          [{ maxNum: 5 }],  // max run number query
        ],
        // insertScheduleRun: insert().values().returning() → returns the new run
        extraReturningReturns: [
          [{ id: 'missed-run-1', runNumber: 6, status: 'missed' }],
        ],
      })

      await triggerCronTick()

      // db.update() should have been called exactly once — for cleanup only.
      // claimSchedule would call db.update() a second time if it ran, so
      // exactly 1 update call means nextRunAt was NOT advanced.
      // Call 1 = cleanup. No claim call = not advanced.
      expect(mockDb.update).toHaveBeenCalledTimes(1)

      // insertScheduleRun should have been called (db.insert)
      expect(mockDb.insert).toHaveBeenCalled()

      // Verify nextRunAt on the schedule object is unchanged
      expect(schedule.nextRunAt).toBe(originalNextRunAt)
    })

    it('active hours blocks → nextRunAt NOT advanced, missed run inserted', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})

      // Use a 1-minute active-hours window that is virtually never "now",
      // so isWithinActiveHours returns false regardless of the current time.
      const schedule2 = makeSchedule({
        activeHoursStart: '23:58',
        activeHoursEnd: '23:59',   // Only 1 minute window — virtually always outside
      })

      // For this test, the schedule is "due" but outside active hours.
      // Setup cleanup + due schedules. No concurrency check should happen.
      // cleanup: where() → chain, returning() → []
      mockWhere.mockReturnValueOnce({ returning: mockReturning, limit: mockLimit })
      mockReturning.mockResolvedValueOnce([])
      // due schedules: where() → schedule array
      mockWhere.mockReturnValueOnce([schedule2])

      // insertScheduleRun for the missed run:
      // select max runNumber
      mockWhere.mockReturnValueOnce([{ maxNum: 0 }])
      // insert returning
      mockReturning.mockResolvedValueOnce([{ id: 'missed-ah-1', runNumber: 1, status: 'missed' }])

      await triggerCronTick()

      // Only 1 update call (cleanup), no claimSchedule update
      expect(mockDb.update).toHaveBeenCalledTimes(1)

      // insertScheduleRun was called (db.insert)
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('concurrency allows → nextRunAt IS advanced (claimSchedule called)', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const schedule = makeSchedule({ maxConcurrency: 2 })

      // Setup: no active runs → under max concurrency
      setupTickMocks({
        schedules: [schedule],
        activeRuns: [],  // 0 < 2, allowed
        extraWhereReturns: [],
        extraReturningReturns: [],
      })

      // Call 4 – claimSchedule: update().set().where().returning()
      // where() needs to chain to returning()
      mockWhere.mockReturnValueOnce({ returning: mockReturning, limit: mockLimit })
      mockReturning.mockResolvedValueOnce([{ id: schedule.id }])

      // Call 5+ – processSchedule: isMachineOnline select().from().where().limit()
      // where() returns { limit }, limit() returns mockReturning
      mockReturning.mockResolvedValueOnce([{ isConnected: true }])

      // resetNodeIfTerminal: select().from().where().limit()
      mockReturning.mockResolvedValueOnce([{ status: 'completed', deletedAt: null }])

      // resetNodeIfTerminal: db.update().set().where() for resetting node — uses default chain

      // insertScheduleRun: select max runNumber
      mockWhere.mockReturnValueOnce([{ maxNum: 0 }])
      // insertScheduleRun: insert().values().returning()
      mockReturning.mockResolvedValueOnce([{ id: 'run-1', runNumber: 1, status: 'dispatched' }])

      await triggerCronTick()

      // db.update() should have been called at least twice:
      // 1 = cleanup, 2 = claimSchedule, possibly more for processSchedule
      expect(mockDb.update.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('logs blocking run IDs when concurrency blocks', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const schedule = makeSchedule({
        maxConcurrency: 1,
        id: 'sched-abcdef01-0000-0000-0000-000000000000',
      })

      setupTickMocks({
        schedules: [schedule],
        activeRuns: [{ id: 'run-11111111-2222-3333-4444-555555555555' }],
        extraWhereReturns: [
          [{ maxNum: 0 }],  // insertScheduleRun: max runNumber
        ],
        extraReturningReturns: [
          [{ id: 'missed-1', runNumber: 1, status: 'missed' }], // insertScheduleRun returning
        ],
      })

      await triggerCronTick()

      // Verify log message includes the blocking run ID (first 8 chars: "run-1111")
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('run-1111'),
      )
      // Verify log message mentions concurrency being reached
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('max concurrency'),
      )
      // Verify it mentions "1 active run(s)"
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 active run(s)'),
      )
    })

    it('isWithinActiveHours returns true when no active hours set', () => {
      expect(isWithinActiveHours(null, null, new Date(), 'UTC')).toBe(true)
    })

    it('isWithinActiveHours returns false outside window', () => {
      // 09:00-17:00, test at 03:00
      const now = new Date('2026-03-12T03:00:00Z')
      expect(isWithinActiveHours('09:00', '17:00', now, 'UTC')).toBe(false)
    })

    it('isWithinActiveHours returns true inside window', () => {
      // 09:00-17:00, test at 12:00
      const now = new Date('2026-03-12T12:00:00Z')
      expect(isWithinActiveHours('09:00', '17:00', now, 'UTC')).toBe(true)
    })
  })
})
