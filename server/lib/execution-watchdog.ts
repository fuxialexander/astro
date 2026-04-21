/**
 * Execution Watchdog (P7)
 *
 * Server-side safety net that periodically scans for tasks stuck in
 * 'in_progress' or 'dispatched' status with no recent activity.
 * Catches edge cases where SSE dispatch connections die silently
 * (server restart, network issue) and heartbeat cross-reference (P2)
 * is unavailable.
 *
 * Runs every 5 minutes. Resets stuck tasks to 'planned' after 2 hours
 * of inactivity (no streaming events and no pending approvals).
 *
 * Uses Redis leader election when multiple instances are running — only
 * one instance runs the watchdog at a time to avoid duplicate resets.
 */

import { db } from './db/index.js'
import { planNodes, streamingEvents, taskExecutions } from './db/schema.js'
import { and, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm'
import { dispatchEngine } from './dispatch/index.js'
import { executionEventBus } from './execution-event-bus.js'
import { redisPubSub } from './redis-pubsub.js'
import { streamingEventLog } from './streaming-event-log.js'

interface WatchdogConfig {
  enabled: boolean
  /** How often to run the watchdog check (ms) */
  intervalMs: number
  /** How long a stream can be inactive before it is closed with a synthetic error (ms) */
  streamTimeoutMs: number
  /** How long a plan node can remain stale before it is reset for re-execution (ms) */
  resetThresholdMs: number
}

const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: true,
  intervalMs: 60 * 1000, // 60 seconds
  streamTimeoutMs: parseInt(process.env.STREAM_WATCHDOG_TIMEOUT_MS || '', 10) || 60 * 60 * 1000, // 60 minutes (was 15 min — too aggressive for long research tasks)
  resetThresholdMs: 2 * 60 * 60 * 1000, // 2 hours
}

const LEADER_NAME = 'execution-watchdog'
/** Leader lock TTL — 3× the check interval for overlap safety */
const LEADER_TTL_SECONDS = 180 // 3 minutes (3× the 60-second interval)

let watchdogTimer: ReturnType<typeof setInterval> | null = null
let config: WatchdogConfig = DEFAULT_WATCHDOG_CONFIG

async function hasPendingApproval(executionId: string): Promise<boolean> {
  // Check 1: pending approval pauses the watchdog.
  // Check local dispatch engine first (fast-path), then Redis (cross-instance).
  if (dispatchEngine.hasPendingApprovalForExecution(executionId)) {
    console.log(`[watchdog] Task ${executionId} has pending approval (local) — skipping`)
    return true
  }
  try {
    if (await redisPubSub.hasPendingApproval(executionId)) {
      console.log(`[watchdog] Task ${executionId} has pending approval (cross-instance) — skipping`)
      return true
    }
  } catch {
    // Redis check failed — err on the side of caution, treat as pending
    return true
  }
  return false
}

async function hasRecentEvents(executionId: string, cutoffTime: Date): Promise<boolean> {
  try {
    const recentEvents = await db.select({ seq: streamingEvents.seq })
      .from(streamingEvents)
      .where(
        and(
          eq(streamingEvents.executionId, executionId),
          gt(streamingEvents.createdAt, cutoffTime),
          isNull(streamingEvents.deletedAt),
        )
      )
      .limit(1)

    if (recentEvents.length > 0) {
      console.log(`[watchdog] Task ${executionId} has recent streaming events — skipping`)
      return true
    }
  } catch (err) {
    console.warn(`[watchdog] Failed to check streaming events for ${executionId}:`, (err as Error).message)
    // If we can't check events, err on the side of caution — assume activity.
    return true
  }
  return false
}

async function hasTerminalEvent(executionId: string): Promise<boolean> {
  try {
    const rows = await db.select({ seq: streamingEvents.seq })
      .from(streamingEvents)
      .where(
        and(
          eq(streamingEvents.executionId, executionId),
          inArray(streamingEvents.eventType, ['result', 'error']),
          isNull(streamingEvents.deletedAt),
        ),
      )
      .limit(1)
    return rows.length > 0
  } catch (err) {
    console.warn(`[watchdog] Failed to check terminal events for ${executionId}:`, (err as Error).message)
    return true
  }
}

/**
 * Check if a task is truly stale by verifying:
 * 1. No pending approval in the dispatch engine
 * 2. No recent streaming events for this executionId
 */
async function isTaskTrulyStale(
  executionId: string | null,
  cutoffTime: Date,
): Promise<boolean> {
  if (!executionId) {
    // No executionId means it was never actually dispatched — consider stale
    return true
  }

  if (await hasPendingApproval(executionId)) return false
  if (await hasRecentEvents(executionId, cutoffTime)) return false
  return true
}

async function publishSyntheticError(
  executionId: string,
  error: string,
  recoverable: boolean,
): Promise<number> {
  const seq = await streamingEventLog.appendTerminalIfAbsent(executionId, 'error', {
    error,
    synthetic: true,
    recoverable,
  })
  executionEventBus.emit('task:error', { taskId: executionId, error, synthetic: true, recoverable, seq })
  redisPubSub.publishStreamingEvent({
    eventType: 'error',
    taskId: executionId,
    data: { error, synthetic: true, recoverable },
    dbSeq: seq,
  }).catch((err) => {
    console.error(`[watchdog] Failed to publish synthetic error for ${executionId}:`, err)
  })
  return seq
}

async function closeTimedOutStreams(cutoffTime: Date): Promise<number> {
  const rows = await db.execute(sql`
    SELECT execution_id AS "executionId"
    FROM streaming_events
    WHERE deleted_at IS NULL
    GROUP BY execution_id
    HAVING MAX(created_at) < ${cutoffTime.toISOString()}
      AND BOOL_OR(event_type IN ('result', 'error')) = FALSE
  `)

  let closed = 0
  const timeoutMinutes = Math.round(config.streamTimeoutMs / 60_000)

  // db.execute() returns rows directly with postgres-js, but { rows } with node-postgres/PGlite
  const rowArray = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{ executionId: string }>
  for (const row of rowArray) {
    const executionId = row.executionId
    if (!executionId) continue
    if (await hasPendingApproval(executionId)) continue

    const error =
      `Stream timed out — no events received for ${timeoutMinutes} minutes`

    await publishSyntheticError(executionId, error, true)

    await db.update(taskExecutions)
      .set({ status: 'failure', error, completedAt: new Date() })
      .where(eq(taskExecutions.executionId, executionId))
      .execute()
      .catch((err) => {
        console.error(`[watchdog] Failed to update taskExecution on timeout for ${executionId}:`, err)
      })

    console.warn(`[watchdog] Closed stale stream ${executionId} after ${timeoutMinutes} minutes of inactivity`)
    closed++
  }

  return closed
}

/**
 * Run one watchdog check cycle.
 */
async function runWatchdogCheck(): Promise<void> {
  const startTime = Date.now()
  console.log('[watchdog] Running execution watchdog check...')

  try {
    const streamCutoffTime = new Date(Date.now() - config.streamTimeoutMs)
    const resetCutoffTime = new Date(Date.now() - config.resetThresholdMs)

    const closedStreams = await closeTimedOutStreams(streamCutoffTime)

    // Find plan_nodes stuck in in_progress/dispatched with updatedAt older than reset threshold
    const staleNodes = await db.select({
      id: planNodes.id,
      clientId: planNodes.clientId,
      projectId: planNodes.projectId,
      status: planNodes.status,
      executionId: planNodes.executionId,
      updatedAt: planNodes.updatedAt,
    })
      .from(planNodes)
      .where(
        and(
          inArray(planNodes.status, ['in_progress', 'dispatched']),
          lt(planNodes.updatedAt, resetCutoffTime),
          isNull(planNodes.deletedAt),
        )
      )

    if (staleNodes.length === 0) {
      const duration = Date.now() - startTime
      console.log(`[watchdog] Check completed in ${duration}ms — closed ${closedStreams} stale stream(s), no stale tasks found`)
      return
    }

    console.log(`[watchdog] Found ${staleNodes.length} potentially stale task(s)`)

    let resetCount = 0
    for (const node of staleNodes) {
      try {
        const isStale = await isTaskTrulyStale(node.executionId, resetCutoffTime)
        if (isStale) {
          const thresholdHours = Math.round(config.resetThresholdMs / 3_600_000)
          const errorMsg =
            `Execution watchdog: task stuck in '${node.status}' with no activity ` +
            `for over ${thresholdHours} hours. Reset for re-execution.`

          if (node.executionId && !await hasTerminalEvent(node.executionId)) {
            await publishSyntheticError(node.executionId, errorMsg, true)
            await db.update(taskExecutions)
              .set({ status: 'failure', error: errorMsg, completedAt: new Date() })
              .where(eq(taskExecutions.executionId, node.executionId))
              .execute()
              .catch((err) => {
                console.error(`[watchdog] Failed to update taskExecution for ${node.executionId}:`, err)
              })
          }

          // Clear executionId to prevent stale task_result from overwriting the reset
          await db.update(planNodes)
            .set({
              status: 'planned',
              executionId: null,
              executionError: errorMsg,
              updatedAt: new Date(),
            })
            .where(eq(planNodes.id, node.id))

          // DB-authoritative: notify all clients about the watchdog reset
          executionEventBus.emit('node:status_changed', {
            nodeId: node.clientId,
            projectId: node.projectId,
            status: 'planned',
            executionId: node.executionId ?? undefined,
          })

          console.warn(
            `[watchdog] Reset stale task: node=${node.clientId} project=${node.projectId} ` +
            `executionId=${node.executionId} previousStatus=${node.status}`
          )
          resetCount++
        }
      } catch (err) {
        console.error(`[watchdog] Failed to check/reset node ${node.clientId}:`, (err as Error).message)
      }
    }

    const duration = Date.now() - startTime
    console.log(`[watchdog] Check completed in ${duration}ms — closed ${closedStreams} stale stream(s), reset ${resetCount} of ${staleNodes.length} stale task(s)`)
  } catch (error) {
    console.error('[watchdog] Watchdog check failed:', error)
  }
}

/**
 * Run watchdog check only if this instance is the leader.
 */
async function runWatchdogCheckIfLeader(): Promise<void> {
  const acquired = await redisPubSub.tryAcquireLeader(LEADER_NAME, LEADER_TTL_SECONDS)
  const renewed = !acquired && await redisPubSub.renewLeadership(LEADER_NAME, LEADER_TTL_SECONDS)

  if (!acquired && !renewed) {
    console.log('[watchdog] Another instance is the watchdog leader — skipping this cycle')
    return
  }

  await runWatchdogCheck()
}

/**
 * Fast reconciliation on server startup.
 *
 * Tasks orphaned by a deploy have a distinctive signature:
 * - `dispatched` with no executionId → dispatch never reached agent
 * - `in_progress` with no recent streaming events → SSE connection died
 *
 * Uses a much shorter threshold (5 min) since these tasks were orphaned
 * by the server restart, not by a long-running execution.
 */
export async function reconcileOnStartup(): Promise<void> {
  // Only one instance should run startup reconciliation — a second instance starting
  // during a rolling deploy could otherwise reset live tasks that are still running
  // on the first instance. Use a short-TTL lock so it auto-releases quickly.
  const isLeader = await redisPubSub.tryAcquireLeader('startup-reconcile', 60)
  if (!isLeader) {
    console.log('[watchdog/startup] Skipping startup reconciliation (another instance is running it)')
    return
  }

  const STARTUP_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
  const cutoffTime = new Date(Date.now() - STARTUP_THRESHOLD_MS)
  const startTime = Date.now()

  console.log('[watchdog/startup] Running fast startup reconciliation...')

  try {
    const stuckNodes = await db.select({
      id: planNodes.id,
      clientId: planNodes.clientId,
      projectId: planNodes.projectId,
      title: planNodes.title,
      status: planNodes.status,
      executionId: planNodes.executionId,
      updatedAt: planNodes.updatedAt,
    })
      .from(planNodes)
      .where(
        and(
          inArray(planNodes.status, ['in_progress', 'dispatched']),
          lt(planNodes.updatedAt, cutoffTime),
          isNull(planNodes.deletedAt),
        )
      )

    if (stuckNodes.length === 0) {
      console.log(`[watchdog/startup] No orphaned tasks found (${Date.now() - startTime}ms)`)
      return
    }

    console.log(`[watchdog/startup] Found ${stuckNodes.length} potentially orphaned task(s)`)

    let resetCount = 0
    for (const node of stuckNodes) {
      try {
        const isStale = await isTaskTrulyStale(node.executionId, cutoffTime)
        if (!isStale) continue

        if (node.executionId && !await hasTerminalEvent(node.executionId)) {
          const error = `Server restart: task was stuck in '${node.status}' with no activity. Reset for re-execution.`
          await publishSyntheticError(node.executionId, error, true)
          await db.update(taskExecutions)
            .set({ status: 'failure', error, completedAt: new Date() })
            .where(eq(taskExecutions.executionId, node.executionId))
            .execute()
            .catch((err) => {
              console.error(`[watchdog/startup] Failed to update taskExecution for ${node.executionId}:`, err)
            })
        }

        await db.update(planNodes)
          .set({
            status: 'planned',
            executionId: null,
            executionError: `Server restart: task was stuck in '${node.status}' with no activity. Reset for re-execution.`,
            updatedAt: new Date(),
          })
          .where(eq(planNodes.id, node.id))

        executionEventBus.emit('node:status_changed', {
          nodeId: node.clientId,
          projectId: node.projectId,
          status: 'planned',
          executionId: node.executionId ?? undefined,
        })

        console.warn(
          `[watchdog/startup] Reset orphaned task: "${node.title}" (${node.clientId}) from ${node.status}`
        )
        resetCount++
      } catch (err) {
        console.error(`[watchdog/startup] Failed to reset ${node.clientId}:`, (err as Error).message)
      }
    }

    console.log(`[watchdog/startup] Reconciliation complete in ${Date.now() - startTime}ms — reset ${resetCount} task(s)`)
  } catch (err) {
    console.error('[watchdog/startup] Startup reconciliation failed:', err)
  }
}

/**
 * Start the execution watchdog.
 */
export function startExecutionWatchdog(customConfig?: Partial<WatchdogConfig>): void {
  config = { ...DEFAULT_WATCHDOG_CONFIG, ...customConfig }

  if (!config.enabled) {
    console.log('[watchdog] Execution watchdog disabled')
    return
  }

  // Stop existing watchdog if running
  stopExecutionWatchdog()

  const intervalMin = Math.round(config.intervalMs / 60_000)
  const streamTimeoutMin = Math.round(config.streamTimeoutMs / 60_000)
  const resetThresholdHours = Math.round(config.resetThresholdMs / 3_600_000)
  console.log(
    `[watchdog] Starting execution watchdog (interval: ${intervalMin}min, stream timeout: ${streamTimeoutMin}min, reset threshold: ${resetThresholdHours}h)`,
  )

  // Run immediately on start to catch any tasks stuck from a previous crash
  runWatchdogCheckIfLeader().catch((err) => {
    console.error('[watchdog] Initial watchdog check failed:', err)
  })

  // Schedule periodic checks (with leader election each cycle)
  watchdogTimer = setInterval(() => {
    runWatchdogCheckIfLeader().catch((err) => {
      console.error('[watchdog] Scheduled watchdog check failed:', err)
    })
  }, config.intervalMs)
}

/**
 * Stop the execution watchdog.
 */
export function stopExecutionWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
    redisPubSub.releaseLeadership(LEADER_NAME).catch(() => {})
    console.log('[watchdog] Execution watchdog stopped')
  }
}

/**
 * Get current watchdog config (useful for testing/debugging).
 */
export function getWatchdogConfig(): WatchdogConfig {
  return { ...config }
}

/**
 * Manual watchdog trigger (useful for testing).
 */
export async function triggerWatchdogCheck(): Promise<void> {
  await runWatchdogCheck()
}
