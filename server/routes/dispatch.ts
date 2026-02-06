/**
 * Dispatch Routes
 *
 * HTTP API endpoints for the task execution dispatch framework.
 * Provides orchestration control, status queries, and manual operations.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  dispatchEngine,
  type BranchPruneRequest,
  type DispatchPriority,
} from '../lib/dispatch/index.js'
import {
  providerRegistry,
  type TaskDispatch,
} from '../lib/providers/index.js'
import { createSession, abortSession, removeSession } from '../lib/session-manager.js'
import { relayServer } from '../lib/relay-server.js'
import { machineRegistry } from '../lib/machine-registry.js'
import type { ExecutionEnvironment } from '../lib/providers/types.js'
import type { ProviderType } from '../types/relay.js'

const dispatchRoute = new Hono()

/**
 * Dispatch a task for execution
 *
 * POST /api/dispatch/task
 *
 * This is the main entry point for task dispatch. It:
 * 1. Validates the request and checks dependencies
 * 2. Assembles execution context (vision doc, dependency outputs)
 * 3. Routes to local provider or relay server based on environment
 * 4. Streams execution progress back to the client
 */
dispatchRoute.post('/task', async (c) => {
  const body = await c.req.json<{
    nodeId: string
    projectId: string
    // Node info (for context assembly)
    title: string
    description: string
    dependencies?: string[]
    environment?: ExecutionEnvironment
    verification?: 'auto' | 'human'
    // Project info
    visionDoc?: string
    // Dependency outputs
    dependencyOutputs?: Array<{
      nodeId: string
      title: string
      output: string
    }>
    // Execution options
    priority?: DispatchPriority
    preferredProvider?: ProviderType
    targetMachineId?: string
    model?: string
    maxTurns?: number
    workingDirectory?: string
    // Control flags
    force?: boolean
    dryRun?: boolean
  }>()

  const {
    nodeId,
    projectId,
    title,
    description,
    dependencies = [],
    environment = 'local',
    verification = 'auto',
    visionDoc,
    dependencyOutputs = [],
    priority = 'normal',
    preferredProvider,
    targetMachineId,
    model,
    maxTurns = 50,
    workingDirectory,
    force = false,
    dryRun = false,
  } = body

  // Dry run validation
  if (dryRun) {
    // Check if dependencies are met
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

  const executionId = `exec-${nodeId}-${Date.now()}`

  // Determine dispatch target
  const useRelay = environment !== 'local' || targetMachineId

  if (useRelay) {
    // Dispatch via relay server for remote execution
    return await dispatchViaRelay(c, {
      nodeId,
      projectId,
      executionId,
      title,
      description,
      visionDoc,
      dependencyOutputs,
      environment,
      preferredProvider,
      targetMachineId,
      priority,
    })
  }

  // Local dispatch via provider
  return await dispatchLocal(c, {
    nodeId,
    projectId,
    executionId,
    title,
    description,
    visionDoc,
    dependencyOutputs,
    verification,
    model,
    maxTurns,
    workingDirectory,
    preferredProvider,
  })
})

/**
 * Local dispatch via provider (streaming SSE)
 */
async function dispatchLocal(
  c: Parameters<Parameters<typeof dispatchRoute.post>[1]>[0],
  params: {
    nodeId: string
    projectId: string
    executionId: string
    title: string
    description: string
    visionDoc?: string
    dependencyOutputs: Array<{ nodeId: string; title: string; output: string }>
    verification: 'auto' | 'human'
    model?: string
    maxTurns: number
    workingDirectory?: string
    preferredProvider?: ProviderType
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
    verification,
    model,
    maxTurns,
    workingDirectory,
    preferredProvider,
  } = params

  const abortController = createSession(executionId, preferredProvider as string)

  return streamSSE(c, async (stream) => {
    try {
      // Get provider
      const provider = preferredProvider
        ? providerRegistry.getProvider(preferredProvider as string)
        : providerRegistry.getDefaultProvider()

      if (!provider) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: 'No provider available',
            message: 'No agent provider found. Ensure a provider is installed and authenticated.',
          }),
        })
        return
      }

      // Check availability
      const registration = providerRegistry.getRegisteredProvider(provider.id)
      if (!registration?.available) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: 'Provider not available',
            message: `${provider.name} is not available.`,
          }),
        })
        return
      }

      // Build execution prompt with context
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

      promptParts.push(`## Current Task\n\n**${title}**\n\n${description}`)

      promptParts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient`)

      const prompt = promptParts.join('\n\n---\n\n')

      // Build task dispatch
      const task: TaskDispatch = {
        taskId: executionId,
        type: 'code_generation',
        prompt,
        model,
        maxTurns,
        context: {
          projectId,
          visionDoc,
          workingDirectory,
        },
        abortController,
      }

      // Send init event
      await stream.writeSSE({
        event: 'init',
        data: JSON.stringify({
          executionId,
          nodeId,
          providerId: provider.id,
          providerName: provider.name,
        }),
      })

      // Stream execution
      let fullOutput = ''
      let sessionId: string | undefined

      for await (const event of provider.stream(task)) {
        switch (event.type) {
          case 'init':
            sessionId = event.sessionId
            await stream.writeSSE({
              event: 'session_init',
              data: JSON.stringify({
                sessionId: event.sessionId,
                model: event.model,
              }),
            })
            break

          case 'text':
            fullOutput += event.text
            await stream.writeSSE({ event: 'text', data: event.text })
            break

          case 'tool_use':
            await stream.writeSSE({
              event: 'tool_use',
              data: JSON.stringify({
                toolName: event.toolName,
                toolInput: event.toolInput,
              }),
            })
            break

          case 'tool_result':
            await stream.writeSSE({
              event: 'tool_result',
              data: JSON.stringify({
                toolName: event.toolName,
                success: event.success,
                result:
                  typeof event.result === 'string'
                    ? event.result.slice(0, 5000)
                    : event.result,
              }),
            })
            break

          case 'file_change':
            await stream.writeSSE({
              event: 'file_change',
              data: JSON.stringify(event.change),
            })
            break

          case 'progress':
            await stream.writeSSE({
              event: 'progress',
              data: JSON.stringify({
                message: event.message,
                percentage: event.percentage,
              }),
            })
            break

          case 'result': {
            // Determine final status based on result and verification type
            const isSuccess = event.result.status === 'success'
            let finalStatus: string

            if (isSuccess) {
              finalStatus = verification === 'auto' ? 'auto_verified' : 'awaiting_judgment'
            } else {
              finalStatus = 'awaiting_judgment'
            }

            await stream.writeSSE({
              event: 'result',
              data: JSON.stringify({
                executionId,
                nodeId,
                status: event.result.status,
                finalStatus,
                output: fullOutput,
                metrics: event.result.metrics,
                verification: event.result.verification,
                sessionId: event.result.sessionId,
              }),
            })
            break
          }

          case 'error':
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({
                error: event.error,
                recoverable: event.recoverable,
              }),
            })
            break

          case 'aborted':
            await stream.writeSSE({
              event: 'aborted',
              data: JSON.stringify({
                reason: event.reason,
              }),
            })
            break
        }
      }

      // Send done event
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          executionId,
          nodeId,
          sessionId,
        }),
      })
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        await stream.writeSSE({
          event: 'aborted',
          data: JSON.stringify({ reason: 'User cancelled' }),
        })
      } else {
        const message = e instanceof Error ? e.message : 'Unknown error'
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: message }),
        })
      }
    } finally {
      removeSession(executionId)
    }
  })
}

/**
 * Dispatch via relay server for remote execution (SSE streaming)
 *
 * Dispatches the task, then subscribes to relay events filtered by
 * executionId and streams them back as SSE until the task completes.
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
    environment: ExecutionEnvironment
    preferredProvider?: ProviderType
    targetMachineId?: string
    priority: DispatchPriority
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
    environment,
    preferredProvider,
    targetMachineId,
    priority,
  } = params

  // Find target machine
  let machineId = targetMachineId
  if (!machineId) {
    const bestMachine = machineRegistry.findBestMachine(environment, preferredProvider)
    if (!bestMachine) {
      return c.json(
        {
          success: false,
          error: `No available machine for environment: ${environment}`,
        },
        400
      )
    }
    machineId = bestMachine.machineId
  }

  // Build dependency output string
  const dependencyContext = dependencyOutputs.length > 0
    ? dependencyOutputs.map((d) => `### ${d.title}\n\n${d.output}`).join('\n\n---\n\n')
    : undefined

  // Dispatch via relay
  const taskDispatch = {
    taskId: executionId,
    projectId,
    nodeId,
    title,
    description,
    visionDoc,
    environment,
    preferredProvider,
    priority: priority === 'critical' ? 0 : priority === 'high' ? 1 : priority === 'normal' ? 2 : 3,
    dependencies: dependencyContext ? [dependencyContext] : undefined,
  }

  const dispatched = relayServer.dispatchTask(taskDispatch, machineId)

  if (!dispatched) {
    return c.json(
      {
        success: false,
        error: `Failed to dispatch to machine: ${machineId}`,
      },
      500
    )
  }

  // Stream relay events for this execution back to the client
  return streamSSE(c, async (stream) => {
    let alive = true

    // Send init event
    await stream.writeSSE({
      event: 'init',
      data: JSON.stringify({ executionId, nodeId, machineId }),
    })

    // Subscribe to relay events filtered by this executionId
    const onResult = (msg: import('../types/relay.js').TaskResultMessage) => {
      if (!alive || msg.result.taskId !== executionId) return
      stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
          executionId,
          nodeId,
          status: msg.result.status === 'completed' ? 'success' : 'failure',
          output: msg.result.output,
          error: msg.result.error,
          duration: msg.result.duration,
        }),
      }).catch(() => { alive = false })
      // Task is done, close stream after sending result
      stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      alive = false
    }

    const onStdout = (msg: import('../types/relay.js').TaskStdoutMessage) => {
      if (!alive || msg.output.taskId !== executionId) return
      stream.writeSSE({ event: 'text', data: msg.output.data }).catch(() => { alive = false })
    }

    const onProgress = (msg: import('../types/relay.js').TaskProgressMessage) => {
      if (!alive || msg.taskId !== executionId) return
      stream.writeSSE({
        event: 'progress',
        data: JSON.stringify({ message: msg.message, percentage: msg.progress }),
      }).catch(() => { alive = false })
    }

    const onToolTrace = (msg: import('../types/relay.js').TaskToolTraceMessage) => {
      if (!alive || msg.taskId !== executionId) return
      stream.writeSSE({
        event: 'tool_use',
        data: JSON.stringify({ toolName: msg.toolName, toolInput: msg.toolInput }),
      }).catch(() => { alive = false })
      if (msg.toolResult !== undefined) {
        stream.writeSSE({
          event: 'tool_result',
          data: JSON.stringify({ toolName: msg.toolName, success: msg.success, result: msg.toolResult }),
        }).catch(() => { alive = false })
      }
    }

    const onFileChange = (msg: import('../types/relay.js').TaskFileChangeMessage) => {
      if (!alive || msg.taskId !== executionId) return
      stream.writeSSE({
        event: 'file_change',
        data: JSON.stringify({ path: msg.path, action: msg.action, linesAdded: msg.linesAdded, linesRemoved: msg.linesRemoved }),
      }).catch(() => { alive = false })
    }

    relayServer.on('task:result', onResult)
    relayServer.on('task:stdout', onStdout)
    relayServer.on('task:progress', onProgress)
    relayServer.on('task:tool_trace', onToolTrace)
    relayServer.on('task:file_change', onFileChange)

    // Keepalive
    const heartbeat = setInterval(() => {
      if (!alive) { clearInterval(heartbeat); return }
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
        alive = false
        clearInterval(heartbeat)
      })
    }, 15000)

    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      relayServer.off('task:result', onResult)
      relayServer.off('task:stdout', onStdout)
      relayServer.off('task:progress', onProgress)
      relayServer.off('task:tool_trace', onToolTrace)
      relayServer.off('task:file_change', onFileChange)
    })

    // Wait for completion or disconnect
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
 * Sends a guidance message to a running agent via the relay server.
 * The agent runner receives the message and injects it into the session.
 */
dispatchRoute.post('/steer', async (c) => {
  const { taskId, machineId, message, action } = await c.req.json<{
    taskId: string
    machineId: string
    message: string
    action?: 'guidance' | 'redirect' | 'pause' | 'resume'
  }>()

  if (!taskId || !machineId || !message) {
    return c.json({ success: false, error: 'taskId, machineId, and message are required' }, 400)
  }

  const sent = relayServer.steerTask(taskId, machineId, message, action)

  if (!sent) {
    return c.json(
      { success: false, error: `Failed to steer task ${taskId} on machine ${machineId}` },
      500
    )
  }

  return c.json({ success: true, taskId, machineId, message: 'Steer message sent' })
})

/**
 * Cancel a task
 *
 * POST /api/dispatch/cancel
 */
dispatchRoute.post('/cancel', async (c) => {
  const { nodeId, executionId } = await c.req.json<{
    nodeId?: string
    executionId?: string
  }>()

  const id = executionId ?? nodeId
  if (!id) {
    return c.json({ success: false, error: 'nodeId or executionId required' }, 400)
  }

  // Try session manager
  const aborted = abortSession(id)

  // Try dispatch engine
  if (nodeId) {
    await dispatchEngine.cancel(nodeId)
  }

  return c.json({ success: true, aborted })
})

/**
 * Prune a branch
 *
 * POST /api/dispatch/prune
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
 * Get dispatch queue status
 *
 * GET /api/dispatch/status
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
 *
 * GET /api/dispatch/ready/:projectId
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
 *
 * POST /api/dispatch/engine/start
 */
dispatchRoute.post('/engine/start', async (c) => {
  dispatchEngine.start()
  return c.json({ success: true, message: 'Dispatch engine started' })
})

/**
 * Stop the dispatch engine
 *
 * POST /api/dispatch/engine/stop
 */
dispatchRoute.post('/engine/stop', async (c) => {
  dispatchEngine.stop()
  return c.json({ success: true, message: 'Dispatch engine stopped' })
})

export { dispatchRoute }
