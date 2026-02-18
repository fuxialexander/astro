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
import { errorMessage } from '../error-utils.js'
import { BranchManager, createBranchManager } from './branch-manager.js'
import { astroEventTransport } from '../events/astro-event-transport.js'
import type { TaskStartedEvent, TaskCompletedEvent as AstroTaskCompletedEvent } from '../events/types.js'
import type { SubroutineDefinition } from './procedure-types.js'
import {
  interpolatePrompt,
  runValidationCommand,
  isValidationPassed,
  buildFixerPrompt,
  initValidationLoop,
  recordValidationAttempt,
  shouldRetryValidation,
} from './procedure-executor.js'

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

  /** Pending approvals waiting for user response */
  private pendingApprovals = new Map<string, {
    resolve: (result: boolean | string) => void
    reject: (error: Error) => void
    nodeId: string
    projectId: string
    executionId: string
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

      // Emit task.started event to event transport
      await astroEventTransport.emitEvent({
        type: 'task.started',
        taskId: executionId,
        nodeId: queueEntry.nodeId,
        projectId: queueEntry.projectId,
        executionId,
        timestamp: new Date(),
        node,
        project,
      } satisfies TaskStartedEvent)

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
                ? event.result.slice(0, 100000)
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

        // Emit to event transport
        await astroEventTransport.emitEvent({
          type: 'task.cancelled',
          taskId: executionId,
          nodeId: queueEntry.nodeId,
          projectId: queueEntry.projectId,
          executionId,
          reason: 'User cancelled',
          timestamp: new Date(),
        })
      } else {
        // Handle error
        const errMsg = errorMessage(error)
        const failResult = this.queue.markFailed(queueEntry.id, errMsg)

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
            executionError: errMsg,
          })

          const failedEvent: TaskFailedEvent = {
            type: 'task:failed',
            timestamp: new Date(),
            nodeId: queueEntry.nodeId,
            projectId: queueEntry.projectId,
            error: errMsg,
            retryable: false,
            retryCount: queueEntry.retryCount,
          }
          this.emit('task:failed', failedEvent)

          // Emit to event transport
          await astroEventTransport.emitEvent({
            type: 'task.failed',
            taskId: executionId,
            nodeId: queueEntry.nodeId,
            projectId: queueEntry.projectId,
            executionId,
            error: errMsg,
            node,
            timestamp: new Date(),
          })
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

    // Emit to event transport for hooks
    await astroEventTransport.emitEvent({
      type: 'task.completed',
      taskId: result.taskId,
      nodeId: node.id,
      projectId: queueEntry.projectId,
      executionId: result.taskId,
      result,
      node,
      timestamp: new Date(),
    } satisfies AstroTaskCompletedEvent)

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
   * Execute a procedure (sequential subroutines)
   */
  private async executeProcedure(
    queueEntry: DispatchQueueEntry,
    node: PlanNode,
    nodes: PlanNode[],
    edges: PlanEdge[],
    project?: Project
  ): Promise<void> {
    const state = queueEntry.procedureState
    if (!state) {
      throw new Error('Procedure state not initialized')
    }

    const procedure = state.procedure
    const currentIndex = state.currentSubroutineIndex

    // Check if procedure is complete
    if (currentIndex >= procedure.subroutines.length) {
      console.log(`[dispatch] Procedure '${procedure.name}' completed`)
      return
    }

    const subroutine = procedure.subroutines[currentIndex]
    console.log(`[dispatch] Executing subroutine '${subroutine.name}' (${currentIndex + 1}/${procedure.subroutines.length})`)

    // Check if approval required
    if (subroutine.requiresApproval && !state.awaitingApproval) {
      const approvalResult = await this.requestApproval(node, subroutine)

      // Check if approval was denied (false for binary, empty for multi-choice)
      if (approvalResult === false) {
        console.log(`[dispatch] Approval denied for subroutine '${subroutine.name}'`)
        await this.nodeUpdateCallback?.(node.id, {
          status: 'planned',
          executionError: 'User denied approval',
        })
        return
      }

      // Store approval result for use in subsequent prompts
      state.approvalResult = approvalResult
      state.awaitingApproval = false
    }

    // Build subroutine prompt
    const prompt = interpolatePrompt(subroutine.promptTemplate, node, state)

    // Execute subroutine
    const result = await this.executeSubroutine(subroutine, prompt, queueEntry, node, nodes, edges, project)

    // Store result in history
    state.subroutineHistory.push({
      subroutine: subroutine.name,
      completedAt: new Date(),
      sessionId: result.sessionId ?? null,
      result: result.stdout,
    })

    // Check if validation loop needed
    if (subroutine.usesValidationLoop) {
      // Initialize validation loop if needed
      if (!state.validationLoop) {
        state.validationLoop = initValidationLoop()
      }

      // Run validation command if specified
      let validationResult: ReturnType<typeof runValidationCommand> | undefined
      if (subroutine.validationCommand) {
        validationResult = runValidationCommand(
          subroutine.validationCommand,
          node.workingDirectory
        )
      }

      // Check if validation passed
      const passed = isValidationPassed(result, subroutine, validationResult)

      // Record attempt
      recordValidationAttempt(
        state.validationLoop,
        passed,
        validationResult?.reason ?? result.errorMessage ?? 'Unknown'
      )

      if (!passed) {
        const maxIterations = subroutine.maxValidationIterations ?? 3

        if (shouldRetryValidation(state.validationLoop, maxIterations)) {
          console.log(`[dispatch] Validation failed, retrying (${state.validationLoop.iteration}/${maxIterations})`)

          // Build fixer prompt
          const fixerPrompt = buildFixerPrompt(
            prompt,
            validationResult ?? {
              pass: false,
              reason: result.errorMessage ?? 'Task failed',
              exitCode: 1,
            },
            state.validationLoop.iteration
          )

          // Increment iteration
          state.validationLoop.iteration++
          state.validationLoop.inFixerMode = true

          // Re-run this subroutine with fixer prompt
          await this.executeSubroutine(subroutine, fixerPrompt, queueEntry, node, nodes, edges, project)

          // Continue with procedure after fix
          await this.executeProcedure(queueEntry, node, nodes, edges, project)
          return
        } else {
          console.log(`[dispatch] Max validation iterations reached`)
          await this.nodeUpdateCallback?.(node.id, {
            status: 'awaiting_judgment',
            executionError: `Validation failed after ${maxIterations} attempts`,
          })
          return
        }
      }

      // Validation passed, reset loop state
      state.validationLoop = undefined
    }

    // Advance to next subroutine
    state.currentSubroutineIndex++

    // Continue with next subroutine
    await this.executeProcedure(queueEntry, node, nodes, edges, project)
  }

  /**
   * Execute a single subroutine
   */
  private async executeSubroutine(
    subroutine: SubroutineDefinition,
    prompt: string,
    queueEntry: DispatchQueueEntry,
    node: PlanNode,
    nodes: PlanNode[],
    edges: PlanEdge[],
    project?: Project
  ): Promise<TaskResult> {
    if (!this.executionCallback) {
      throw new Error('Execution callback not configured')
    }

    // Assemble context
    const context = this.contextAssembler.assembleContext(node, nodes, edges, project)

    // Create abort controller
    const abortController = new AbortController()
    const executionId = `exec-${queueEntry.nodeId}-sub-${subroutine.name}-${Date.now()}`

    // Track active execution
    this.activeExecutions.set(queueEntry.nodeId, {
      executionId,
      abortController,
      projectId: queueEntry.projectId,
    })

    try {
      // Prepare dispatch for subroutine
      const subroutineDispatch = {
        ...queueEntry,
        prompt,
        maxTurns: subroutine.singleTurn ? 1 : queueEntry.maxTurns,
        context: {
          ...context,
          // Add tool restrictions if specified
          ...(subroutine.disallowedTools ? { disallowedTools: subroutine.disallowedTools } : {}),
          ...(subroutine.disallowAllTools ? { allowedTools: [] } : {}),
        },
      }

      let result: TaskResult | undefined

      // Stream execution
      const stream = this.executionCallback(context, subroutineDispatch)

      for await (const event of stream) {
        if (abortController.signal.aborted) {
          break
        }

        if (event.type === 'result') {
          result = event.result
        }
      }

      if (!result) {
        throw new Error('No result returned from execution')
      }

      return result
    } finally {
      this.activeExecutions.delete(queueEntry.nodeId)
    }
  }

  /**
   * Request user approval for subroutine
   * Returns true/false for binary approval, or selected option string for multi-choice
   */
  private async requestApproval(
    node: PlanNode,
    subroutine: SubroutineDefinition
  ): Promise<boolean | string> {
    const executionId = this.activeExecutions.get(node.id)?.executionId
    if (!executionId) {
      throw new Error('No active execution found for approval request')
    }

    const approvalId = `approval-${node.id}-${Date.now()}`

    console.log(`[dispatch] Requesting approval for ${subroutine.name}: ${subroutine.approvalMessage}`)

    // Emit approval request event
    await astroEventTransport.emitEvent({
      type: 'approval.requested',
      approvalId,
      nodeId: node.id,
      projectId: node.projectId,
      executionId,
      subroutine,
      message: subroutine.approvalMessage || 'Approval required to continue',
      options: subroutine.approvalOptions,
      timestamp: new Date(),
    })

    // Update node status to awaiting_approval
    if (this.nodeUpdateCallback) {
      await this.nodeUpdateCallback(node.id, {
        status: 'awaiting_approval',
        executionError: undefined, // Clear any previous errors
      })
    }

    // Create promise that will be resolved when user responds
    return new Promise<boolean | string>((resolve, reject) => {
      this.pendingApprovals.set(approvalId, {
        resolve,
        reject,
        nodeId: node.id,
        projectId: node.projectId,
        executionId,
      })

      // Set timeout (5 minutes)
      setTimeout(() => {
        if (this.pendingApprovals.has(approvalId)) {
          this.pendingApprovals.delete(approvalId)
          reject(new Error('Approval request timed out after 5 minutes'))
        }
      }, 5 * 60 * 1000)
    })
  }

  /**
   * Handle approval response from user
   */
  async respondToApproval(
    approvalId: string,
    approved: boolean,
    selectedOption?: string
  ): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId)
    if (!pending) {
      throw new Error(`No pending approval found for ID: ${approvalId}`)
    }

    // Emit approval responded event
    await astroEventTransport.emitEvent({
      type: 'approval.responded',
      approvalId,
      nodeId: pending.nodeId,
      projectId: pending.projectId,
      executionId: pending.executionId,
      approved,
      selectedOption,
      timestamp: new Date(),
    })

    // Update node status back to in_progress
    if (this.nodeUpdateCallback) {
      await this.nodeUpdateCallback(pending.nodeId, {
        status: 'in_progress',
      })
    }

    // Resolve the promise
    this.pendingApprovals.delete(approvalId)

    if (selectedOption) {
      pending.resolve(selectedOption)
    } else {
      pending.resolve(approved)
    }
  }

  /**
   * Request dynamic approval from MCP tool (AskUserQuestion)
   * This is called when the agent uses the ask_user_question tool during execution
   */
  async requestDynamicApproval(
    executionId: string,
    question: string,
    options: string[]
  ): Promise<string> {
    // Find the node by executionId
    const activeExecution = Array.from(this.activeExecutions.entries()).find(
      ([, exec]) => exec.executionId === executionId
    )

    if (!activeExecution) {
      throw new Error(`No active execution found for ID: ${executionId}`)
    }

    const [nodeId, execInfo] = activeExecution
    const approvalId = `approval-tool-${nodeId}-${Date.now()}`

    console.log(`[dispatch] Dynamic approval requested via tool: ${question}`)

    // Emit approval request event
    await astroEventTransport.emitEvent({
      type: 'approval.requested',
      approvalId,
      nodeId,
      projectId: execInfo.projectId,
      executionId,
      subroutine: undefined, // Dynamic approvals don't have a subroutine context
      message: question,
      options,
      timestamp: new Date(),
    })

    // Note: We don't update node status for dynamic approvals since they can happen mid-execution
    // The agent is still running, just paused waiting for user input

    // Create promise that will be resolved when user responds
    return new Promise<string>((resolve, reject) => {
      this.pendingApprovals.set(approvalId, {
        resolve: (result) => resolve(result as string),
        reject,
        nodeId,
        projectId: execInfo.projectId,
        executionId,
      })

      // Set timeout (5 minutes)
      setTimeout(() => {
        if (this.pendingApprovals.has(approvalId)) {
          this.pendingApprovals.delete(approvalId)
          reject(new Error('User question timed out after 5 minutes'))
        }
      }, 5 * 60 * 1000)
    })
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
