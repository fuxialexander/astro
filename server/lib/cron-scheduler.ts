/**
 * Cron Scheduler
 *
 * Polls the `schedules` table every 60 seconds for due schedules
 * (next_run_at <= NOW() AND enabled = true) and dispatches them.
 *
 * Uses Redis leader election when multiple instances are running — only one
 * instance polls at a time. If the leader dies, its lock expires and another
 * instance takes over automatically.
 *
 * This module follows the same pattern as cleanup-scheduler.ts.
 */

import { Cron } from 'croner'
import { db } from './db/index.js'
import { schedules, scheduleRuns, planNodes, planEdges, registeredMachines } from './db/schema.js'
import { eq, and, lte, gt, isNull, inArray, max } from 'drizzle-orm'
import { redisPubSub } from './redis-pubsub.js'
import { serverSideDispatch } from './server-side-dispatch.js'

// ── Shared constants ─────────────────────────────────────────────
export const TERMINAL_STATUSES = ['completed', 'auto_verified', 'pruned', 'awaiting_judgment']
const COMPLETED_STATUSES = ['completed', 'auto_verified']

/**
 * Runs stuck in an active status beyond this threshold are considered zombie
 * runs and are excluded from the concurrency check / cleaned up automatically.
 * 24 hours is conservative — real executions should complete or fail much sooner.
 */
const STALE_RUN_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Insert a schedule run with an atomically computed run number.
 * Uses SELECT max + INSERT with a retry loop to handle unique constraint violations
 * from concurrent inserts.
 */
export async function insertScheduleRun(
  values: Omit<typeof scheduleRuns.$inferInsert, 'runNumber'>,
): Promise<typeof scheduleRuns.$inferSelect> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [maxRun] = await db.select({ maxNum: max(scheduleRuns.runNumber) })
      .from(scheduleRuns).where(eq(scheduleRuns.scheduleId, values.scheduleId))
    const runNumber = (maxRun?.maxNum ?? 0) + 1

    try {
      const [run] = await db.insert(scheduleRuns).values({
        ...values,
        runNumber,
      }).returning()
      return run
    } catch (err: unknown) {
      // Check for unique constraint violation (23505) — retry with next number
      const pgErr = err as { code?: string }
      if (pgErr.code === '23505' && attempt < 2) continue
      throw err
    }
  }
  // Unreachable but satisfies TypeScript
  throw new Error('Failed to insert schedule run after retries')
}

/**
 * Validate that a timezone string is supported by the runtime.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export interface CronSchedulerConfig {
  enabled: boolean
  intervalMs: number
}

const DEFAULT_CONFIG: CronSchedulerConfig = {
  enabled: true,
  intervalMs: 60_000, // 60 seconds
}

const LEADER_NAME = 'cron-scheduler'
const LEADER_TTL_SECONDS = 180 // 3 minutes

let cronTimer: ReturnType<typeof setInterval> | null = null
let config: CronSchedulerConfig = DEFAULT_CONFIG

/**
 * Check if a schedule is within its active hours window.
 */
export function isWithinActiveHours(
  activeHoursStart: string | null,
  activeHoursEnd: string | null,
  now: Date,
  timezone: string,
): boolean {
  if (!activeHoursStart || !activeHoursEnd) return true

  // Get the current time in the schedule's timezone (minute-level precision)
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone,
  })
  const parts = formatter.formatToParts(now)
  const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
  const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
  const currentTotal = currentHour * 60 + currentMinute

  const [startH, startM] = activeHoursStart.split(':').map(Number)
  const [endH, endM] = activeHoursEnd.split(':').map(Number)
  const startTotal = startH * 60 + (startM || 0)
  const endTotal = endH * 60 + (endM || 0)

  if (startTotal <= endTotal) {
    // Normal range: e.g., 09:00 - 17:00
    return currentTotal >= startTotal && currentTotal < endTotal
  } else {
    // Overnight range: e.g., 22:00 - 06:00
    return currentTotal >= startTotal || currentTotal < endTotal
  }
}

/**
 * Compute a branch suffix based on cron frequency.
 * Daily or less frequent → YYYYMMDD. Sub-daily → YYYYMMDDTHHmm.
 */
export function computeBranchSuffix(cronExpression: string, now: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  })
  const parts = formatter.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  const dateStr = `${get('year')}${get('month')}${get('day')}`

  // Check if cron fires more frequently than daily
  try {
    const cron = new Cron(cronExpression, { timezone })
    const next1 = cron.nextRun()
    if (next1) {
      const next2 = cron.nextRun(next1)
      if (next2) {
        const gapMs = next2.getTime() - next1.getTime()
        const oneDayMs = 24 * 60 * 60 * 1000
        if (gapMs < oneDayMs) {
          // Sub-daily: include time
          return `${dateStr}T${get('hour')}${get('minute')}`
        }
      }
    }
  } catch {
    // Fallback to date-only
  }

  return dateStr
}

/**
 * Check max concurrency for a schedule.
 *
 * Returns `{ allowed: true }` if under the limit, or
 * `{ allowed: false, activeRunIds, activeCount }` when blocked.
 *
 * Runs that have been stuck in an active status for longer than
 * STALE_RUN_THRESHOLD_MS are excluded — they are zombie runs from a crashed
 * server or disconnected machine and should not block new executions.
 */
export async function checkMaxConcurrency(
  scheduleId: string,
  maxConcurrency: number,
): Promise<{ allowed: true } | { allowed: false; activeRunIds: string[]; activeCount: number }> {
  const staleThreshold = new Date(Date.now() - STALE_RUN_THRESHOLD_MS)
  const activeRuns = await db.select({ id: scheduleRuns.id })
    .from(scheduleRuns)
    .where(and(
      eq(scheduleRuns.scheduleId, scheduleId),
      inArray(scheduleRuns.status, ['pending', 'dispatched', 'running']),
      // Exclude zombie runs — created too long ago to be genuinely in-flight
      gt(scheduleRuns.createdAt, staleThreshold),
    ))
  if (activeRuns.length < maxConcurrency) {
    return { allowed: true }
  }
  return { allowed: false, activeRunIds: activeRuns.map(r => r.id), activeCount: activeRuns.length }
}

/**
 * Check if a machine is online. Returns true if online or if the table
 * doesn't exist (PGlite local mode).
 */
export async function isMachineOnline(machineId: string): Promise<boolean> {
  try {
    const [machine] = await db.select({ isConnected: registeredMachines.isConnected })
      .from(registeredMachines)
      .where(eq(registeredMachines.id, machineId))
      .limit(1)
    return machine?.isConnected ?? false
  } catch (error: unknown) {
    // Only assume online if table doesn't exist (PGlite); rethrow real errors
    const err = error as { cause?: { code?: string }; code?: string }
    if (err?.cause?.code === '42P01' || err?.code === '42P01') return true
    throw error
  }
}

/**
 * Reset a single node to 'planned' if it's in a terminal status.
 * Only resets if the node exists, isn't deleted, and is in a terminal state.
 * Returns false if the node is currently in_progress/dispatched (skip it).
 */
export async function resetNodeIfTerminal(nodeId: string, now: Date): Promise<'reset' | 'active' | 'not_found'> {
  const [node] = await db.select({ status: planNodes.status, deletedAt: planNodes.deletedAt })
    .from(planNodes)
    .where(eq(planNodes.clientId, nodeId))
    .limit(1)

  if (!node || node.deletedAt) return 'not_found'
  if (node.status === 'in_progress' || node.status === 'dispatched') return 'active'

  if (TERMINAL_STATUSES.includes(node.status)) {
    await db.update(planNodes)
      .set({
        status: 'planned',
        executionId: null,
        executionOutput: null,
        executionError: null,
        executionStartedAt: null,
        executionCompletedAt: null,
        updatedAt: now,
      })
      .where(eq(planNodes.clientId, nodeId))
    return 'reset'
  }

  // Node is 'planned' — already ready for dispatch
  if (node.status === 'planned') return 'reset'

  // Non-terminal, non-active statuses (e.g. awaiting_approval) — skip
  return 'active'
}

/**
 * Dispatch eligible root nodes for a project-scope schedule.
 * Returns the number of nodes dispatched.
 */
export async function dispatchProjectRootNodes(
  schedule: typeof schedules.$inferSelect,
  run: typeof scheduleRuns.$inferSelect,
  branchSuffix: string,
  now: Date,
  logPrefix: string,
): Promise<number> {
  const allNodes = await db.select()
    .from(planNodes)
    .where(and(eq(planNodes.projectId, schedule.projectId), isNull(planNodes.deletedAt)))
  const allEdges = await db.select()
    .from(planEdges)
    .where(and(eq(planEdges.projectId, schedule.projectId), isNull(planEdges.deletedAt)))

  // Filter to specific nodes if nodeFilter is set
  let taskNodes = allNodes.filter(n => n.type === 'task')
  if (schedule.nodeFilter && schedule.nodeFilter.length > 0) {
    const filterSet = new Set(schedule.nodeFilter)
    taskNodes = taskNodes.filter(n => filterSet.has(n.clientId))
  }

  if (taskNodes.length === 0) return 0

  // Reset all terminal task nodes to planned, updating in-memory status to match
  for (const node of taskNodes) {
    if (TERMINAL_STATUSES.includes(node.status)) {
      await db.update(planNodes)
        .set({
          status: 'planned',
          executionId: null,
          executionOutput: null,
          executionError: null,
          executionStartedAt: null,
          executionCompletedAt: null,
          updatedAt: now,
        })
        .where(eq(planNodes.clientId, node.clientId))
      node.status = 'planned'
    }
  }

  // Dispatch root nodes (no incoming edges from within the filtered set)
  const nodeIds = new Set(taskNodes.map(n => n.clientId))
  let dispatched = 0

  for (const node of taskNodes) {
    if (node.status === 'in_progress' || node.status === 'dispatched') continue

    const depEdges = allEdges.filter(e => e.targetClientId === node.clientId)
    const allDepsMet = depEdges.every(depEdge => {
      // Use taskNodes (with updated statuses) for dependency lookup within the filtered set
      const depNode = taskNodes.find(n => n.clientId === depEdge.sourceClientId)
        ?? allNodes.find(n => n.clientId === depEdge.sourceClientId)
      if (!nodeIds.has(depEdge.sourceClientId)) return true
      return depNode && COMPLETED_STATUSES.includes(depNode.status)
    })

    if (allDepsMet) {
      console.log(`${logPrefix}: dispatching root node ${node.clientId} (run #${run.runNumber})`)
      serverSideDispatch(node.clientId, schedule.projectId, {
        targetMachineId: schedule.targetMachineId,
        branchSuffix,
        scheduleRunId: run.id,
      }).catch((err) => {
        console.error(`${logPrefix}: dispatch failed for ${node.clientId}:`, err)
      })
      dispatched++
    }
  }

  return dispatched
}

/**
 * Process a single due schedule: create run, dispatch nodes.
 */
async function processSchedule(
  schedule: typeof schedules.$inferSelect,
  now: Date,
): Promise<void> {
  const logPrefix = `[cron] schedule=${schedule.id.slice(0, 8)} "${schedule.name}"`

  // NOTE: Active hours and concurrency checks are performed BEFORE claimSchedule()
  // in runCronTick() so that nextRunAt is not advanced when a run must be skipped.
  // Only machine-connectivity and dispatch logic remain here.

  // Machine connectivity check
  let machineOnline: boolean
  try {
    machineOnline = await isMachineOnline(schedule.targetMachineId)
  } catch (err) {
    console.error(`${logPrefix}: error checking machine connectivity:`, err)
    await insertScheduleRun({
      scheduleId: schedule.id,
      status: 'failure',
      scheduledAt: now,
      completedAt: now,
      errorMessage: `Error checking machine connectivity: ${String(err)}`,
    })
    return
  }

  if (!machineOnline) {
    console.log(`${logPrefix}: target machine ${schedule.targetMachineId} is offline`)

    if (schedule.missedRunPolicy === 'skip') {
      await insertScheduleRun({
        scheduleId: schedule.id,
        status: 'missed',
        scheduledAt: now,
        errorMessage: `Target machine ${schedule.targetMachineId} is offline`,
      })
    } else if (schedule.missedRunPolicy === 'retry_on_reconnect') {
      const retryUntil = new Date(now.getTime() + schedule.retryTtlMinutes * 60 * 1000)
      await insertScheduleRun({
        scheduleId: schedule.id,
        status: 'missed',
        scheduledAt: now,
        errorMessage: `Target machine ${schedule.targetMachineId} is offline — will retry until ${retryUntil.toISOString()}`,
        retryUntil,
      })
    }

    // Advance nextRunAt even on missed runs
    return
  }

  // Compute branch suffix
  const branchSuffix = computeBranchSuffix(schedule.cronExpression, now, schedule.timezone)

  if (schedule.scope === 'node') {
    // ── Node scope: dispatch a single node ──
    if (!schedule.nodeId) {
      console.error(`${logPrefix}: node-scope schedule missing nodeId`)
      return
    }

    const nodeResult = await resetNodeIfTerminal(schedule.nodeId, now)
    if (nodeResult === 'not_found') {
      console.log(`${logPrefix}: node ${schedule.nodeId} not found or deleted`)
      await insertScheduleRun({
        scheduleId: schedule.id,
        status: 'success',
        scheduledAt: now,
        completedAt: now,
        summary: { message: 'Node not found or deleted' },
      })
      return
    }
    if (nodeResult === 'active') {
      console.log(`${logPrefix}: node ${schedule.nodeId} already active, skipping`)
      await insertScheduleRun({
        scheduleId: schedule.id,
        status: 'missed',
        scheduledAt: now,
        completedAt: now,
        errorMessage: `Skipped: node ${schedule.nodeId} is currently active (in_progress, dispatched, or awaiting_approval)`,
      })
      return
    }

    // Create run entry (atomic run number via insertScheduleRun)
    const run = await insertScheduleRun({
      scheduleId: schedule.id,
      status: 'dispatched',
      branchName: `astro/${branchSuffix}`,
      scheduledAt: now,
      startedAt: now,
    })

    // Dispatch
    console.log(`${logPrefix}: dispatching node ${schedule.nodeId} (run #${run.runNumber})`)
    serverSideDispatch(schedule.nodeId, schedule.projectId, {
      targetMachineId: schedule.targetMachineId,
      branchSuffix,
      scheduleRunId: run.id,
    }).catch((err) => {
      console.error(`${logPrefix}: dispatch failed:`, err)
      db.update(scheduleRuns)
        .set({ status: 'failure', completedAt: new Date(), errorMessage: String(err) })
        .where(eq(scheduleRuns.id, run.id))
        .execute().catch(() => {})
    })
  } else {
    // ── Project scope: dispatch all eligible root nodes ──
    // Create run entry first
    const run = await insertScheduleRun({
      scheduleId: schedule.id,
      status: 'dispatched',
      scheduledAt: now,
      startedAt: now,
    })

    const dispatched = await dispatchProjectRootNodes(schedule, run, branchSuffix, now, logPrefix)

    if (dispatched === 0) {
      await db.update(scheduleRuns)
        .set({ status: 'success', completedAt: now, summary: { message: 'No eligible nodes to dispatch' } })
        .where(eq(scheduleRuns.id, run.id))
    }

    console.log(`${logPrefix}: dispatched ${dispatched} root nodes (run #${run.runNumber})`)
  }

  // Schedule already advanced by claimSchedule() before processSchedule() was called
}

/**
 * Atomically claim a schedule by advancing its nextRunAt.
 * Returns true if this instance claimed it (row was updated),
 * false if another instance already advanced it (no matching row).
 * This prevents double-dispatch on concurrent ticks.
 */
async function claimSchedule(
  schedule: typeof schedules.$inferSelect,
  now: Date,
): Promise<boolean> {
  try {
    const cron = new Cron(schedule.cronExpression, { timezone: schedule.timezone })
    const nextRun = cron.nextRun()

    const rows = await db.update(schedules)
      .set({
        nextRunAt: nextRun,
        lastRunAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(schedules.id, schedule.id),
        // Optimistic lock: only update if nextRunAt hasn't changed
        eq(schedules.nextRunAt, schedule.nextRunAt!),
      ))
      .returning({ id: schedules.id })

    return rows.length > 0
  } catch (err) {
    console.error(`[cron] Failed to claim schedule ${schedule.id}:`, err)
    return false
  }
}

/**
 * Mark schedule runs that have been stuck in an active status for longer than
 * STALE_RUN_THRESHOLD_MS as 'failure'. This prevents zombie runs (from server
 * crashes, machine disconnects, etc.) from permanently blocking concurrency.
 */
export async function cleanupStaleScheduleRuns(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_RUN_THRESHOLD_MS)
  try {
    const stale = await db.update(scheduleRuns)
      .set({
        status: 'failure',
        completedAt: new Date(),
        errorMessage: 'Timed out: run was stuck in an active state for over 24 hours (server crash or machine disconnect)',
      })
      .where(and(
        inArray(scheduleRuns.status, ['pending', 'dispatched', 'running']),
        lte(scheduleRuns.createdAt, staleThreshold),
      ))
      .returning({ id: scheduleRuns.id })

    if (stale.length > 0) {
      console.log(`[cron] Cleaned up ${stale.length} stale schedule run(s) stuck in active status`)
    }
  } catch (err) {
    console.error('[cron] Error cleaning up stale schedule runs:', err)
  }
}

/**
 * Main cron tick: query all due schedules and process them.
 */
async function runCronTick(): Promise<void> {
  const now = new Date()
  console.log('[cron] Running cron tick...')

  try {
    // Clean up zombie runs first so stale entries don't block concurrency checks
    await cleanupStaleScheduleRuns()

    const dueSchedules = await db.select()
      .from(schedules)
      .where(and(
        eq(schedules.enabled, true),
        lte(schedules.nextRunAt, now),
      ))

    if (dueSchedules.length === 0) {
      return
    }

    console.log(`[cron] Found ${dueSchedules.length} due schedule(s)`)

    for (const schedule of dueSchedules) {
      const logPrefix = `[cron] schedule=${schedule.id.slice(0, 8)} "${schedule.name}"`
      try {
        // ── Pre-claim checks ──────────────────────────────────────
        // These run BEFORE claimSchedule() so that nextRunAt is NOT
        // advanced when the run must be skipped — the schedule stays
        // due and will be re-evaluated on the next tick.

        // 1. Active hours check
        if (!isWithinActiveHours(schedule.activeHoursStart, schedule.activeHoursEnd, now, schedule.timezone)) {
          console.log(`${logPrefix}: outside active hours, skipping without advancing`)
          await insertScheduleRun({
            scheduleId: schedule.id,
            status: 'missed',
            scheduledAt: now,
            completedAt: now,
            errorMessage: 'Skipped: outside active hours window',
          })
          continue
        }

        // 2. Concurrency check
        const concurrency = await checkMaxConcurrency(schedule.id, schedule.maxConcurrency)
        if (!concurrency.allowed) {
          const runIdSnippets = concurrency.activeRunIds.map(id => id.slice(0, 8)).join(', ')
          console.log(
            `${logPrefix}: max concurrency (${schedule.maxConcurrency}) reached `
            + `(${concurrency.activeCount} active run(s): ${runIdSnippets}), skipping without advancing`,
          )
          await insertScheduleRun({
            scheduleId: schedule.id,
            status: 'missed',
            scheduledAt: now,
            completedAt: now,
            errorMessage: `Skipped: max concurrency (${schedule.maxConcurrency}) reached — ${concurrency.activeCount} active run(s): ${runIdSnippets}`,
          })
          continue
        }

        // ── Claim & process ───────────────────────────────────────
        // Atomically advance nextRunAt — only proceeds if no other
        // instance has already claimed this fire time.
        const claimed = await claimSchedule(schedule, now)
        if (!claimed) {
          console.log(`[cron] Schedule ${schedule.id.slice(0, 8)} already claimed by another instance`)
          continue
        }
        await processSchedule(schedule, now)
      } catch (err) {
        console.error(`[cron] Error processing schedule ${schedule.id}:`, err)
      }
    }
  } catch (error: unknown) {
    const err = error as { cause?: { code?: string } }
    if (err?.cause?.code === '42P01') {
      // Table doesn't exist yet — skip silently
      return
    }
    throw error
  }
}

/**
 * Run cron tick only if this instance is the leader.
 */
async function runCronTickIfLeader(): Promise<void> {
  const acquired = await redisPubSub.tryAcquireLeader(LEADER_NAME, LEADER_TTL_SECONDS)
  const renewed = !acquired && await redisPubSub.renewLeadership(LEADER_NAME, LEADER_TTL_SECONDS)

  if (!acquired && !renewed) {
    return // Another instance is the cron leader
  }

  await runCronTick()
}

/**
 * Retry missed schedule runs when a machine reconnects.
 */
export async function retryMissedRunsForMachine(machineId: string): Promise<void> {
  const now = new Date()

  try {
    // Find missed runs targeting this machine that are still within retry window
    const missedRuns = await db.select({
      run: scheduleRuns,
      schedule: schedules,
    })
      .from(scheduleRuns)
      .innerJoin(schedules, eq(scheduleRuns.scheduleId, schedules.id))
      .where(and(
        eq(scheduleRuns.status, 'missed'),
        eq(schedules.targetMachineId, machineId),
        eq(schedules.enabled, true),
      ))

    // Filter to runs with retryUntil in the future
    const retriable = missedRuns.filter(r => r.run.retryUntil && r.run.retryUntil > now)

    if (retriable.length === 0) return

    console.log(`[cron] Retrying ${retriable.length} missed run(s) for machine ${machineId}`)

    for (const { run, schedule } of retriable) {
      try {
        // Respect max concurrency on retry
        const concurrency = await checkMaxConcurrency(schedule.id, schedule.maxConcurrency)
        if (!concurrency.allowed) {
          console.log(`[cron] retry: max concurrency (${schedule.maxConcurrency}) reached for schedule ${schedule.id.slice(0, 8)}, skipping`)
          continue
        }

        // Update run status to dispatched
        await db.update(scheduleRuns)
          .set({ status: 'dispatched', startedAt: now })
          .where(eq(scheduleRuns.id, run.id))

        const branchSuffix = computeBranchSuffix(schedule.cronExpression, run.scheduledAt, schedule.timezone)
        const logPrefix = `[cron] retry run=${run.id.slice(0, 8)}`

        if (schedule.scope === 'node' && schedule.nodeId) {
          serverSideDispatch(schedule.nodeId, schedule.projectId, {
            targetMachineId: machineId,
            branchSuffix,
            scheduleRunId: run.id,
          }).catch((err) => {
            console.error(`${logPrefix}: dispatch failed:`, err)
            // Reset to missed so it remains eligible for retry
            db.update(scheduleRuns)
              .set({ status: 'missed', startedAt: null })
              .where(eq(scheduleRuns.id, run.id))
              .execute().catch(() => {})
          })
        } else if (schedule.scope === 'project') {
          const dispatched = await dispatchProjectRootNodes(schedule, run, branchSuffix, now, logPrefix)
          if (dispatched === 0) {
            await db.update(scheduleRuns)
              .set({ status: 'success', completedAt: now, summary: { message: 'No eligible nodes on retry' } })
              .where(eq(scheduleRuns.id, run.id))
          }
        }
      } catch (err) {
        console.error(`[cron] Error retrying run ${run.id}:`, err)
      }
    }
  } catch (error: unknown) {
    const err = error as { cause?: { code?: string } }
    if (err?.cause?.code === '42P01') return // Table doesn't exist
    console.error('[cron] Error retrying missed runs:', error)
  }
}

/**
 * Start the cron scheduler.
 */
export function startCronScheduler(customConfig?: Partial<CronSchedulerConfig>): void {
  config = { ...DEFAULT_CONFIG, ...customConfig }

  if (!config.enabled) {
    console.log('[cron] Cron scheduler disabled')
    return
  }

  stopCronScheduler()

  console.log(`[cron] Starting cron scheduler (interval: ${config.intervalMs / 1000}s)`)

  // Run immediately on start
  runCronTickIfLeader().catch((err) => {
    console.error('[cron] Initial cron tick failed:', err)
  })

  // Schedule periodic ticks
  cronTimer = setInterval(() => {
    runCronTickIfLeader().catch((err) => {
      console.error('[cron] Scheduled cron tick failed:', err)
    })
  }, config.intervalMs)
}

/**
 * Stop the cron scheduler.
 */
export function stopCronScheduler(): void {
  if (cronTimer) {
    clearInterval(cronTimer)
    cronTimer = null
    redisPubSub.releaseLeadership(LEADER_NAME).catch(() => {})
    console.log('[cron] Cron scheduler stopped')
  }
}

/**
 * Manual trigger for testing — runs a cron tick immediately without leader election.
 */
export async function triggerCronTick(): Promise<void> {
  await runCronTick()
}
