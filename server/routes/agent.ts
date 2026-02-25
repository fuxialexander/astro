import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { buildPlanSystemPrompt, buildChatSystemPrompt, buildTaskExecutionPrompt, buildTaskChatSystemPrompt, buildSummaryPrompt, buildTitleGenerationPrompt, buildRefinementPrompt, buildLabelSuggestionPrompt, PLAN_GRAPH_SCHEMA } from '../lib/prompt-templates.js'
import { skillManager } from '../lib/skill-manager.js'
import { readRepoContext } from '../lib/repo-context.js'
import { relayServer } from '../lib/relay-server.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { machineRegistry } from '../lib/machine-registry.js'
import { requireAuth } from '../middleware/auth.js'
import type { TaskDispatch as RelayTaskDispatch, TaskResultMessage, TaskTextMessage, TaskToolTraceMessage, TaskFileChangeMessage, TaskSessionInitMessage, TaskStdoutMessage } from '../types/relay.js'
import { db } from '../lib/db/index.js'
import { projects } from '../lib/db/schema.js'
import { eq, isNull, and } from 'drizzle-orm'

/** Scratch directory for text-only relay tasks (label suggestion, refine, etc.) */
const SCRATCH_DIR = join(homedir(), '.astro', 'tmp')
try { mkdirSync(SCRATCH_DIR, { recursive: true }) } catch { /* ignore */ }

// Validation schemas
const generatePlanSchema = z.object({
  description: z.string().min(1).max(50000),
  visionDoc: z.string().max(100000).optional(),
  projectId: z.string().min(1).max(100),
  model: z.string().max(100).optional(),
  providerId: z.string().max(100).optional(),
  workingDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),
  fileTree: z.array(z.string().max(1000)).max(10000).optional(),
  keyFiles: z.object({
    claudeMd: z.string().max(100000).optional(),
    readmeMd: z.string().max(100000).optional(),
    packageInfo: z.string().max(100000).optional(),
  }).optional(),
  targetMachineId: z.string().max(100).optional(),
  gitState: z.object({
    currentBranch: z.string().max(200),
    targetBranch: z.string().max(200),
    isDirty: z.boolean(),
    dirtyDetails: z.object({
      staged: z.number(),
      unstaged: z.number(),
      untracked: z.number(),
    }).optional(),
  }).optional(),
})

const chatSchema = z.object({
  message: z.string().min(1).max(50000),
  sessionId: z.string().max(100).optional(),
  projectId: z.string().min(1).max(100),
  visionDoc: z.string().max(100000).optional(),
  model: z.string().max(100).optional(),
  providerId: z.string().max(100).optional(),
  planNodes: z.array(z.any()).max(1000).optional(),
  planEdges: z.array(z.any()).max(1000).optional(),
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
  }
) {
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
    maxTurns: opts.maxTurns ?? 50,
    workingDirectory: opts.workingDirectory,
    useWorktree: false,
  }

  // Disable proxy buffering so SSE chunks flush immediately (Fly.io, nginx)
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let alive = true
    let lastActivity = Date.now()
    const ACTIVITY_TIMEOUT_MS = 300_000

    const onText = (msg: TaskTextMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
      executionEventBus.emit('task:stdout', { output: { taskId: opts.taskId, data: msg.text, stream: 'stdout', timestamp: new Date() } })
    }

    const onResult = (msg: TaskResultMessage) => {
      if (!alive || msg.result.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ sessionId: opts.taskId }),
      }).catch(() => {})
      alive = false
    }

    const onToolTrace = (msg: TaskToolTraceMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'tool_use',
        data: JSON.stringify({ toolName: msg.toolName, toolInput: msg.toolInput }),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:tool_trace', { taskId: opts.taskId, toolName: msg.toolName, toolInput: msg.toolInput })
      if (msg.toolResult !== undefined) {
        stream.writeSSE({
          event: 'tool_result',
          data: JSON.stringify({ toolName: msg.toolName, success: msg.success, result: msg.toolResult }),
        }).catch(() => { alive = false })
        executionEventBus.emit('task:tool_trace', { taskId: opts.taskId, toolName: msg.toolName, toolResult: typeof msg.toolResult === 'string' ? msg.toolResult.slice(0, 100000) : msg.toolResult, success: msg.success ?? true })
      }
    }

    const onFileChange = (msg: TaskFileChangeMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'file_change',
        data: JSON.stringify({ path: msg.path, action: msg.action }),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:file_change', { taskId: opts.taskId, path: msg.path, action: msg.action })
    }

    const onSessionInit = (msg: TaskSessionInitMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'session_init',
        data: JSON.stringify({ sessionId: msg.sessionId, model: msg.model }),
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

    // Dispatch after listeners are registered
    const dispatched = relayServer.dispatchTask(task, opts.targetMachineId)

    if (!dispatched) {
      cleanup()
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
        stream.writeSSE({ event: 'error', data: 'Activity timeout — agent runner stopped responding' }).catch(() => {})
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
      relayServer.cancelTask(opts.taskId, opts.targetMachineId || '')
    })

    // Wait for completion
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) { clearInterval(check); clearInterval(heartbeat); cleanup(); resolve() }
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

    const dispatched = relayServer.dispatchTask(task)
    if (!dispatched) {
      clearTimeout(timeout)
      cleanup()
      resolve({ success: false, error: 'No agent runner connected' })
    }
  })
}

/**
 * Extract a plan JSON object from accumulated assistant text.
 * Handles multi-turn conversations where the JSON may appear in the last message
 * mixed with prose or wrapped in code fences.
 */
function extractPlanJson(text: string): Record<string, unknown> | null {
  // Try code fence extraction first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim())
      if (parsed.nodes && parsed.edges) return parsed
    } catch { /* continue */ }
  }

  // Find the last complete JSON object containing nodes and edges
  let lastValidPlan: Record<string, unknown> | null = null
  let searchFrom = 0

  while (true) {
    const start = text.indexOf('{', searchFrom)
    if (start === -1) break

    let depth = 0
    let end = -1
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }

    if (end === -1) break

    const candidate = text.slice(start, end + 1)
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && parsed.nodes && parsed.edges) {
        lastValidPlan = parsed
      }
    } catch { /* not valid JSON, skip */ }

    searchFrom = start + 1
  }

  return lastValidPlan
}

const agentRoute = new Hono()

// All agent routes require authentication
agentRoute.use('/*', requireAuth)

agentRoute.post('/generate-plan', async (c) => {
  // Validate input
  let body: z.infer<typeof generatePlanSchema>
  try {
    const rawBody = await c.req.json()
    body = generatePlanSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { description, visionDoc, projectId, model, workingDirectory, fileTree, keyFiles, targetMachineId, gitState } = body
  const taskId = `gen-${projectId}-${Date.now()}`

  console.log(`[plan-gen] Request received: projectId=${projectId}, targetMachineId=${targetMachineId || 'any'}, workingDirectory=${workingDirectory || 'none'}`)

  // Build repo context from provided data (key files + file tree from remote setup)
  let repoContext
  if (fileTree || keyFiles) {
    repoContext = readRepoContext('', fileTree)
    if (keyFiles) {
      if (keyFiles.claudeMd) repoContext.claudeMd = keyFiles.claudeMd
      if (keyFiles.readmeMd) repoContext.readmeMd = keyFiles.readmeMd
      if (keyFiles.packageInfo) repoContext.packageInfo = keyFiles.packageInfo
    }
  }

  // Build the full plan prompt: system prompt + user description
  // Include available skills so the planner can create tasks that leverage them
  const skillsSummary = skillManager.getSkillPromptInjection() || undefined
  const systemPrompt = buildPlanSystemPrompt(visionDoc, repoContext, gitState, skillsSummary)
  const fullPrompt = `${systemPrompt}\n\n---\n\n## User Request\n\n${description}\n\n---\n\nIMPORTANT: Respond with ONLY the JSON plan object. Start your response with { and end with }. No prose, no markdown fences, no explanation. The JSON must have "projectName", "nodes", and "edges" keys.`

  // Build relay task dispatch
  const taskDispatch: RelayTaskDispatch = {
    taskId,
    projectId,
    nodeId: `plan-${projectId}`,
    title: 'Plan Generation',
    description,
    visionDoc,
    workingDirectory,
    prompt: fullPrompt,
    model: model || undefined,
    maxTurns: 100,
    outputFormat: { type: 'json_schema', schema: PLAN_GRAPH_SCHEMA },
    type: 'plan', // Mark as plan task to skip safety checks (no file system access)
    useWorktree: false,
  }

  // Disable proxy buffering so SSE chunks flush immediately (Fly.io, nginx)
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let alive = true
    let lastActivity = Date.now()
    let assistantText = ''
    let planResultSent = false
    const ACTIVITY_TIMEOUT_MS = 300_000

    const onResult = (msg: TaskResultMessage) => {
      if (!alive || msg.result.taskId !== taskId) return
      lastActivity = Date.now()

      // Try to extract plan from accumulated text
      if (!planResultSent && assistantText) {
        const parsed = extractPlanJson(assistantText)
        if (parsed) {
          planResultSent = true
          stream.writeSSE({
            event: 'plan_result',
            data: JSON.stringify(parsed),
          }).catch(() => { alive = false })
        }
      }

      // Also check the result output for plan JSON
      if (!planResultSent && msg.result.output) {
        const parsed = extractPlanJson(msg.result.output)
        if (parsed) {
          planResultSent = true
          stream.writeSSE({
            event: 'plan_result',
            data: JSON.stringify(parsed),
          }).catch(() => { alive = false })
        }
      }

      if (!planResultSent) {
        let failureDetail: string
        const resultOutput = msg.result.output ?? ''
        const resultError = msg.result.error ?? ''
        const resultStatus = msg.result.status ?? 'unknown'
        console.warn(`[plan-gen] Extraction failed. assistantText length=${assistantText.length}, result.output length=${resultOutput.length}, status=${resultStatus}, error=${resultError}`)

        if (resultStatus === 'failed' && resultError) {
          failureDetail = `Plan generation failed: ${resultError}`
        } else if (assistantText.length > 0 || resultOutput.length > 0) {
          const combined = assistantText || resultOutput
          const trimmed = combined.trimEnd()
          const mentionsPlanKeys = trimmed.includes('"nodes"') || trimmed.includes('"edges"')
          if (mentionsPlanKeys && !trimmed.endsWith('}')) {
            failureDetail = 'The AI response was truncated before the plan could be completed. Try simplifying the project description.'
          } else {
            failureDetail = 'The AI response did not contain a valid plan structure. Try regenerating the plan.'
          }
        } else {
          failureDetail = `No output was produced during plan generation (status: ${resultStatus}${resultError ? `, error: ${resultError}` : ''}).`
        }
        stream.writeSSE({ event: 'error', data: failureDetail }).catch(() => { alive = false })
      }

      // Auto-assign defaultMachineId on the project if not yet set
      if (planResultSent && targetMachineId) {
        db.update(projects)
          .set({ defaultMachineId: targetMachineId, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), isNull(projects.defaultMachineId)))
          .execute()
          .catch((err: unknown) => {
            console.error('[plan-gen] Error auto-assigning defaultMachineId:', err)
          })
      }

      stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ sessionId: taskId }),
      }).catch(() => {})
      alive = false
    }

    const onStdout = (msg: TaskStdoutMessage) => {
      if (!alive || msg.output.taskId !== taskId) return
      lastActivity = Date.now()
      assistantText += msg.output.data
      stream.writeSSE({ event: 'text', data: msg.output.data }).catch(() => { alive = false })
    }

    const onText = (msg: TaskTextMessage) => {
      if (!alive || msg.taskId !== taskId) return
      lastActivity = Date.now()
      assistantText += msg.text
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
    }

    const onMachineDisconnected = (disconnectedMachineId: string) => {
      if (!alive) return
      if (targetMachineId && disconnectedMachineId !== targetMachineId) return
      stream.writeSSE({
        event: 'error',
        data: 'Remote machine disconnected during plan generation',
      }).catch(() => {})
      alive = false
    }

    relayServer.on('task:result', onResult)
    relayServer.on('task:stdout', onStdout)
    relayServer.on('task:text', onText)
    relayServer.on('machine:disconnected', onMachineDisconnected)

    const cleanup = () => {
      relayServer.off('task:result', onResult)
      relayServer.off('task:stdout', onStdout)
      relayServer.off('task:text', onText)
      relayServer.off('machine:disconnected', onMachineDisconnected)
    }

    // Dispatch after listeners registered
    const dispatched = relayServer.dispatchTask(taskDispatch, targetMachineId)

    if (!dispatched) {
      cleanup()
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
        stream.writeSSE({ event: 'error', data: 'Activity timeout — agent runner stopped responding' }).catch(() => {})
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
      relayServer.cancelTask(taskId, targetMachineId || '')
    })

    // Wait for completion
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) { clearInterval(check); resolve() }
      }, 500)
    })
  })
})

agentRoute.post('/chat', async (c) => {
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

  const { message, sessionId: existingSessionId, projectId, model, visionDoc, planNodes, planEdges, messages: historyMessages } = body
  const taskId = existingSessionId || `chat-${projectId}-${Date.now()}`

  // Look up the project's working directory
  const [project] = await db.select({ workingDirectory: projects.workingDirectory }).from(projects).where(eq(projects.id, projectId)).limit(1)

  const systemPrompt = buildChatSystemPrompt(visionDoc, planNodes, planEdges)
  return streamChatViaRelay(c, {
    taskId,
    projectId,
    nodeId: '',
    prompt: message,
    systemPrompt,
    type: 'chat',
    messages: historyMessages,
    model: model || undefined,
    maxTurns: 50,
    workingDirectory: project?.workingDirectory ?? undefined,
  })
})

const taskChatSchema = z.object({
  message: z.string().min(1).max(50000),
  sessionId: z.string().optional(),
  nodeId: z.string().min(1),
  projectId: z.string().uuid(),
  taskTitle: z.string().max(1000),
  taskDescription: z.string().max(50000),
  taskOutput: z.string().max(100000).optional(),
  visionDoc: z.string().max(100000).optional(),
  model: z.string().optional(),
  providerId: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(50000),
  })).max(100).optional(),
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
    nodeId,
    projectId,
    taskTitle,
    taskDescription,
    taskOutput,
    visionDoc,
    model,
    messages: historyMessages,
  } = body

  const taskId = existingSessionId || `task-chat-${nodeId}-${Date.now()}`

  // Look up the project's working directory
  const [project] = await db.select({ workingDirectory: projects.workingDirectory }).from(projects).where(eq(projects.id, projectId)).limit(1)

  const systemPrompt = buildTaskChatSystemPrompt({
    taskTitle,
    taskDescription,
    taskOutput,
    visionDoc,
  })
  return streamChatViaRelay(c, {
    taskId,
    projectId,
    nodeId,
    prompt: message,
    systemPrompt,
    type: 'chat',
    messages: historyMessages,
    model: model || undefined,
    maxTurns: 50,
    workingDirectory: project?.workingDirectory ?? undefined,
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

agentRoute.post('/compact', async (c) => {
  const body = await c.req.json<{
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    projectId: string
    model?: string
    providerId?: string
  }>()

  const { messages, projectId } = body

  if (!messages || messages.length === 0) {
    return c.json({ error: 'No messages to compact' }, 400)
  }

  const taskId = `compact-${projectId}-${Date.now()}`

  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const compactPrompt = `Summarize the following conversation into a concise but comprehensive context document. Preserve all important decisions, key facts, action items, and technical details. The summary will be used as context for future messages in the same session.

Focus on:
- Decisions made and their rationale
- Technical details and specifications discussed
- Action items and their status
- Key constraints or requirements mentioned
- Any plan modifications or task updates

Conversation:
${transcript}

Provide a structured summary that captures the essential context needed to continue this conversation effectively.`

  return streamChatViaRelay(c, {
    taskId,
    projectId,
    nodeId: '',
    prompt: compactPrompt,
    type: 'chat',
    maxTurns: 1,
  })
})

agentRoute.post('/dispatch', async (c) => {
  const body = await c.req.json<{
    nodeId: string
    projectId: string
    taskTitle: string
    taskDescription: string
    visionDoc?: string
    dependencyOutputs?: string
    workingDirectory?: string
    model?: string
    providerId?: string
    maxTurns?: number
  }>()

  const {
    nodeId,
    projectId,
    taskTitle,
    taskDescription,
    visionDoc,
    dependencyOutputs,
    workingDirectory,
    maxTurns = 100,
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

  const prompt = buildSummaryPrompt(body)
  const taskId = `summary-${Date.now()}`
  const result = await executeViaRelay({
    taskId,
    projectId: '',
    nodeId: '',
    prompt,
    type: 'summarize',
    maxTurns: 1,
  })

  if (result.success && result.output) {
    try {
      const jsonMatch = result.output.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const summary = JSON.parse(jsonMatch[0])
        return c.json({ summary })
      }
    } catch {
      return c.json({
        summary: {
          workCompleted: result.output.slice(0, 200),
          filesChanged: body.fileChanges.map((f) => f.path),
          status: body.status,
          followUps: [],
        },
      })
    }
  }

  return c.json({ error: result.error || 'Failed to generate summary' }, 500)
})

agentRoute.post('/generate-title', async (c) => {
  const body = await c.req.json<{ description: string }>()
  const { description } = body

  if (!description || typeof description !== 'string' || description.length < 1) {
    return c.json({ error: 'Description is required' }, 400)
  }

  const prompt = buildTitleGenerationPrompt(description)
  const taskId = `title-${Date.now()}`
  const result = await executeViaRelay({
    taskId,
    projectId: '',
    nodeId: '',
    prompt,
    type: 'summarize',
    maxTurns: 1,
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

  const prompt = buildRefinementPrompt({ title: body.title, description: body.description, context: body.context })
  const taskId = `refine-${Date.now()}`
  const result = await executeViaRelay({
    taskId,
    projectId: '',
    nodeId: '',
    prompt,
    type: 'summarize',
    maxTurns: 1,
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

  const prompt = buildLabelSuggestionPrompt(body.title, body.description)
  const taskId = `labels-${Date.now()}`
  const result = await executeViaRelay({
    taskId,
    projectId: '',
    nodeId: '',
    prompt,
    type: 'summarize',
    maxTurns: 1,
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
  const machines = machineRegistry.getAll()
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
  const machines = machineRegistry.getAll()
  return c.json({
    detected: machines.length,
    mode: 'relay',
    connectedRunners: machines.length,
  })
})

export { agentRoute }
