/**
 * Dispatch Routes
 *
 * HTTP API endpoints for the task execution dispatch framework.
 * All AI execution flows through the relay to agent runners.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import {
  dispatchEngine,
  type BranchPruneRequest,
  type DispatchPriority,
} from '../lib/dispatch/index.js'
import { relayServer } from '../lib/relay-server.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { machineRegistry } from '../lib/machine-registry.js'
import type { ProviderType } from '../types/relay.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'
import { astroEventTransport } from '../lib/events/astro-event-transport.js'
import { db } from '../lib/db/index.js'
import { projects } from '../lib/db/schema.js'
import { eq, isNull, and } from 'drizzle-orm'
import type { TaskResult as DispatchTaskResult } from '../lib/dispatch/types.js'

// Validation schemas
const dispatchTaskSchema = z.object({
  nodeId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
  title: z.string().min(1).max(1000),
  description: z.string().min(1).max(50000),
  dependencies: z.array(z.string().max(100)).max(100).optional(),
  verification: z.enum(['auto', 'human']).optional(),
  visionDoc: z.string().max(100000).optional(),
  dependencyOutputs: z.array(z.object({
    nodeId: z.string().max(100),
    title: z.string().max(1000),
    output: z.string().max(100000),
  })).max(100).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  preferredProvider: z.string().max(100).optional(),
  targetMachineId: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  maxTurns: z.number().int().min(1).max(200).optional(),
  workingDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),
  sourceDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  computeBackend: z.string().max(100).optional(),
  deliveryMode: z.enum(['pr', 'push', 'branch', 'copy', 'direct']).optional(),
  remoteType: z.enum(['github', 'gitlab', 'bitbucket', 'generic', 'none']).optional(),
  agentDir: z.string().max(100).optional(),
  worktreeStrategy: z.enum(['copy', 'reference', 'direct']).optional(),
})

const dispatchRoute = new Hono()

// All dispatch routes require authentication
dispatchRoute.use('/*', requireAuth)

/**
 * Dispatch a task for execution
 *
 * POST /api/dispatch/task
 *
 * All tasks are dispatched via relay to agent runners.
 */
dispatchRoute.post('/task', async (c) => {
  // Validate input
  let body: z.infer<typeof dispatchTaskSchema>
  try {
    const rawBody = await c.req.json()
    body = dispatchTaskSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ success: false, error: 'Invalid input', details: err.issues }, 400)
    }
    return c.json({ success: false, error: 'Invalid JSON' }, 400)
  }

  const {
    nodeId,
    projectId,
    title,
    description,
    dependencies = [],
    visionDoc,
    dependencyOutputs = [],
    priority = 'normal',
    preferredProvider,
    targetMachineId,
    workingDirectory,
    sourceDirectory,
    force = false,
    dryRun = false,
    computeBackend,
    deliveryMode,
    remoteType,
    agentDir,
    worktreeStrategy,
  } = body

  // Validate working directory
  if (!workingDirectory) {
    return c.json(
      { success: false, error: 'No working directory or repository configured' },
      400
    )
  }

  // Dry run validation
  if (dryRun) {
    const pendingDeps = dependencies.filter((depId) => {
      const depOutput = dependencyOutputs.find((d) => d.nodeId === depId)
      return !depOutput
    })

    if (pendingDeps.length > 0 && !force) {
      return c.json({
        success: false,
        dryRun: true,
        validationIssues: [`Pending dependencies: ${pendingDeps.join(', ')}`],
      })
    }

    return c.json({
      success: true,
      dryRun: true,
      validationIssues: [],
    })
  }

  // Check dependencies (unless forced)
  if (!force && dependencies.length > 0) {
    const pendingDeps = dependencies.filter((depId) => {
      const depOutput = dependencyOutputs.find((d) => d.nodeId === depId)
      return !depOutput
    })

    if (pendingDeps.length > 0) {
      return c.json(
        {
          success: false,
          error: `Dependencies not met: ${pendingDeps.join(', ')}`,
        },
        400
      )
    }
  }

  // Serial execution constraint for 'direct' delivery mode (non-git directories).
  // Without git isolation, parallel execution on the same directory is unsafe.
  if (deliveryMode === 'direct') {
    const stats = await dispatchEngine.getStats()
    const activeForProject = stats.activePerProject?.[projectId] ?? 0
    if (activeForProject > 0) {
      return c.json(
        {
          success: false,
          error: 'Serial execution required: this project uses direct delivery mode (no git). Only one task can run at a time to prevent file conflicts.',
        },
        409
      )
    }
  }

  const executionId = `exec-${nodeId}-${Date.now()}`

  console.log(`[dispatch] ${executionId}: relay dispatch, workingDirectory=${workingDirectory}`)

  // All dispatch goes through relay
  return await dispatchViaRelay(c, {
    nodeId,
    projectId,
    executionId,
    title,
    description,
    visionDoc,
    dependencyOutputs,
    preferredProvider,
    targetMachineId,
    priority,
    workingDirectory,
    sourceDirectory,
    computeBackend,
    deliveryMode,
    remoteType,
    agentDir,
    worktreeStrategy,
  })
})

/**
 * Dispatch via relay server to agent runner (SSE streaming)
 */
async function dispatchViaRelay(
  c: Parameters<Parameters<typeof dispatchRoute.post>[1]>[0],
  params: {
    nodeId: string
    projectId: string
    executionId: string
    title: string
    description: string
    visionDoc?: string
    dependencyOutputs: Array<{ nodeId: string; title: string; output: string }>
    preferredProvider?: ProviderType
    targetMachineId?: string
    priority: DispatchPriority
    workingDirectory?: string
    sourceDirectory?: string
    computeBackend?: string
    deliveryMode?: string
    remoteType?: string
    agentDir?: string
    worktreeStrategy?: string
  }
) {
  const {
    nodeId,
    projectId,
    executionId,
    title,
    description,
    visionDoc,
    dependencyOutputs,
    preferredProvider,
    targetMachineId,
    priority,
    workingDirectory,
    sourceDirectory,
    computeBackend,
    deliveryMode,
    remoteType,
    agentDir,
    worktreeStrategy,
  } = params

  // Extract user for ownership verification
  const user = c.get('user') as AuthUser | undefined

  // Find target machine
  let machineId = targetMachineId
  if (!machineId) {
    const bestMachine = machineRegistry.findBestMachine(preferredProvider, user?.id)
    if (!bestMachine) {
      return c.json(
        {
          success: false,
          error: `No available machine. Start an agent runner with: npx astro-agent start --relay wss://<your-relay-url>`,
        },
        400
      )
    }
    machineId = bestMachine.machineId
  } else {
    // Verify ownership of explicitly targeted machine
    const targetMachine = machineRegistry.get(machineId)
    if (targetMachine?.userId && targetMachine.userId !== LOCAL_USER_ID && user?.id && targetMachine.userId !== user.id) {
      return c.json(
        { success: false, error: `Machine ${machineId} not found or not authorized` },
        403
      )
    }
  }

  // Build full execution prompt
  const promptParts: string[] = []

  if (visionDoc) {
    promptParts.push(`## Project Vision\n\n${visionDoc}`)
  }

  if (dependencyOutputs.length > 0) {
    const depsSection = dependencyOutputs
      .map((d) => `### ${d.title}\n\n${d.output}`)
      .join('\n\n---\n\n')
    promptParts.push(`## Previous Task Outputs\n\n${depsSection}`)
  }

  if (workingDirectory) {
    promptParts.push(`## Working Directory\n\n${workingDirectory}`)
  }

  if (sourceDirectory) {
    promptParts.push(`## Data Access\n\nYour working directory is a git worktree (isolated branch) in a sibling directory next to the project.\nThe original project directory is: ${sourceDirectory}\nLarge untracked files (training data, model caches, datasets) remain in the original directory. Use absolute paths to reference them. Always use absolute paths when writing code that accesses data files.`)
  }

  promptParts.push(`## Current Task\n\n**${title}**\n\n${description}`)

  promptParts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient
- When you are done, commit all your changes with a descriptive commit message summarizing what was accomplished

### Making Decisions vs. Asking for User Input

**When to proceed independently:**
- Standard best practices and established patterns exist
- Technical decisions with clear trade-offs you can evaluate
- Implementation details that don't affect user-facing behavior
- Refactoring and code quality improvements

**When to note that user input would be valuable:**
If you encounter a decision point where multiple approaches are equally valid and the choice depends on user preferences or priorities (e.g., which library to use, architectural patterns, feature trade-offs), note it clearly in your output:
1. Describe the decision point
2. Present 2-3 viable options with brief trade-offs
3. State which option you recommend and why
4. Proceed with your recommended approach unless instructed otherwise

The user can review your reasoning in the task output and provide guidance if they disagree with your choice.`)

  const relayPrompt = promptParts.join('\n\n---\n\n')

  // Dispatch via relay
  const taskDispatch = {
    taskId: executionId,
    projectId,
    nodeId,
    title,
    description,
    prompt: relayPrompt,
    visionDoc,
    preferredProvider,
    executionStrategy: computeBackend,
    priority: priority === 'critical' ? 0 : priority === 'high' ? 1 : priority === 'normal' ? 2 : 3,
    workingDirectory,
    sourceDirectory,
    deliveryMode: deliveryMode ?? 'pr',
    remoteType,
    agentDir,
    worktreeStrategy,
  }

  return streamSSE(c, async (stream) => {
    let alive = true
    let lastActivity = Date.now()
    const ACTIVITY_TIMEOUT_MS = 300_000

    const onResult = (msg: import('../types/relay.js').TaskResultMessage) => {
      if (!alive || msg.result.taskId !== executionId) return
      lastActivity = Date.now()

      // Map relay metrics to dispatch metrics (adding aliases used by hooks)
      const relayMetrics = msg.result.metrics
      const dispatchMetrics = relayMetrics ? {
        durationMs: relayMetrics.durationMs,
        inputTokens: relayMetrics.inputTokens,
        outputTokens: relayMetrics.outputTokens,
        totalCost: relayMetrics.totalCost,
        estimatedCostUsd: relayMetrics.totalCost,  // Alias used by observation collector & usage hooks
        tokensUsed: (relayMetrics.inputTokens ?? 0) + (relayMetrics.outputTokens ?? 0) || undefined,
        model: relayMetrics.model,
        numTurns: relayMetrics.numTurns,
        turnsUsed: relayMetrics.numTurns,  // Alias used by usage-metrics-hook
      } : undefined

      stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
          executionId,
          nodeId,
          status: msg.result.status === 'completed' ? 'success' : 'failure',
          output: msg.result.output,
          error: msg.result.error,
          duration: msg.result.duration,
          metrics: dispatchMetrics,
          branchName: msg.result.branchName,
          prUrl: msg.result.prUrl,
          prNumber: msg.result.prNumber,
        }),
      }).catch(() => { alive = false })

      // Emit task.completed AstroEvent for observability hooks (observation collector, usage metrics, langfuse)
      const dispatchResult: DispatchTaskResult = {
        taskId: executionId,
        status: msg.result.status === 'completed' ? 'success' : 'failure',
        stdout: msg.result.output,
        errorMessage: msg.result.error,
        metrics: dispatchMetrics,
        branchName: msg.result.branchName,
        prUrl: msg.result.prUrl,
        prNumber: msg.result.prNumber,
      }
      astroEventTransport.emitEvent({
        type: 'task.completed',
        taskId: executionId,
        nodeId,
        projectId,
        executionId,
        result: dispatchResult,
        node: {
          id: nodeId,
          projectId,
          type: 'task',
          title,
          description,
          status: msg.result.status === 'completed' ? 'completed' : 'planned',
          parentId: null,
          dependencies: [],
          verification: 'auto',
          position: { x: 0, y: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      }).catch((err) => {
        console.error('[dispatch] Error emitting task.completed event:', err)
      })

      // Auto-assign defaultMachineId on the project if not yet set
      if (msg.result.status === 'completed' && machineId) {
        db.update(projects)
          .set({ defaultMachineId: machineId, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), isNull(projects.defaultMachineId)))
          .execute()
          .catch((err: unknown) => {
            console.error('[dispatch] Error auto-assigning defaultMachineId:', err)
          })
      }

      stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      alive = false
    }

    const onText = (msg: import('../types/relay.js').TaskTextMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
      executionEventBus.emit('task:stdout', { output: { taskId: executionId, data: msg.text, stream: 'stdout', timestamp: new Date() } })
    }

    const onSessionInit = (msg: import('../types/relay.js').TaskSessionInitMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'session_init',
        data: JSON.stringify({ sessionId: msg.sessionId, model: msg.model }),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:session_init', { taskId: executionId, sessionId: msg.sessionId, model: msg.model || 'unknown' })
    }

    const onProgress = (msg: import('../types/relay.js').TaskProgressMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'progress',
        data: JSON.stringify({ message: msg.message, percentage: msg.progress }),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:progress', { taskId: executionId, message: msg.message, progress: msg.progress })
    }

    const onToolTrace = (msg: import('../types/relay.js').TaskToolTraceMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'tool_use',
        data: JSON.stringify({ toolName: msg.toolName, toolInput: msg.toolInput }),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:tool_trace', { taskId: executionId, toolName: msg.toolName, toolInput: msg.toolInput })
      if (msg.toolResult !== undefined) {
        stream.writeSSE({
          event: 'tool_result',
          data: JSON.stringify({ toolName: msg.toolName, success: msg.success, result: msg.toolResult }),
        }).catch(() => { alive = false })
        executionEventBus.emit('task:tool_trace', { taskId: executionId, toolName: msg.toolName, toolResult: typeof msg.toolResult === 'string' ? msg.toolResult.slice(0, 100000) : msg.toolResult, success: msg.success ?? true })
      }
    }

    const onFileChange = (msg: import('../types/relay.js').TaskFileChangeMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'file_change',
        data: JSON.stringify({ path: msg.path, action: msg.action, linesAdded: msg.linesAdded, linesRemoved: msg.linesRemoved }),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:file_change', { taskId: executionId, path: msg.path, action: msg.action })
    }

    const onMachineDisconnected = (disconnectedId: string) => {
      if (!alive || disconnectedId !== machineId) return
      console.log(`[dispatch] Machine ${machineId} disconnected during task ${executionId}`)
      stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: 'Remote machine disconnected during task execution', recoverable: false }),
      }).catch(() => {})
      stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      alive = false
    }

    relayServer.on('task:result', onResult)
    relayServer.on('task:text', onText)
    relayServer.on('task:session_init', onSessionInit)
    relayServer.on('task:progress', onProgress)
    relayServer.on('task:tool_trace', onToolTrace)
    relayServer.on('task:file_change', onFileChange)
    relayServer.on('machine:disconnected', onMachineDisconnected)

    const cleanup = () => {
      relayServer.off('task:result', onResult)
      relayServer.off('task:text', onText)
      relayServer.off('task:session_init', onSessionInit)
      relayServer.off('task:progress', onProgress)
      relayServer.off('task:tool_trace', onToolTrace)
      relayServer.off('task:file_change', onFileChange)
      relayServer.off('machine:disconnected', onMachineDisconnected)
    }

    // Dispatch after listeners registered
    const dispatched = relayServer.dispatchTask(taskDispatch, machineId)

    if (!dispatched) {
      cleanup()
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: `Failed to dispatch to machine: ${machineId}` }),
      })
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) })
      return
    }

    // Send init event
    const targetMachine = machineRegistry.get(machineId!)
    await stream.writeSSE({
      event: 'init',
      data: JSON.stringify({
        executionId,
        nodeId,
        machineId,
        providerId: preferredProvider || targetMachine?.providers[0]?.type,
        providerName: preferredProvider || targetMachine?.providers[0]?.type,
        computeBackend,
      }),
    })

    // Keepalive + activity timeout
    const heartbeat = setInterval(() => {
      if (!alive) { clearInterval(heartbeat); return }
      if (Date.now() - lastActivity > ACTIVITY_TIMEOUT_MS) {
        stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'Activity timeout — agent runner stopped responding', recoverable: false }),
        }).catch(() => {})
        stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
        alive = false
        clearInterval(heartbeat)
        return
      }
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => { alive = false; clearInterval(heartbeat) })
    }, 15000)

    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      cleanup()
    })

    // Wait for completion
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) { clearInterval(check); resolve() }
      }, 500)
    })
  })
}

/**
 * Steer a running agent task
 *
 * POST /api/dispatch/steer
 *
 * All steering goes through relay to agent runners.
 */
dispatchRoute.post('/steer', async (c) => {
  const { taskId, machineId, message, action, interrupt } = await c.req.json<{
    taskId: string
    machineId: string
    message: string
    action?: 'guidance' | 'redirect' | 'pause' | 'resume'
    interrupt?: boolean
  }>()

  if (!taskId || !machineId || !message) {
    return c.json({ success: false, error: 'taskId, machineId, and message are required' }, 400)
  }

  const sent = relayServer.steerTask(taskId, machineId, message, action, interrupt)

  if (!sent) {
    return c.json(
      { success: false, error: `Failed to steer task ${taskId} on machine ${machineId}` },
      500
    )
  }

  return c.json({ success: true, taskId, machineId, message: 'Steer message sent' })
})

/**
 * Send approval response back to agent runner
 */
dispatchRoute.post('/approval', async (c) => {
  const { taskId, machineId, requestId, answered, answer, message } = await c.req.json<{
    taskId: string
    machineId: string
    requestId: string
    answered: boolean
    answer?: string
    message?: string
  }>()

  if (!taskId || !machineId || !requestId) {
    return c.json({ success: false, error: 'taskId, machineId, and requestId are required' }, 400)
  }

  const sent = relayServer.sendApprovalResponse(taskId, machineId, requestId, answered, answer, message)

  if (!sent) {
    return c.json(
      { success: false, error: `Failed to send approval response for task ${taskId} on machine ${machineId}` },
      500
    )
  }

  return c.json({ success: true, taskId, machineId, requestId, message: 'Approval response sent' })
})

/**
 * Cancel a task
 */
dispatchRoute.post('/cancel', async (c) => {
  const { nodeId, executionId, machineId } = await c.req.json<{
    nodeId?: string
    executionId?: string
    machineId?: string
  }>()

  const id = executionId ?? nodeId
  if (!id) {
    return c.json({ success: false, error: 'nodeId or executionId required' }, 400)
  }

  // Cancel via relay
  relayServer.cancelTask(id, machineId || '')

  // Also cancel via dispatch engine
  if (nodeId) {
    await dispatchEngine.cancel(nodeId)
  }

  return c.json({ success: true, aborted: true })
})

/**
 * Prune a branch
 */
dispatchRoute.post('/prune', async (c) => {
  const body = await c.req.json<BranchPruneRequest>()
  const result = await dispatchEngine.pruneBranch(body)

  if (!result.success) {
    return c.json(result, 400)
  }

  return c.json(result)
})

/**
 * Respond to approval request
 */
dispatchRoute.post('/approve', async (c) => {
  const { approvalId, approved, selectedOption } = await c.req.json<{
    approvalId: string
    approved: boolean
    selectedOption?: string
  }>()

  if (!approvalId) {
    return c.json({ success: false, error: 'approvalId required' }, 400)
  }

  if (approved === undefined || approved === null) {
    return c.json({ success: false, error: 'approved (boolean) required' }, 400)
  }

  try {
    await dispatchEngine.respondToApproval(approvalId, approved, selectedOption)
    return c.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ success: false, error: message }, 400)
  }
})

/**
 * Request dynamic approval (called by MCP tool server)
 */
dispatchRoute.post('/request-dynamic-approval', async (c) => {
  const { executionId, question, options } = await c.req.json<{
    executionId: string
    question: string
    options: string[]
  }>()

  if (!executionId) {
    return c.json({ success: false, error: 'executionId required' }, 400)
  }

  if (!question || typeof question !== 'string') {
    return c.json({ success: false, error: 'question required (string)' }, 400)
  }

  if (!Array.isArray(options) || options.length < 2 || options.length > 5) {
    return c.json({ success: false, error: 'options must be array of 2-5 strings' }, 400)
  }

  try {
    const selectedOption = await dispatchEngine.requestDynamicApproval(
      executionId,
      question,
      options
    )
    return c.json({ success: true, selectedOption })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ success: false, error: message }, 400)
  }
})

/**
 * Get dispatch queue status
 */
dispatchRoute.get('/status', async (c) => {
  const stats = dispatchEngine.getStats()
  return c.json({
    engine: {
      running: stats.running,
      activeExecutions: stats.activeExecutions,
    },
    queue: {
      total: stats.total,
      byStatus: stats.byStatus,
      activeTotal: stats.activeTotal,
      activePerProject: stats.activePerProject,
    },
  })
})

/**
 * Find ready tasks for a project
 */
dispatchRoute.get('/ready/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const readyTasks = await dispatchEngine.findReadyTasks(projectId)
  return c.json({
    projectId,
    readyTasks,
    count: readyTasks.length,
  })
})

/**
 * Start the dispatch engine
 */
dispatchRoute.post('/engine/start', async (c) => {
  dispatchEngine.start()
  return c.json({ success: true, message: 'Dispatch engine started' })
})

/**
 * Stop the dispatch engine
 */
dispatchRoute.post('/engine/stop', async (c) => {
  dispatchEngine.stop()
  return c.json({ success: true, message: 'Dispatch engine stopped' })
})

/**
 * Reset a task for re-execution
 *
 * Cancels via relay and resets dispatch engine state.
 */
dispatchRoute.post('/reset', async (c) => {
  const { nodeId, executionId, machineId } = await c.req.json<{
    nodeId?: string
    executionId?: string
    machineId?: string
  }>()

  if (!nodeId) {
    return c.json({ success: false, error: 'nodeId required' }, 400)
  }

  // Cancel via relay if we have an execution ID
  if (executionId) {
    relayServer.cancelTask(executionId, machineId || '')
  }

  return c.json({ success: true })
})

/**
 * Clean up after a completed/pruned task
 *
 * In relay mode, cleanup is handled by the agent runner.
 * This endpoint is kept for API compatibility.
 */
dispatchRoute.post('/cleanup', async (c) => {
  const { executionId, nodeId } = await c.req.json<{
    executionId?: string
    nodeId?: string
  }>()

  if (!executionId && !nodeId) {
    return c.json({ success: false, error: 'executionId or nodeId required' }, 400)
  }

  // In relay mode, the agent runner handles worktree cleanup.
  // We could forward a cleanup command via relay if needed.
  return c.json({ success: true, removed: false })
})

export { dispatchRoute }
