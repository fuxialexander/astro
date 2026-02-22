/**
 * Dispatch Routes
 *
 * HTTP API endpoints for the task execution dispatch framework.
 * Provides orchestration control, status queries, and manual operations.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
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
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { errorMessage, isAbortError } from '../lib/error-utils.js'
import { isServerMode } from '../lib/app-mode.js'
import { astroEventTransport } from '../lib/events/astro-event-transport.js'
import type { TaskStartedEvent, TaskCompletedEvent as AstroTaskCompletedEvent, TaskFailedEvent } from '../lib/events/types.js'
import {
  createServerWorktree,
  getDefaultBranch,
  hasBranchCommits,
  pushAndCreatePR,
  autoCommitChanges,
  isGitRepo,
  hasRemoteOrigin,
  findWorktreeOnDisk,
  type ServerWorktreeSetup,
} from '../lib/worktree-manager.js'
import { worktreeRegistry } from '../lib/worktree-registry.js'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, relative } from 'node:path'
import { homedir } from 'node:os'
import { classifyTask } from '../lib/dispatch/procedure-classifier.js'
import { getProcedure, type ProcedureState } from '../lib/dispatch/procedure-types.js'

// Validation schemas
const dispatchTaskSchema = z.object({
  nodeId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
  title: z.string().min(1).max(1000),
  description: z.string().min(1).max(50000),
  dependencies: z.array(z.string().max(100)).max(100).optional(),
  environment: z.enum(['local', 'remote', 'hpc', 'cloud']).optional(),
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
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  procedure: z.string().max(100).optional(),
  computeBackend: z.string().max(100).optional(),
})

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
    environment = 'local',
    verification = 'auto',
    visionDoc,
    dependencyOutputs = [],
    priority = 'normal',
    preferredProvider,
    targetMachineId,
    model,
    maxTurns = 100,
    workingDirectory,
    force = false,
    dryRun = false,
    procedure: requestedProcedure,
    computeBackend,
  } = body

  // Validate working directory
  if (!workingDirectory) {
    return c.json(
      { success: false, error: 'No working directory or repository configured' },
      400
    )
  }

  // Validate working directory path (prevent path traversal)
  // Only validate local paths for local execution — relay dispatch runs on a remote machine
  const isRelayDispatch = environment !== 'local' || !!targetMachineId
  if (!isRelayDispatch && !workingDirectory.startsWith('http://') && !workingDirectory.startsWith('https://') && !workingDirectory.startsWith('git@')) {
    // Local path validation: check for ".." and ensure it's within an allowed base
    const allowedBase = resolve(homedir(), '.astro')
    const requestedPath = resolve(workingDirectory)
    const rel = relative(allowedBase, requestedPath)

    // If path is outside allowed base or contains "..", reject
    if (rel.startsWith('..') || resolve(workingDirectory).includes('..')) {
      return c.json(
        { success: false, error: 'Invalid working directory path (path traversal not allowed)' },
        400
      )
    }
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
  // In server mode, always use relay — the server has no AI providers.
  // In local mode, use relay only for remote environments or explicit machine targeting.
  const useRelay = isServerMode() || environment !== 'local' || targetMachineId

  console.log(`[dispatch] ${executionId}: ${useRelay ? 'relay' : 'local'} dispatch, workingDirectory=${workingDirectory}`)

  if (useRelay) {
    // Relay dispatch: pass raw workingDirectory — agent-runner handles resolution
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
      computeBackend,
    })
  }

  // Local dispatch: resolve working directory (clone repo if needed)
  let resolvedDir = workingDirectory
  try {
    resolvedDir = resolveWorkingDirectory(workingDirectory, projectId)
    if (resolvedDir !== workingDirectory) {
      console.log(`[dispatch] ${executionId}: resolved git URL to ${resolvedDir}`)
    }
  } catch (e) {
    const msg = errorMessage(e)
    console.error(`[dispatch] ${executionId}: resolveWorkingDirectory failed: ${msg}`)
    return c.json(
      { success: false, error: `Failed to resolve working directory: ${msg}` },
      500
    )
  }

  // Auto-classify task to determine procedure pipeline
  let procedureState: ProcedureState | undefined
  const procedureName = requestedProcedure ?? (
    await classifyTask(title, description).then((r) => r.procedure)
  )

  if (procedureName) {
    const procedure = getProcedure(procedureName)
    if (procedure) {
      procedureState = {
        procedureName,
        currentSubroutineIndex: 0,
        subroutineHistory: [],
        procedure,
      }
      console.log(`[dispatch] Task ${nodeId} classified as '${procedureName}' (${procedure.subroutines.length} subroutines)`)
    }
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
    procedureState,
  })
})

/**
 * Resolve a working directory value. If it looks like a git URL, clone to
 * ~/.astro/repos/{projectId}/ and return the local path. Otherwise return as-is.
 *
 * SECURITY: Uses execFileSync to prevent command injection in git operations.
 */
function resolveWorkingDirectory(value: string, projectId: string): string {
  const isGitUrl = value.startsWith('http://') || value.startsWith('https://') || value.startsWith('git@')
  if (!isGitUrl) return value

  // Validate projectId format to prevent path traversal (HIGH-004)
  if (!/^[a-zA-Z0-9-_]+$/.test(projectId)) {
    throw new Error('Invalid projectId format')
  }

  const repoDir = join(homedir(), '.astro', 'repos', projectId)
  if (existsSync(join(repoDir, '.git'))) {
    // Already cloned — fetch latest (HIGH-004: use execFileSync + disable hooks)
    try {
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'fetch', '--all'], {
        cwd: repoDir,
        stdio: 'ignore',
        timeout: 30_000,
      })
    } catch {
      console.warn(`[dispatch] git fetch failed for ${repoDir} (non-fatal)`)
    }
  } else {
    // Clone the repo (CRITICAL-004: use execFileSync to prevent injection)
    execFileSync('git', ['clone', value, repoDir], {
      stdio: 'ignore',
      timeout: 120_000,
    })
    console.log(`[dispatch] Cloned ${value} to ${repoDir}`)
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
    procedureState?: ProcedureState
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
    procedureState,
  } = params

  const abortController = createSession(executionId, preferredProvider as string)

  return streamSSE(c, async (stream) => {
    let worktreeSetup: ServerWorktreeSetup | null = null

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
      if (workingDirectory) {
        const gitRepoCheck = await isGitRepo(workingDirectory)
        if (gitRepoCheck) {
          const remoteOriginCheck = await hasRemoteOrigin(workingDirectory)
          if (remoteOriginCheck) {
            try {
              worktreeSetup = await createServerWorktree({
                repoPath: workingDirectory,
                taskId: executionId,
                nodeId,
              })
              effectiveWorkDir = worktreeSetup.worktreePath
              // Register worktree for post-execution persistence
              worktreeRegistry.register({
                executionId,
                nodeId,
                projectId,
                worktreePath: worktreeSetup.worktreePath,
                branchName: worktreeSetup.branchName,
                repoPath: workingDirectory!,
                cleanup: worktreeSetup.cleanup,
                createdAt: new Date(),
              })
              console.log(`[dispatch] ${executionId}: worktree created at ${worktreeSetup.worktreePath} (branch: ${worktreeSetup.branchName})`)
            } catch (wtErr) {
              const wtErrMsg = errorMessage(wtErr)
              console.error(`[dispatch] ${executionId}: worktree creation failed: ${wtErrMsg}`)
              await stream.writeSSE({
                event: 'error',
                data: JSON.stringify({
                  error: 'Worktree creation failed',
                  message: `Failed to create isolated worktree for task execution. The task will NOT run in the project directory to prevent contamination. Error: ${wtErrMsg}`,
                }),
              })
              return
            }
          } else {
            console.warn(`[dispatch] ${executionId}: skipping worktree (no remote origin)`)
          }
        } else {
          console.warn(`[dispatch] ${executionId}: skipping worktree (not a git repo)`)
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

The user can review your reasoning in the task output and provide guidance if they disagree with your choice.

**Example:**
"I need to choose a state management solution. Options: (1) Zustand - lightweight, already in project, (2) Redux Toolkit - more structured, better DevTools, (3) React Context - native, no deps. I recommend Zustand since it's already used in the project and matches the codebase style. Proceeding with Zustand unless you'd like a different approach."`)

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
          approvalCallback: dispatchEngine.requestDynamicApproval.bind(dispatchEngine),
        },
        abortController,
      }

      console.log(`[dispatch] ${executionId}: executing with ${provider.id}, cwd=${effectiveWorkDir}`)

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

      // Helper: stream a single provider execution, collecting output and forwarding SSE events
      async function streamProviderExecution(
        providerTask: TaskDispatch,
      ): Promise<{ fullOutput: string; sessionId?: string; resultStatus: string; metrics?: Record<string, unknown>; verification?: Record<string, unknown> }> {
        let subroutineOutput = ''
        let resultSessionId: string | undefined
        let resultStatus = 'success'
        let resultMetrics: Record<string, unknown> | undefined
        let resultVerification: Record<string, unknown> | undefined

        for await (const event of provider.stream(providerTask)) {
          switch (event.type) {
            case 'init':
              resultSessionId = event.sessionId
              if (worktreeSetup && event.sessionId) {
                worktreeRegistry.updateSessionId(executionId, event.sessionId)
              }
              await stream.writeSSE({
                event: 'session_init',
                data: JSON.stringify({ sessionId: event.sessionId, model: event.model }),
              })
              executionEventBus.emit('task:session_init', {
                taskId: executionId,
                sessionId: event.sessionId,
                model: event.model,
              })
              break
            case 'text':
              subroutineOutput += event.text
              await stream.writeSSE({ event: 'text', data: event.text })
              executionEventBus.emit('task:stdout', {
                output: { taskId: executionId, data: event.text, stream: 'stdout', timestamp: new Date() },
              })
              break
            case 'tool_use':
              await stream.writeSSE({
                event: 'tool_use',
                data: JSON.stringify({ toolName: event.toolName, toolInput: event.toolInput, toolUseId: event.toolUseId }),
              })
              executionEventBus.emit('task:tool_trace', {
                taskId: executionId, toolName: event.toolName, toolInput: event.toolInput, toolUseId: event.toolUseId,
              })
              break
            case 'tool_result':
              await stream.writeSSE({
                event: 'tool_result',
                data: JSON.stringify({
                  toolName: event.toolName,
                  success: event.success,
                  result: typeof event.result === 'string' ? event.result.slice(0, 100000) : event.result,
                  toolUseId: event.toolUseId,
                }),
              })
              executionEventBus.emit('task:tool_trace', {
                taskId: executionId,
                toolName: event.toolName,
                toolResult: typeof event.result === 'string' ? event.result.slice(0, 100000) : event.result,
                success: event.success,
                toolUseId: event.toolUseId,
              })
              break
            case 'file_change':
              await stream.writeSSE({ event: 'file_change', data: JSON.stringify(event.change) })
              executionEventBus.emit('task:file_change', { taskId: executionId, ...event.change })
              break
            case 'progress':
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({ message: event.message, percentage: event.percentage }),
              })
              executionEventBus.emit('task:progress', {
                taskId: executionId, progress: event.percentage, message: event.message,
              })
              break
            case 'result':
              resultStatus = event.result.status
              resultMetrics = event.result.metrics as Record<string, unknown> | undefined
              resultVerification = event.result.verification as Record<string, unknown> | undefined
              resultSessionId = event.result.sessionId ?? resultSessionId
              break
            case 'error':
              await stream.writeSSE({
                event: 'error',
                data: JSON.stringify({ error: event.error, recoverable: event.recoverable }),
              })
              break
            case 'aborted':
              await stream.writeSSE({
                event: 'aborted',
                data: JSON.stringify({ reason: event.reason }),
              })
              break
          }
        }

        return { fullOutput: subroutineOutput, sessionId: resultSessionId, resultStatus, metrics: resultMetrics, verification: resultVerification }
      }

      // Stream execution — procedure pipeline or direct
      let fullOutput = ''
      let sessionId: string | undefined
      let lastResultStatus = 'success'
      let lastMetrics: Record<string, unknown> | undefined
      let lastVerification: Record<string, unknown> | undefined

      if (procedureState) {
        // === Procedure pipeline: run subroutines in sequence ===
        const procedure = procedureState.procedure
        const subroutines = procedure.subroutines

        for (let i = 0; i < subroutines.length; i++) {
          const sub = subroutines[i]

          // Emit subroutine_progress event
          await stream.writeSSE({
            event: 'subroutine_progress',
            data: JSON.stringify({
              name: sub.name,
              index: i,
              total: subroutines.length,
              status: 'running',
            }),
          })

          // Build subroutine prompt using interpolation
          const { interpolatePrompt } = await import('../lib/dispatch/procedure-executor.js')
          const subPrompt = interpolatePrompt(sub.promptTemplate, {
            id: nodeId,
            title,
            description,
            projectId,
            status: 'in_progress',
            type: 'task',
            parentId: null,
            dependencies: [],
            verification: 'auto',
            position: { x: 0, y: 0 },
            createdAt: new Date(),
            updatedAt: new Date(),
          } as import('../../src/types/index.js').PlanNode, procedureState)

          // Build provider task, threading sessionId for resume
          const subTask: TaskDispatch = {
            taskId: executionId,
            type: 'code_generation',
            prompt: subPrompt,
            model,
            maxTurns: sub.singleTurn ? 1 : maxTurns,
            context: {
              projectId,
              visionDoc,
              workingDirectory: effectiveWorkDir,
              approvalCallback: dispatchEngine.requestDynamicApproval.bind(dispatchEngine),
              ...(sub.disallowAllTools ? { allowedTools: [] } : {}),
              ...(sub.disallowedTools ? { disallowedTools: sub.disallowedTools } : {}),
            },
            abortController,
            // Resume from previous session if available
            ...(sessionId ? { sessionId } : {}),
          }

          const result = await streamProviderExecution(subTask)
          fullOutput += result.fullOutput
          sessionId = result.sessionId ?? sessionId
          lastResultStatus = result.resultStatus
          lastMetrics = result.metrics
          lastVerification = result.verification

          // Store in subroutine history
          procedureState.subroutineHistory.push({
            subroutine: sub.name,
            completedAt: new Date(),
            sessionId: result.sessionId ?? null,
            result: result.fullOutput,
          })

          // Emit subroutine completed
          await stream.writeSSE({
            event: 'subroutine_progress',
            data: JSON.stringify({
              name: sub.name,
              index: i,
              total: subroutines.length,
              status: result.resultStatus === 'success' ? 'completed' : 'failed',
            }),
          })

          // If subroutine failed, stop the pipeline
          if (result.resultStatus !== 'success') {
            console.log(`[dispatch] Subroutine '${sub.name}' failed, stopping pipeline`)
            break
          }
        }
      } else {
        // === Direct execution (no procedure) ===
        const result = await streamProviderExecution(task)
        fullOutput = result.fullOutput
        sessionId = result.sessionId
        lastResultStatus = result.resultStatus
        lastMetrics = result.metrics
        lastVerification = result.verification
      }

      // Determine final status based on result and verification type
      const isSuccess = lastResultStatus === 'success'
      let finalStatus: string

      if (isSuccess) {
        finalStatus = verification === 'auto' ? 'auto_verified' : 'awaiting_judgment'
      } else {
        finalStatus = 'awaiting_judgment'
      }

      // Attempt PR creation if worktree was used and execution succeeded
      // (Skip if procedure already handled git-commit/gh-pr subroutines)
      let branchName: string | undefined
      let prUrl: string | undefined
      let prNumber: number | undefined

      if (worktreeSetup && isSuccess && !procedureState) {
        try {
          const baseBranch = await getDefaultBranch(workingDirectory!)
          await autoCommitChanges(worktreeSetup.worktreePath, title)
          const hasCommits = await hasBranchCommits(worktreeSetup.worktreePath, baseBranch)
          if (hasCommits) {
            const prResult = await pushAndCreatePR({
              worktreePath: worktreeSetup.worktreePath,
              branchName: worktreeSetup.branchName,
              baseBranch,
              title,
              body: `## Task\n\n${description}\n\n---\n*Created by Astro task automation*`,
            })
            branchName = prResult.branchName
            prUrl = prResult.prUrl
            prNumber = prResult.prNumber
            console.log(`[dispatch] PR result for ${executionId}: branch=${branchName}, prUrl=${prUrl || 'none'}`)
          } else {
            console.log(`[dispatch] No commits for ${executionId}, skipping PR creation`)
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
          status: lastResultStatus,
          finalStatus,
          output: fullOutput,
          metrics: lastMetrics,
          verification: lastVerification,
          sessionId,
          branchName,
          prUrl,
          prNumber,
        }),
      })
      executionEventBus.emit('task:result', {
        result: {
          taskId: executionId,
          status: isSuccess ? 'completed' : 'failed',
          output: fullOutput,
          duration: (lastMetrics as Record<string, unknown> | undefined)?.durationMs as number | undefined,
        },
      })

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
      // Worktree is intentionally NOT cleaned up here.
      // It persists until the task is explicitly completed/pruned,
      // enabling post-execution steering (resume sessions).
      // Cleanup is triggered via POST /api/dispatch/cleanup.
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
    computeBackend?: string
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
    computeBackend,
  } = params

  // Extract user for ownership verification
  const user = c.get('user') as AuthUser | undefined

  // Find target machine
  let machineId = targetMachineId
  if (!machineId) {
    const bestMachine = machineRegistry.findBestMachine(environment, preferredProvider, user?.id)
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
  } else {
    // Verify ownership of explicitly targeted machine
    const targetMachine = machineRegistry.get(machineId)
    if (targetMachine?.userId && targetMachine.userId !== 'dev-user' && user?.id && targetMachine.userId !== user.id) {
      return c.json(
        { success: false, error: `Machine ${machineId} not found or not authorized` },
        403
      )
    }
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
    executionStrategy: computeBackend,
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
      const isSuccess = msg.result.status === 'completed'
      stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
          executionId,
          nodeId,
          status: isSuccess ? 'success' : 'failure',
          output: msg.result.output,
          error: msg.result.error,
          duration: msg.result.duration,
          branchName: msg.result.branchName,
          prUrl: msg.result.prUrl,
          prNumber: msg.result.prNumber,
        }),
      }).catch(() => { alive = false })

      // Bridge to astroEventTransport for observability (observation collector, audit log, usage metrics)
      const nodeStub = { id: nodeId, title, description } as import('../../src/types/index.js').PlanNode
      if (isSuccess) {
        astroEventTransport.emitEvent({
          type: 'task.completed',
          taskId: executionId,
          nodeId,
          projectId,
          executionId,
          result: {
            taskId: executionId,
            status: 'completed',
            stdout: typeof msg.result.output === 'string' ? msg.result.output : undefined,
            metrics: {
              durationMs: msg.result.duration,
              ...(msg.result.metadata as Record<string, unknown> | undefined),
            },
          } as import('../lib/providers/types.js').TaskResult,
          node: nodeStub,
          timestamp: new Date(),
        } satisfies AstroTaskCompletedEvent).catch((err) => {
          console.error('[dispatch-relay] Failed to emit task.completed:', err)
        })
      } else {
        astroEventTransport.emitEvent({
          type: 'task.failed',
          taskId: executionId,
          nodeId,
          projectId,
          executionId,
          error: msg.result.error || 'Task failed',
          node: nodeStub,
          timestamp: new Date(),
        } satisfies TaskFailedEvent).catch((err) => {
          console.error('[dispatch-relay] Failed to emit task.failed:', err)
        })
      }

      // Task is done, close stream after sending result
      stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      alive = false
    }

    // Note: We only listen to task:text, not task:stdout, to avoid duplicates.
    // The relay server emits both events, but task:text is the formatted agent output.
    const onText = (msg: import('../types/relay.js').TaskTextMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
      // Bridge to executionEventBus for observability
      executionEventBus.emit('task:stdout', {
        output: { taskId: executionId, data: msg.text, stream: 'stdout', timestamp: new Date() },
      })
    }

    const onSessionInit = (msg: import('../types/relay.js').TaskSessionInitMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'session_init',
        data: JSON.stringify({ sessionId: msg.sessionId, model: msg.model }),
      }).catch(() => { alive = false })
      // Bridge to executionEventBus for observability
      executionEventBus.emit('task:session_init', {
        taskId: executionId,
        sessionId: msg.sessionId,
        model: msg.model || 'unknown',
      })
    }

    const onProgress = (msg: import('../types/relay.js').TaskProgressMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'progress',
        data: JSON.stringify({ message: msg.message, percentage: msg.progress }),
      }).catch(() => { alive = false })
      // Bridge to executionEventBus for observability
      executionEventBus.emit('task:progress', {
        taskId: executionId,
        progress: msg.progress,
        message: msg.message || '',
      })
    }

    const onToolTrace = (msg: import('../types/relay.js').TaskToolTraceMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'tool_use',
        data: JSON.stringify({ toolName: msg.toolName, toolInput: msg.toolInput }),
      }).catch(() => { alive = false })
      // Bridge tool_use to executionEventBus for observability
      executionEventBus.emit('task:tool_trace', {
        taskId: executionId,
        toolName: msg.toolName,
        toolInput: msg.toolInput,
      })
      if (msg.toolResult !== undefined) {
        stream.writeSSE({
          event: 'tool_result',
          data: JSON.stringify({ toolName: msg.toolName, success: msg.success, result: msg.toolResult }),
        }).catch(() => { alive = false })
        // Bridge tool_result to executionEventBus for observability
        executionEventBus.emit('task:tool_trace', {
          taskId: executionId,
          toolName: msg.toolName,
          toolResult: typeof msg.toolResult === 'string' ? msg.toolResult.slice(0, 100000) : msg.toolResult,
          success: msg.success ?? true,
        })
      }
    }

    const onFileChange = (msg: import('../types/relay.js').TaskFileChangeMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'file_change',
        data: JSON.stringify({ path: msg.path, action: msg.action, linesAdded: msg.linesAdded, linesRemoved: msg.linesRemoved }),
      }).catch(() => { alive = false })
      // Bridge to executionEventBus for observability
      executionEventBus.emit('task:file_change', {
        taskId: executionId,
        path: msg.path,
        action: msg.action,
      })
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
      // Bridge disconnect as task.failed for observability
      astroEventTransport.emitEvent({
        type: 'task.failed',
        taskId: executionId,
        nodeId,
        projectId,
        executionId,
        error: 'Remote machine disconnected during task execution',
        node: { id: nodeId, title, description } as import('../../src/types/index.js').PlanNode,
        timestamp: new Date(),
      } satisfies TaskFailedEvent).catch((err) => {
        console.error('[dispatch-relay] Failed to emit task.failed on disconnect:', err)
      })
      alive = false
    }

    relayServer.on('task:result', onResult)
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

    // Send init event after successful dispatch (include provider/backend info)
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

    // Emit task.started to astroEventTransport so observability hooks (observation collector,
    // audit log, usage metrics, etc.) are notified. Without this, the relay dispatch path
    // is invisible to the observability system.
    await astroEventTransport.emitEvent({
      type: 'task.started',
      taskId: executionId,
      nodeId,
      projectId,
      executionId,
      timestamp: new Date(),
      node: { id: nodeId, title, description } as import('../../src/types/index.js').PlanNode,
    } satisfies TaskStartedEvent)

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
  const { taskId, machineId, message, action, interrupt, sessionId: requestSessionId } = await c.req.json<{
    taskId: string
    machineId: string
    message: string
    action?: 'guidance' | 'redirect' | 'pause' | 'resume'
    interrupt?: boolean
    sessionId?: string
    branchName?: string
  }>()

  if (!taskId || !machineId || !message) {
    return c.json({ success: false, error: 'taskId, machineId, and message are required' }, 400)
  }

  // Local dispatch steering
  if (machineId === 'local') {
    const { steerLocalTask, resumeLocalTask, getLocalTaskContext } = await import('../lib/providers/adapters/claude-code.js')
    const result = await steerLocalTask(taskId, message, interrupt ?? false)

    if (result === 'injected') {
      // Active session — message injected inline
      executionEventBus.emit('task:steer_ack', { taskId, accepted: true, interrupted: interrupt ?? false, message: 'Steering message injected' })
      return c.json({ success: true, taskId, machineId })
    }

    if (result === 'completed') {
      // Execution finished but context preserved — try to resume session
      const context = getLocalTaskContext(taskId)
      // Also try worktree registry for workingDirectory
      const worktreeEntry = worktreeRegistry.get(taskId)
        ?? worktreeRegistry.getByNodeId(taskId)

      const workingDirectory = context?.workingDirectory
        ?? worktreeEntry?.worktreePath
      const sessionId = context?.sessionId
        ?? worktreeEntry?.sessionId

      if (!workingDirectory || !sessionId) {
        return c.json({ success: false, error: 'Session context lost — cannot resume' }, 404)
      }

      // Stream resumed session as SSE
      return streamSSE(c, async (stream) => {
        try {
          await stream.writeSSE({
            event: 'resumed',
            data: JSON.stringify({ taskId, sessionId, workingDirectory }),
          })

          for await (const event of resumeLocalTask(taskId, message, workingDirectory, sessionId)) {
            switch (event.type) {
              case 'init':
                await stream.writeSSE({
                  event: 'session_init',
                  data: JSON.stringify({ sessionId: event.sessionId, model: event.model }),
                })
                // Update worktree registry with new session ID
                if (worktreeEntry && event.sessionId) {
                  worktreeRegistry.updateSessionId(worktreeEntry.executionId, event.sessionId)
                }
                break
              case 'text':
                await stream.writeSSE({ event: 'text', data: event.text })
                executionEventBus.emit('task:stdout', {
                  output: { taskId, data: event.text, stream: 'stdout', timestamp: new Date() },
                })
                break
              case 'tool_use':
                await stream.writeSSE({
                  event: 'tool_use',
                  data: JSON.stringify({ toolName: event.toolName, toolInput: event.toolInput }),
                })
                break
              case 'tool_result':
                await stream.writeSSE({
                  event: 'tool_result',
                  data: JSON.stringify({ toolName: event.toolName, success: event.success, result: event.result }),
                })
                break
              case 'result':
                await stream.writeSSE({
                  event: 'result',
                  data: JSON.stringify({
                    executionId: taskId,
                    status: event.result.status,
                    metrics: event.result.metrics,
                    sessionId: event.result.sessionId,
                  }),
                })
                break
              case 'error':
                await stream.writeSSE({
                  event: 'error',
                  data: JSON.stringify({ error: event.error }),
                })
                break
              case 'aborted':
                await stream.writeSSE({
                  event: 'aborted',
                  data: JSON.stringify({ reason: event.reason }),
                })
                break
            }
          }

          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({ executionId: taskId }),
          })
        } catch (e) {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ error: errorMessage(e) }),
          })
        }
      })
    }

    // No in-memory context — try to recover from disk using client-provided hints
    if (requestSessionId) {
      const workingDirectory = await findWorktreeOnDisk(taskId)
      if (workingDirectory) {
        console.log(`[dispatch] Recovering session for ${taskId}: worktree=${workingDirectory}, sessionId=${requestSessionId}`)

        return streamSSE(c, async (stream) => {
          try {
            await stream.writeSSE({
              event: 'resumed',
              data: JSON.stringify({ taskId, sessionId: requestSessionId, workingDirectory }),
            })

            for await (const event of resumeLocalTask(taskId, message, workingDirectory, requestSessionId)) {
              switch (event.type) {
                case 'init':
                  await stream.writeSSE({
                    event: 'session_init',
                    data: JSON.stringify({ sessionId: event.sessionId, model: event.model }),
                  })
                  break
                case 'text':
                  await stream.writeSSE({ event: 'text', data: event.text })
                  executionEventBus.emit('task:stdout', {
                    output: { taskId, data: event.text, stream: 'stdout', timestamp: new Date() },
                  })
                  break
                case 'tool_use':
                  await stream.writeSSE({
                    event: 'tool_use',
                    data: JSON.stringify({ toolName: event.toolName, toolInput: event.toolInput }),
                  })
                  break
                case 'tool_result':
                  await stream.writeSSE({
                    event: 'tool_result',
                    data: JSON.stringify({ toolName: event.toolName, success: event.success, result: event.result }),
                  })
                  break
                case 'result':
                  await stream.writeSSE({
                    event: 'result',
                    data: JSON.stringify({
                      executionId: taskId,
                      status: event.result.status,
                      metrics: event.result.metrics,
                      sessionId: event.result.sessionId,
                    }),
                  })
                  break
                case 'error':
                  await stream.writeSSE({
                    event: 'error',
                    data: JSON.stringify({ error: event.error }),
                  })
                  break
                case 'aborted':
                  await stream.writeSSE({
                    event: 'aborted',
                    data: JSON.stringify({ reason: event.reason }),
                  })
                  break
              }
            }

            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({ executionId: taskId }),
            })
          } catch (e) {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({ error: errorMessage(e) }),
            })
          }
        })
      }
    }

    // No context at all — neither in-memory nor on disk
    return c.json({ success: false, error: 'No active local query for this task' }, 404)
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
 *
 * POST /api/dispatch/approval
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
 * Respond to approval request
 *
 * POST /api/dispatch/approve
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
 *
 * POST /api/dispatch/request-dynamic-approval
 *
 * This endpoint is called by the Astro MCP server when the agent uses
 * the ask_user_question tool. It blocks until the user responds.
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
    // This blocks until user responds or timeout (5 minutes)
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

/**
 * Reset a task for re-execution
 *
 * POST /api/dispatch/reset
 *
 * Cancels any in-progress execution, removes worktree AND branch,
 * and cleans up preserved session context so the task can be dispatched fresh.
 */
dispatchRoute.post('/reset', async (c) => {
  const { nodeId } = await c.req.json<{ nodeId?: string }>()

  if (!nodeId) {
    return c.json({ success: false, error: 'nodeId required' }, 400)
  }

  // Find worktree entry by nodeId
  const entry = worktreeRegistry.getByNodeId(nodeId)

  // Cancel any in-progress execution
  if (entry) {
    abortSession(entry.executionId)
  }

  // Remove worktree AND delete the git branch (keepBranch=false)
  let removed = false
  if (entry) {
    removed = await worktreeRegistry.remove(entry.executionId, false)
  }

  // Clean up preserved session context
  if (entry) {
    const { cleanupLocalTaskContext } = await import('../lib/providers/adapters/claude-code.js')
    cleanupLocalTaskContext(entry.executionId)
  }

  return c.json({ success: true, removed })
})

/**
 * Clean up worktree for a completed/pruned task
 *
 * POST /api/dispatch/cleanup
 *
 * Called when a task transitions to completed or pruned.
 * Removes worktree from registry and cleans up on disk.
 */
dispatchRoute.post('/cleanup', async (c) => {
  const { executionId, nodeId } = await c.req.json<{
    executionId?: string
    nodeId?: string
  }>()

  if (!executionId && !nodeId) {
    return c.json({ success: false, error: 'executionId or nodeId required' }, 400)
  }

  // Clean up worktree
  let removed = false
  if (executionId) {
    removed = await worktreeRegistry.remove(executionId, true)
  }
  if (!removed && nodeId) {
    const entry = worktreeRegistry.getByNodeId(nodeId)
    if (entry) {
      removed = await worktreeRegistry.remove(entry.executionId, true)
    }
  }

  // Also clean up preserved session context
  if (executionId) {
    const { cleanupLocalTaskContext } = await import('../lib/providers/adapters/claude-code.js')
    cleanupLocalTaskContext(executionId)
  }

  return c.json({ success: true, removed })
})

export { dispatchRoute }
