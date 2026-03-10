/**
 * SSE Event Stream Routes
 *
 * Real-time bridge from relay server events to browser clients.
 * Forwards task execution events, machine state changes, and
 * other relay events as Server-Sent Events.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'
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
import { getMachine } from '../lib/registered-machines-store.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { redisPubSub, type StreamingEventMessage } from '../lib/redis-pubsub.js'
import { astroEventTransport } from '../lib/events/astro-event-transport.js'
import type { ApprovalRequestedEvent, ApprovalRespondedEvent, ProjectCompletedEvent } from '../lib/events/types.js'
import { executionContextStore, activeDispatchStreams } from '../lib/execution-context-store.js'
import { streamingEventLog } from '../lib/streaming-event-log.js'
import { isYoloMode } from '../lib/yolo-mode.js'
import { channelRouter } from '../lib/channel/channel-router.js'
import type {
  TaskTextMessage,
  TaskSessionInitMessage as RelayTaskSessionInitMessage,
  TaskProgressMessage as RelayTaskProgressMessage,
  TaskToolTraceMessage as RelayTaskToolTraceMessage,
  TaskFileChangeMessage as RelayTaskFileChangeMessage,
} from '../types/relay.js'

const eventsRoute = new Hono()

// Dedup set for channel notifications — prevents sending N Telegram polls
// when a user has N browser tabs open (each tab registers its own SSE handler).
// Entries auto-expire after 5 minutes (matching approval timeout).
const notifiedApprovalRequests = new Set<string>()

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

    // Helper: check if this SSE connection's user owns the given task
    const isTaskOwnedByUser = (taskId: string): boolean => {
      if (!user?.id) return true // no auth = local mode, allow all
      const ctx = executionContextStore.get(taskId)
      if (!ctx) return true // unknown task = allow (backward compat, e.g. dispatch via engine)
      return ctx.userId === user.id || ctx.userId === LOCAL_USER_ID
    }

    // Helper: check if this SSE connection's user owns the given project
    const isProjectOwnedByUser = async (projectId: string): Promise<boolean> => {
      if (!user?.id) return true // no auth = local mode, allow all
      try {
        const { projects } = await import('../lib/db/schema.js')
        const { eq, and, or, isNull } = await import('drizzle-orm')
        const { db } = await import('../lib/db/index.js')
        const [project] = await db.select({ id: projects.id }).from(projects).where(
          and(
            eq(projects.id, projectId),
            or(
              eq(projects.teamId, user.teamId),
              and(isNull(projects.teamId), eq(projects.ownerId, user.id))
            )
          )
        ).limit(1)
        return !!project
      } catch (err) {
        console.error('[events] isProjectOwnedByUser DB query failed:', err)
        return false // fail closed for security
      }
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
            if (taskId && !isTaskOwnedByUser(taskId)) continue
          } catch { /* allow non-JSON events */ }
        }
        await stream.writeSSE({ id: event.id, event: event.event, data: event.data })
      }
    }

    // Send initial machine list (filtered by authenticated user)
    // Cross-reference with persistent store to prefer user-set names
    const allMachines = machineRegistry.getAll()
    const machines = allMachines.filter(m => !m.userId || m.userId === user?.id || m.userId === LOCAL_USER_ID)
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

    const onTaskResult = (msg: TaskResultMessage) => {
      if (!alive) return
      // NOTE: Do NOT suppress task:result via activeDispatchStreams.
      // task:result is a terminal event — if the dispatch SSE dies (browser navigation,
      // tab backgrounding, network blip), the result must still reach the browser via
      // the global SSE. The frontend deduplicates via plan fingerprinting and execution
      // status checks. Suppressing this was the root cause of "plan page stays stuck".
      if (!isTaskOwnedByUser(msg.result.taskId)) return
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
      })
      const id = eventBuffer.push('task:result', data)
      stream.writeSSE({ id, event: 'task:result', data }).catch(() => { alive = false })
    }

    const onTaskStdout = (msg: TaskStdoutMessage) => {
      if (!alive) return
      if (activeDispatchStreams.has(msg.output.taskId)) return
      if (!isTaskOwnedByUser(msg.output.taskId)) return
      throttle.write(msg.output.taskId, msg.output.data)
    }

    const onTaskProgress = (msg: TaskProgressMessage) => {
      if (!alive) return
      // No activeDispatchStreams guard here: the dispatch stream sends event:'progress' (handled
      // only by execution-store for logging), while this sends event:'task:progress' to the
      // realtime SSE so the realtime store can update the progress bar. Different event types,
      // no duplication.
      if (!isTaskOwnedByUser(msg.taskId)) return
      const data = JSON.stringify({
        taskId: msg.taskId,
        progress: msg.progress,
        message: msg.message,
      })
      const id = eventBuffer.push('task:progress', data)
      stream.writeSSE({ id, event: 'task:progress', data }).catch(() => { alive = false })
    }

    const onTaskSteerAck = (msg: TaskSteerAckMessage & { interrupted?: boolean }) => {
      if (!alive) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      const data = JSON.stringify({
        taskId: msg.taskId,
        accepted: msg.accepted,
        message: msg.message,
        interrupted: msg.interrupted,
      })
      const id = eventBuffer.push('task:steer_ack', data)
      stream.writeSSE({ id, event: 'task:steer_ack', data }).catch(() => { alive = false })
    }

    const onTaskToolTrace = (msg: TaskToolTraceMessage) => {
      if (!alive) return
      if (activeDispatchStreams.has(msg.taskId)) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      const data = JSON.stringify({
        taskId: msg.taskId,
        toolName: msg.toolName,
        toolInput: msg.toolInput,
        toolResult: msg.toolResult,
        success: msg.success,
        duration: msg.duration,
      })
      const id = eventBuffer.push('task:tool_trace', data)
      stream.writeSSE({ id, event: 'task:tool_trace', data }).catch(() => { alive = false })
    }

    const onTaskFileChange = (msg: TaskFileChangeMessage) => {
      if (!alive) return
      if (activeDispatchStreams.has(msg.taskId)) return
      if (!isTaskOwnedByUser(msg.taskId)) return
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
    }

    const onTaskSessionInit = (msg: TaskSessionInitMessage) => {
      if (!alive) return
      if (activeDispatchStreams.has(msg.taskId)) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      const data = JSON.stringify({
        taskId: msg.taskId,
        sessionId: msg.sessionId,
        model: msg.model,
      })
      const id = eventBuffer.push('task:session_init', data)
      stream.writeSSE({ id, event: 'task:session_init', data }).catch(() => { alive = false })
    }

    const onTaskApprovalRequest = (msg: { taskId: string; requestId: string; question: string; options: string[]; machineId?: string }) => {
      if (!alive) return
      if (!isTaskOwnedByUser(msg.taskId)) return

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

          const ctx = executionContextStore.get(msg.taskId)
          if (ctx?.projectId) {
            channelRouter.sendNotification({
              type: 'approval.requested',
              projectId: ctx.projectId,
              summary: msg.question,
              astroUrl: `${process.env.ASTRO_BASE_URL || 'http://localhost:5173'}/project/${ctx.projectId}`,
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
    }

    /** Auto-proceed a safety prompt and notify the browser */
    const autoSafetyProceed = (msg: { taskId: string; safetyTier: string; warning?: string; machineId?: string }, reason: string) => {
      relayServer.sendSafetyDecision(msg.taskId, msg.machineId!, 'proceed')
      console.log(`[events] ${reason} safety auto-proceed: task=${msg.taskId} tier=${msg.safetyTier}`)

      streamingEventLog.append(msg.taskId, 'safety_response', { decision: 'proceed', autoApproved: true }).catch(() => {})

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

    const onTaskSafetyPrompt = (msg: { taskId: string; safetyTier: string; warning?: string; machineId?: string; options: Array<{ id: string; label: string; description?: string }> }) => {
      if (!alive) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      if (!msg.machineId) {
        // No machine to send decision to — show dialog as fallback
        const data = JSON.stringify(msg)
        const id = eventBuffer.push('task:safety_prompt', data)
        stream.writeSSE({ id, event: 'task:safety_prompt', data }).catch(() => { alive = false })
        return
      }

      // Per-project auto-proceed: if user already approved for this project, skip the dialog
      const ctx = executionContextStore.get(msg.taskId)
      if (ctx && safetyApprovedProjects.has(ctx.projectId)) {
        autoSafetyProceed(msg, 'Per-project')
        return
      }

      // YOLO mode: auto-proceed for safety prompts (skip the dialog)
      isYoloMode(user?.id, msg.taskId).then((yoloEnabled) => {
        if (!alive) return

        if (yoloEnabled) {
          if (ctx) safetyApprovedProjects.add(ctx.projectId)
          autoSafetyProceed(msg, 'YOLO')
          return
        }

        const data = JSON.stringify(msg)
        const id = eventBuffer.push('task:safety_prompt', data)
        stream.writeSSE({ id, event: 'task:safety_prompt', data }).catch(() => { alive = false })
      }).catch(() => {
        const data = JSON.stringify(msg)
        const id = eventBuffer.push('task:safety_prompt', data)
        stream.writeSSE({ id, event: 'task:safety_prompt', data }).catch(() => { alive = false })
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
      if (!alive) return
      if (!isTaskOwnedByUser(taskId)) return
      const data = JSON.stringify({ sessionId, taskId, machineId, attachedAt: new Date().toISOString() })
      const id = eventBuffer.push('session:attached', data)
      stream.writeSSE({ id, event: 'session:attached', data }).catch(() => { alive = false })
    }

    const onSessionDetached = (sessionId: string, taskId: string, reason?: string) => {
      if (!alive) return
      if (!isTaskOwnedByUser(taskId)) return
      const data = JSON.stringify({ sessionId, taskId, reason })
      const id = eventBuffer.push('session:detached', data)
      stream.writeSSE({ id, event: 'session:detached', data }).catch(() => { alive = false })
    }

    const onSessionEvent = (sessionId: string, taskId: string, event: SessionEvent) => {
      if (!alive) return
      if (!isTaskOwnedByUser(taskId)) return
      const data = JSON.stringify({ sessionId, taskId, event })
      const id = eventBuffer.push('session:event', data)
      stream.writeSSE({ id, event: 'session:event', data }).catch(() => { alive = false })
    }

    // Approval event handlers — filter by execution/task ownership
    const onApprovalRequested = (event: ApprovalRequestedEvent) => {
      if (!alive) return
      // Filter by execution ownership
      if (event.executionId && !isTaskOwnedByUser(event.executionId)) return
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
    }

    const onApprovalResponded = (event: ApprovalRespondedEvent) => {
      if (!alive) return
      // Filter by execution ownership
      if (event.executionId && !isTaskOwnedByUser(event.executionId)) return
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
    }

    // Subscribe to relay events directly.
    // For streaming types (text, tool_trace, file_change, session_init, progress),
    // dispatch.ts also bridges relay → executionEventBus while its SSE stream
    // is alive. After page refresh that bridge dies, so these relay-direct handlers
    // serve as fallback. We skip events for tasks with active dispatch streams
    // to avoid duplicates.
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

    // Relay-direct handlers for streaming types (fallback after page refresh).
    // These fire for ALL relay events; skip tasks with active dispatch bridges.
    const onRelayText = (msg: TaskTextMessage) => {
      if (!alive || activeDispatchStreams.has(msg.taskId)) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      // Persistence handled globally in relay-server.ts; only SSE delivery here
      throttle.write(msg.taskId, msg.text)
    }
    const onRelaySessionInit = async (msg: RelayTaskSessionInitMessage & { _dbSeq?: number }) => {
      if (!alive || activeDispatchStreams.has(msg.taskId)) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      // Persistence handled globally in relay-server.ts; use DB seq for SSE ID when available
      const eventData = { taskId: msg.taskId, sessionId: msg.sessionId, model: msg.model }
      const data = JSON.stringify(eventData)
      const id = msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:session_init', data)
      stream.writeSSE({ id, event: 'task:session_init', data }).catch(() => { alive = false })
    }
    const onRelayProgress = async (msg: RelayTaskProgressMessage & { _dbSeq?: number }) => {
      if (!alive || activeDispatchStreams.has(msg.taskId)) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      // Persistence handled globally in relay-server.ts; use DB seq for SSE ID when available
      const eventData = { taskId: msg.taskId, progress: msg.progress, message: msg.message }
      const data = JSON.stringify(eventData)
      const id = msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:progress', data)
      stream.writeSSE({ id, event: 'task:progress', data }).catch(() => { alive = false })
    }
    const onRelayToolTrace = async (msg: RelayTaskToolTraceMessage & { _dbSeq?: number }) => {
      if (!alive || activeDispatchStreams.has(msg.taskId)) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      // Persistence handled globally in relay-server.ts; use DB seq for SSE ID when available
      const eventData = {
        taskId: msg.taskId, toolName: msg.toolName,
        toolInput: msg.toolInput, toolResult: msg.toolResult,
        success: msg.success, duration: msg.duration,
      }
      const data = JSON.stringify(eventData)
      const id = msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:tool_trace', data)
      stream.writeSSE({ id, event: 'task:tool_trace', data }).catch(() => { alive = false })
    }
    const onRelayFileChange = async (msg: RelayTaskFileChangeMessage & { _dbSeq?: number }) => {
      if (!alive || activeDispatchStreams.has(msg.taskId)) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      // Persistence handled globally in relay-server.ts; use DB seq for SSE ID when available
      const eventData = {
        taskId: msg.taskId, path: msg.path, action: msg.action,
        linesAdded: msg.linesAdded, linesRemoved: msg.linesRemoved, diff: msg.diff,
      }
      const data = JSON.stringify(eventData)
      const id = msg._dbSeq ? String(msg._dbSeq) : eventBuffer.push('task:file_change', data)
      stream.writeSSE({ id, event: 'task:file_change', data }).catch(() => { alive = false })
    }
    relayServer.on('task:text', onRelayText)
    relayServer.on('task:session_init', onRelaySessionInit)
    relayServer.on('task:progress', onRelayProgress)
    relayServer.on('task:tool_trace', onRelayToolTrace)
    relayServer.on('task:file_change', onRelayFileChange)

    // Cross-instance streaming handler via Redis pub/sub.
    // When Redis is connected and multiple server instances exist, streaming events
    // from other instances arrive here. Self-instance events are skipped (the local
    // EventEmitter path already delivered them).
    // NOTE: No activeDispatchStreams guard needed here. The dispatch SSE stream only
    // exists on the instance that initiated the dispatch, and cross-instance events
    // (different instanceId) by definition come from tasks running on other instances
    // which won't have a local dispatch bridge.
    const onRedisStreaming = async (msg: StreamingEventMessage) => {
      if (!alive) return
      if (msg.instanceId === redisPubSub.getInstanceId()) return
      // Cross-instance user isolation: deny-by-default when userId is missing.
      // The receiving instance's executionContextStore won't have the task (it runs
      // on another instance), so we check the userId embedded in the Redis message.
      // Events with project-level isolation (node_status_changed, task_init,
      // task_ready) bypass the userId check — their case branches use
      // isProjectOwnedByUser as authoritative check instead.
      const hasProjectCheck = msg.eventType === 'node_status_changed'
        || msg.eventType === 'task_init' || msg.eventType === 'task_ready'
      if (user?.id && !hasProjectCheck
        && msg.userId !== user.id && msg.userId !== LOCAL_USER_ID) return

      switch (msg.eventType) {
        case 'text':
          throttle.write(msg.taskId, msg.data.text as string)
          break
        case 'tool_use':
        case 'tool_result': {
          const data = JSON.stringify({ taskId: msg.taskId, ...msg.data })
          const id = msg.dbSeq ? String(msg.dbSeq) : eventBuffer.push('task:tool_trace', data)
          stream.writeSSE({ id, event: 'task:tool_trace', data }).catch(() => { alive = false })
          break
        }
        case 'file_change': {
          const data = JSON.stringify({ taskId: msg.taskId, ...msg.data })
          const id = msg.dbSeq ? String(msg.dbSeq) : eventBuffer.push('task:file_change', data)
          stream.writeSSE({ id, event: 'task:file_change', data }).catch(() => { alive = false })
          break
        }
        case 'session_init': {
          const data = JSON.stringify({ taskId: msg.taskId, ...msg.data })
          const id = msg.dbSeq ? String(msg.dbSeq) : eventBuffer.push('task:session_init', data)
          stream.writeSSE({ id, event: 'task:session_init', data }).catch(() => { alive = false })
          break
        }
        case 'progress': {
          const data = JSON.stringify({ taskId: msg.taskId, ...msg.data })
          const id = msg.dbSeq ? String(msg.dbSeq) : eventBuffer.push('task:progress', data)
          stream.writeSSE({ id, event: 'task:progress', data }).catch(() => { alive = false })
          break
        }
        case 'result': {
          const data = JSON.stringify({ taskId: msg.taskId, ...msg.data })
          const id = eventBuffer.push('task:result', data)
          stream.writeSSE({ id, event: 'task:result', data }).catch(() => { alive = false })
          break
        }
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

    // node:status_changed — DB-authoritative notification. Emitted AFTER the
    // DB write commits in dispatch.ts. No activeDispatchStreams guard: this is
    // the primary mechanism for frontend state sync (frontend re-reads from DB).
    const onNodeStatusChanged = async (msg: { nodeId: string; projectId: string; status: string; executionId?: string }) => {
      if (!alive) return
      if (!await isProjectOwnedByUser(msg.projectId)) return
      const data = JSON.stringify(msg)
      const id = eventBuffer.push('node:status_changed', data)
      stream.writeSSE({ id, event: 'node:status_changed', data }).catch(() => { alive = false })
    }

    // Subscribe to execution events (bridged from relay by dispatch.ts)
    executionEventBus.on('node:status_changed', onNodeStatusChanged)
    executionEventBus.on('task:init', onTaskInit)
    executionEventBus.on('task:ready', onTaskReady)
    executionEventBus.on('task:result', onTaskResult)
    executionEventBus.on('task:stdout', onTaskStdout)
    executionEventBus.on('task:progress', onTaskProgress)
    executionEventBus.on('task:tool_trace', onTaskToolTrace)
    executionEventBus.on('task:file_change', onTaskFileChange)
    executionEventBus.on('task:session_init', onTaskSessionInit)
    executionEventBus.on('task:steer_ack', onTaskSteerAck)
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
      executionEventBus.off('task:stdout', onTaskStdout)
      executionEventBus.off('task:progress', onTaskProgress)
      executionEventBus.off('task:tool_trace', onTaskToolTrace)
      executionEventBus.off('task:file_change', onTaskFileChange)
      executionEventBus.off('task:session_init', onTaskSessionInit)
      executionEventBus.off('task:steer_ack', onTaskSteerAck)
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
  const executionIdsParam = c.req.query('executionIds') || ''
  const afterSeq = parseInt(c.req.query('afterSeq') || '0', 10) || 0
  const limit = Math.min(parseInt(c.req.query('limit') || '1000', 10) || 1000, 5000)

  const executionIds = executionIdsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (executionIds.length === 0) {
    return c.json({ events: [], lastSeq: afterSeq })
  }

  const events = await streamingEventLog.getAfter(executionIds, afterSeq, limit)
  const lastSeq = events.length > 0 ? events[events.length - 1].seq : afterSeq
  const hasMore = events.length >= limit

  return c.json({ events, lastSeq, hasMore })
})

export { eventsRoute }
