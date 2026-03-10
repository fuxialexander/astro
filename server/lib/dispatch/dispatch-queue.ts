/**
 * Dispatch Queue
 *
 * Manages the queue of tasks waiting for dispatch.
 * Handles priority ordering, concurrency limits, and retry logic.
 *
 * Backed by Postgres via Drizzle ORM (dispatchQueueEntries table).
 */

import { EventEmitter } from 'events'
import { db } from '../db/index.js'
import { dispatchQueueEntries } from '../db/schema.js'
import { eq, and, notInArray, inArray, sql, asc, lt, count } from 'drizzle-orm'
import type {
  DispatchQueueEntry,
  DispatchStatus,
  DispatchPriority,
  DispatchEngineConfig,
} from './types.js'
import type { ProviderType } from '../../types/relay.js'

/**
 * Terminal statuses — entries with these statuses are considered finished.
 */
const TERMINAL_STATUSES: DispatchStatus[] = ['completed', 'failed', 'cancelled']

/**
 * Priority SQL CASE expression for ordering (lower = higher priority).
 */
const priorityOrderExpr = sql<number>`CASE
  WHEN ${dispatchQueueEntries.priority} = 'critical' THEN 0
  WHEN ${dispatchQueueEntries.priority} = 'high'     THEN 1
  WHEN ${dispatchQueueEntries.priority} = 'normal'   THEN 2
  WHEN ${dispatchQueueEntries.priority} = 'low'      THEN 3
  ELSE 4
END`

/**
 * Convert a raw DB row to the typed DispatchQueueEntry interface.
 */
function rowToEntry(row: typeof dispatchQueueEntries.$inferSelect): DispatchQueueEntry {
  return {
    id: row.id,
    nodeId: row.nodeId,
    projectId: row.projectId,
    status: row.status as DispatchStatus,
    priority: row.priority as DispatchPriority,
    environment: row.environment ?? undefined,
    preferredProvider: (row.preferredProvider ?? undefined) as ProviderType | undefined,
    targetMachineId: row.targetMachineId ?? undefined,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    createdAt: row.createdAt,
    lastDispatchAttempt: row.lastDispatchAttempt ?? undefined,
    lastError: row.lastError ?? undefined,
    executionId: row.executionId ?? undefined,
    sessionId: row.sessionId ?? undefined,
    procedureState: undefined,
  }
}

/**
 * Events emitted by the dispatch queue
 */
export interface DispatchQueueEvents {
  'entry:added': (entry: DispatchQueueEntry) => void
  'entry:updated': (entry: DispatchQueueEntry) => void
  'entry:removed': (entryId: string) => void
  'entry:ready': (entry: DispatchQueueEntry) => void
  'queue:drained': () => void
}

/**
 * Dispatch queue implementation backed by Postgres.
 */
export class DispatchQueue extends EventEmitter {
  /** Entry counter for unique IDs */
  private entryCounter = 0

  constructor(private config: DispatchEngineConfig) {
    super()
  }

  /**
   * Add a task to the dispatch queue.
   * If the node already has a non-terminal entry, returns it instead.
   */
  async enqueue(params: {
    nodeId: string
    projectId: string
    priority?: DispatchPriority
    preferredProvider?: ProviderType
    targetMachineId?: string
    maxRetries?: number
  }): Promise<DispatchQueueEntry> {
    // Check if already in queue with a non-terminal status
    const existing = await this.getByNodeId(params.nodeId)
    if (existing) {
      return existing
    }

    const entryId = `dq-${++this.entryCounter}-${Date.now()}`
    const now = new Date()

    const values = {
      id: entryId,
      nodeId: params.nodeId,
      projectId: params.projectId,
      status: 'ready' as const,
      priority: (params.priority ?? this.config.defaultPriority) as string,
      environment: 'local',
      preferredProvider: params.preferredProvider ?? null,
      targetMachineId: params.targetMachineId ?? null,
      retryCount: 0,
      maxRetries: params.maxRetries ?? this.config.defaultMaxRetries,
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(dispatchQueueEntries).values(values)

    const entry: DispatchQueueEntry = {
      id: entryId,
      nodeId: params.nodeId,
      projectId: params.projectId,
      status: 'ready',
      priority: params.priority ?? this.config.defaultPriority,
      environment: undefined,
      preferredProvider: params.preferredProvider,
      targetMachineId: params.targetMachineId,
      retryCount: 0,
      maxRetries: params.maxRetries ?? this.config.defaultMaxRetries,
      createdAt: now,
    }

    this.emit('entry:added', entry)
    return entry
  }

  /**
   * Get the next task ready for dispatch (respecting concurrency limits).
   * Atomically marks it as 'queued' and returns it.
   */
  async dequeue(): Promise<DispatchQueueEntry | null> {
    // Check total concurrency
    const totalActive = await this.getActiveConcurrencyTotal()
    if (totalActive >= this.config.maxConcurrentTotal) {
      return null
    }

    // Get all ready entries sorted by priority then creation time
    const readyRows = await db
      .select()
      .from(dispatchQueueEntries)
      .where(eq(dispatchQueueEntries.status, 'ready'))
      .orderBy(priorityOrderExpr, asc(dispatchQueueEntries.createdAt))

    // Find first entry whose project concurrency is not exceeded
    for (const row of readyRows) {
      const projectActive = await this.getActiveConcurrency(row.projectId)
      if (projectActive < this.config.maxConcurrentPerProject) {
        // Mark as queued
        await db
          .update(dispatchQueueEntries)
          .set({ status: 'queued', updatedAt: new Date() })
          .where(eq(dispatchQueueEntries.id, row.id))

        const entry = rowToEntry({ ...row, status: 'queued' })
        this.emit('entry:updated', entry)
        return entry
      }
    }

    return null
  }

  /**
   * Mark an entry as dispatched.
   */
  async markDispatched(entryId: string, executionId: string): Promise<boolean> {
    const now = new Date()
    const result = await db
      .update(dispatchQueueEntries)
      .set({
        status: 'dispatched',
        executionId,
        lastDispatchAttempt: now,
        updatedAt: now,
      })
      .where(eq(dispatchQueueEntries.id, entryId))
      .returning()

    if (result.length === 0) return false

    this.emit('entry:updated', rowToEntry(result[0]))
    return true
  }

  /**
   * Mark an entry as in progress.
   */
  async markInProgress(entryId: string, sessionId?: string): Promise<boolean> {
    const updates: Record<string, unknown> = {
      status: 'in_progress',
      updatedAt: new Date(),
    }
    if (sessionId) {
      updates.sessionId = sessionId
    }

    const result = await db
      .update(dispatchQueueEntries)
      .set(updates)
      .where(eq(dispatchQueueEntries.id, entryId))
      .returning()

    if (result.length === 0) return false

    this.emit('entry:updated', rowToEntry(result[0]))
    return true
  }

  /**
   * Mark an entry as completed.
   */
  async markCompleted(entryId: string): Promise<boolean> {
    const result = await db
      .update(dispatchQueueEntries)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(dispatchQueueEntries.id, entryId))
      .returning()

    if (result.length === 0) return false

    this.emit('entry:updated', rowToEntry(result[0]))
    await this.checkDrained()
    return true
  }

  /**
   * Mark an entry as failed. If retries remain, re-queues as 'ready'.
   */
  async markFailed(
    entryId: string,
    error: string
  ): Promise<{ retry: boolean; entry: DispatchQueueEntry } | null> {
    // Fetch current entry
    const rows = await db
      .select()
      .from(dispatchQueueEntries)
      .where(eq(dispatchQueueEntries.id, entryId))

    if (rows.length === 0) return null

    const row = rows[0]
    const newRetryCount = row.retryCount + 1
    const now = new Date()

    if (newRetryCount <= row.maxRetries) {
      // Re-queue for retry
      const updated = await db
        .update(dispatchQueueEntries)
        .set({
          status: 'ready',
          retryCount: newRetryCount,
          lastError: error,
          updatedAt: now,
        })
        .where(eq(dispatchQueueEntries.id, entryId))
        .returning()

      const entry = rowToEntry(updated[0])
      this.emit('entry:updated', entry)
      return { retry: true, entry }
    }

    // Max retries exceeded
    const updated = await db
      .update(dispatchQueueEntries)
      .set({
        status: 'failed',
        retryCount: newRetryCount,
        lastError: error,
        updatedAt: now,
      })
      .where(eq(dispatchQueueEntries.id, entryId))
      .returning()

    const entry = rowToEntry(updated[0])
    this.emit('entry:updated', entry)
    await this.checkDrained()
    return { retry: false, entry }
  }

  /**
   * Mark an entry as cancelled.
   */
  async markCancelled(entryId: string): Promise<boolean> {
    const result = await db
      .update(dispatchQueueEntries)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(dispatchQueueEntries.id, entryId))
      .returning()

    if (result.length === 0) return false

    this.emit('entry:updated', rowToEntry(result[0]))
    await this.checkDrained()
    return true
  }

  /**
   * Cancel entry by node ID (only non-terminal entries).
   */
  async cancelByNodeId(nodeId: string): Promise<boolean> {
    const result = await db
      .update(dispatchQueueEntries)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(dispatchQueueEntries.nodeId, nodeId),
          notInArray(dispatchQueueEntries.status, TERMINAL_STATUSES)
        )
      )
      .returning()

    if (result.length === 0) return false

    for (const row of result) {
      this.emit('entry:updated', rowToEntry(row))
    }
    await this.checkDrained()
    return true
  }

  /**
   * Cancel all non-terminal entries for a project.
   */
  async cancelByProject(projectId: string): Promise<number> {
    const result = await db
      .update(dispatchQueueEntries)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(dispatchQueueEntries.projectId, projectId),
          notInArray(dispatchQueueEntries.status, TERMINAL_STATUSES)
        )
      )
      .returning()

    for (const row of result) {
      this.emit('entry:updated', rowToEntry(row))
    }
    return result.length
  }

  /**
   * Get entry by ID.
   */
  async get(entryId: string): Promise<DispatchQueueEntry | undefined> {
    const rows = await db
      .select()
      .from(dispatchQueueEntries)
      .where(eq(dispatchQueueEntries.id, entryId))

    return rows.length > 0 ? rowToEntry(rows[0]) : undefined
  }

  /**
   * Get the active (non-terminal) entry for a node ID.
   */
  async getByNodeId(nodeId: string): Promise<DispatchQueueEntry | undefined> {
    const rows = await db
      .select()
      .from(dispatchQueueEntries)
      .where(
        and(
          eq(dispatchQueueEntries.nodeId, nodeId),
          notInArray(dispatchQueueEntries.status, TERMINAL_STATUSES)
        )
      )

    return rows.length > 0 ? rowToEntry(rows[0]) : undefined
  }

  /**
   * Get all entries for a project.
   */
  async getByProject(projectId: string): Promise<DispatchQueueEntry[]> {
    const rows = await db
      .select()
      .from(dispatchQueueEntries)
      .where(eq(dispatchQueueEntries.projectId, projectId))

    return rows.map(rowToEntry)
  }

  /**
   * Get all active entries (dispatched or in_progress).
   */
  async getActive(): Promise<DispatchQueueEntry[]> {
    const rows = await db
      .select()
      .from(dispatchQueueEntries)
      .where(inArray(dispatchQueueEntries.status, ['dispatched', 'in_progress']))

    return rows.map(rowToEntry)
  }

  /**
   * Get all ready entries.
   */
  async getReady(): Promise<DispatchQueueEntry[]> {
    const rows = await db
      .select()
      .from(dispatchQueueEntries)
      .where(eq(dispatchQueueEntries.status, 'ready'))

    return rows.map(rowToEntry)
  }

  /**
   * Get all non-terminal entries.
   */
  async getAll(): Promise<DispatchQueueEntry[]> {
    const rows = await db
      .select()
      .from(dispatchQueueEntries)
      .where(notInArray(dispatchQueueEntries.status, TERMINAL_STATUSES))

    return rows.map(rowToEntry)
  }

  /**
   * Count active (dispatched + in_progress) entries for a specific project.
   */
  async getActiveConcurrency(projectId: string): Promise<number> {
    const result = await db
      .select({ value: count() })
      .from(dispatchQueueEntries)
      .where(
        and(
          eq(dispatchQueueEntries.projectId, projectId),
          inArray(dispatchQueueEntries.status, ['dispatched', 'in_progress'])
        )
      )

    return result[0]?.value ?? 0
  }

  /**
   * Count total active (dispatched + in_progress) entries across all projects.
   */
  private async getActiveConcurrencyTotal(): Promise<number> {
    const result = await db
      .select({ value: count() })
      .from(dispatchQueueEntries)
      .where(inArray(dispatchQueueEntries.status, ['dispatched', 'in_progress']))

    return result[0]?.value ?? 0
  }

  /**
   * Get queue statistics.
   */
  async getStats(): Promise<{
    total: number
    byStatus: Record<DispatchStatus, number>
    activeTotal: number
    activePerProject: Record<string, number>
  }> {
    // Count by status
    const statusCounts = await db
      .select({
        status: dispatchQueueEntries.status,
        value: count(),
      })
      .from(dispatchQueueEntries)
      .groupBy(dispatchQueueEntries.status)

    const byStatus: Record<DispatchStatus, number> = {
      pending: 0,
      ready: 0,
      queued: 0,
      dispatched: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    }

    let total = 0
    for (const row of statusCounts) {
      const status = row.status as DispatchStatus
      byStatus[status] = row.value
      total += row.value
    }

    // Active per project
    const activeRows = await db
      .select({
        projectId: dispatchQueueEntries.projectId,
        value: count(),
      })
      .from(dispatchQueueEntries)
      .where(inArray(dispatchQueueEntries.status, ['dispatched', 'in_progress']))
      .groupBy(dispatchQueueEntries.projectId)

    const activePerProject: Record<string, number> = {}
    let activeTotal = 0
    for (const row of activeRows) {
      activePerProject[row.projectId] = row.value
      activeTotal += row.value
    }

    return { total, byStatus, activeTotal, activePerProject }
  }

  /**
   * Calculate retry delay for an entry (exponential backoff with jitter).
   */
  calculateRetryDelay(entry: DispatchQueueEntry): number {
    const baseDelay = this.config.retryDelayBase
    const maxDelay = this.config.retryDelayMax
    const exponentialDelay = baseDelay * Math.pow(2, entry.retryCount - 1)
    const jitter = Math.random() * 0.2 * exponentialDelay
    return Math.min(exponentialDelay + jitter, maxDelay)
  }

  /**
   * Remove completed/failed/cancelled entries older than specified age.
   */
  async cleanup(maxAgeMs: number = 3600000): Promise<number> {
    const threshold = new Date(Date.now() - maxAgeMs)

    const deleted = await db
      .delete(dispatchQueueEntries)
      .where(
        and(
          inArray(dispatchQueueEntries.status, TERMINAL_STATUSES),
          lt(dispatchQueueEntries.createdAt, threshold)
        )
      )
      .returning()

    for (const row of deleted) {
      this.emit('entry:removed', row.id)
    }

    return deleted.length
  }

  /**
   * Clear all entries (for testing).
   */
  async clear(): Promise<void> {
    await db.delete(dispatchQueueEntries)
  }

  /**
   * Update the status of an entry.
   */
  async updateStatus(entryId: string, status: DispatchStatus): Promise<boolean> {
    const result = await db
      .update(dispatchQueueEntries)
      .set({ status, updatedAt: new Date() })
      .where(eq(dispatchQueueEntries.id, entryId))
      .returning()

    if (result.length === 0) return false

    this.emit('entry:updated', rowToEntry(result[0]))
    return true
  }

  /**
   * Check if queue is drained (no active or ready entries).
   */
  private async checkDrained(): Promise<void> {
    const activeCount = await this.getActiveConcurrencyTotal()
    if (activeCount > 0) return

    const readyRows = await db
      .select({ value: count() })
      .from(dispatchQueueEntries)
      .where(eq(dispatchQueueEntries.status, 'ready'))

    const readyCount = readyRows[0]?.value ?? 0
    if (readyCount === 0) {
      this.emit('queue:drained')
    }
  }
}

/**
 * Create a dispatch queue with default configuration.
 */
export function createDispatchQueue(config?: Partial<DispatchEngineConfig>): DispatchQueue {
  const fullConfig: DispatchEngineConfig = {
    autoDispatch: config?.autoDispatch ?? true,
    maxConcurrentPerProject: config?.maxConcurrentPerProject ?? 4,
    maxConcurrentTotal: config?.maxConcurrentTotal ?? 20,
    defaultPriority: config?.defaultPriority ?? 'normal',
    defaultMaxRetries: config?.defaultMaxRetries ?? 2,
    retryDelayBase: config?.retryDelayBase ?? 5000,
    retryDelayMax: config?.retryDelayMax ?? 60000,
    dryRunMode: config?.dryRunMode ?? false,
    maxDependencyOutputSize: config?.maxDependencyOutputSize ?? 20000,
    pollIntervalMs: config?.pollIntervalMs ?? 2000,
    machineSelectionPolicy: config?.machineSelectionPolicy ?? 'priority',
  }

  return new DispatchQueue(fullConfig)
}
