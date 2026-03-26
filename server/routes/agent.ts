import { Hono } from 'hono'
import { z } from 'zod'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { buildChatSystemPrompt, buildTaskExecutionPrompt, buildTaskChatSystemPrompt, buildSummaryPrompt, buildTitleGenerationPrompt, buildRefinementPrompt, buildLabelSuggestionPrompt, formatMachineInstruction, GENERATIVE_UI_HINT } from '../lib/prompt-templates.js'
import { DEFAULT_MACHINE_INSTRUCTION_FORMATTED, MACHINE_INSTRUCTION_PRESETS } from '../lib/machine-instruction-presets.js'
import { relayServer } from '../lib/relay-server.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { machineRegistry } from '../lib/machine-registry.js'
import { streamingEventLog } from '../lib/streaming-event-log.js'
import { executionContextStore } from '../lib/execution-context-store.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'
import type { TaskDispatch as RelayTaskDispatch, TaskResultMessage, TaskTextMessage, ProviderType, ImageAttachment } from '../types/relay.js'
import { db } from '../lib/db/index.js'
import { projects, registeredMachines, machineInstructions, blobs } from '../lib/db/schema.js'
import { eq, and, inArray, isNull } from 'drizzle-orm'

const DEFAULT_INSTRUCTION_ID = 'builtin:default'

/** Resolve a machine's instruction content (handles both builtin presets and DB-stored instructions). */
async function resolveMachineInstruction(instructionId: string): Promise<string | null> {
  if (instructionId.startsWith('builtin:')) {
    const preset = MACHINE_INSTRUCTION_PRESETS.find((p) => p.id === instructionId)
    return preset ? formatMachineInstruction(preset.name, preset.content) : null
  }
  const [instruction] = await db.select({ content: machineInstructions.content, name: machineInstructions.name })
    .from(machineInstructions).where(eq(machineInstructions.id, instructionId)).limit(1)
  return instruction?.content ? formatMachineInstruction(instruction.name, instruction.content) : null
}

/** Verify the user has access to the given project (team-scoped). */
async function verifyProjectAccess(projectId: string, user: AuthUser): Promise<boolean> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(
    and(
      eq(projects.id, projectId),
      inArray(projects.teamId, user.teamIds)
    )
  ).limit(1)
  return !!row
}

/** Look up the user's default AI provider from their settings. Returns undefined if not configured. */
async function resolveUserProvider(userId?: string): Promise<string | undefined> {
  if (!userId) return undefined
  const { userProfiles } = await import('../lib/db/schema.js')
  const [profile] = await db.select({ settings: userProfiles.settings }).from(userProfiles).where(eq(userProfiles.id, userId)).limit(1)
  const settings = profile?.settings as Record<string, string> | null
  return settings?.defaultProvider || undefined
}

/** Scratch directory for text-only relay tasks (label suggestion, refine, etc.) */
const SCRATCH_DIR = join(homedir(), '.astro', 'tmp')
try { mkdirSync(SCRATCH_DIR, { recursive: true }) } catch { /* ignore */ }

// Validation schemas
// Validation limits are generous safety nets — agent SDKs handle context window
// management and compaction internally. These prevent obviously malformed payloads
// without artificially cutting off long conversations. See #1234.
const chatSchema = z.object({
  message: z.string().min(1).max(500_000),
  sessionId: z.string().max(100).nullish(),
  streamId: z.string().max(200).nullish(),
  projectId: z.string().min(1).max(100),
  visionDoc: z.string().max(500_000).nullish(),
  model: z.string().max(100).nullish(),
  providerId: z.string().max(100).nullish(),
  planNodes: z.array(z.any()).max(1000).nullish(),
  planEdges: z.array(z.any()).max(1000).nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(500_000),
  })).max(500).nullish(),
  /** When 'plan', the agent-runner restricts to read-only tools (Read, Glob, Grep, WebSearch, WebFetch). */
  taskType: z.enum(['plan', 'execution']).nullish(),
  /** Blob IDs for attached images (multimodal chat) */
  imageRefs: z.array(z.string().uuid()).max(20).nullish(),
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
    preferredProvider?: string
    resumeSessionId?: string
    streamId?: string
    /** Pathway type for observability (stored in init event) */
    pathwayType?: string
    /** SSE events to emit before dispatching the relay task (e.g. image warnings) */
    preStreamEvents?: Array<{ event: string; data: string }>
    /** Pre-fetched image attachments for multimodal chat */
    images?: ImageAttachment[]
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
    preferredProvider: opts.preferredProvider as ProviderType | undefined,
    maxTurns: opts.maxTurns,
    workingDirectory: opts.workingDirectory,
    useWorktree: false,
    ...(opts.resumeSessionId && { resumeSessionId: opts.resumeSessionId }),
    ...(opts.images?.length && { images: opts.images }),
  }

  // Persist init event for observability (system prompt, pathway type, project context)
  if (opts.pathwayType) {
    await streamingEventLog.append(persistId, 'init', {
      pathwayType: opts.pathwayType,
      projectId: opts.projectId,
      nodeId: opts.nodeId || undefined,
      model: opts.model,
      providerId: opts.preferredProvider,
      hasSystemPrompt: !!opts.systemPrompt,
      systemPrompt: opts.systemPrompt,
    })
  }

  // Persist user message BEFORE starting the relay stream (unified streaming pipeline Phase 1)
  if ((opts.type === 'chat' || opts.type === 'plan') && opts.prompt) {
    await streamingEventLog.append(persistId, 'chat_user', { message: opts.prompt })
  }

  // Emit task:init to global SSE so the frontend realtime store can track this
  // execution (enables dashboard/active-tasks to show it after page refresh).
  // The realtime store handler is idempotent (skips if execution entry exists).
  executionEventBus.emit('task:init', {
    executionId: opts.taskId,
    nodeId: opts.nodeId,
    projectId: opts.projectId,
    machineId: opts.targetMachineId,
    providerId: opts.preferredProvider,
  })

  // Register in executionContextStore so the catch-up endpoint can verify access
  // and flush the in-memory text buffer for this session (chat/plan pathways).
  const user = c.get('user') as { id: string } | undefined
  if (opts.projectId && user?.id) {
    executionContextStore.register({
      executionId: persistId,
      projectId: opts.projectId,
      nodeId: opts.nodeId || '',
      userId: user.id,
      machineId: opts.targetMachineId || '',
    })
  }

  // Fire-and-forget relay dispatch — all subsequent events reach the frontend
  // exclusively through the global SSE bus (relay-server → executionEventBus → events.ts → realtime-store).
  const dispatched = relayServer.dispatchTask(task, opts.targetMachineId, user?.id)

  if (!dispatched) {
    return c.json({ success: false, error: 'No agent runner connected. Start one with: npx astro-agent start --relay wss://<your-relay-url>' }, 503)
  }

  return c.json({ success: true, taskId: opts.taskId, streamId: opts.streamId || opts.taskId })
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
  preferredProvider?: string
  userId?: string
  /** Pathway type for observability (stored in init event) */
  pathwayType?: string
}): Promise<{ success: boolean; output?: string; error?: string }> {
  const startTime = Date.now()
  const task: RelayTaskDispatch = {
    taskId: opts.taskId,
    projectId: opts.projectId,
    nodeId: opts.nodeId,
    title: opts.type || 'summarize',
    description: opts.prompt.slice(0, 200),
    prompt: opts.prompt,
    systemPrompt: opts.systemPrompt,
    type: opts.type,
    preferredProvider: opts.preferredProvider as ProviderType | undefined,
    maxTurns: opts.maxTurns ?? 1,
    workingDirectory: SCRATCH_DIR,
    skipSafetyCheck: true,
    useWorktree: false,
  }

  // Persist init event for one-shot observability
  if (opts.pathwayType) {
    await streamingEventLog.append(opts.taskId, 'init', {
      pathwayType: opts.pathwayType,
      projectId: opts.projectId,
      model: undefined,
      providerId: opts.preferredProvider,
      hasSystemPrompt: !!opts.systemPrompt,
      systemPrompt: opts.systemPrompt,
    })
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
      const isSuccess = msg.result.status === 'completed'
      const metrics = msg.result.metrics

      // Persist result event for one-shot observability (fire-and-forget)
      if (opts.pathwayType) {
        streamingEventLog.appendTerminalIfAbsent(opts.taskId, 'result', {
          status: isSuccess ? 'success' : 'failure',
          error: msg.result.error,
          metrics,
          durationMs: Date.now() - startTime,
        }).catch((err) => {
          console.warn(`[one-shot] Failed to persist result for ${opts.taskId}:`, err)
        })
      }

      resolve({
        success: isSuccess,
        output: msg.result.output || output,
        error: msg.result.error,
      })
    }

    const cleanup = () => {
      relayServer.off('task:text', onText)
      relayServer.off('task:result', onResult)
      // relay-server.ts unconditionally buffers text for all tasks via appendText().
      // One-shot tasks capture text in the local `output` variable and don't need
      // it in streaming_events. Discard the buffer to prevent it accumulating in
      // memory until the next flushAll() (graceful shutdown).
      streamingEventLog.discardText(opts.taskId)
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

/** Fetch image blobs by ID with ownership verification. Returns { images, warnings }. */
async function fetchImageBlobs(imageRefs: string[], user: AuthUser): Promise<{ images: ImageAttachment[]; warning?: string }> {
  if (!imageRefs.length) return { images: [] }
  try {
    const blobRows = await db.select({
      id: blobs.id,
      data: blobs.data,
      mimeType: blobs.mimeType,
      filename: blobs.filename,
    }).from(blobs).where(and(
      inArray(blobs.id, imageRefs),
      inArray(blobs.teamId, user.teamIds),
      isNull(blobs.deletedAt)
    ))
    const images = blobRows.map(row => ({
      blobId: row.id,
      mimeType: row.mimeType,
      data: row.data,
      filename: row.filename,
    }))
    if (images.length < imageRefs.length) {
      const missing = imageRefs.length - images.length
      console.warn(`[agent] ${missing} of ${imageRefs.length} image blobs not found or not accessible`)
      return { images, warning: `${missing} image(s) could not be loaded (deleted or inaccessible)` }
    }
    return { images }
  } catch (err) {
    console.warn('[agent] Failed to fetch image blobs:', err)
    return { images: [], warning: 'Failed to load attached images' }
  }
}

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

  const { message, sessionId: existingSessionId, streamId, projectId, model, providerId, visionDoc, planNodes, planEdges, messages: historyMessages, taskType, imageRefs } = body
  const chatUser = c.get('user') as AuthUser
  // Use streamId as stable taskId across turns (streamId = frontend session.id, stable per conversation).
  // Don't use existingSessionId — that's a provider session ID and changes the relay routing key.
  const taskId = streamId || `project-chat-${projectId}-${Date.now()}`

  // Verify project ownership
  if (!await verifyProjectAccess(projectId, chatUser)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Look up the project's working directory and default machine
  const [project] = await db.select({ workingDirectory: projects.workingDirectory, defaultMachineId: projects.defaultMachineId }).from(projects).where(eq(projects.id, projectId)).limit(1)

  // Look up machine instruction for prompt injection
  let chatSkills: string | undefined
  const chatMachineId = project?.defaultMachineId
  if (chatMachineId) {
    try {
      const [machine] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
        .from(registeredMachines).where(eq(registeredMachines.id, chatMachineId)).limit(1)
      const instrId = machine?.defaultInstructionId ?? DEFAULT_INSTRUCTION_ID
      const resolved = await resolveMachineInstruction(instrId)
      if (resolved) chatSkills = resolved
    } catch (err) {
      console.warn('[agent/project-chat] Failed to fetch machine instruction:', err instanceof Error ? err.message : String(err))
    }
  }
  // Fallback: use built-in default compute guide (loaded from skills/machine_instruction_presets/)
  if (!chatSkills) {
    chatSkills = DEFAULT_MACHINE_INSTRUCTION_FORMATTED
  }

  // Inject platform skills (visualise, etc.) from skill manager
  const { skillManager } = await import('../lib/skill-manager.js')
  const chatTeamId = chatUser.teamId
  const chatPlatformSkills = skillManager.getSkillPromptInjection(chatTeamId)
  if (chatPlatformSkills) {
    chatSkills = chatSkills + '\n\n' + chatPlatformSkills
  }

  // Inject lightweight generative UI hint (full catalog is in render-ui skill, loaded on-demand)
  chatSkills = (chatSkills || '') + '\n\n' + GENERATIVE_UI_HINT

  const systemPrompt = buildChatSystemPrompt(visionDoc, planNodes, planEdges, chatSkills, projectId, taskType)

  // Persist user message for catch-up hydration
  await streamingEventLog.append(streamId || taskId, 'steer_message', { message })

  const preStreamEvents: Array<{ event: string; data: string }> = []

  // Forward messages as fallback context for the agent runner — used only if session
  // resume fails (e.g. session expired). Context window management and compaction are
  // handled internally by each agent SDK (Claude, Codex, OpenClaw). See #1234.
  const resolvedResumeId = existingSessionId || undefined

  // Fetch image blobs if attached
  let chatImages: ImageAttachment[] | undefined
  if (imageRefs?.length) {
    const result = await fetchImageBlobs(imageRefs, chatUser)
    chatImages = result.images.length > 0 ? result.images : undefined
    if (result.warning) {
      preStreamEvents.push({ event: 'text', data: `> ⚠️ ${result.warning}\n\n` })
    }
  }

  return streamChatViaRelay(c, {
    taskId,
    projectId,
    nodeId: '',
    prompt: message,
    systemPrompt,
    type: taskType || 'chat',
    messages: historyMessages ?? undefined,
    model: model || undefined,
    preferredProvider: providerId || undefined,
    workingDirectory: project?.workingDirectory ?? undefined,
    targetMachineId: project?.defaultMachineId ?? undefined,
    resumeSessionId: resolvedResumeId,
    streamId,
    pathwayType: taskType === 'plan' ? 'plan-chat' : 'project-chat',
    preStreamEvents,
    images: chatImages,
  })
})

const taskChatSchema = z.object({
  message: z.string().min(1).max(500_000),
  sessionId: z.string().nullable().optional(),
  streamId: z.string().max(200).optional(),
  nodeId: z.string().min(1),
  projectId: z.string().uuid(),
  taskTitle: z.string().max(1000),
  taskDescription: z.string().max(500_000).default(""),
  taskOutput: z.string().max(500_000).nullable().optional(),
  visionDoc: z.string().max(500_000).nullable().optional(),
  model: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(500_000),
  })).max(500).optional(),
  // Execution context for resumed sessions
  branchName: z.string().max(500).nullable().optional(),
  prUrl: z.string().max(2000).nullable().optional(),
  /** Blob IDs for attached images (multimodal chat) */
  imageRefs: z.array(z.string().uuid()).max(20).optional(),
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
    providerId,
    messages: historyMessages,
    branchName,
    prUrl,
    imageRefs: taskImageRefs,
  } = body

  const isResumedSession = !!existingSessionId
  // Use streamId as stable taskId across turns — don't use existingSessionId as taskId
  // since that changes the relay routing key and breaks agent-runner preservedSessions lookup.
  const taskId = streamId || `task-chat-${nodeId}-${Date.now()}`

  // Verify project ownership
  const taskChatUser = c.get('user') as AuthUser
  if (!await verifyProjectAccess(projectId, taskChatUser)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Look up the project's working directory and default machine
  const [project] = await db.select({ workingDirectory: projects.workingDirectory, defaultMachineId: projects.defaultMachineId }).from(projects).where(eq(projects.id, projectId)).limit(1)

  // Look up machine instruction for prompt injection
  let tcSkills: string | undefined
  const tcMachineId = project?.defaultMachineId
  if (tcMachineId) {
    try {
      const [machine] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
        .from(registeredMachines).where(eq(registeredMachines.id, tcMachineId)).limit(1)
      const instrId = machine?.defaultInstructionId ?? DEFAULT_INSTRUCTION_ID
      const resolved = await resolveMachineInstruction(instrId)
      if (resolved) tcSkills = resolved
    } catch (err) {
      console.warn('[agent/task-chat] Failed to fetch machine instruction:', err instanceof Error ? err.message : String(err))
    }
  }
  // Task-chat skips machine instructions (Docker/K8s/Slurm commands are irrelevant
  // for reviewing results), but always injects the lightweight Generative UI hint
  // so playground follow-up chat and task detail chat can render rich components.
  tcSkills = (tcSkills || '') + '\n\n' + GENERATIVE_UI_HINT

  const systemPrompt = buildTaskChatSystemPrompt({
    taskTitle,
    taskDescription,
    taskOutput,
    visionDoc,
    isResumedSession,
    branchName: branchName || undefined,
    prUrl: prUrl || undefined,
    skillsInjection: tcSkills,
  })

  // Persist user message for catch-up hydration
  await streamingEventLog.append(streamId || taskId, 'steer_message', { message })

  // When resuming a provider session, the session already has conversation context.
  // Still forward messages so the agent runner can use them as fallback context
  // if the resume fails (e.g. Codex session expired) and it falls back to fresh execution.
  const tcResumeId = existingSessionId || undefined

  // Fetch image blobs if attached
  let tcImages: ImageAttachment[] | undefined
  const tcPreStreamEvents: Array<{ event: string; data: string }> = []
  if (taskImageRefs?.length) {
    const result = await fetchImageBlobs(taskImageRefs, taskChatUser)
    tcImages = result.images.length > 0 ? result.images : undefined
    if (result.warning) {
      tcPreStreamEvents.push({ event: 'text', data: `> ⚠️ ${result.warning}\n\n` })
    }
  }

  return streamChatViaRelay(c, {
    taskId,
    projectId,
    nodeId,
    prompt: message,
    systemPrompt,
    type: 'chat',
    messages: historyMessages,
    model: model || undefined,
    preferredProvider: providerId || undefined,
    workingDirectory: project?.workingDirectory ?? undefined,
    targetMachineId: project?.defaultMachineId ?? undefined,
    resumeSessionId: tcResumeId,
    streamId,
    pathwayType: 'task-chat',
    preStreamEvents: tcPreStreamEvents.length > 0 ? tcPreStreamEvents : undefined,
    images: tcImages,
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

  // Insert a synthetic terminal event so the frontend sees the abort immediately,
  // even if the relay/agent never responds. If the agent later sends its own
  // terminal event, deriveStreamStatus() returns the first terminal state
  // encountered (scanning backwards), so the abort wins.
  streamingEventLog.append(id, 'result', {
    status: 'aborted',
    synthetic: true,
    output: 'Aborted by user',
  }).catch((err) => {
    console.warn('[agent/abort] Failed to persist synthetic abort event:', (err as Error).message)
  })

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
    providerId,
    maxTurns,
  } = body

  const executionId = `exec-${nodeId}-${Date.now()}`

  // Look up the project's default machine for skill/instruction injection
  let dispatchSkills: string | undefined
  let targetMachineId: string | undefined
  try {
    const [project] = await db.select({ defaultMachineId: projects.defaultMachineId })
      .from(projects).where(eq(projects.id, projectId)).limit(1)
    targetMachineId = project?.defaultMachineId ?? undefined
    if (targetMachineId) {
      const [machine] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
        .from(registeredMachines).where(eq(registeredMachines.id, targetMachineId)).limit(1)
      const instrId = machine?.defaultInstructionId ?? DEFAULT_INSTRUCTION_ID
      const resolved = await resolveMachineInstruction(instrId)
      if (resolved) dispatchSkills = resolved
    }
  } catch (err) {
    console.warn('[agent/dispatch] Failed to fetch machine instruction:', err instanceof Error ? err.message : String(err))
  }
  if (!dispatchSkills) {
    dispatchSkills = DEFAULT_MACHINE_INSTRUCTION_FORMATTED
  }

  // Inject platform skills (visualise, etc.) from skill manager
  const { skillManager } = await import('../lib/skill-manager.js')
  const teamId = (c.get('user') as AuthUser).teamId
  const platformSkills = skillManager.getSkillPromptInjection(teamId)
  if (platformSkills) {
    dispatchSkills = dispatchSkills + '\n\n' + platformSkills
  }

  const prompt = buildTaskExecutionPrompt({
    taskTitle,
    taskDescription,
    visionDoc,
    dependencyOutputs,
    workingDirectory,
    skillsInjection: dispatchSkills,
  })
  return streamChatViaRelay(c, {
    taskId: executionId,
    projectId,
    nodeId,
    prompt,
    type: 'execution',
    preferredProvider: providerId || undefined,
    workingDirectory,
    maxTurns,
    pathwayType: 'execution',
    targetMachineId,
  })
})

agentRoute.post('/summarize', async (c) => {
  const body = await c.req.json<{
    taskTitle: string
    taskDescription: string
    executionOutput: string
    fileChanges: Array<{ path: string; action: string }>
    status: 'success' | 'failure'
    providerId?: string
  }>()

  console.log(`[summarize] Summary requested for task: ${body.taskTitle} (status: ${body.status})`)

  const summaryUser = c.get('user') as { id: string } | undefined
  const effectiveProvider = body.providerId || await resolveUserProvider(summaryUser?.id)
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
    preferredProvider: effectiveProvider,
    pathwayType: 'summarize',
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
  const body = await c.req.json<{ description: string; providerId?: string }>()
  const { description } = body

  if (!description || typeof description !== 'string' || description.length < 1) {
    return c.json({ error: 'Description is required' }, 400)
  }

  const titleUser = c.get('user') as { id: string } | undefined
  const effectiveProvider = body.providerId || await resolveUserProvider(titleUser?.id)
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
    preferredProvider: effectiveProvider,
    pathwayType: 'title-gen',
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
    providerId: z.string().max(100).optional(),
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
  const effectiveProvider = body.providerId || await resolveUserProvider(refineUser?.id)
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
    preferredProvider: effectiveProvider,
    pathwayType: 'refine',
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
    providerId: z.string().max(100).optional(),
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
  const effectiveProvider = body.providerId || await resolveUserProvider(labelUser?.id)
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
    preferredProvider: effectiveProvider,
    pathwayType: 'suggest-labels',
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
