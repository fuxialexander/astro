/**
 * Dispatch Engine
 *
 * The core orchestrator that bridges the plan graph and agent execution.
 * Watches for ready tasks, manages dispatch queue, routes results,
 * and handles branch operations.
 */

import { EventEmitter } from 'events'
import type { PlanNode, PlanEdge, Project } from '../../../src/types/index.js'
import type { TaskResult, StreamEvent } from '../providers/types.js'
import { executionEventBus } from '../execution-event-bus.js'
import {
  DEFAULT_DISPATCH_CONFIG,
  type DispatchEngineConfig,
  type DispatchResult,
  type DispatchQueueEntry,
  type BranchPruneRequest,
  type BranchPruneResult,
  type TaskReadyEvent,
  type TaskDispatchedEvent,
  type TaskCompletedEvent,
  type TaskFailedEvent,
  type BranchPrunedEvent,
  type AssembledContext,
} from './types.js'
import { DispatchQueue, createDispatchQueue } from './dispatch-queue.js'
import { ContextAssembler, createContextAssembler } from './context-assembler.js'
import { ResultRouter, createResultRouter } from './result-router.js'
import { BranchManager, createBranchManager } from './branch-manager.js'

/**
 * Callback to update plan node status
 */
export type NodeUpdateCallback = (
  nodeId: string,
  updates: Partial<PlanNode>
) => Promise<void>

/**
 * Callback to get current plan graph state
 */
export type PlanGraphProvider = (projectId: string) => Promise<{
  nodes: PlanNode[]
  edges: PlanEdge[]
  project?: Project
}>

/**
 * Callback to execute a task via provider
 */
export type ExecutionCallback = (
  context: AssembledContext,
  queueEntry: DispatchQueueEntry
) => AsyncGenerator<StreamEvent, TaskResult, undefined>

/**
 * Events emitted by the dispatch engine
 */
export interface DispatchEngineEvents {
  'task:ready': (event: TaskReadyEvent) => void
  'task:queued': (entry: DispatchQueueEntry) => void
  'task:dispatched': (event: TaskDispatchedEvent) => void
  'task:completed': (event: TaskCompletedEvent) => void
  'task:failed': (event: TaskFailedEvent) => void
  'task:cancelled': (nodeId: string, projectId: string) => void
  'branch:pruned': (event: BranchPrunedEvent) => void
  'engine:error': (error: Error) => void
}

/**
 * Dispatch engine implementation
 */
export class DispatchEngine extends EventEmitter {
  private config: DispatchEngineConfig
  private queue: DispatchQueue
  private contextAssembler: ContextAssembler
  private resultRouter: ResultRouter
  private branchManager: BranchManager

  /** Active executions by node ID */
  private activeExecutions = new Map<string, {
    executionId: string
    abortController: AbortController
    projectId: string
  }>()

  /** Plan graph poll interval */
  private pollInterval: ReturnType<typeof setInterval> | null = null

  /** Whether the engine is running */
  private running = false

  /** Callbacks */
  private nodeUpdateCallback?: NodeUpdateCallback
  private planGraphProvider?: PlanGraphProvider
  private executionCallback?: ExecutionCallback

  constructor(config: Partial<DispatchEngineConfig> = {}) {
    super()
    this.config = { ...DEFAULT_DISPATCH_CONFIG, ...config }
    this.queue = createDispatchQueue(this.config)
    this.contextAssembler = createContextAssembler(this.config)
    this.resultRouter = createResultRouter()
    this.branchManager = createBranchManager()

    // Forward queue events
    this.queue.on('entry:added', (entry) => this.emit('task:queued', entry))
  }

  /**
   * Configure callbacks for integration
   */
  configure(callbacks: {
    nodeUpdate: NodeUpdateCallback
    planGraphProvider: PlanGraphProvider
    executionCallback: ExecutionCallback
  }): void {
    this.nodeUpdateCallback = callbacks.nodeUpdate
    this.planGraphProvider = callbacks.planGraphProvider
    this.executionCallback = callbacks.executionCallback
  }

  /**
   * Start the dispatch engine
   */
  start(): void {
    if (this.running) return

    this.running = true
    console.log('[dispatch] Engine started')

    // Start polling for ready tasks if auto-dispatch enabled
    if (this.config.autoDispatch) {
      this.startPolling()
    }
  }

  /**
   * Stop the dispatch engine
   */
  stop(): void {
    if (!this.running) return

    this.running = false
    this.stopPolling()

    // Cancel all active executions
    for (const [, execution] of this.activeExecutions) {
      execution.abortController.abort()
    }
    this.activeExecutions.clear()

    console.log('[dispatch] Engine stopped')
  }

  /**
   * Manually dispatch a task
   */
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    if (!this.planGraphProvider) {
      return { success: false, error: 'Plan graph provider not configured' }
    }

    // Get plan graph state
    const { nodes, edges, project } = await this.planGraphProvider(request.projectId)
    const node = nodes.find((n) => n.id === request.nodeId)

    if (!node) {
      return { success: false, error: `Node ${request.nodeId} not found` }
    }

    // Check dependencies (unless force)
    if (!request.force) {
      const resolution = this.contextAssembler.resolveDependencies(node, nodes)
      if (!resolution.allMet) {
        const issues: string[] = []
        if (resolution.pending.length > 0) {
          issues.push(`Pending dependencies: ${resolution.pending.join(', ')}`)
        }
        if (resolution.failed.length > 0) {
          issues.push(`Failed dependencies: ${resolution.failed.join(', ')}`)
        }
        if (resolution.pruned.length > 0) {
          issues.push(`Pruned dependencies: ${resolution.pruned.join(', ')}`)
        }

        if (request.dryRun) {
          return { success: false, validationIssues: issues }
        }
        return { success: false, error: issues.join('; ') }
      }
    }

    // Dry run - just validate
    if (request.dryRun) {
      return { success: true, validationIssues: [] }
    }

    // Add to queue
    const queueEntry = this.queue.enqueue({
      nodeId: request.nodeId,
      projectId: request.projectId,
      priority: request.priority,
      environment: request.environment ?? node.environment ?? 'local',
      preferredProvider: request.preferredProvider,
      targetMachineId: request.targetMachineId,
    })

    // Start execution immediately
    this.executeTask(queueEntry, nodes, edges, project)

    return { success: true, queueEntry }
  }

  /**
   * Cancel a task
   */
  async cancel(nodeId: string): Promise<boolean> {
    // Cancel in queue
    this.queue.cancelByNodeId(nodeId)

    // Abort active execution
    const execution = this.activeExecutions.get(nodeId)
    if (execution) {
      execution.abortController.abort()
      this.activeExecutions.delete(nodeId)

      // Update node status
      if (this.nodeUpdateCallback) {
        await this.nodeUpdateCallback(nodeId, { status: 'planned' })
      }

      this.emit('task:cancelled', nodeId, execution.projectId)
      return true
    }

    return false
  }

  /**
   * Prune a branch
   */
  async pruneBranch(request: BranchPruneRequest): Promise<BranchPruneResult> {
    if (!this.planGraphProvider || !this.nodeUpdateCallback) {
      return {
        success: false,
        prunedNodes: [],
        cancelledTasks: [],
        error: 'Engine not properly configured',
      }
    }

    // Get plan graph
    const { nodes, edges } = await this.planGraphProvider(request.projectId)

    // Validate request
    const validation = this.branchManager.validatePruneRequest(request, nodes, edges)
    if (!validation.valid) {
      return {
        success: false,
        prunedNodes: [],
        cancelledTasks: [],
        error: validation.error,
      }
    }

    // Find branch info
    const branches = this.branchManager.findBranches(nodes, edges)
    const branchInfo = branches.get(request.branchNodeId)

    if (!branchInfo) {
      return {
        success: false,
        prunedNodes: [],
        cancelledTasks: [],
        error: 'Branch not found',
      }
    }

    // Find nodes to cancel and prune
    const nodesToCancel = this.branchManager.findNodesToCancel(branchInfo.branchNodes, nodes)
    const nodesToPrune = this.branchManager.findNodesToPrune(branchInfo.branchNodes, nodes)

    // Cancel active tasks
    const cancelledTasks: string[] = []
    for (const nodeId of nodesToCancel) {
      const cancelled = await this.cancel(nodeId)
      if (cancelled) {
        cancelledTasks.push(nodeId)
      }
    }

    // Mark nodes as pruned
    for (const nodeId of nodesToPrune) {
      await this.nodeUpdateCallback(nodeId, { status: 'pruned' })
    }

    // Emit event
    const event: BranchPrunedEvent = {
      type: 'branch:pruned',
      timestamp: new Date(),
      branchNodeId: request.branchNodeId,
      projectId: request.projectId,
      prunedNodes: nodesToPrune,
      cancelledTasks,
      reason: request.reason,
    }
    this.emit('branch:pruned', event)

    return {
      success: true,
      prunedNodes: nodesToPrune,
      cancelledTasks,
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): ReturnType<DispatchQueue['getStats']> & {
    activeExecutions: number
    running: boolean
  } {
    return {
      ...this.queue.getStats(),
      activeExecutions: this.activeExecutions.size,
      running: this.running,
    }
  }

  /**
   * Find ready tasks in a project
   */
  async findReadyTasks(projectId: string): Promise<string[]> {
    if (!this.planGraphProvider) return []

    const { nodes, edges } = await this.planGraphProvider(projectId)
    const readyNodes: string[] = []

    for (const node of nodes) {
      // Skip non-planned nodes
      if (node.status !== 'planned') continue

      // Skip if on pruned branch
      if (this.branchManager.isOnPrunedBranch(node.id, nodes, edges)) continue

      // Check dependencies
      const resolution = this.contextAssembler.resolveDependencies(node, nodes)
      if (resolution.allMet) {
        readyNodes.push(node.id)
      }
    }

    return readyNodes
  }

  /**
   * Execute a task from the queue
   */
  private async executeTask(
    queueEntry: DispatchQueueEntry,
    nodes: PlanNode[],
    edges: PlanEdge[],
    project?: Project
  ): Promise<void> {
    if (!this.executionCallback || !this.nodeUpdateCallback) {
      console.error('[dispatch] Execution callback not configured')
      this.queue.markFailed(queueEntry.id, 'Execution callback not configured')
      return
    }

    const node = nodes.find((n) => n.id === queueEntry.nodeId)
    if (!node) {
      this.queue.markFailed(queueEntry.id, 'Node not found')
      return
    }

    // Assemble context
    const context = this.contextAssembler.assembleContext(node, nodes, edges, project)

    // Create abort controller
    const abortController = new AbortController()
    const executionId = `exec-${queueEntry.nodeId}-${Date.now()}`

    // Track active execution
    this.activeExecutions.set(queueEntry.nodeId, {
      executionId,
      abortController,
      projectId: queueEntry.projectId,
    })

    // Update queue and node status
    this.queue.markDispatched(queueEntry.id, executionId)
    await this.nodeUpdateCallback(queueEntry.nodeId, {
      status: 'dispatched',
      executionId,
    })

    // Emit dispatched event
    const dispatchedEvent: TaskDispatchedEvent = {
      type: 'task:dispatched',
      timestamp: new Date(),
      nodeId: queueEntry.nodeId,
      projectId: queueEntry.projectId,
      executionId,
      environment: queueEntry.environment,
    }
    this.emit('task:dispatched', dispatchedEvent)

    try {
      // Start execution
      let fullOutput = ''
      let result: TaskResult | undefined

      // Update to in_progress
      this.queue.markInProgress(queueEntry.id)
      await this.nodeUpdateCallback(queueEntry.nodeId, {
        status: 'in_progress',
        executionStartedAt: new Date(),
      })

      // Stream execution
      const stream = this.executionCallback(context, queueEntry)

      for await (const event of stream) {
        if (abortController.signal.aborted) {
          break
        }

        switch (event.type) {
          case 'text':
            fullOutput += event.text
            executionEventBus.emit('task:stdout', {
              output: { taskId: executionId, data: event.text, stream: 'stdout', timestamp: new Date() },
            })
            break
          case 'tool_use':
            executionEventBus.emit('task:tool_trace', {
              taskId: executionId,
              toolName: event.toolName,
              toolInput: event.toolInput,
            })
            break
          case 'tool_result':
            executionEventBus.emit('task:tool_trace', {
              taskId: executionId,
              toolName: event.toolName,
              toolResult: typeof event.result === 'string'
                ? event.result.slice(0, 5000)
                : event.result,
              success: event.success,
            })
            break
          case 'file_change':
            executionEventBus.emit('task:file_change', {
              taskId: executionId,
              ...event.change,
            })
            break
          case 'progress':
            executionEventBus.emit('task:progress', {
              taskId: executionId,
              progress: event.percentage,
              message: event.message,
            })
            break
          case 'result':
            result = event.result
            executionEventBus.emit('task:result', {
              result: {
                taskId: executionId,
                status: event.result.status === 'success' ? 'completed' : 'failed',
                output: fullOutput,
                duration: event.result.metrics?.durationMs,
              },
            })
            break
        }
      }

      // Handle result
      if (result) {
        await this.handleResult(queueEntry, node, result, fullOutput, nodes, edges)
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError'

      if (isAbort) {
        // Handle cancellation
        this.queue.markCancelled(queueEntry.id)
        await this.nodeUpdateCallback(queueEntry.nodeId, { status: 'planned' })
        this.emit('task:cancelled', queueEntry.nodeId, queueEntry.projectId)
      } else {
        // Handle error
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        const failResult = this.queue.markFailed(queueEntry.id, errorMessage)

        if (failResult?.retry) {
          // Will retry
          console.log(`[dispatch] Task ${queueEntry.nodeId} will retry (attempt ${queueEntry.retryCount})`)
          await this.nodeUpdateCallback(queueEntry.nodeId, { status: 'planned' })

          // Schedule retry with delay
          const delay = this.queue.calculateRetryDelay(queueEntry)
          setTimeout(() => {
            if (this.running) {
              this.executeTask(failResult.entry, nodes, edges, project)
            }
          }, delay)
        } else {
          // Max retries exceeded
          await this.nodeUpdateCallback(queueEntry.nodeId, {
            status: 'awaiting_judgment',
            executionError: errorMessage,
          })

          const failedEvent: TaskFailedEvent = {
            type: 'task:failed',
            timestamp: new Date(),
            nodeId: queueEntry.nodeId,
            projectId: queueEntry.projectId,
            error: errorMessage,
            retryable: false,
            retryCount: queueEntry.retryCount,
          }
          this.emit('task:failed', failedEvent)
        }
      }
    } finally {
      this.activeExecutions.delete(queueEntry.nodeId)
    }
  }

  /**
   * Handle task result and route appropriately
   */
  private async handleResult(
    queueEntry: DispatchQueueEntry,
    node: PlanNode,
    result: TaskResult,
    output: string,
    nodes: PlanNode[],
    edges: PlanEdge[]
  ): Promise<void> {
    // Find downstream nodes
    const downstreamNodes = this.branchManager.findDownstreamNodes(node.id, edges)

    // Route result
    const routing = this.resultRouter.route(node, result, downstreamNodes)

    // Update queue
    if (routing.targetStatus === 'auto_verified' || routing.targetStatus === 'completed') {
      this.queue.markCompleted(queueEntry.id)
    } else if (result.status === 'cancelled') {
      this.queue.markCancelled(queueEntry.id)
    } else {
      this.queue.markFailed(queueEntry.id, result.errorMessage || 'Unknown error')
    }

    // Update node
    if (this.nodeUpdateCallback) {
      await this.nodeUpdateCallback(node.id, {
        status: routing.targetStatus,
        executionOutput: output,
        executionCompletedAt: new Date(),
        executionError: result.errorMessage,
      })
    }

    // Emit completed event
    const completedEvent: TaskCompletedEvent = {
      type: 'task:completed',
      timestamp: new Date(),
      nodeId: node.id,
      projectId: queueEntry.projectId,
      result,
      routingDecision: routing,
    }
    this.emit('task:completed', completedEvent)

    // Trigger downstream dispatch if applicable
    if (routing.triggerDownstream && this.config.autoDispatch && routing.downstreamNodes) {
      for (const downstreamId of routing.downstreamNodes) {
        // Check if downstream is ready
        const downstreamNode = nodes.find((n) => n.id === downstreamId)
        if (downstreamNode?.status === 'planned') {
          // This will be picked up by the next poll cycle
          const readyEvent: TaskReadyEvent = {
            type: 'task:ready',
            timestamp: new Date(),
            nodeId: downstreamId,
            projectId: queueEntry.projectId,
            autoDispatch: true,
          }
          this.emit('task:ready', readyEvent)
        }
      }
    }
  }

  /**
   * Start polling for ready tasks
   */
  private startPolling(): void {
    if (this.pollInterval) return

    this.pollInterval = setInterval(async () => {
      await this.pollReadyTasks()
    }, this.config.pollIntervalMs)

    console.log(`[dispatch] Polling started (${this.config.pollIntervalMs}ms interval)`)
  }

  /**
   * Stop polling for ready tasks
   */
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
      console.log('[dispatch] Polling stopped')
    }
  }

  /**
   * Poll for ready tasks and dispatch them
   */
  private async pollReadyTasks(): Promise<void> {
    if (!this.planGraphProvider || this.config.dryRunMode) return

    // For now, we don't have a way to get all project IDs
    // This would be provided by the plan store integration
    // The polling is mainly for demonstration - actual integration
    // would be event-driven from plan graph changes
  }
}

/**
 * Create a dispatch engine with default configuration
 */
export function createDispatchEngine(
  config?: Partial<DispatchEngineConfig>
): DispatchEngine {
  return new DispatchEngine(config)
}

// Singleton instance
export const dispatchEngine = createDispatchEngine()
