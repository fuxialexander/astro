import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { buildChatSystemPrompt, buildTaskExecutionPrompt, buildTaskChatSystemPrompt, buildSummaryPrompt, buildTitleGenerationPrompt, buildRefinementPrompt, buildLabelSuggestionPrompt } from '../lib/prompt-templates.js'
import { skillManager } from '../lib/skill-manager.js'
import { relayServer } from '../lib/relay-server.js'
import { dispatchEngine } from '../lib/dispatch/index.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { machineRegistry } from '../lib/machine-registry.js'
import { streamingEventLog } from '../lib/streaming-event-log.js'
import { activeDispatchStreams } from '../lib/execution-context-store.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'
import type { TaskDispatch as RelayTaskDispatch, TaskResultMessage, TaskTextMessage, TaskToolTraceMessage, TaskFileChangeMessage, TaskSessionInitMessage } from '../types/relay.js'
import { db } from '../lib/db/index.js'
import { projects, environmentConfigs } from '../lib/db/schema.js'
import { eq, isNull, and, or, inArray } from 'drizzle-orm'

/** Verify the user has access to the given project (team-scoped). */
async function verifyProjectAccess(projectId: string, user: AuthUser): Promise<boolean> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(
    and(
      eq(projects.id, projectId),
      or(
        eq(projects.teamId, user.teamId),
        and(isNull(projects.teamId), eq(projects.ownerId, user.id))
      )
    )
  ).limit(1)
  return !!row
}

/** Scratch directory for text-only relay tasks (label suggestion, refine, etc.) */
const SCRATCH_DIR = join(homedir(), '.astro', 'tmp')
try { mkdirSync(SCRATCH_DIR, { recursive: true }) } catch { /* ignore */ }

/**
 * Load and aggregate environment context for multiple compute backends.
 * Queries environmentConfigs for each backend and returns sectioned markdown.
 */
async function loadEnvironmentContext(
  userId: string,
  backends: string[],
  machineId?: string
): Promise<string | undefined> {
  if (backends.length === 0) return undefined
  try {
    const machineFilter = machineId
      ? eq(environmentConfigs.machineId, machineId)
      : isNull(environmentConfigs.machineId)
    const rows = await db.select().from(environmentConfigs).where(
      and(
        eq(environmentConfigs.userId, userId),
        inArray(environmentConfigs.backendId, backends),
        machineFilter
      )
    )
    if (rows.length === 0) return undefined
    const sections = rows
      .filter((r: { customContext?: string }) => r.customContext?.trim())
      .map((r: { backendId: string; customContext: string }) => `### ${r.backendId} Environment\n${r.customContext}`)
    return sections.length > 0 ? sections.join('\n\n') : undefined
  } catch (err) {
    console.warn('[agent] Failed to load environment context:', err)
    return undefined
  }
}

// Validation schemas
const chatSchema = z.object({
  message: z.string().min(1).max(50000),
  sessionId: z.string().max(100).optional(),
  streamId: z.string().max(200).optional(),
  projectId: z.string().min(1).max(100),
  visionDoc: z.string().max(100000).optional(),
  model: z.string().max(100).optional(),
  providerId: z.string().max(100).optional(),
  planNodes: z.array(z.any()).max(1000).optional(),
  planEdges: z.array(z.any()).max(1000).optional(),
  selectedBackends: z.array(z.string().max(100)).max(20).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(50000),
  })).max(100).optional(),
})

/**
 * Stream a task via relay to an agent runner and bridge SSE back to the browser.
 * This is the only execution path — all AI work flows through the relay.
 */
async function streamChatViaRelay(
  c: Parameters<Parameters<Hono['post']>[1]>[0],
  opts: {
    taskId: string
    projectId: string
    nodeId: string
    prompt: string
    systemPrompt?: string
    maxTurns?: number
    type?: 'chat' | 'plan' | 'execution' | 'summarize'
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>
    workingDirectory?: string
    targetMachineId?: string
    model?: string
    resumeSessionId?: string
    streamId?: string
  }
) {
  // persistId: where streaming events are stored. Defaults to taskId (relay routing key),
  // but callers can supply a stable streamId so the frontend can find events after refresh.
  const persistId = opts.streamId || opts.taskId

  const task: RelayTaskDispatch = {
    taskId: opts.taskId,
    projectId: opts.projectId,
    nodeId: opts.nodeId,
    title: opts.type || 'chat',
    description: opts.prompt.slice(0, 200),
    prompt: opts.prompt,
    systemPrompt: opts.systemPrompt,
    type: opts.type,
    messages: opts.messages,
    model: opts.model,
    maxTurns: opts.maxTurns,
    workingDirectory: opts.workingDirectory,
    useWorktree: false,
    ...(opts.resumeSessionId && { resumeSessionId: opts.resumeSessionId }),
  }

  // Disable proxy buffering so SSE chunks flush immediately (Fly.io, nginx)
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let alive = true
    let lastActivity = Date.now()
    let providerSessionId: string | undefined  // Real Claude SDK session ID from session_init
    const ACTIVITY_TIMEOUT_MS = 5 * 24 * 60 * 60 * 1000 // 5 days

    const onText = (msg: TaskTextMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      streamingEventLog.appendText(persistId, msg.text)
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
      executionEventBus.emit('task:stdout', { output: { taskId: opts.taskId, data: msg.text, stream: 'stdout', timestamp: new Date() } })
    }

    const onResult = async (msg: TaskResultMessage) => {
      if (!alive || msg.result.taskId !== opts.taskId) return
      lastActivity = Date.now()
      const resolvedSessionId = providerSessionId || opts.taskId

      // Forward agent runner errors to client instead of silently sending 'done'
      if (msg.result.status === 'failed') {
        const errorMsg = msg.result.error || 'Agent runner task failed'
        console.error(`[chat] Task ${opts.taskId} failed: ${errorMsg}`)
        await streamingEventLog.append(persistId, 'result', { sessionId: resolvedSessionId, error: errorMsg })
        stream.writeSSE({
          event: 'error',
          data: errorMsg,
        }).catch(() => {})
        alive = false
        return
      }

      await streamingEventLog.append(persistId, 'result', { sessionId: resolvedSessionId })
      stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ sessionId: resolvedSessionId }),
      }).catch(() => {})
      alive = false
    }

    const onToolTrace = async (msg: TaskToolTraceMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      const useSeq = await streamingEventLog.append(persistId, 'tool_use', { toolName: msg.toolName, toolInput: msg.toolInput })
      stream.writeSSE({
        event: 'tool_use',
        data: JSON.stringify({ toolName: msg.toolName, toolInput: msg.toolInput }),
        id: String(useSeq),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:tool_trace', { taskId: opts.taskId, toolName: msg.toolName, toolInput: msg.toolInput })
      if (msg.toolResult !== undefined) {
        const resultSeq = await streamingEventLog.append(persistId, 'tool_result', { toolName: msg.toolName, success: msg.success, result: msg.toolResult })
        stream.writeSSE({
          event: 'tool_result',
          data: JSON.stringify({ toolName: msg.toolName, success: msg.success, result: msg.toolResult }),
          id: String(resultSeq),
        }).catch(() => { alive = false })
        executionEventBus.emit('task:tool_trace', { taskId: opts.taskId, toolName: msg.toolName, toolResult: typeof msg.toolResult === 'string' ? msg.toolResult.slice(0, 100000) : msg.toolResult, success: msg.success ?? true })
      }
    }

    const onFileChange = async (msg: TaskFileChangeMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      // Compute line counts from diff when not provided
      let linesAdded = msg.linesAdded
      let linesRemoved = msg.linesRemoved
      if (linesAdded == null && linesRemoved == null && msg.diff) {
        for (const line of msg.diff.split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) linesAdded = (linesAdded ?? 0) + 1
          else if (line.startsWith('-') && !line.startsWith('---')) linesRemoved = (linesRemoved ?? 0) + 1
        }
      }
      const data = { path: msg.path, action: msg.action, linesAdded, linesRemoved }
      const seq = await streamingEventLog.append(persistId, 'file_change', data)
      stream.writeSSE({
        event: 'file_change',
        data: JSON.stringify(data),
        id: String(seq),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:file_change', { taskId: opts.taskId, path: msg.path, action: msg.action })
    }

    const onSessionInit = async (msg: TaskSessionInitMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      providerSessionId = msg.sessionId  // Capture real Claude SDK session ID
      const seq = await streamingEventLog.append(persistId, 'session_init', { sessionId: msg.sessionId, model: msg.model })
      stream.writeSSE({
        event: 'session_init',
        data: JSON.stringify({ sessionId: msg.sessionId, model: msg.model }),
        id: String(seq),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:session_init', { taskId: opts.taskId, sessionId: msg.sessionId, model: msg.model || 'unknown' })
    }

    const onMachineDisconnected = (disconnectedMachineId: string) => {
      if (!alive) return
      if (opts.targetMachineId && disconnectedMachineId !== opts.targetMachineId) return
      stream.writeSSE({
        event: 'error',
        data: 'Remote machine disconnected during task execution',
      }).catch(() => {})
      alive = false
    }

    relayServer.on('task:text', onText)
    relayServer.on('task:result', onResult)
    relayServer.on('task:tool_trace', onToolTrace)
    relayServer.on('task:file_change', onFileChange)
    relayServer.on('task:session_init', onSessionInit)
    relayServer.on('machine:disconnected', onMachineDisconnected)

    const cleanup = () => {
      relayServer.off('task:text', onText)
      relayServer.off('task:result', onResult)
      relayServer.off('task:tool_trace', onToolTrace)
      relayServer.off('task:file_change', onFileChange)
      relayServer.off('task:session_init', onSessionInit)
      relayServer.off('machine:disconnected', onMachineDisconnected)
    }

    // Extract authenticated user for machine ownership filtering
    const user = c.get('user') as { id: string } | undefined

    // Track active stream to prevent double-persistence from events.ts
    activeDispatchStreams.add(opts.taskId)
    if (persistId !== opts.taskId) activeDispatchStreams.add(persistId)

    const cleanupAll = () => {
      cleanup()
      activeDispatchStreams.delete(opts.taskId)
      if (persistId !== opts.taskId) activeDispatchStreams.delete(persistId)
    }

    // Dispatch after listeners are registered
    const dispatched = relayServer.dispatchTask(task, opts.targetMachineId, user?.id)

    if (!dispatched) {
      cleanupAll()
      await stream.writeSSE({
        event: 'error',
        data: 'No agent runner connected. Start one with: npx astro-agent start --relay wss://<your-relay-url>',
      })
      return
    }

    // Keepalive + activity timeout
    const heartbeat = setInterval(() => {
      if (!alive) { clearInterval(heartbeat); return }
      if (Date.now() - lastActivity > ACTIVITY_TIMEOUT_MS) {
        // Don't timeout if we're waiting for user approval (ask_user_question)
        if (dispatchEngine.hasPendingApprovalForExecution(opts.taskId)) {
          lastActivity = Date.now() // Reset timer while approval is pending
        } else {
          stream.writeSSE({ event: 'error', data: 'Activity timeout — agent runner stopped responding' }).catch(() => {})
          alive = false
          clearInterval(heartbeat)
          return
        }
      }
      // Flush buffered text to DB periodically so catch-up hydration has recent data
      // (text is normally only flushed on structural events like tool_use or result)
      streamingEventLog.flushText(persistId).catch(() => {})
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => { alive = false; clearInterval(heartbeat) })
    }, 15000)

    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      cleanupAll()
      streamingEventLog.flushText(persistId).catch(() => {})
      // Task continues running on the agent runner — results arrive via relay → global SSE → realtime-store
    })

    // Wait for completion
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) { clearInterval(check); clearInterval(heartbeat); cleanupAll(); resolve() }
      }, 500)
    })
  })
}

/**
 * Non-streaming relay dispatch.
 * Dispatches task, waits for result, returns output as JSON.
 * Used by /summarize which is non-streaming.
 */
async function executeViaRelay(opts: {
  taskId: string
  projectId: string
  nodeId: string
  prompt: string
  systemPrompt?: string
  maxTurns?: number
  type?: 'chat' | 'plan' | 'execution' | 'summarize'
  userId?: string
}): Promise<{ success: boolean; output?: string; error?: string }> {
  const task: RelayTaskDispatch = {
    taskId: opts.taskId,
    projectId: opts.projectId,
    nodeId: opts.nodeId,
    title: opts.type || 'summarize',
    description: opts.prompt.slice(0, 200),
    prompt: opts.prompt,
    systemPrompt: opts.systemPrompt,
    type: opts.type,
    maxTurns: opts.maxTurns ?? 1,
    workingDirectory: SCRATCH_DIR,
    skipSafetyCheck: true,
    useWorktree: false,
  }

  return new Promise((resolve) => {
    let output = ''
    const timeout = setTimeout(() => {
      cleanup()
      resolve({ success: false, error: 'Relay task timed out' })
    }, 120_000)

    const onText = (msg: TaskTextMessage) => {
      if (msg.taskId !== opts.taskId) return
      output += msg.text
    }

    const onResult = (msg: TaskResultMessage) => {
      if (msg.result.taskId !== opts.taskId) return
      clearTimeout(timeout)
      cleanup()
      resolve({
        success: msg.result.status === 'completed',
        output: msg.result.output || output,
        error: msg.result.error,
      })
    }

    const cleanup = () => {
      relayServer.off('task:text', onText)
      relayServer.off('task:result', onResult)
    }

    relayServer.on('task:text', onText)
    relayServer.on('task:result', onResult)

    const dispatched = relayServer.dispatchTask(task, undefined, opts.userId)
    if (!dispatched) {
      clearTimeout(timeout)
      cleanup()
      resolve({ success: false, error: 'No agent runner connected' })
    }
  })
}

// (imported above) to ensure consistent behavior between server and client.

const agentRoute = new Hono()

// All agent routes require authentication
agentRoute.use('/*', requireAuth)

agentRoute.post('/project-chat', async (c) => {
  let body: z.infer<typeof chatSchema>
  try {
    const rawBody = await c.req.json()
    body = chatSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { message, sessionId: existingSessionId, streamId, projectId, model, visionDoc, planNodes, planEdges, selectedBackends, messages: historyMessages } = body
  const chatUser = c.get('user') as AuthUser
  const taskId = existingSessionId || `project-chat-${projectId}-${Date.now()}`

  // Verify project ownership
  if (!await verifyProjectAccess(projectId, chatUser)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Look up the project's working directory, default machine, and compute backends
  const [project] = await db.select({ workingDirectory: projects.workingDirectory, defaultMachineId: projects.defaultMachineId, computeBackends: projects.computeBackends }).from(projects).where(eq(projects.id, projectId)).limit(1)

  // Resolve backends: body override > project setting
  const backends = selectedBackends ?? (project?.computeBackends as string[] | null) ?? undefined
  const chatSkills = skillManager.getBackendScopedSkillInjection(chatUser.teamId ?? null, backends) || undefined
  const chatEnvContext = await loadEnvironmentContext(chatUser.id, backends ?? [], project?.defaultMachineId ?? undefined)

  const systemPrompt = buildChatSystemPrompt(visionDoc, planNodes, planEdges, chatSkills, chatEnvContext)

  // Persist user message for catch-up hydration
  await streamingEventLog.append(streamId || taskId, 'steer_message', { message })

  return streamChatViaRelay(c, {
    taskId,
    projectId,
    nodeId: '',
    prompt: message,
    systemPrompt,
    type: 'chat',
    messages: historyMessages,
    model: model || undefined,
    workingDirectory: project?.workingDirectory ?? undefined,
    targetMachineId: project?.defaultMachineId ?? undefined,
    streamId,
  })
})

const taskChatSchema = z.object({
  message: z.string().min(1).max(50000),
  sessionId: z.string().nullable().optional(),
  streamId: z.string().max(200).optional(),
  nodeId: z.string().min(1),
  projectId: z.string().uuid(),
  taskTitle: z.string().max(1000),
  taskDescription: z.string().max(50000).default(""),
  taskOutput: z.string().max(100000).nullable().optional(),
  visionDoc: z.string().max(100000).nullable().optional(),
  model: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(50000),
  })).max(100).optional(),
  selectedBackends: z.array(z.string().max(100)).max(20).optional(),
  // Execution context for resumed sessions
  branchName: z.string().max(500).nullable().optional(),
  prUrl: z.string().max(2000).nullable().optional(),
})

agentRoute.post('/task-chat', async (c) => {
  const raw = await c.req.json()
  const parsed = taskChatSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const {
    message,
    sessionId: existingSessionId,
    streamId,
    nodeId,
    projectId,
    taskTitle,
    taskDescription,
    taskOutput,
    visionDoc,
    model,
    selectedBackends,
    messages: historyMessages,
    branchName,
    prUrl,
  } = body

  const isResumedSession = !!existingSessionId
  const taskId = existingSessionId || `task-chat-${nodeId}-${Date.now()}`

  // Verify project ownership
  const taskChatUser = c.get('user') as AuthUser
  if (!await verifyProjectAccess(projectId, taskChatUser)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Look up the project's working directory, default machine, and compute backends
  const [project] = await db.select({ workingDirectory: projects.workingDirectory, defaultMachineId: projects.defaultMachineId, computeBackends: projects.computeBackends }).from(projects).where(eq(projects.id, projectId)).limit(1)

  // Resolve backends: body override > project setting
  const tcBackends = selectedBackends ?? (project?.computeBackends as string[] | null) ?? undefined
  const tcSkills = skillManager.getBackendScopedSkillInjection(taskChatUser.teamId ?? null, tcBackends) || undefined
  const tcEnvContext = await loadEnvironmentContext(taskChatUser.id, tcBackends ?? [], project?.defaultMachineId ?? undefined)

  const systemPrompt = buildTaskChatSystemPrompt({
    taskTitle,
    taskDescription,
    taskOutput,
    visionDoc,
    isResumedSession,
    branchName: branchName || undefined,
    prUrl: prUrl || undefined,
    skillsInjection: tcSkills,
    environmentContext: tcEnvContext,
  })

  // Persist user message for catch-up hydration
  await streamingEventLog.append(streamId || taskId, 'steer_message', { message })

  return streamChatViaRelay(c, {
    taskId,
    projectId,
    nodeId,
    prompt: message,
    systemPrompt,
    type: 'chat',
    messages: historyMessages,
    model: model || undefined,
    workingDirectory: project?.workingDirectory ?? undefined,
    targetMachineId: project?.defaultMachineId ?? undefined,
    // When we have a provider session ID, pass it so agent-runner can resume the Claude session
    resumeSessionId: existingSessionId || undefined,
    streamId,
  })
})

agentRoute.post('/abort', async (c) => {
  const { sessionId, taskId } = await c.req.json<{ sessionId?: string; taskId?: string }>()
  const id = taskId ?? sessionId

  if (!id) {
    return c.json({ aborted: false, error: 'No sessionId or taskId provided' }, 400)
  }

  // Cancel via relay — forward abort to the agent runner
  relayServer.cancelTask(id, '')
  return c.json({ aborted: true })
})


const dispatchTaskSchema = z.object({
  nodeId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
  taskTitle: z.string().min(1).max(1000),
  taskDescription: z.string().min(1).max(100000),
  visionDoc: z.string().max(100000).optional(),
  dependencyOutputs: z.string().max(500000).optional(),
  workingDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),
  model: z.string().max(100).optional(),
  providerId: z.string().max(100).optional(),
  maxTurns: z.number().int().min(1).refine(
    (value) => Number.isSafeInteger(value),
    { message: 'maxTurns must be a safe integer' }
  ).optional(),
})

agentRoute.post('/dispatch', async (c) => {
  const body = dispatchTaskSchema.parse(await c.req.json())

  const {
    nodeId,
    projectId,
    taskTitle,
    taskDescription,
    visionDoc,
    dependencyOutputs,
    workingDirectory,
    maxTurns,
  } = body

  const executionId = `exec-${nodeId}-${Date.now()}`

  const prompt = buildTaskExecutionPrompt({
    taskTitle,
    taskDescription,
    visionDoc,
    dependencyOutputs,
    workingDirectory,
  })
  return streamChatViaRelay(c, {
    taskId: executionId,
    projectId,
    nodeId,
    prompt,
    type: 'execution',
    workingDirectory,
    maxTurns,
  })
})

agentRoute.post('/summarize', async (c) => {
  const body = await c.req.json<{
    taskTitle: string
    taskDescription: string
    executionOutput: string
    fileChanges: Array<{ path: string; action: string }>
    status: 'success' | 'failure'
  }>()

  console.log(`[summarize] Summary requested for task: ${body.taskTitle} (status: ${body.status})`)

  const summaryUser = c.get('user') as { id: string } | undefined
  const prompt = buildSummaryPrompt(body)
  const taskId = `summary-${Date.now()}`
  const result = await executeViaRelay({
    taskId,
    projectId: '',
    nodeId: '',
    prompt,
    type: 'summarize',
    maxTurns: 1,
    userId: summaryUser?.id,
  })

  if (result.success && result.output) {
    try {
      const jsonMatch = result.output.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const summary = JSON.parse(jsonMatch[0])
        return c.json({ summary })
      }
    } catch {
      // JSON parse failed — fall through to text fallback below
    }
    // No JSON found or parse failed — return a text-based fallback summary
    return c.json({
      summary: {
        workCompleted: result.output.slice(0, 500),
        keyFindings: [],
        filesChanged: body.fileChanges.map((f) => f.path),
        status: body.status,
        followUps: [],
      },
    })
  }

  return c.json({ error: result.error || 'Failed to generate summary' }, 500)
})

agentRoute.post('/generate-title', async (c) => {
  const body = await c.req.json<{ description: string }>()
  const { description } = body

  if (!description || typeof description !== 'string' || description.length < 1) {
    return c.json({ error: 'Description is required' }, 400)
  }

  const titleUser = c.get('user') as { id: string } | undefined
  const prompt = buildTitleGenerationPrompt(description)
  const taskId = `title-${Date.now()}`
  const result = await executeViaRelay({
    taskId,
    projectId: '',
    nodeId: '',
    prompt,
    type: 'summarize',
    maxTurns: 1,
    userId: titleUser?.id,
  })

  if (result.success && result.output) {
    // Clean up: take first line, trim whitespace and quotes
    const title = result.output.trim().split('\n')[0].replace(/^["']|["']$/g, '').trim().slice(0, 80)
    return c.json({ title })
  }

  // Fallback: first 80 chars of description
  const fallback = description.trim().slice(0, 80)
  return c.json({ title: fallback })
})

agentRoute.post('/refine', async (c) => {
  const refineSchema = z.object({
    title: z.string().max(500).default(''),
    description: z.string().max(50000).default(''),
    context: z.enum(['task', 'project']),
  })

  let body: z.infer<typeof refineSchema>
  try {
    const rawBody = await c.req.json()
    body = refineSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  if (!body.title.trim() && !body.description.trim()) {
    return c.json({ error: 'At least one of title or description is required' }, 400)
  }

  const refineUser = c.get('user') as { id: string } | undefined
  const prompt = buildRefinementPrompt({ title: body.title, description: body.description, context: body.context })
  const taskId = `refine-${Date.now()}`
  const result = await executeViaRelay({
    taskId,
    projectId: '',
    nodeId: '',
    prompt,
    type: 'summarize',
    maxTurns: 1,
    userId: refineUser?.id,
  })

  if (result.success && result.output) {
    try {
      const jsonMatch = result.output.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const refinement = JSON.parse(jsonMatch[0])
        return c.json({ refinement })
      }
    } catch { /* fall through */ }
  }

  // Fallback: return original content
  return c.json({
    refinement: {
      refinedTitle: body.title,
      refinedDescription: body.description,
      confidence: 'low' as const,
    },
  })
})

agentRoute.post('/suggest-labels', async (c) => {
  const labelSchema = z.object({
    title: z.string().max(500).default(''),
    description: z.string().max(50000).default(''),
  })

  let body: z.infer<typeof labelSchema>
  try {
    const rawBody = await c.req.json()
    body = labelSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const labelUser = c.get('user') as { id: string } | undefined
  const prompt = buildLabelSuggestionPrompt(body.title, body.description)
  const taskId = `labels-${Date.now()}`
  const result = await executeViaRelay({
    taskId,
    projectId: '',
    nodeId: '',
    prompt,
    type: 'summarize',
    maxTurns: 1,
    userId: labelUser?.id,
  })

  if (result.success && result.output) {
    try {
      const jsonMatch = result.output.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const validIds = ['l1', 'l2', 'l3', 'l4', 'l5']
        const labelIds = Array.isArray(parsed.labelIds)
          ? parsed.labelIds.filter((id: unknown) => typeof id === 'string' && validIds.includes(id))
          : []
        return c.json({ labelIds })
      }
    } catch { /* fall through */ }
  }

  return c.json({ labelIds: [] })
})

/**
 * Get relay status — shows connected agent runners instead of local providers.
 */
agentRoute.get('/providers', async (c) => {
  const user = c.get('user') as { id: string } | undefined
  const machines = machineRegistry.getAll()
    .filter(m => !m.userId || m.userId === user?.id || m.userId === LOCAL_USER_ID)
  return c.json({
    mode: 'relay',
    connectedRunners: machines.length,
    machines: machines.map((m) => ({
      id: m.machineId,
      name: m.name,
      providers: m.providers,
      activeTasks: m.load.activeTasks,
    })),
  })
})

/**
 * Re-detect is a no-op in relay mode — agent runners self-register.
 */
agentRoute.post('/providers/detect', async (c) => {
  const user = c.get('user') as { id: string } | undefined
  const machines = machineRegistry.getAll()
    .filter(m => !m.userId || m.userId === user?.id || m.userId === LOCAL_USER_ID)
  return c.json({
    detected: machines.length,
    mode: 'relay',
    connectedRunners: machines.length,
  })
})

export { agentRoute }
