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
import { eq, and, lte, isNull, inArray, max } from 'drizzle-orm'
import { redisPubSub } from './redis-pubsub.js'
import { serverSideDispatch } from './server-side-dispatch.js'

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
function isWithinActiveHours(
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
function computeBranchSuffix(cronExpression: string, now: Date, timezone: string): string {
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
 * Process a single due schedule: create run, dispatch nodes.
 */
async function processSchedule(
  schedule: typeof schedules.$inferSelect,
  now: Date,
): Promise<void> {
  const logPrefix = `[cron] schedule=${schedule.id.slice(0, 8)} "${schedule.name}"`

  // Active hours check
  if (!isWithinActiveHours(schedule.activeHoursStart, schedule.activeHoursEnd, now, schedule.timezone)) {
    console.log(`${logPrefix}: outside active hours, skipping`)
    return
  }

  // Max concurrency check
  const activeRuns = await db.select({ id: scheduleRuns.id })
    .from(scheduleRuns)
    .where(and(
      eq(scheduleRuns.scheduleId, schedule.id),
      inArray(scheduleRuns.status, ['pending', 'dispatched', 'running']),
    ))
  if (activeRuns.length >= schedule.maxConcurrency) {
    console.log(`${logPrefix}: max concurrency (${schedule.maxConcurrency}) reached, skipping`)
    return
  }

  // Machine connectivity check
  let machineOnline = false
  try {
    const [machine] = await db.select({ isConnected: registeredMachines.isConnected })
      .from(registeredMachines)
      .where(eq(registeredMachines.id, schedule.targetMachineId))
      .limit(1)
    machineOnline = machine?.isConnected ?? false
  } catch {
    // If table doesn't exist (PGlite), assume online
    machineOnline = true
  }

  if (!machineOnline) {
    console.log(`${logPrefix}: target machine ${schedule.targetMachineId} is offline`)

    if (schedule.missedRunPolicy === 'skip') {
      // Create missed run record
      const [maxRun] = await db.select({ maxNum: max(scheduleRuns.runNumber) })
        .from(scheduleRuns).where(eq(scheduleRuns.scheduleId, schedule.id))
      const runNumber = (maxRun?.maxNum ?? 0) + 1

      await db.insert(scheduleRuns).values({
        scheduleId: schedule.id,
        runNumber,
        status: 'missed',
        scheduledAt: now,
        errorMessage: `Target machine ${schedule.targetMachineId} is offline`,
      })
    } else if (schedule.missedRunPolicy === 'retry_on_reconnect') {
      const [maxRun] = await db.select({ maxNum: max(scheduleRuns.runNumber) })
        .from(scheduleRuns).where(eq(scheduleRuns.scheduleId, schedule.id))
      const runNumber = (maxRun?.maxNum ?? 0) + 1
      const retryUntil = new Date(now.getTime() + schedule.retryTtlMinutes * 60 * 1000)

      await db.insert(scheduleRuns).values({
        scheduleId: schedule.id,
        runNumber,
        status: 'missed',
        scheduledAt: now,
        errorMessage: `Target machine ${schedule.targetMachineId} is offline — will retry until ${retryUntil.toISOString()}`,
        retryUntil,
      })
    }

    // Advance nextRunAt even on missed runs
    return
  }

  // Compute run number
  const [maxRun] = await db.select({ maxNum: max(scheduleRuns.runNumber) })
    .from(scheduleRuns).where(eq(scheduleRuns.scheduleId, schedule.id))
  const runNumber = (maxRun?.maxNum ?? 0) + 1

  // Compute branch suffix
  const branchSuffix = computeBranchSuffix(schedule.cronExpression, now, schedule.timezone)

  if (schedule.scope === 'node') {
    // ── Node scope: dispatch a single node ──
    if (!schedule.nodeId) {
      console.error(`${logPrefix}: node-scope schedule missing nodeId`)

      return
    }

    // Check node exists and isn't deleted
    const [node] = await db.select({ status: planNodes.status, deletedAt: planNodes.deletedAt })
      .from(planNodes)
      .where(eq(planNodes.clientId, schedule.nodeId))
      .limit(1)

    if (!node || node.deletedAt) {
      console.log(`${logPrefix}: node ${schedule.nodeId} not found or deleted`)
      await db.insert(scheduleRuns).values({
        scheduleId: schedule.id,
        runNumber,
        status: 'success',
        scheduledAt: now,
        completedAt: now,
        summary: { message: 'Node not found or deleted' },
      })

      return
    }

    // Skip if node is currently in_progress
    if (node.status === 'in_progress' || node.status === 'dispatched') {
      console.log(`${logPrefix}: node ${schedule.nodeId} already ${node.status}, skipping`)

      return
    }

    // Reset node to planned if terminal
    const terminalStatuses = ['completed', 'auto_verified', 'pruned', 'awaiting_judgment']
    if (terminalStatuses.includes(node.status)) {
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
        .where(eq(planNodes.clientId, schedule.nodeId))
    }

    // Create run entry
    const [run] = await db.insert(scheduleRuns).values({
      scheduleId: schedule.id,
      runNumber,
      status: 'dispatched',
      branchName: `astro/${branchSuffix}`,
      scheduledAt: now,
      startedAt: now,
    }).returning()

    // Dispatch
    console.log(`${logPrefix}: dispatching node ${schedule.nodeId} (run #${runNumber})`)
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

    if (taskNodes.length === 0) {
      console.log(`${logPrefix}: no eligible nodes`)
      await db.insert(scheduleRuns).values({
        scheduleId: schedule.id,
        runNumber,
        status: 'success',
        scheduledAt: now,
        completedAt: now,
        summary: { message: 'No eligible nodes' },
      })

      return
    }

    // Reset all terminal task nodes to planned
    const terminalStatuses = ['completed', 'auto_verified', 'pruned', 'awaiting_judgment']
    for (const node of taskNodes) {
      if (terminalStatuses.includes(node.status)) {
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
      }
    }

    // Create run entry
    const [run] = await db.insert(scheduleRuns).values({
      scheduleId: schedule.id,
      runNumber,
      status: 'dispatched',
      scheduledAt: now,
      startedAt: now,
    }).returning()

    // Dispatch root nodes (no incoming edges from within the filtered set)
    const nodeIds = new Set(taskNodes.map(n => n.clientId))
    const COMPLETED_STATUSES = ['completed', 'auto_verified']
    let dispatched = 0

    for (const node of taskNodes) {
      // Skip if already running
      if (node.status === 'in_progress' || node.status === 'dispatched') continue

      const depEdges = allEdges.filter(e => e.targetClientId === node.clientId)
      const allDepsMet = depEdges.every(depEdge => {
        const depNode = allNodes.find(n => n.clientId === depEdge.sourceClientId)
        // Deps outside node filter are always considered met
        if (!nodeIds.has(depEdge.sourceClientId)) return true
        return depNode && COMPLETED_STATUSES.includes(depNode.status)
      })

      if (allDepsMet) {
        console.log(`${logPrefix}: dispatching root node ${node.clientId} (run #${runNumber})`)
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

    console.log(`${logPrefix}: dispatched ${dispatched}/${taskNodes.length} root nodes (run #${runNumber})`)
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

    const result = await db.update(schedules)
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

    return (result.rowCount ?? 0) > 0
  } catch (err) {
    console.error(`[cron] Failed to claim schedule ${schedule.id}:`, err)
    return false
  }
}

/**
 * Main cron tick: query all due schedules and process them.
 */
async function runCronTick(): Promise<void> {
  const now = new Date()
  console.log('[cron] Running cron tick...')

  try {
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
      try {
        // Atomically claim the schedule before processing
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
        // Update run status to dispatched
        await db.update(scheduleRuns)
          .set({ status: 'dispatched', startedAt: now })
          .where(eq(scheduleRuns.id, run.id))

        const branchSuffix = computeBranchSuffix(schedule.cronExpression, run.scheduledAt, schedule.timezone)

        if (schedule.scope === 'node' && schedule.nodeId) {
          serverSideDispatch(schedule.nodeId, schedule.projectId, {
            targetMachineId: machineId,
            branchSuffix,
            scheduleRunId: run.id,
          }).catch((err) => {
            console.error(`[cron] Retry dispatch failed for run ${run.id}:`, err)
            // Reset to missed so it remains eligible for retry
            db.update(scheduleRuns)
              .set({ status: 'missed', startedAt: null })
              .where(eq(scheduleRuns.id, run.id))
              .execute().catch(() => {})
          })
        }
        // Project-scope retry would need the same root-node logic — for now, skip
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
