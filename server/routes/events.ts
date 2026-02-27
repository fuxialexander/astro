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
import { astroEventTransport } from '../lib/events/astro-event-transport.js'
import type { ApprovalRequestedEvent, ApprovalRespondedEvent } from '../lib/events/types.js'
import { executionContextStore } from '../lib/execution-context-store.js'

const eventsRoute = new Hono()

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

  // Extract authenticated user for filtering machine events
  const user = c.get('user') as AuthUser | undefined

  // Disable proxy buffering so SSE chunks flush immediately (Fly.io, nginx)
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let alive = true

    // Load YOLO mode setting for this user (one query per SSE connection)
    let yoloMode = false
    if (user?.id) {
      try {
        const { userProfiles } = await import('../lib/db/schema.js')
        const { eq } = await import('drizzle-orm')
        const { db } = await import('../lib/db/index.js')
        const [profile] = await db.select({ settings: userProfiles.settings })
          .from(userProfiles).where(eq(userProfiles.id, user.id)).limit(1)
        yoloMode = (profile?.settings as Record<string, string> | null)?.yoloMode === 'true'
      } catch {
        // fail open — no auto-approval if we can't read settings
      }
    }

    // Stdout throttle for this connection
    const throttle = new StdoutThrottle((taskId, data) => {
      if (!alive) return
      const id = eventBuffer.push('task:stdout', JSON.stringify({ taskId, data }))
      stream.writeSSE({ id, event: 'task:stdout', data: JSON.stringify({ taskId, data }) }).catch(() => {
        alive = false
      })
    })

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
      } catch {
        return true // fail open for backward compat
      }
    }

    // Replay missed events on reconnection (filtered by user ownership)
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
      if (!isTaskOwnedByUser(msg.result.taskId)) return
      const data = JSON.stringify({
        taskId: msg.result.taskId,
        status: msg.result.status,
        output: msg.result.output,
        error: msg.result.error,
        duration: msg.result.duration,
      })
      const id = eventBuffer.push('task:result', data)
      stream.writeSSE({ id, event: 'task:result', data }).catch(() => { alive = false })
    }

    const onTaskStdout = (msg: TaskStdoutMessage) => {
      if (!alive) return
      if (!isTaskOwnedByUser(msg.output.taskId)) return
      throttle.write(msg.output.taskId, msg.output.data)
    }

    const onTaskProgress = (msg: TaskProgressMessage) => {
      if (!alive) return
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

      // YOLO mode: auto-approve with first option (AI's recommendation)
      if (yoloMode && msg.machineId && msg.options.length > 0) {
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

      const data = JSON.stringify({
        taskId: msg.taskId,
        requestId: msg.requestId,
        question: msg.question,
        options: msg.options,
        machineId: msg.machineId,
      })
      const id = eventBuffer.push('task:approval_request', data)
      stream.writeSSE({ id, event: 'task:approval_request', data }).catch(() => { alive = false })
    }

    const onTaskSafetyPrompt = (msg: { taskId: string; safetyTier: string; warning?: string; machineId?: string; options: Array<{ id: string; label: string; description?: string }> }) => {
      if (!alive) return
      if (!isTaskOwnedByUser(msg.taskId)) return
      const data = JSON.stringify(msg)
      const id = eventBuffer.push('task:safety_prompt', data)
      stream.writeSSE({ id, event: 'task:safety_prompt', data }).catch(() => { alive = false })
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

    // Subscribe to relay events (only events NOT already bridged by dispatch.ts).
    // dispatch.ts bridges relay → executionEventBus for: stdout, text, progress,
    // tool_trace, file_change, session_init — subscribing here too causes duplicates.
    relayServer.on('task:result', onTaskResult)
    relayServer.on('task:steer_ack', onTaskSteerAck)
    relayServer.on('task:approval_request', onTaskApprovalRequest)
    relayServer.on('task:safety_prompt', onTaskSafetyPrompt)
    relayServer.on('machine:connected', onMachineConnected)
    relayServer.on('machine:disconnected', onMachineDisconnected)
    // Session events
    relayServer.on('session:attached', onSessionAttached)
    relayServer.on('session:detached', onSessionDetached)
    relayServer.on('session:event', onSessionEvent)

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

    // Subscribe to execution events (bridged from relay by dispatch.ts)
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

    // Subscribe to approval events from astroEventTransport
    const astroEventHandler = (event: { type: string; [key: string]: unknown }) => {
      if (!alive) return
      if (event.type === 'approval.requested') {
        onApprovalRequested(event as ApprovalRequestedEvent)
      } else if (event.type === 'approval.responded') {
        onApprovalResponded(event as ApprovalRespondedEvent)
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

    // Wait for client disconnect
    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      throttle.shutdown()

      relayServer.off('task:result', onTaskResult)
      relayServer.off('task:steer_ack', onTaskSteerAck)
      relayServer.off('task:approval_request', onTaskApprovalRequest)
      relayServer.off('task:safety_prompt', onTaskSafetyPrompt)
      relayServer.off('machine:connected', onMachineConnected)
      relayServer.off('machine:disconnected', onMachineDisconnected)
      // Session events cleanup
      relayServer.off('session:attached', onSessionAttached)
      relayServer.off('session:detached', onSessionDetached)
      relayServer.off('session:event', onSessionEvent)

      // Execution event bus cleanup
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

export { eventsRoute }
