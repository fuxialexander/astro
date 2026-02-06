/**
 * Dispatch Queue
 *
 * Manages the queue of tasks waiting for dispatch.
 * Handles priority ordering, concurrency limits, and retry logic.
 */

import { EventEmitter } from 'events'
import type {
  DispatchQueueEntry,
  DispatchStatus,
  DispatchPriority,
  DispatchEngineConfig,
} from './types.js'
import type { ExecutionEnvironment } from '../providers/types.js'
import type { ProviderType } from '../../types/relay.js'

/**
 * Priority order (lower number = higher priority)
 */
const PRIORITY_ORDER: Record<DispatchPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
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
 * Dispatch queue implementation
 */
export class DispatchQueue extends EventEmitter {
  /** Queue entries by ID */
  private entries = new Map<string, DispatchQueueEntry>()
  /** Node ID to entry ID mapping */
  private nodeToEntry = new Map<string, string>()
  /** Active execution count per project */
  private activePerProject = new Map<string, number>()
  /** Total active executions */
  private activeTotal = 0
  /** Entry counter for unique IDs */
  private entryCounter = 0

  constructor(private config: DispatchEngineConfig) {
    super()
  }

  /**
   * Add a task to the dispatch queue
   */
  enqueue(params: {
    nodeId: string
    projectId: string
    priority?: DispatchPriority
    environment?: ExecutionEnvironment
    preferredProvider?: ProviderType
    targetMachineId?: string
    maxRetries?: number
  }): DispatchQueueEntry {
    // Check if already in queue
    const existingId = this.nodeToEntry.get(params.nodeId)
    if (existingId) {
      const existing = this.entries.get(existingId)
      if (existing && !this.isTerminalStatus(existing.status)) {
        return existing
      }
    }

    const entryId = `dq-${++this.entryCounter}-${Date.now()}`
    const entry: DispatchQueueEntry = {
      id: entryId,
      nodeId: params.nodeId,
      projectId: params.projectId,
      status: 'ready',
      priority: params.priority ?? this.config.defaultPriority,
      environment: params.environment ?? 'local',
      preferredProvider: params.preferredProvider,
      targetMachineId: params.targetMachineId,
      retryCount: 0,
      maxRetries: params.maxRetries ?? this.config.defaultMaxRetries,
      createdAt: new Date(),
    }

    this.entries.set(entryId, entry)
    this.nodeToEntry.set(params.nodeId, entryId)
    this.emit('entry:added', entry)

    return entry
  }

  /**
   * Get the next task ready for dispatch (respecting concurrency limits)
   */
  dequeue(): DispatchQueueEntry | null {
    // Check total concurrency
    if (this.activeTotal >= this.config.maxConcurrentTotal) {
      return null
    }

    // Get all ready entries sorted by priority
    const readyEntries = Array.from(this.entries.values())
      .filter((e) => e.status === 'ready')
      .sort((a, b) => {
        // Sort by priority first
        const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        if (priorityDiff !== 0) return priorityDiff
        // Then by creation time (FIFO within same priority)
        return a.createdAt.getTime() - b.createdAt.getTime()
      })

    // Find first entry that can be dispatched (project concurrency not exceeded)
    for (const entry of readyEntries) {
      const projectActive = this.activePerProject.get(entry.projectId) ?? 0
      if (projectActive < this.config.maxConcurrentPerProject) {
        // Mark as queued
        entry.status = 'queued'
        this.emit('entry:updated', entry)
        return entry
      }
    }

    return null
  }

  /**
   * Mark an entry as dispatched
   */
  markDispatched(entryId: string, executionId: string): boolean {
    const entry = this.entries.get(entryId)
    if (!entry) return false

    entry.status = 'dispatched'
    entry.executionId = executionId
    entry.lastDispatchAttempt = new Date()

    // Update concurrency tracking
    const projectActive = this.activePerProject.get(entry.projectId) ?? 0
    this.activePerProject.set(entry.projectId, projectActive + 1)
    this.activeTotal++

    this.emit('entry:updated', entry)
    return true
  }

  /**
   * Mark an entry as in progress
   */
  markInProgress(entryId: string, sessionId?: string): boolean {
    const entry = this.entries.get(entryId)
    if (!entry) return false

    entry.status = 'in_progress'
    if (sessionId) {
      entry.sessionId = sessionId
    }

    this.emit('entry:updated', entry)
    return true
  }

  /**
   * Mark an entry as completed
   */
  markCompleted(entryId: string): boolean {
    const entry = this.entries.get(entryId)
    if (!entry) return false

    entry.status = 'completed'
    this.decrementActive(entry.projectId)
    this.emit('entry:updated', entry)
    this.checkDrained()

    return true
  }

  /**
   * Mark an entry as failed
   */
  markFailed(entryId: string, error: string): { retry: boolean; entry: DispatchQueueEntry } | null {
    const entry = this.entries.get(entryId)
    if (!entry) return null

    entry.lastError = error
    entry.retryCount++
    this.decrementActive(entry.projectId)

    // Check if should retry
    if (entry.retryCount <= entry.maxRetries) {
      // Re-queue with delay
      entry.status = 'ready'
      this.emit('entry:updated', entry)
      return { retry: true, entry }
    }

    // Max retries exceeded
    entry.status = 'failed'
    this.emit('entry:updated', entry)
    this.checkDrained()

    return { retry: false, entry }
  }

  /**
   * Mark an entry as cancelled
   */
  markCancelled(entryId: string): boolean {
    const entry = this.entries.get(entryId)
    if (!entry) return false

    const wasActive = entry.status === 'dispatched' || entry.status === 'in_progress'
    entry.status = 'cancelled'

    if (wasActive) {
      this.decrementActive(entry.projectId)
    }

    this.emit('entry:updated', entry)
    this.checkDrained()

    return true
  }

  /**
   * Cancel entry by node ID
   */
  cancelByNodeId(nodeId: string): boolean {
    const entryId = this.nodeToEntry.get(nodeId)
    if (!entryId) return false
    return this.markCancelled(entryId)
  }

  /**
   * Get entry by ID
   */
  get(entryId: string): DispatchQueueEntry | undefined {
    return this.entries.get(entryId)
  }

  /**
   * Get entry by node ID
   */
  getByNodeId(nodeId: string): DispatchQueueEntry | undefined {
    const entryId = this.nodeToEntry.get(nodeId)
    if (!entryId) return undefined
    return this.entries.get(entryId)
  }

  /**
   * Get all entries for a project
   */
  getByProject(projectId: string): DispatchQueueEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.projectId === projectId)
  }

  /**
   * Get all active entries (dispatched or in_progress)
   */
  getActive(): DispatchQueueEntry[] {
    return Array.from(this.entries.values()).filter(
      (e) => e.status === 'dispatched' || e.status === 'in_progress'
    )
  }

  /**
   * Get all ready entries
   */
  getReady(): DispatchQueueEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.status === 'ready')
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number
    byStatus: Record<DispatchStatus, number>
    activeTotal: number
    activePerProject: Record<string, number>
  } {
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

    for (const entry of this.entries.values()) {
      byStatus[entry.status]++
    }

    return {
      total: this.entries.size,
      byStatus,
      activeTotal: this.activeTotal,
      activePerProject: Object.fromEntries(this.activePerProject),
    }
  }

  /**
   * Calculate retry delay for an entry
   */
  calculateRetryDelay(entry: DispatchQueueEntry): number {
    // Exponential backoff with jitter
    const baseDelay = this.config.retryDelayBase
    const maxDelay = this.config.retryDelayMax
    const exponentialDelay = baseDelay * Math.pow(2, entry.retryCount - 1)
    const jitter = Math.random() * 0.2 * exponentialDelay
    return Math.min(exponentialDelay + jitter, maxDelay)
  }

  /**
   * Remove completed/failed/cancelled entries older than specified age
   */
  cleanup(maxAgeMs: number = 3600000): number {
    const cutoff = Date.now() - maxAgeMs
    let removed = 0

    for (const [id, entry] of this.entries) {
      if (this.isTerminalStatus(entry.status) && entry.createdAt.getTime() < cutoff) {
        this.entries.delete(id)
        this.nodeToEntry.delete(entry.nodeId)
        this.emit('entry:removed', id)
        removed++
      }
    }

    return removed
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.entries.clear()
    this.nodeToEntry.clear()
    this.activePerProject.clear()
    this.activeTotal = 0
  }

  /**
   * Check if status is terminal
   */
  private isTerminalStatus(status: DispatchStatus): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled'
  }

  /**
   * Decrement active count for a project
   */
  private decrementActive(projectId: string): void {
    const current = this.activePerProject.get(projectId) ?? 0
    if (current > 0) {
      this.activePerProject.set(projectId, current - 1)
    }
    if (this.activeTotal > 0) {
      this.activeTotal--
    }
  }

  /**
   * Check if queue is drained (no active or ready entries)
   */
  private checkDrained(): void {
    const hasActive = this.activeTotal > 0
    const hasReady = Array.from(this.entries.values()).some((e) => e.status === 'ready')
    if (!hasActive && !hasReady) {
      this.emit('queue:drained')
    }
  }
}

/**
 * Create a dispatch queue with default configuration
 */
export function createDispatchQueue(config?: Partial<DispatchEngineConfig>): DispatchQueue {
  const fullConfig: DispatchEngineConfig = {
    autoDispatch: config?.autoDispatch ?? true,
    maxConcurrentPerProject: config?.maxConcurrentPerProject ?? 5,
    maxConcurrentTotal: config?.maxConcurrentTotal ?? 20,
    defaultPriority: config?.defaultPriority ?? 'normal',
    defaultMaxRetries: config?.defaultMaxRetries ?? 2,
    retryDelayBase: config?.retryDelayBase ?? 5000,
    retryDelayMax: config?.retryDelayMax ?? 60000,
    dryRunMode: config?.dryRunMode ?? false,
    maxDependencyOutputSize: config?.maxDependencyOutputSize ?? 10000,
    pollIntervalMs: config?.pollIntervalMs ?? 2000,
  }

  return new DispatchQueue(fullConfig)
}
