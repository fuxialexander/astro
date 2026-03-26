/**
 * SSE Event Stream Routes
 *
 * Real-time bridge from relay server events to browser clients.
 * Forwards task execution events, machine state changes, and
 * other relay events as Server-Sent Events.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { and, eq, inArray } from 'drizzle-orm'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'
import { db } from '../lib/db/index.js'
import { projects, taskExecutions } from '../lib/db/schema.js'
import { relayServer } from '../lib/relay-server.js'
import { machineRegistry } from '../lib/machine-registry.js'
import { eventBuffer } from '../lib/event-buffer.js'
import { StdoutThrottle } from '../lib/stdout-throttle.js'
import type {
  TaskResultMessage,
  TaskStdoutMessage,
  TaskProgressMessage,
  TaskSteerAckMessage,
  TaskToolTraceMessage,
  TaskFileChangeMessage,
  TaskSessionInitMessage,
  SessionEvent,
} from '../types/relay.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { getMachine, getTeamSharedMachineIds } from '../lib/registered-machines-store.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { redisPubSub, type StreamingEventMessage } from '../lib/redis-pubsub.js'
import { astroEventTransport } from '../lib/events/astro-event-transport.js'
import type { ApprovalRequestedEvent, ApprovalRespondedEvent, ProjectCompletedEvent } from '../lib/events/types.js'
import { executionContextStore } from '../lib/execution-context-store.js'
import { streamingEventLog } from '../lib/streaming-event-log.js'
import { isYoloMode } from '../lib/yolo-mode.js'
import { channelRouter } from '../lib/channel/channel-router.js'
import { incrementGlobalSSE, decrementGlobalSSE } from '../lib/sse-connection-tracker.js'
import type {
  TaskTextMessage,
  TaskOperationalMessage as RelayTaskOperationalMessage,
  TaskSessionInitMessage as RelayTaskSessionInitMessage,
  TaskProgressMessage as RelayTaskProgressMessage,
  TaskToolTraceMessage as RelayTaskToolTraceMessage,
  TaskFileChangeMessage as RelayTaskFileChangeMessage,
} from '../types/relay.js'

const ASTRO_BASE_URL = process.env.ASTRO_BASE_URL || 'http://localhost:5173'

const eventsRoute = new Hono()

// Dedup set for channel notifications — prevents sending N Telegram polls
// when a user has N browser tabs open (each tab registers its own SSE handler).
// Entries auto-expire after 5 minutes (matching approval timeout).
const notifiedApprovalRequests = new Set<string>()

interface ResolvedExecutionContext {
  executionId: string
  projectId: string
  nodeId: string | null
  userId: string | null
  machineId: string | null
}

async function isProjectAccessibleToUser(
  user: AuthUser | undefined,
  projectId: string,
): Promise<boolean> {
  if (!user?.id) return false

  try {
    const [project] = await db.select({ id: projects.id }).from(projects).where(
      and(
        eq(projects.id, projectId),
        inArray(projects.teamId, user.teamIds),
      ),
    ).limit(1)
    return !!project
  } catch (err) {
    console.error('[events] Project access check failed:', err)
    return false
  }
}

async function loadExecutionContext(
  executionId: string,
): Promise<ResolvedExecutionContext | null> {
  const context = await executionContextStore.getWithFallback(executionId)
  if (context) {
    return {
      executionId: context.executionId,
      projectId: context.projectId,
      nodeId: context.nodeId,
      userId: context.userId,
      machineId: context.machineId,
    }
  }

  try {
    const [execution] = await db.select({
      executionId: taskExecutions.executionId,
      projectId: taskExecutions.projectId,
      nodeId: taskExecutions.nodeClientId,
      userId: taskExecutions.userId,
      machineId: taskExecutions.machineId,
    }).from(taskExecutions).where(eq(taskExecutions.executionId, executionId)).limit(1)

    if (!execution) return null

    return {
      executionId: execution.executionId,
      projectId: execution.projectId,
      nodeId: execution.nodeId,
      userId: execution.userId,
      machineId: execution.machineId,
    }
  } catch (err) {
    console.error('[events] Execution context lookup failed:', err)
    return null
  }
}

// All events routes require authentication
eventsRoute.use('/*', requireAuth)

/**
 * SSE event stream endpoint
 *
 * GET /api/events/stream
 *
 * Query params:
 * - projectId (optional): filter events to a specific project
 *
 * Headers:
 * - Last-Event-ID: replay events after this ID on reconnection
 */
eventsRoute.get('/stream', async (c) => {
  // projectId filter is reserved for future use
  void c.req.query('projectId')
  const lastEventId = c.req.header('Last-Event-ID')
  // Client sends lastSeq on reconnect for DB-backed catch-up of streaming events
  void c.req.query('lastSeq')

  // Extract authenticated user for filtering machine events
  const user = c.get('user') as AuthUser | undefined

  // Disable proxy buffering so SSE chunks flush immediately (Fly.io, nginx)
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let alive = true
    incrementGlobalSSE()

    // Hono's streamSSE only wires c.req.raw.signal → stream.abort() for old Bun.
    // On Node.js, @hono/node-server fires signal.abort() via outgoing.on("close"),
    // but the SSE helper never listens to it — so onAbort() subscribers are never
    // called when the client disconnects (tab close, refresh, network drop).
    // Wire it explicitly so every client disconnect immediately sets alive=false.
    c.req.raw.signal.addEventListener('abort', () => {
      alive = false
    }, { once: true })

    // Stdout throttle for this connection
    const throttle = new StdoutThrottle((taskId, data) => {
      if (!alive) return
      const id = eventBuffer.push('task:stdout', JSON.stringify({ taskId, data }))
      stream.writeSSE({ id, event: 'task:stdout', data: JSON.stringify({ taskId, data }) }).catch(() => {
        alive = false
      })
    })

    // Track projects whose safety prompts have been approved (per SSE session).
    // Once a user approves "Continue anyway" for any task in a project, all
    // subsequent tasks in the same project auto-proceed silently.
    const safetyApprovedProjects = new Set<string>()
    const executionContextCache = new Map<string, Promise<ResolvedExecutionContext | null>>()
    /** Track when a null result was cached so we can expire it and retry */
    const nullCacheTimestamps = new Map<string, number>()
    /** How long to cache a null (not-found) execution context before retrying */
    const NULL_CACHE_TTL_MS = 5_000
    const projectAccessCache = new Map<string, Promise<boolean>>()

    const getExecutionContextForTask = (taskId: string): Promise<ResolvedExecutionContext | null> => {
      const cached = executionContextCache.get(taskId)
      if (cached) {
        // If this was a null result, check if it has expired
        const nullTs = nullCacheTimestamps.get(taskId)
        if (nullTs && Date.now() - nullTs > NULL_CACHE_TTL_MS) {
          // Expired negative cache — evict and retry
          executionContextCache.delete(taskId)
          nullCacheTimestamps.delete(taskId)
        } else {
          return cached
        }
      }

      const pending = loadExecutionContext(taskId)
        .then((result) => {
          if (!result) {
            // Track when we cached a null so we can expire it
            nullCacheTimestamps.set(taskId, Date.now())
            console.warn(`[events] Execution context not found for task ${taskId} — will retry in ${NULL_CACHE_TTL_MS}ms`)
          }
          return result
        })
        .catch((err) => {
          console.error('[events] Failed to resolve execution context:', err)
          nullCacheTimestamps.set(taskId, Date.now())
          return null
        })
      executionContextCache.set(taskId, pending)
      return pending
    }

    const isProjectOwnedByUser = (projectId: string): Promise<boolean> => {
      const cached = projectAccessCache.get(projectId)
      if (cached) return cached

      const pending = isProjectAccessibleToUser(user, projectId)
      projectAccessCache.set(projectId, pending)
      return pending
    }

    const canAccessTaskContext = async (
      ctx: ResolvedExecutionContext | null,
    ): Promise<boolean> => {
      if (!user?.id) return false
      if (!ctx?.projectId) return false
      return isProjectOwnedByUser(ctx.projectId)
    }

    const isTaskOwnedByUser = async (taskId: string): Promise<boolean> => {
      const ctx = await getExecutionContextForTask(taskId)
      return canAccessTaskContext(ctx)
    }

    /** Track which taskIds we've already warned about to avoid log spam */
    const accessDeniedWarned = new Set<string>()

    const withTaskAccess = (
      taskId: string,
      handler: (ctx: ResolvedExecutionContext | null) => void | Promise<void>,
    ): void => {
      void (async () => {
        if (!alive) return
        const ctx = await getExecutionContextForTask(taskId)
        if (!await canAccessTaskContext(ctx)) {
          if (!accessDeniedWarned.has(taskId)) {
            accessDeniedWarned.add(taskId)
            console.warn(`[events] Dropping event for task ${taskId}: context=${ctx ? `project=${ctx.projectId}` : 'null'}`)
          }
          return
        }
        if (!alive) return
        await handler(ctx)
      })()
    }

    // Replay missed events on reconnection (filtered by user ownership)
    // EventBuffer handles non-task events (machine:connected, approval events)
    if (lastEventId) {
      const missed = eventBuffer.getAfter(lastEventId)
      for (const event of missed) {
        // Filter replayed events by user ownership where possible
        if (event.event.startsWith('task:') || event.event === 'session:attached' ||
            event.event === 'session:detached' || event.event === 'session:event') {
          try {
            const parsed = JSON.parse(event.data)
            const taskId = parsed.taskId
            if (taskId && !await isTaskOwnedByUser(taskId)) continue
          } catch { /* allow non-JSON events */ }
        }
        await stream.writeSSE({ id: event.id, event: event.event, data: event.data })
      }
    }

    // Send initial machine list (filtered by authenticated user + team shared)
    // Cross-reference with persistent store to prefer user-set names
    const allMachines = machineRegistry.getAll()
    const teamSharedIds = user?.teamIds ? await getTeamSharedMachineIds(user.teamIds) : new Set<string>()
    const machines = allMachines.filter(m =>
      !m.userId || m.userId === user?.id || m.userId === LOCAL_USER_ID || teamSharedIds.has(m.machineId)
    )
    const machineData = await Promise.all(machines.map(async (m) => {
      const dbMachine = await getMachine(m.machineId)
      // Prefer user-set name from DB if it differs from hostname (i.e., user renamed it)
      const name = (dbMachine?.name && dbMachine.name !== dbMachine.hostname && dbMachine.name !== m.machineId)
        ? dbMachine.name
        : m.name
      return {
        machineId: m.machineId,
        name,
        environmentType: m.environmentType,
        connectionStatus: m.connectionStatus,
        providers: m.providers,
        executionStrategies: m.executionStrategies,
        resources: m.resources,
        load: m.load,
      }
    }))
    await stream.writeSSE({
      event: 'machines:snapshot',
      data: JSON.stringify(machineData),
    })

    // Event handlers
    const onTaskInit = async (msg: { executionId: string; nodeId: string; projectId: string; machineId?: string; providerId?: string; providerName?: string; computeBackend?: string }) => {
      if (!alive) return
      if (!await isProjectOwnedByUser(msg.projectId)) return
      const data = JSON.stringify(msg)
      const id = eventBuffer.push('task:init', data)
      stream.writeSSE({ id, event: 'task:init', data }).catch(() => { alive = false })
    }

    const onTaskReady = async (msg: { nodeId: string; projectId: string }) => {
      if (!alive) return
      // Filter by project ownership
      if (!await isProjectOwnedByUser(msg.projectId)) return
      const data = JSON.stringify({ nodeId: msg.nodeId, projectId: msg.projectId })
      const id = eventBuffer.push('task:ready', data)
      stream.writeSSE({ id, event: 'task:ready', data }).catch(() => { alive = false })
    }

    const onTaskResult = (msg: TaskResultMessage & { finalNodeStatus?: string }) => {
      withTaskAccess(msg.result.taskId, async (resultCtx) => {
        const data = JSON.stringify({
          taskId: msg.result.taskId,
          status: msg.result.status,
          output: msg.result.output,
          error: msg.result.error,
          duration: msg.result.duration,
          branchName: msg.result.branchName,
          prUrl: msg.result.prUrl,
          prNumber: msg.result.prNumber,
          deliveryStatus: msg.result.deliveryStatus,
          finalNodeStatus: msg.finalNodeStatus,
        })
        const id = eventBuffer.push('task:result', data)
        stream.writeSSE({ id, event: 'task:result', data }).catch(() => { alive = false })

        streamingEventLog.appendTerminalIfAbsent(msg.result.taskId, 'result', {
          executionId: msg.result.taskId,
          nodeId: resultCtx?.nodeId ?? undefined,
          status: msg.result.status,
          output: msg.result.output,
          error: msg.result.error,
          duration: msg.result.duration,
          branchName: msg.result.branchName,
          prUrl: msg.result.prUrl,
          prNumber: msg.result.prNumber,
          deliveryStatus: msg.result.deliveryStatus,
        }).catch((err) => console.warn('[events] Failed to persist task result:', (err as Error).message))
      })
    }

    const onTaskStdout = (msg: TaskStdoutMessage) => {
      withTaskAccess(msg.output.taskId, () => {
        throttle.write(msg.output.taskId, msg.output.data)
      })
    }

    const onTaskProgress = (msg: TaskProgressMessage) => {
      withTaskAccess(msg.taskId, () => {
        const data = JSON.stringify({
          taskId: msg.taskId,
          progress: msg.progress,
          message: msg.message,
        })
        const id = eventBuffer.push('task:progress', data)
        stream.writeSSE({ id, event: 'task:progress', data }).catch(() => { alive = false })
      })
    }

    const onTaskSteerAck = (msg: TaskSteerAckMessage & { interrupted?: boolean }) => {
      withTaskAccess(msg.taskId, () => {
        const data = JSON.stringify({
          taskId: msg.taskId,
          accepted: msg.accepted,
          message: msg.message,
          interrupted: msg.interrupted,
        })
        const id = eventBuffer.push('task:steer_ack', data)
        stream.writeSSE({ id, event: 'task:steer_ack', data }).catch(() => { alive = false })
      })
    }

    const onTaskToolTrace = (msg: TaskToolTraceMessage) => {
      withTaskAccess(msg.taskId, () => {
        const data = JSON.stringify({
          taskId: msg.taskId,
          toolName: msg.toolName,
          toolInput: msg.toolInput,
          toolResult: msg.toolResult,
          success: msg.success,
          duration: msg.duration,
          ...(msg.toolUseId ? { toolUseId: msg.toolUseId } : {}),
        })
        const id = eventBuffer.push('task:tool_trace', data)
        stream.writeSSE({ id, event: 'task:tool_trace', data }).catch(() => { alive = false })
      })
    }

    const onTaskFileChange = (msg: TaskFileChangeMessage) => {
      withTaskAccess(msg.taskId, () => {
        const data = JSON.stringify({
          taskId: msg.taskId,
          path: msg.path,
          action: msg.action,
          linesAdded: msg.linesAdded,
          linesRemoved: msg.linesRemoved,
          diff: msg.diff,
        })
        const id = eventBuffer.push('task:file_change', data)
        stream.writeSSE({ id, event: 'task:file_change', data }).catch(() => { alive = false })
      })
    }

    const onTaskSessionInit = (msg: TaskSessionInitMessage) => {
      withTaskAccess(msg.taskId, () => {
        const data = JSON.stringify({
          taskId: msg.taskId,
          sessionId: msg.sessionId,
          model: msg.model,
        })
        const id = eventBuffer.push('task:session_init', data)
        stream.writeSSE({ id, event: 'task:session_init', data }).catch(() => { alive = false })
      })
    }

    const onTaskApprovalRequest = (msg: { taskId: string; requestId: string; question: string; options: string[]; machineId?: string }) => {
      withTaskAccess(msg.taskId, async (ctx) => {
        /** Send SSE to browser + notify configured channels */
        const sendApprovalToUIAndChannels = async () => {
          const data = JSON.stringify({
            taskId: msg.taskId,
            requestId: msg.requestId,
            question: msg.question,
            options: msg.options,
            machineId: msg.machineId,
          })
          const id = eventBuffer.push('task:approval_request', data)
          stream.writeSSE({ id, event: 'task:approval_request', data }).catch(() => { alive = false })

          streamingEventLog.appendApprovalRequestIfAbsent(msg.taskId, {
            requestId: msg.requestId,
            question: msg.question,
            options: msg.options,
            machineId: msg.machineId,
          }).catch((err) => console.warn('[events] Failed to persist approval_request:', (err as Error).message))

          // Also route to configured channels (OpenClaw/Telegram/Slack/etc.)
          // Channels can respond interactively — first response wins (agent runner deduplicates).
          // Deduplicate: multiple SSE connections (browser tabs) share this relay event,
          // but channel notification should fire only once per requestId.
          // Dedup across instances: Redis SETNX returns true only for the first instance.
          // Local Set still used as fast-path guard to avoid redundant Redis calls.
          const shouldNotify = !notifiedApprovalRequests.has(msg.requestId)
            && await redisPubSub.markApprovalNotified(msg.requestId)
          if (shouldNotify) {
            notifiedApprovalRequests.add(msg.requestId)
            setTimeout(() => notifiedApprovalRequests.delete(msg.requestId), 300_000)

            if (ctx?.projectId) {
              // Route plan generation approvals to dashboard (plan page is empty during generation)
              // Route playground approvals to playground page (no plan node exists)
              const astroUrl = ctx.nodeId?.startsWith('plan-')
                ? ASTRO_BASE_URL
                : ctx.nodeId?.startsWith('playground-')
                  ? `${ASTRO_BASE_URL}/playground?projectId=${ctx.projectId}`
                  : `${ASTRO_BASE_URL}/project/${ctx.projectId}/task/${ctx.nodeId}`
              channelRouter.sendNotification({
                type: 'approval.requested',
                projectId: ctx.projectId,
                summary: msg.question,
                astroUrl,
                metadata: {
                  requestId: msg.requestId,
                  taskId: msg.taskId,
                  options: msg.options,
                  machineId: msg.machineId,
                },
              }).catch(err => console.error('[events] Failed to send approval notification to channels:', err))
            }
          }
        }

        // Check YOLO mode fresh from DB (not cached) so mid-session toggles take effect
        // Pass taskId so playground tasks check playgroundYoloMode separately
        isYoloMode(user?.id, msg.taskId).then((yoloEnabled) => {
          if (!alive) return

          // YOLO mode: auto-approve with first option (AI's recommendation)
          if (yoloEnabled && msg.machineId && msg.options.length > 0) {
            const autoAnswer = msg.options[0]
            relayServer.sendApprovalResponse(msg.taskId, msg.machineId, msg.requestId, true, autoAnswer)
            console.log(`[events] YOLO auto-approved: task=${msg.taskId} request=${msg.requestId} answer="${autoAnswer}"`)

            // Persist approval_response so hydration on page refresh shows it as answered
            streamingEventLog.appendApprovalResponseIfAbsent(msg.taskId, {
              requestId: msg.requestId, answer: autoAnswer, answered: true,
            }).catch((err) => console.warn('[events] Failed to persist YOLO approval_response:', (err as Error).message))

            // Send auto-responded notification to browser instead of the approval dialog
            const autoData = JSON.stringify({
              taskId: msg.taskId,
              requestId: msg.requestId,
              question: msg.question,
              options: msg.options,
              answer: autoAnswer,
              autoApproved: true,
            })
            const id = eventBuffer.push('task:approval_auto_responded', autoData)
            stream.writeSSE({ id, event: 'task:approval_auto_responded', data: autoData }).catch(() => { alive = false })
            return
          }

          sendApprovalToUIAndChannels()
        }).catch(() => {
          // On error reading settings, fall through to normal approval flow
          sendApprovalToUIAndChannels()
        })
      })
    }

    /** Auto-proceed a safety prompt and notify the browser */
    const autoSafetyProceed = (msg: { taskId: string; safetyTier: string; warning?: string; machineId?: string; options?: Array<{ id: string; label: string; description?: string }> }, reason: string) => {
      relayServer.sendSafetyDecision(msg.taskId, msg.machineId!, 'proceed')
      console.log(`[events] ${reason} safety auto-proceed: task=${msg.taskId} tier=${msg.safetyTier}`)

      // Persist safety_prompt before the response so hydration on page refresh sees both
      if (msg.options) {
        streamingEventLog.appendSafetyPromptIfAbsent(msg.taskId, {
          safetyTier: msg.safetyTier, warning: msg.warning, machineId: msg.machineId, options: msg.options,
        }).catch((err) => console.warn('[events] Failed to persist safety_prompt:', (err as Error).message))
      }
      streamingEventLog.append(msg.taskId, 'safety_response', { decision: 'proceed', autoApproved: true }).catch((err) => console.warn('[events] Failed to persist safety_response:', (err as Error).message))

      const autoData = JSON.stringify({
        taskId: msg.taskId,
        safetyTier: msg.safetyTier,
        warning: msg.warning,
        decision: 'proceed',
        autoApproved: true,
      })
      const autoId = eventBuffer.push('task:safety_auto_proceeded', autoData)
      stream.writeSSE({ id: autoId, event: 'task:safety_auto_proceeded', data: autoData }).catch(() => { alive = false })
    }

    const persistSafetyPromptIfNeeded = (msg: { taskId: string; safetyTier: string; warning?: string; machineId?: string; options: Array<{ id: string; label: string; description?: string }> }) => {
      streamingEventLog.appendSafetyPromptIfAbsent(msg.taskId, {
        safetyTier: msg.safetyTier,
        warning: msg.warning,
        machineId: msg.machineId,
        options: msg.options,
      }).catch((err) => console.warn('[events] Failed to persist safety_prompt:', (err as Error).message))
    }

    const onTaskSafetyPrompt = (msg: { taskId: string; safetyTier: string; warning?: string; machineId?: string; options: Array<{ id: string; label: string; description?: string }> }) => {
      withTaskAccess(msg.taskId, (ctx) => {
        if (!msg.machineId) {
          // No machine to send decision to — show dialog as fallback
          const data = JSON.stringify(msg)
          const id = eventBuffer.push('task:safety_prompt', data)
          stream.writeSSE({ id, event: 'task:safety_prompt', data }).catch(() => { alive = false })
          persistSafetyPromptIfNeeded(msg)
          return
        }

        // Per-project auto-proceed: if user already approved for this project, skip the dialog
        if (ctx?.projectId && safetyApprovedProjects.has(ctx.projectId)) {
          autoSafetyProceed(msg, 'Per-project')
          return
        }

        // YOLO mode: auto-proceed for safety prompts (skip the dialog)
        isYoloMode(user?.id, msg.taskId).then((yoloEnabled) => {
          if (!alive) return

          if (yoloEnabled) {
            if (ctx?.projectId) safetyApprovedProjects.add(ctx.projectId)
            autoSafetyProceed(msg, 'YOLO')
            return
          }

          const data = JSON.stringify(msg)
          const id = eventBuffer.push('task:safety_prompt', data)
          stream.writeSSE({ id, event: 'task:safety_prompt', data }).catch(() => { alive = false })
          persistSafetyPromptIfNeeded(msg)
        }).catch(() => {
          const data = JSON.stringify(msg)
          const id = eventBuffer.push('task:safety_prompt', data)
          stream.writeSSE({ id, event: 'task:safety_prompt', data }).catch(() => { alive = false })
          persistSafetyPromptIfNeeded(msg)
        })
      })
    }

    const onMachineConnected = async (machineId: string, machineUserId: string) => {
      if (!alive) return
      // Filter: only send events for machines owned by this user
      if (machineUserId && machineUserId !== LOCAL_USER_ID && user?.id && machineUserId !== user.id) return
      const entry = machineRegistry.get(machineId)
      // Cross-reference with persistent store for user-set name
      const dbMachine = await getMachine(machineId)
      const name = (dbMachine?.name && dbMachine.name !== dbMachine.hostname && dbMachine.name !== machineId)
        ? dbMachine.name
        : entry?.name
      const data = JSON.stringify({
        machineId,
        userId: machineUserId,
        name,
        environmentType: entry?.environmentType,
        providers: entry?.providers,
        executionStrategies: entry?.executionStrategies,
        resources: entry?.resources,
        load: entry?.load,
      })
      const id = eventBuffer.push('machine:connected', data)
      stream.writeSSE({ id, event: 'machine:connected', data }).catch(() => { alive = false })
    }

    const onMachineDisconnected = (machineId: string, reason?: string) => {
      if (!alive) return
      // Note: machine is already removed from registry at this point,
      // so we can't look up userId. The browser will filter by its known machines.
      const data = JSON.stringify({ machineId, reason })
      const id = eventBuffer.push('machine:disconnected', data)
      stream.writeSSE({ id, event: 'machine:disconnected', data }).catch(() => { alive = false })
    }

    // Session attachment event handlers (MCP bridge) — filter by task ownership
    const onSessionAttached = (sessionId: string, taskId: string, machineId: string) => {
      withTaskAccess(taskId, () => {
        const data = JSON.stringify({ sessionId, taskId, machineId, attachedAt: new Date().toISOString() })
        const id = eventBuffer.push('session:attached', data)
        stream.writeSSE({ id, event: 'session:attached', data }).catch(() => { alive = false })
      })
    }

    const onSessionDetached = (sessionId: string, taskId: string, reason?: string) => {
      withTaskAccess(taskId, () => {
        const data = JSON.stringify({ sessionId, taskId, reason })
        const id = eventBuffer.push('session:detached', data)
        stream.writeSSE({ id, event: 'session:detached', data }).catch(() => { alive = false })
      })
    }

    const onSessionEvent = (sessionId: string, taskId: string, event: SessionEvent) => {
      withTaskAccess(taskId, () => {
        const data = JSON.stringify({ sessionId, taskId, event })
        const id = eventBuffer.push('session:event', data)
        stream.writeSSE({ id, event: 'session:event', data }).catch(() => { alive = false })
      })
    }

    // Approval event handlers — filter by execution/task ownership
    const onApprovalRequested = (event: ApprovalRequestedEvent) => {
      if (!event.executionId) {
        void (async () => {
          if (!alive) return
          if (!await isProjectOwnedByUser(event.projectId)) return
          const data = JSON.stringify({
            approvalId: event.approvalId,
            nodeId: event.nodeId,
            projectId: event.projectId,
            executionId: event.executionId,
            message: event.message,
            options: event.options,
            timestamp: event.timestamp,
          })
          const id = eventBuffer.push('approval:requested', data)
          stream.writeSSE({ id, event: 'approval:requested', data }).catch(() => { alive = false })
        })()
        return
      }

      withTaskAccess(event.executionId, () => {
        const data = JSON.stringify({
          approvalId: event.approvalId,
          nodeId: event.nodeId,
          projectId: event.projectId,
          executionId: event.executionId,
          message: event.message,
          options: event.options,
          timestamp: event.timestamp,
        })
        const id = eventBuffer.push('approval:requested', data)
        stream.writeSSE({ id, event: 'approval:requested', data }).catch(() => { alive = false })
      })
    }

    const onApprovalResponded = (event: ApprovalRespondedEvent) => {
      if (!event.executionId) {
        void (async () => {
          if (!alive) return
          if (!await isProjectOwnedByUser(event.projectId)) return
          const data = JSON.stringify({
            approvalId: event.approvalId,
            nodeId: event.nodeId,
            projectId: event.projectId,
            executionId: event.executionId,
            approved: event.approved,
            selectedOption: event.selectedOption,
            timestamp: event.timestamp,
          })
          const id = eventBuffer.push('approval:responded', data)
          stream.writeSSE({ id, event: 'approval:responded', data }).catch(() => { alive = false })
        })()
        return
      }

      withTaskAccess(event.executionId, () => {
        const data = JSON.stringify({
          approvalId: event.approvalId,
          nodeId: event.nodeId,
          projectId: event.projectId,
          executionId: event.executionId,
          approved: event.approved,
          selectedOption: event.selectedOption,
          timestamp: event.timestamp,
        })
        const id = eventBuffer.push('approval:responded', data)
        stream.writeSSE({ id, event: 'approval:responded', data }).catch(() => { alive = false })
      })
    }

    // Subscribe to relay events directly. Relay-originated streaming events
    // are always forwarded through this path.
    relayServer.on('task:result', onTaskResult)
    relayServer.on('task:steer_ack', onTaskSteerAck)
    relayServer.on('task:approval_request', onTaskApprovalRequest)
    relayServer.on('task:safety_prompt', onTaskSafetyPrompt)
    // Track per-project safety approvals from user responses (dispatch.ts emits this)
    const onSafetyApproved = (msg: { projectId: string }) => {
      safetyApprovedProjects.add(msg.projectId)
    }
    relayServer.on('task:safety_approved', onSafetyApproved)
    relayServer.on('machine:connected', onMachineConnected)
    relayServer.on('machine:disconnected', onMachineDisconnected)
    // Session events
    relayServer.on('session:attached', onSessionAttached)
    relayServer.on('session:detached', onSessionDetached)
    relayServer.on('session:event', onSessionEvent)

    const onRelayText = (msg: TaskTextMessage) => {
      withTaskAccess(msg.taskId, () => {
        throttle.write(msg.taskId, msg.text)
      })
    }
    const onRelayOperational = async (msg: RelayTaskOperationalMessage & { _dbSeq?: number }) => {
      withTaskAccess(msg.taskId, () => {
        const eventData = { taskId: msg.taskId, message: msg.message, source: msg.source }
        const data = JSON.stringify(eventData)
        const id = msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:operational', data)
        stream.writeSSE({ id, event: 'task:operational', data }).catch(() => { alive = false })
      })
    }
    const onRelaySessionInit = async (msg: RelayTaskSessionInitMessage & { _dbSeq?: number }) => {
      withTaskAccess(msg.taskId, () => {
        const eventData = { taskId: msg.taskId, sessionId: msg.sessionId, model: msg.model }
        const data = JSON.stringify(eventData)
        const id = msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:session_init', data)
        stream.writeSSE({ id, event: 'task:session_init', data }).catch(() => { alive = false })
      })
    }
    const onRelayProgress = async (msg: RelayTaskProgressMessage & { _dbSeq?: number }) => {
      withTaskAccess(msg.taskId, () => {
        const eventData = { taskId: msg.taskId, progress: msg.progress, message: msg.message }
        const data = JSON.stringify(eventData)
        const id = msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:progress', data)
        stream.writeSSE({ id, event: 'task:progress', data }).catch(() => { alive = false })
      })
    }
    const onRelayToolTrace = async (msg: RelayTaskToolTraceMessage & { _dbSeq?: number }) => {
      withTaskAccess(msg.taskId, () => {
        const eventData = {
          taskId: msg.taskId, toolName: msg.toolName,
          toolInput: msg.toolInput, toolResult: msg.toolResult,
          success: msg.success, duration: msg.duration,
          ...(msg.toolUseId ? { toolUseId: msg.toolUseId } : {}),
        }
        const data = JSON.stringify(eventData)
        const id = msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:tool_trace', data)
        stream.writeSSE({ id, event: 'task:tool_trace', data }).catch(() => { alive = false })
      })
    }
    const onRelayFileChange = async (msg: RelayTaskFileChangeMessage & { _dbSeq?: number }) => {
      withTaskAccess(msg.taskId, () => {
        const eventData = {
          taskId: msg.taskId, path: msg.path, action: msg.action,
          linesAdded: msg.linesAdded, linesRemoved: msg.linesRemoved, diff: msg.diff,
        }
        const data = JSON.stringify(eventData)
        const id = msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:file_change', data)
        stream.writeSSE({ id, event: 'task:file_change', data }).catch(() => { alive = false })
      })
    }
    relayServer.on('task:text', onRelayText)
    relayServer.on('task:operational', onRelayOperational)
    relayServer.on('task:session_init', onRelaySessionInit)
    relayServer.on('task:progress', onRelayProgress)
    relayServer.on('task:tool_trace', onRelayToolTrace)
    relayServer.on('task:file_change', onRelayFileChange)

    // Cross-instance streaming handler via Redis pub/sub.
    // Streaming events (text, tool_use, tool_result, etc.) are now bridged in
    // relay-server.ts — they re-emit as local relay events, so the relay
    // listeners above (onRelayText, onRelayToolTrace, etc.) handle them.
    // This handler only covers non-streaming Redis events that have no
    // relay equivalent: node_status_changed, task_init, task_ready.
    const onRedisStreaming = async (msg: StreamingEventMessage) => {
      if (!alive) return
      if (msg.instanceId === redisPubSub.getInstanceId()) return
      // Cross-instance user isolation: these events use project-level checks.
      switch (msg.eventType) {
        case 'node_status_changed': {
          // Use project ownership check (not just userId) for node status events.
          // The userId in the message is a hint from executionContextStore; the
          // authoritative check is team-scoped project ownership from the DB.
          // Fail closed: if projectId is missing, don't deliver the event.
          const projectId = msg.data.projectId as string | undefined
          if (!projectId || !await isProjectOwnedByUser(projectId)) break
          const data = JSON.stringify(msg.data)
          const id = eventBuffer.push('node:status_changed', data)
          stream.writeSSE({ id, event: 'node:status_changed', data }).catch(() => { alive = false })
          break
        }
        case 'task_init': {
          const projectId = msg.data.projectId as string | undefined
          if (!projectId || !await isProjectOwnedByUser(projectId)) break
          const data = JSON.stringify(msg.data)
          const id = eventBuffer.push('task:init', data)
          stream.writeSSE({ id, event: 'task:init', data }).catch(() => { alive = false })
          break
        }
        case 'task_ready': {
          const projectId = msg.data.projectId as string | undefined
          if (!projectId || !await isProjectOwnedByUser(projectId)) break
          const data = JSON.stringify(msg.data)
          const id = eventBuffer.push('task:ready', data)
          stream.writeSSE({ id, event: 'task:ready', data }).catch(() => { alive = false })
          break
        }
        case 'plan_result': {
          // Plan created via CLI — broadcast to frontend for real-time PlanGraphBlock rendering
          const prProjectId = msg.data.projectId as string | undefined
          if (!prProjectId || !await isProjectOwnedByUser(prProjectId)) break
          const prData = JSON.stringify({
            taskId: msg.taskId,
            ...msg.data,
          })
          const prId = msg.dbSeq ? String(msg.dbSeq) : eventBuffer.push('task:plan_result', prData)
          stream.writeSSE({ id: prId, event: 'task:plan_result', data: prData }).catch(() => { alive = false })
          break
        }
        case 'error': {
          if (!await isTaskOwnedByUser(msg.taskId)) break
          const errorData = JSON.stringify({
            taskId: msg.taskId,
            error: msg.data.error,
            recoverable: msg.data.recoverable,
            synthetic: msg.data.synthetic,
          })
          const errorId = msg.dbSeq ? String(msg.dbSeq) : eventBuffer.push('task:error', errorData)
          stream.writeSSE({ id: errorId, event: 'task:error', data: errorData }).catch(() => { alive = false })
          break
        }
        default:
          // Unknown event type from Redis — ignore silently.
          // New event types should be added as explicit cases above.
          break
      }
    }
    redisPubSub.on('task:streaming', onRedisStreaming)

    // Merge queue event handlers — filter by project ownership
    const onMergeQueueFailed = async (msg: { nodeId: string; projectId: string; prNumber: number; reason: string; branchName: string }) => {
      if (!alive) return
      if (!await isProjectOwnedByUser(msg.projectId)) return
      const data = JSON.stringify(msg)
      const id = eventBuffer.push('merge_queue:failed', data)
      stream.writeSSE({ id, event: 'merge_queue:failed', data }).catch(() => { alive = false })
    }

    const onMergeQueueSucceeded = async (msg: { nodeId: string; projectId: string; prNumber: number; branchName: string; mergedSha?: string }) => {
      if (!alive) return
      if (!await isProjectOwnedByUser(msg.projectId)) return
      const data = JSON.stringify(msg)
      const id = eventBuffer.push('merge_queue:succeeded', data)
      stream.writeSSE({ id, event: 'merge_queue:succeeded', data }).catch(() => { alive = false })
    }

    const onTaskError = (msg: { taskId: string; error: string; recoverable?: boolean; synthetic?: boolean; seq?: number }) => {
      withTaskAccess(msg.taskId, () => {
        const data = JSON.stringify({
          taskId: msg.taskId,
          error: msg.error,
          recoverable: msg.recoverable,
          synthetic: msg.synthetic,
        })
        const id = msg.seq ? String(msg.seq) : eventBuffer.push('task:error', data)
        stream.writeSSE({ id, event: 'task:error', data }).catch(() => { alive = false })
      })
    }

    // node:status_changed — DB-authoritative notification. Emitted AFTER the
    // DB write commits in dispatch.ts. This is the primary mechanism for
    // frontend state sync (frontend re-reads from DB).
    const onNodeStatusChanged = async (msg: { nodeId: string; projectId: string; status: string; executionId?: string }) => {
      if (!alive) return
      if (!await isProjectOwnedByUser(msg.projectId)) return
      const data = JSON.stringify(msg)
      const id = eventBuffer.push('node:status_changed', data)
      stream.writeSSE({ id, event: 'node:status_changed', data }).catch(() => { alive = false })
    }

    // Plan result from data API (local-instance fallback when Redis is unavailable)
    const onPlanResult = async (msg: { taskId: string; projectId: string; data: Record<string, unknown>; dbSeq?: number }) => {
      if (!alive) return
      if (!await isProjectOwnedByUser(msg.projectId)) return
      const data = JSON.stringify({ taskId: msg.taskId, ...msg.data, projectId: msg.projectId })
      const id = msg.dbSeq ? String(msg.dbSeq) : eventBuffer.push('task:plan_result', data)
      stream.writeSSE({ id, event: 'task:plan_result', data }).catch(() => { alive = false })
    }

    // Subscribe to execution events (bridged from relay by dispatch.ts)
    executionEventBus.on('node:status_changed', onNodeStatusChanged)
    executionEventBus.on('task:init', onTaskInit)
    executionEventBus.on('task:ready', onTaskReady)
    executionEventBus.on('task:result', onTaskResult)
    executionEventBus.on('task:error', onTaskError)
    executionEventBus.on('task:stdout', onTaskStdout)
    executionEventBus.on('task:progress', onTaskProgress)
    executionEventBus.on('task:tool_trace', onTaskToolTrace)
    executionEventBus.on('task:file_change', onTaskFileChange)
    executionEventBus.on('task:session_init', onTaskSessionInit)
    executionEventBus.on('task:steer_ack', onTaskSteerAck)
    executionEventBus.on('task:plan_result', onPlanResult)
    executionEventBus.on('merge_queue:failed', onMergeQueueFailed)
    executionEventBus.on('merge_queue:succeeded', onMergeQueueSucceeded)

    // Project completion handler — forward to browser as SSE
    const onProjectCompleted = async (event: ProjectCompletedEvent) => {
      if (!alive) return
      if (!await isProjectOwnedByUser(event.projectId)) return
      const data = JSON.stringify({
        projectId: event.projectId,
        projectBranch: event.projectBranch,
        projectPrUrl: event.projectPrUrl,
        projectPrNumber: event.projectPrNumber,
        deliveryMode: event.project?.deliveryMode,
        baseBranch: (event.project?.source as { baseBranch?: string } | undefined)?.baseBranch ?? 'main',
        projectName: event.project?.name,
        timestamp: event.timestamp,
      })
      const id = eventBuffer.push('project:completed', data)
      stream.writeSSE({ id, event: 'project:completed', data }).catch(() => { alive = false })
    }

    // Subscribe to approval events from astroEventTransport
    const astroEventHandler = (event: { type: string; [key: string]: unknown }) => {
      if (!alive) return
      if (event.type === 'approval.requested') {
        onApprovalRequested(event as ApprovalRequestedEvent)
      } else if (event.type === 'approval.responded') {
        onApprovalResponded(event as ApprovalRespondedEvent)
      } else if (event.type === 'project.completed') {
        onProjectCompleted(event as unknown as ProjectCompletedEvent)
      }
    }
    astroEventTransport.on('event', astroEventHandler)

    // Keepalive heartbeat (15s)
    const heartbeat = setInterval(() => {
      if (!alive) {
        clearInterval(heartbeat)
        return
      }
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
        alive = false
        clearInterval(heartbeat)
      })
    }, 15000)

    // Max SSE connection lifetime: 2 hours. After this, close gracefully so the
    // client reconnects with a fresh connection. Prevents zombie connections from
    // crashed browsers (which the OS TCP keepalive won't clear for ~2h by default)
    // from accumulating and exhausting Fly.io's per-instance connection limit.
    const MAX_LIFETIME_MS = 2 * 60 * 60 * 1000 // 2 hours
    const maxLifetimeTimer = setTimeout(() => {
      if (!alive) return
      stream.writeSSE({ event: 'server-close', data: JSON.stringify({ reason: 'max_lifetime' }) }).catch(() => {})
      alive = false
    }, MAX_LIFETIME_MS)

    // Wait for client disconnect
    stream.onAbort(() => {
      alive = false
      decrementGlobalSSE()
      clearInterval(heartbeat)
      clearTimeout(maxLifetimeTimer)
      throttle.shutdown()

      // Flush any buffered text from relay-direct fallback path (GAP-9 fix)
      streamingEventLog.flushAll().catch(() => {})

      relayServer.off('task:result', onTaskResult)
      relayServer.off('task:steer_ack', onTaskSteerAck)
      relayServer.off('task:approval_request', onTaskApprovalRequest)
      relayServer.off('task:safety_prompt', onTaskSafetyPrompt)
      relayServer.off('task:safety_approved', onSafetyApproved)
      relayServer.off('machine:connected', onMachineConnected)
      relayServer.off('machine:disconnected', onMachineDisconnected)
      // Relay-direct streaming fallback cleanup
      relayServer.off('task:text', onRelayText)
      relayServer.off('task:operational', onRelayOperational)
      relayServer.off('task:session_init', onRelaySessionInit)
      relayServer.off('task:progress', onRelayProgress)
      relayServer.off('task:tool_trace', onRelayToolTrace)
      relayServer.off('task:file_change', onRelayFileChange)
      // Session events cleanup
      relayServer.off('session:attached', onSessionAttached)
      relayServer.off('session:detached', onSessionDetached)
      relayServer.off('session:event', onSessionEvent)
      // Redis cross-instance streaming cleanup
      redisPubSub.off('task:streaming', onRedisStreaming)

      // Execution event bus cleanup
      executionEventBus.off('node:status_changed', onNodeStatusChanged)
      executionEventBus.off('task:init', onTaskInit)
      executionEventBus.off('task:ready', onTaskReady)
      executionEventBus.off('task:result', onTaskResult)
      executionEventBus.off('task:error', onTaskError)
      executionEventBus.off('task:stdout', onTaskStdout)
      executionEventBus.off('task:progress', onTaskProgress)
      executionEventBus.off('task:tool_trace', onTaskToolTrace)
      executionEventBus.off('task:file_change', onTaskFileChange)
      executionEventBus.off('task:session_init', onTaskSessionInit)
      executionEventBus.off('task:steer_ack', onTaskSteerAck)
      executionEventBus.off('task:plan_result', onPlanResult)
      executionEventBus.off('merge_queue:failed', onMergeQueueFailed)
      executionEventBus.off('merge_queue:succeeded', onMergeQueueSucceeded)

      // Cleanup astroEventTransport listeners
      astroEventTransport.off('event', astroEventHandler)
    })

    // Keep the stream open until aborted
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) {
          clearInterval(check)
          resolve()
        }
      }, 1000)
    })
  })
})

/**
 * Catch-up endpoint for streaming events.
 *
 * GET /api/events/catch-up?executionIds=X,Y&afterSeq=N&limit=1000
 *
 * Returns missed streaming events from the DB for reconnection/hydration.
 */
eventsRoute.get('/catch-up', async (c) => {
  const user = c.get('user') as AuthUser | undefined
  const executionIdsParam = c.req.query('executionIds') || ''
  const afterSeq = parseInt(c.req.query('afterSeq') || '0', 10) || 0
  const limit = Math.min(parseInt(c.req.query('limit') || '1000', 10) || 1000, 5000)

  const executionIds = executionIdsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (executionIds.length === 0) {
    return c.json({ events: [], lastSeq: afterSeq })
  }

  const accessibleExecutionIds: string[] = []
  for (const executionId of executionIds) {
    const context = await loadExecutionContext(executionId)
    if (!context?.projectId) continue
    if (await isProjectAccessibleToUser(user, context.projectId)) {
      accessibleExecutionIds.push(executionId)
    }
  }

  if (accessibleExecutionIds.length === 0) {
    return c.json({ events: [], lastSeq: afterSeq, hasMore: false })
  }

  // Flush in-memory text buffers for any running execution before reading the DB.
  // Text is buffered in streamingEventLog until the next structural event; a
  // secondary tab opening mid-response would otherwise get stale catch-up data.
  await Promise.allSettled(
    accessibleExecutionIds.map((id) => streamingEventLog.flushText(id))
  )

  const events = await streamingEventLog.getAfter(accessibleExecutionIds, afterSeq, limit)
  const lastSeq = events.length > 0 ? events[events.length - 1].seq : afterSeq
  const hasMore = events.length >= limit

  return c.json({ events, lastSeq, hasMore })
})

export { eventsRoute }
