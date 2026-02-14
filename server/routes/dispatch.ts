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
import { requireAuth } from '../middleware/auth.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { errorMessage, isAbortError } from '../lib/error-utils.js'
import {
  createServerWorktree,
  getDefaultBranch,
  hasBranchCommits,
  pushAndCreatePR,
  isGitRepo,
  hasRemoteOrigin,
  type ServerWorktreeSetup,
} from '../lib/worktree-manager.js'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

const dispatchRoute = new Hono()

// All dispatch routes require authentication
dispatchRoute.use('/*', requireAuth)

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

  // Validate working directory
  if (!workingDirectory) {
    return c.json(
      { success: false, error: 'No working directory or repository configured' },
      400
    )
  }

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
      workingDirectory,
    })
  }

  // Resolve working directory (clone repo if needed)
  let resolvedDir = workingDirectory
  try {
    resolvedDir = resolveWorkingDirectory(workingDirectory, projectId)
  } catch (e) {
    const msg = errorMessage(e)
    return c.json(
      { success: false, error: `Failed to resolve working directory: ${msg}` },
      500
    )
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
    workingDirectory: resolvedDir,
    preferredProvider,
  })
})

/**
 * Resolve a working directory value. If it looks like a git URL, clone to
 * ~/.nexus/repos/{projectId}/ and return the local path. Otherwise return as-is.
 */
function resolveWorkingDirectory(value: string, projectId: string): string {
  const isGitUrl = value.startsWith('http://') || value.startsWith('https://') || value.startsWith('git@')
  if (!isGitUrl) return value

  const repoDir = join(homedir(), '.nexus', 'repos', projectId)
  if (existsSync(join(repoDir, '.git'))) {
    // Already cloned — fetch latest
    try {
      execSync('git fetch --all', { cwd: repoDir, stdio: 'ignore', timeout: 30_000 })
    } catch {
      // Non-fatal: proceed with stale clone
    }
  } else {
    // Clone the repo
    execSync(`git clone ${JSON.stringify(value)} ${JSON.stringify(repoDir)}`, {
      stdio: 'ignore',
      timeout: 120_000,
    })
  }
  return repoDir
}

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
    let worktreeSetup: ServerWorktreeSetup | null = null
    let keepBranch = false

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

      // Create worktree for isolation if the directory is a git repo with a remote
      let effectiveWorkDir = workingDirectory
      if (workingDirectory && await isGitRepo(workingDirectory) && await hasRemoteOrigin(workingDirectory)) {
        try {
          worktreeSetup = await createServerWorktree({
            repoPath: workingDirectory,
            taskId: executionId,
            nodeId,
          })
          if (worktreeSetup) {
            effectiveWorkDir = worktreeSetup.worktreePath
            console.log(`[dispatch] Created worktree for ${executionId}: ${worktreeSetup.worktreePath} (branch: ${worktreeSetup.branchName})`)
          }
        } catch (wtErr) {
          console.warn(`[dispatch] Worktree creation failed, using repo directly: ${errorMessage(wtErr)}`)
        }
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

      if (effectiveWorkDir) {
        promptParts.push(`## Working Directory\n\n${effectiveWorkDir}`)
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
          workingDirectory: effectiveWorkDir,
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
          machineId: 'local',
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
            executionEventBus.emit('task:stdout', {
              output: { taskId: executionId, data: event.text, stream: 'stdout', timestamp: new Date() },
            })
            break

          case 'tool_use':
            await stream.writeSSE({
              event: 'tool_use',
              data: JSON.stringify({
                toolName: event.toolName,
                toolInput: event.toolInput,
              }),
            })
            executionEventBus.emit('task:tool_trace', {
              taskId: executionId,
              toolName: event.toolName,
              toolInput: event.toolInput,
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
                    ? event.result.slice(0, 100000)
                    : event.result,
              }),
            })
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
            await stream.writeSSE({
              event: 'file_change',
              data: JSON.stringify(event.change),
            })
            executionEventBus.emit('task:file_change', {
              taskId: executionId,
              ...event.change,
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
            executionEventBus.emit('task:progress', {
              taskId: executionId,
              progress: event.percentage,
              message: event.message,
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

            // Attempt PR creation if worktree was used and execution succeeded
            let branchName: string | undefined
            let prUrl: string | undefined
            let prNumber: number | undefined

            if (worktreeSetup && isSuccess) {
              try {
                const baseBranch = await getDefaultBranch(workingDirectory!)
                const hasCommits = await hasBranchCommits(worktreeSetup.worktreePath, baseBranch)
                if (hasCommits) {
                  const prResult = await pushAndCreatePR({
                    worktreePath: worktreeSetup.worktreePath,
                    branchName: worktreeSetup.branchName,
                    baseBranch,
                    title,
                    body: `## Task\n\n${description}\n\n---\n*Created by Nexus task automation*`,
                  })
                  branchName = prResult.branchName
                  prUrl = prResult.prUrl
                  prNumber = prResult.prNumber
                  keepBranch = true
                  console.log(`[dispatch] PR result for ${executionId}: branch=${branchName}, prUrl=${prUrl || 'none'}`)
                }
              } catch (prErr) {
                console.warn(`[dispatch] PR creation failed for ${executionId}: ${errorMessage(prErr)}`)
              }
            } else if (worktreeSetup) {
              branchName = worktreeSetup.branchName
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
                branchName,
                prUrl,
                prNumber,
              }),
            })
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
      if (isAbortError(e)) {
        await stream.writeSSE({
          event: 'aborted',
          data: JSON.stringify({ reason: 'User cancelled' }),
        })
      } else {
        const message = errorMessage(e)
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: message }),
        })
      }
    } finally {
      removeSession(executionId)
      // Clean up worktree
      if (worktreeSetup) {
        try {
          await worktreeSetup.cleanup({ keepBranch })
        } catch (cleanupErr) {
          console.warn(`[dispatch] Worktree cleanup failed: ${errorMessage(cleanupErr)}`)
        }
      }
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
    workingDirectory?: string
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
    workingDirectory,
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
    workingDirectory,
  }

  // Stream relay events for this execution back to the client
  // IMPORTANT: Register event listeners BEFORE dispatching to avoid race conditions
  // where fast-failing tasks send results before listeners are set up.
  return streamSSE(c, async (stream) => {
    let alive = true
    let lastActivity = Date.now()
    const ACTIVITY_TIMEOUT_MS = 300_000

    // Subscribe to relay events filtered by this executionId BEFORE dispatching
    const onResult = (msg: import('../types/relay.js').TaskResultMessage) => {
      if (!alive || msg.result.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
          executionId,
          nodeId,
          status: msg.result.status === 'completed' ? 'success' : 'failure',
          output: msg.result.output,
          error: msg.result.error,
          duration: msg.result.duration,
          branchName: msg.result.branchName,
          prUrl: msg.result.prUrl,
          prNumber: msg.result.prNumber,
        }),
      }).catch(() => { alive = false })
      // Task is done, close stream after sending result
      stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      alive = false
    }

    const onStdout = (msg: import('../types/relay.js').TaskStdoutMessage) => {
      if (!alive || msg.output.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({ event: 'text', data: msg.output.data }).catch(() => { alive = false })
    }

    const onText = (msg: import('../types/relay.js').TaskTextMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
    }

    const onSessionInit = (msg: import('../types/relay.js').TaskSessionInitMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'session_init',
        data: JSON.stringify({ sessionId: msg.sessionId, model: msg.model }),
      }).catch(() => { alive = false })
    }

    const onProgress = (msg: import('../types/relay.js').TaskProgressMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'progress',
        data: JSON.stringify({ message: msg.message, percentage: msg.progress }),
      }).catch(() => { alive = false })
    }

    const onToolTrace = (msg: import('../types/relay.js').TaskToolTraceMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
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
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'file_change',
        data: JSON.stringify({ path: msg.path, action: msg.action, linesAdded: msg.linesAdded, linesRemoved: msg.linesRemoved }),
      }).catch(() => { alive = false })
    }

    // Listen for machine disconnect during streaming
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
    relayServer.on('task:stdout', onStdout)
    relayServer.on('task:text', onText)
    relayServer.on('task:session_init', onSessionInit)
    relayServer.on('task:progress', onProgress)
    relayServer.on('task:tool_trace', onToolTrace)
    relayServer.on('task:file_change', onFileChange)
    relayServer.on('machine:disconnected', onMachineDisconnected)

    // Now dispatch the task (after listeners are registered to avoid race conditions)
    const dispatched = relayServer.dispatchTask(taskDispatch, machineId)

    if (!dispatched) {
      // Clean up listeners
      relayServer.off('task:result', onResult)
      relayServer.off('task:stdout', onStdout)
      relayServer.off('task:text', onText)
      relayServer.off('task:session_init', onSessionInit)
      relayServer.off('task:progress', onProgress)
      relayServer.off('task:tool_trace', onToolTrace)
      relayServer.off('task:file_change', onFileChange)
      relayServer.off('machine:disconnected', onMachineDisconnected)
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: `Failed to dispatch to machine: ${machineId}` }),
      })
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) })
      return
    }

    // Send init event after successful dispatch
    await stream.writeSSE({
      event: 'init',
      data: JSON.stringify({ executionId, nodeId, machineId }),
    })

    // Keepalive + activity timeout check
    const heartbeat = setInterval(() => {
      if (!alive) { clearInterval(heartbeat); return }
      // Check for inactivity timeout
      if (Date.now() - lastActivity > ACTIVITY_TIMEOUT_MS) {
        console.log(`[dispatch] Activity timeout for task ${executionId} on machine ${machineId}`)
        stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'Remote machine stopped responding (activity timeout)', recoverable: false }),
        }).catch(() => {})
        stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
        alive = false
        clearInterval(heartbeat)
        return
      }
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
      relayServer.off('task:text', onText)
      relayServer.off('task:session_init', onSessionInit)
      relayServer.off('task:progress', onProgress)
      relayServer.off('task:tool_trace', onToolTrace)
      relayServer.off('task:file_change', onFileChange)
      relayServer.off('machine:disconnected', onMachineDisconnected)
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

  // Local dispatch steering
  if (machineId === 'local') {
    const { steerLocalTask } = await import('../lib/providers/adapters/claude-code.js')
    const injected = await steerLocalTask(taskId, message, interrupt ?? false)
    if (!injected) {
      return c.json({ success: false, error: 'No active local query for this task' }, 404)
    }
    executionEventBus.emit('task:steer_ack', { taskId, accepted: true, interrupted: interrupt ?? false, message: 'Steering message injected' })
    return c.json({ success: true, taskId, machineId })
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
