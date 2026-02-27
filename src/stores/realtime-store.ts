/**
 * Realtime Store
 *
 * Zustand store for real-time events from the SSE event bridge.
 * Manages connected machines, activity feed, and per-task stream data.
 */

import { create } from 'zustand'
import { realtimeClient, type RealtimeEvent } from '@/lib/realtime-client'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'
import { showApprovalNotification, showTaskNotification } from '@/lib/notifications'
import { usePlanStore } from './plan-store'
import { useProjectStore } from './project-store'
import { useExecutionStore } from './execution-store'
import { useMachinesStore } from './machines-store'
import type { TaskActivityEvent } from '@/types'

export interface HpcCapability {
  clusterName?: string
  partitions: string[]
  defaultPartition?: string
  accounts: string[]
}

export interface ComputeBackendInfo {
  id: string
  name: string
  available: boolean
  version?: string
  metadata?: Record<string, unknown>
}

export interface MachineEntry {
  machineId: string
  name: string
  connectionStatus: string
  providers: Array<{
    type: string
    status: string
    currentTasks: number
    maxConcurrentTasks: number
    hpcCapability?: HpcCapability
  }>
  executionStrategies?: ComputeBackendInfo[]
  resources?: {
    cpuCores: number
    memoryMB: number
    gpuCount?: number
    gpuMemoryMB?: number
    gpuType?: string
  }
  load: {
    cpuPercent: number
    memoryPercent: number
    activeTasks: number
  }
}

export interface ActivityEvent {
  id: string
  type: string
  text: string
  timestamp: Date
  taskId?: string
  machineId?: string
}

export interface DynamicApprovalRequest {
  taskId: string
  requestId: string
  question: string
  options: string[]
  machineId?: string
  timestamp: Date
}

export interface SafetyPromptRequest {
  taskId: string
  safetyTier: string
  warning?: string
  machineId?: string
  options: Array<{ id: string; label: string; description?: string }>
  timestamp: Date
}

export interface TaskStream {
  taskId: string
  machineId?: string
  providerId?: string
  providerName?: string
  sessionId?: string
  model?: string
  stdout: string
  progress: number
  progressMessage?: string
  toolTraces: Array<{
    toolName: string
    toolInput: unknown
    toolResult?: unknown
    success?: boolean
    duration?: number
    timestamp: Date
  }>
  fileChanges: Array<{
    path: string
    action: string
    linesAdded?: number
    linesRemoved?: number
    diff?: string
    timestamp: Date
  }>
  steerMessages: Array<{
    message: string
    accepted?: boolean
    ackMessage?: string
    interrupted?: boolean
    timestamp: Date
  }>
  activityEvents: TaskActivityEvent[]
  status?: string
  output?: string
  error?: string
  planTodos?: Array<{
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    activeForm: string
  }>
  planQuestions?: Array<{
    question: string
    options: string[]
    answer?: string
  }>
}

/** Attached session from MCP bridge */
export interface AttachedSession {
  sessionId: string
  taskId: string
  machineId: string
  attachedAt: Date
  eventCount: number
  events: SessionEventEntry[]
}

/** Session event from MCP bridge */
export interface SessionEventEntry {
  type: string
  timestamp: Date
  data: unknown
}

interface RealtimeState {
  connected: boolean
  machines: Map<string, MachineEntry>
  activityFeed: ActivityEvent[]
  taskStreams: Map<string, TaskStream>
  // Attached sessions from MCP bridge
  attachedSessions: Map<string, AttachedSession>
  // Dynamic approval requests (AskUserQuestion tool)
  dynamicApprovals: Map<string, DynamicApprovalRequest>
  // Safety prompt requests (non-git working directory)
  safetyPrompts: Map<string, SafetyPromptRequest>

  // Actions
  connect: () => void
  disconnect: () => void
  getTaskStream: (taskId: string) => TaskStream | undefined
  addSteerMessage: (taskId: string, message: string, interrupted?: boolean) => void
  updateSteerMessage: (taskId: string, index: number, update: { accepted?: boolean; ackMessage?: string }) => void
  getSessionsForTask: (taskId: string) => AttachedSession[]
  getDynamicApproval: (requestId: string) => DynamicApprovalRequest | undefined
  respondToDynamicApproval: (taskId: string, requestId: string, answer: string) => Promise<void>
  respondToSafetyPrompt: (taskId: string, decision: string) => Promise<void>
}

let activityCounter = 0

// ─── Text Batching for Smooth Streaming ────────────────────────────
// Same pattern as execution-store: accumulate text chunks in a buffer
// and flush to Zustand every 50ms (~20fps) to avoid per-token re-renders.
const realtimeTextBatch = new Map<string, string>()
const realtimeTextTimers = new Map<string, ReturnType<typeof setTimeout>>()

function flushRealtimeText(
  taskId: string,
  set: (fn: (state: RealtimeState) => Partial<RealtimeState>) => void,
) {
  const timer = realtimeTextTimers.get(taskId)
  if (timer) {
    clearTimeout(timer)
    realtimeTextTimers.delete(taskId)
  }

  const text = realtimeTextBatch.get(taskId)
  realtimeTextBatch.delete(taskId)

  if (!text) return

  set((state) => {
    const streams = new Map(state.taskStreams)
    const existing = streams.get(taskId) || createEmptyTaskStream(taskId)
    const stream = {
      ...existing,
      stdout: existing.stdout + text,
      activityEvents: [...existing.activityEvents, { type: 'text' as const, content: text, timestamp: new Date() }],
    }
    streams.set(taskId, stream)
    return { taskStreams: streams }
  })
}

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  connected: false,
  machines: new Map(),
  activityFeed: [],
  taskStreams: new Map(),
  attachedSessions: new Map(),
  dynamicApprovals: new Map(),
  safetyPrompts: new Map(),

  connect: () => {
    // Remove any stale handler before adding a new one
    const prevUnsub = (window as unknown as Record<string, unknown>).__realtimeUnsub as (() => void) | undefined
    prevUnsub?.()

    realtimeClient.connect()

    const unsub = realtimeClient.on('*', (event: RealtimeEvent) => {
      handleRealtimeEvent(event, set)
    })
    ;(window as unknown as Record<string, unknown>).__realtimeUnsub = unsub

    // Track connection state
    const checkConnection = setInterval(() => {
      set({ connected: realtimeClient.connected })
    }, 2000)

    // Store cleanup ref
    ;(window as unknown as Record<string, unknown>).__realtimeInterval = checkConnection
  },

  disconnect: () => {
    const unsub = (window as unknown as Record<string, unknown>).__realtimeUnsub as (() => void) | undefined
    unsub?.()
    ;(window as unknown as Record<string, unknown>).__realtimeUnsub = undefined

    realtimeClient.disconnect()
    const interval = (window as unknown as Record<string, unknown>).__realtimeInterval as ReturnType<typeof setInterval>
    if (interval) clearInterval(interval)
    set({ connected: false })
  },

  getTaskStream: (taskId: string) => {
    return get().taskStreams.get(taskId)
  },

  addSteerMessage: (taskId: string, message: string, interrupted?: boolean) => {
    const now = new Date()
    set((state) => {
      const streams = new Map(state.taskStreams)
      const existing = streams.get(taskId)
      const stream = existing
        ? { ...existing, steerMessages: [...existing.steerMessages], activityEvents: [...existing.activityEvents] }
        : createEmptyTaskStream(taskId)
      stream.steerMessages.push({ message, interrupted, timestamp: now })
      stream.activityEvents.push({ type: 'steer' as const, message, interrupted, timestamp: now })
      streams.set(taskId, stream)
      return { taskStreams: streams }
    })
  },

  updateSteerMessage: (taskId: string, index: number, update: { accepted?: boolean; ackMessage?: string }) => {
    set((state) => {
      const streams = new Map(state.taskStreams)
      const existing = streams.get(taskId)
      if (existing && existing.steerMessages[index]) {
        // Create new stream object to trigger Zustand selector re-renders
        const newSteerMessages = [...existing.steerMessages]
        newSteerMessages[index] = { ...newSteerMessages[index], ...update }
        // Also update the corresponding activity event
        let steerCount = 0
        const newActivityEvents = existing.activityEvents.map(e => {
          if (e.type === 'steer') {
            if (steerCount === index) {
              steerCount++
              return { ...e, ...update }
            }
            steerCount++
          }
          return e
        })
        streams.set(taskId, { ...existing, steerMessages: newSteerMessages, activityEvents: newActivityEvents })
      }
      return { taskStreams: streams }
    })
  },

  getSessionsForTask: (taskId: string) => {
    const sessions = get().attachedSessions
    return Array.from(sessions.values()).filter((s) => s.taskId === taskId)
  },

  getDynamicApproval: (requestId: string) => {
    return get().dynamicApprovals.get(requestId)
  },

  respondToDynamicApproval: async (taskId: string, requestId: string, answer: string) => {
    // taskId is actually the executionId - find the nodeId first
    const planStore = usePlanStore.getState()
    const node = planStore.nodes.find((n) => n.executionId === taskId)

    // Resolve machineId: prefer the machineId from the approval event (set by relay),
    // then fall back to plan node / execution store lookup
    const approval = get().dynamicApprovals.get(requestId)
    let machineId: string | undefined = approval?.machineId
    if (!machineId && node) {
      const execution = useExecutionStore.getState().getExecution(node.id)
      machineId = execution?.machineId
    }
    if (!machineId) {
      // Fall back: search all executions for matching executionId
      const execStore = useExecutionStore.getState()
      for (const exec of execStore.executions.values()) {
        if (exec.executionId === taskId && exec.machineId) {
          machineId = exec.machineId
          break
        }
      }
    }

    if (!machineId) {
      // Remove from pending so dialog doesn't stay stuck
      set((state) => {
        const newApprovals = new Map(state.dynamicApprovals)
        newApprovals.delete(requestId)
        return { dynamicApprovals: newApprovals }
      })
      throw new Error(`No machine ID for task: ${taskId}`)
    }

    // Look up the original question for the approval_response activity event
    const question = approval?.question || ''

    try {
      const token = await getAccessToken()
      const authHeaders: HeadersInit = { 'Content-Type': 'application/json' }
      if (token) authHeaders['Authorization'] = `Bearer ${token}`

      const response = await fetch(apiUrl('/api/dispatch/approval'), {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          taskId,
          machineId,
          requestId,
          answered: true,
          answer,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to send approval response: ${response.status}`)
      }

      // Push approval_response activity event into the task stream
      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(taskId)
        if (stream) {
          stream.activityEvents = [...stream.activityEvents, {
            type: 'approval_response' as const,
            requestId,
            question,
            answer,
            timestamp: new Date(),
          }]
          streams.set(taskId, stream)
        }

        // Also push into any execution store entry matching this executionId
        const newApprovals = new Map(state.dynamicApprovals)
        newApprovals.delete(requestId)
        return { taskStreams: streams, dynamicApprovals: newApprovals }
      })

      console.log('[realtime] Approval response sent:', { taskId, requestId, answer })
    } catch (error) {
      console.error('[realtime] Failed to send approval response:', error)
      throw error
    }
  },

  respondToSafetyPrompt: async (taskId: string, decision: string) => {
    // taskId is the executionId — find the nodeId to look up machineId
    const planStore = usePlanStore.getState()
    const node = planStore.nodes.find((n) => n.executionId === taskId)

    // Resolve machineId: prefer the machineId from the safety prompt event (set by relay),
    // then fall back to execution store lookup
    const safetyPrompt = get().safetyPrompts.get(taskId)
    let machineId: string | undefined = safetyPrompt?.machineId
    if (!machineId && node) {
      const execution = useExecutionStore.getState().getExecution(node.id)
      machineId = execution?.machineId
    }
    if (!machineId) {
      // Fall back: search all executions for matching executionId
      const execStore = useExecutionStore.getState()
      for (const exec of execStore.executions.values()) {
        if (exec.executionId === taskId && exec.machineId) {
          machineId = exec.machineId
          break
        }
      }
    }

    if (!machineId) {
      // Remove from map so the dialog doesn't get stuck
      set((state) => {
        const newPrompts = new Map(state.safetyPrompts)
        newPrompts.delete(taskId)
        return { safetyPrompts: newPrompts }
      })
      throw new Error(`No machine found for safety prompt task: ${taskId}`)
    }

    try {
      const safetyToken = await getAccessToken()
      const safetyHeaders: HeadersInit = { 'Content-Type': 'application/json' }
      if (safetyToken) safetyHeaders['Authorization'] = `Bearer ${safetyToken}`

      const response = await fetch(apiUrl('/api/dispatch/safety-decision'), {
        method: 'POST',
        headers: safetyHeaders,
        body: JSON.stringify({
          taskId,
          machineId,
          decision,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to send safety decision: ${response.status}`)
      }

      console.log('[realtime] Safety decision sent:', { taskId, decision })
    } catch (error) {
      console.error('[realtime] Failed to send safety decision:', error)
      throw error
    } finally {
      // Always remove from pending safety prompts to prevent dialog from being stuck
      set((state) => {
        const newPrompts = new Map(state.safetyPrompts)
        newPrompts.delete(taskId)
        return { safetyPrompts: newPrompts }
      })
    }
  },
}))

function createEmptyTaskStream(taskId: string): TaskStream {
  return {
    taskId,
    stdout: '',
    progress: 0,
    toolTraces: [],
    fileChanges: [],
    steerMessages: [],
    activityEvents: [],
  }
}

function addActivity(
  set: (fn: (state: RealtimeState) => Partial<RealtimeState>) => void,
  type: string,
  text: string,
  extra?: { taskId?: string; machineId?: string }
) {
  set((state) => {
    const feed = [
      {
        id: `activity-${++activityCounter}`,
        type,
        text,
        timestamp: new Date(),
        ...extra,
      },
      ...state.activityFeed,
    ].slice(0, 50) // Keep last 50

    return { activityFeed: feed }
  })
}

function handleRealtimeEvent(
  event: RealtimeEvent,
  set: (fn: (state: RealtimeState) => Partial<RealtimeState>) => void,
) {
  const data = event.data as Record<string, unknown>

  // Flush pending text batches before non-text events to preserve ordering
  if (event.type !== 'task:stdout' && event.type !== 'task:text') {
    const taskId = (data?.taskId as string) || ''
    if (taskId && realtimeTextBatch.has(taskId)) {
      flushRealtimeText(taskId, set)
    }
  }

  switch (event.type) {
    case 'machines:snapshot': {
      const machineList = event.data as MachineEntry[]
      const machines = new Map<string, MachineEntry>()
      const registeredMachines = useMachinesStore.getState().machines
      for (const m of machineList) {
        // Cross-reference with registered machines store for user-set names
        const registered = registeredMachines.find(rm => rm.id === m.machineId)
        if (registered?.name && registered.name !== registered.hostname) {
          m.name = registered.name
        }
        machines.set(m.machineId, m)
      }
      set(() => ({ machines }))
      break
    }

    case 'machine:connected': {
      const entry = data as unknown as MachineEntry
      // Prefer user-set name from registered machines store over WebSocket-provided name
      const registeredMachine = useMachinesStore.getState().machines.find(m => m.id === entry.machineId)
      if (registeredMachine?.name && registeredMachine.name !== registeredMachine.hostname) {
        entry.name = registeredMachine.name
      }
      set((state) => {
        const machines = new Map(state.machines)
        machines.set(entry.machineId, entry)
        return { machines }
      })
      addActivity(set, 'machine', `Machine "${entry.name || entry.machineId}" connected`, {
        machineId: entry.machineId,
      })
      // Update registered machines store with connection status
      useMachinesStore.getState().updateMachineStatus(entry.machineId, true)
      break
    }

    case 'machine:disconnected': {
      const machineId = data.machineId as string
      set((state) => {
        const machines = new Map(state.machines)
        machines.delete(machineId)
        return { machines }
      })
      addActivity(set, 'machine', `Machine "${machineId}" disconnected`, {
        machineId,
      })
      // Update registered machines store with connection status
      useMachinesStore.getState().updateMachineStatus(machineId, false)
      break
    }

    case 'task:stdout':
    case 'task:text': {
      const taskId = data.taskId as string
      const text = data.data as string
      // Batch text chunks — flush every 50ms for smooth ~20fps rendering
      realtimeTextBatch.set(taskId, (realtimeTextBatch.get(taskId) || '') + text)
      if (!realtimeTextTimers.has(taskId)) {
        realtimeTextTimers.set(taskId, setTimeout(() => {
          realtimeTextTimers.delete(taskId)
          flushRealtimeText(taskId, set)
        }, 50))
      }
      break
    }

    case 'task:session_init': {
      const taskId = data.taskId as string
      const sessionId = data.sessionId as string
      const model = data.model as string | undefined
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(taskId) || createEmptyTaskStream(taskId)
        streams.set(taskId, { ...existing, sessionId, model })
        return { taskStreams: streams }
      })
      break
    }

    case 'task:progress': {
      const taskId = data.taskId as string
      const progress = data.progress as number
      const message = data.message as string | undefined
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(taskId) || createEmptyTaskStream(taskId)
        streams.set(taskId, { ...existing, progress, progressMessage: message })
        return { taskStreams: streams }
      })
      // Update plan node if in_progress
      if (progress > 0) {
        addActivity(set, 'progress', `Task progress: ${progress}%${message ? ` - ${message}` : ''}`, {
          taskId,
        })
      }
      break
    }

    case 'task:result': {
      const taskId = data.taskId as string
      const status = data.status as string
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(taskId) || createEmptyTaskStream(taskId)
        streams.set(taskId, {
          ...existing,
          status,
          output: data.output as string | undefined,
          error: data.error as string | undefined,
        })

        // Clean up any pending dynamic approvals for this task
        const newApprovals = new Map(state.dynamicApprovals)
        let changed = false
        for (const [reqId, approval] of newApprovals) {
          if (approval.taskId === taskId) {
            newApprovals.delete(reqId)
            changed = true
          }
        }

        return {
          taskStreams: streams,
          ...(changed ? { dynamicApprovals: newApprovals } : {}),
        }
      })

      const isSuccess = status === 'completed'
      addActivity(
        set,
        isSuccess ? 'success' : 'failure',
        `Task ${isSuccess ? 'completed' : 'failed'}: ${taskId}`,
        { taskId }
      )

      // Update plan node status via plan store
      const planStore = usePlanStore.getState()
      const node = planStore.nodes.find(
        (n) => n.executionId === taskId
      )
      if (node) {
        const completionTime = new Date()
        planStore.updateNode(node.id, {
          status: isSuccess
            ? (node.verification === 'auto' ? 'auto_verified' : 'awaiting_judgment')
            : 'awaiting_judgment',
          executionOutput: data.output as string | undefined,
          executionError: data.error as string | undefined,
          executionCompletedAt: completionTime,
          // Set actualEndDate on task completion
          actualEndDate: completionTime,
        })

        // Browser notification for task completion/failure/judgment
        const project = useProjectStore.getState().projects.find(p => p.id === node.projectId)
        const pName = project?.name || 'Astro'
        showTaskNotification(pName, node.title, isSuccess ? 'completed' : 'failed')
        if (!isSuccess) {
          showTaskNotification(pName, node.title, 'awaiting_judgment')
        }
      }
      break
    }

    case 'task:tool_trace': {
      const taskId = data.taskId as string
      const now = new Date()
      const toolName = data.toolName as string
      const hasInput = data.toolInput !== undefined
      const hasResult = data.toolResult !== undefined

      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(taskId) || createEmptyTaskStream(taskId)

        // Build new arrays (avoid mutating existing references)
        let newToolTraces = [...existing.toolTraces]
        let newActivityEvents = [...existing.activityEvents]
        let newPlanTodos = existing.planTodos
        let newPlanQuestions = existing.planQuestions

        // Determine if this is a tool_use event (has input) or tool_result event (has result only).
        // The relay sends separate task:tool_trace SSE events for tool_use and tool_result.
        // We need to match them by toolName and reuse the ID from tool_use, same strategy
        // as execution-store.ts uses for local dispatch.
        const isResultOnly = hasResult && !hasInput

        if (isResultOnly) {
          // Result-only event: find the last matching trace by toolName and update it
          const lastTraceIdx = [...newToolTraces].reverse().findIndex(t => t.toolName === toolName && !t.toolResult)
          if (lastTraceIdx >= 0) {
            const idx = newToolTraces.length - 1 - lastTraceIdx
            newToolTraces[idx] = {
              ...newToolTraces[idx],
              toolResult: data.toolResult,
              success: data.success as boolean | undefined,
              duration: data.duration as number | undefined,
            }
          } else {
            // No matching tool_use found — create a standalone trace
            newToolTraces.push({
              toolName,
              toolInput: undefined,
              toolResult: data.toolResult,
              success: data.success as boolean | undefined,
              duration: data.duration as number | undefined,
              timestamp: now,
            })
          }

          // Find the matching tool_use activity event to reuse its ID.
          const pairedResultIds = new Set(
            newActivityEvents
              .filter((e): e is Extract<TaskActivityEvent, { type: 'tool_result' }> => e.type === 'tool_result')
              .map(e => e.id)
          )
          const matchingUse = [...newActivityEvents].reverse().find(
            (e): e is Extract<TaskActivityEvent, { type: 'tool_use' }> =>
              e.type === 'tool_use' && e.toolName === toolName && !pairedResultIds.has(e.id)
          )
          const resultId = matchingUse?.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`

          newActivityEvents = [
            ...newActivityEvents,
            {
              type: 'tool_result' as const,
              id: resultId,
              toolName,
              toolResult: data.toolResult,
              success: data.success as boolean | undefined,
              duration: data.duration as number | undefined,
              timestamp: now,
            },
          ]
        } else {
          // Input event (tool_use) or combined event (has both input and result)
          const traceId = `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`
          newToolTraces = [
            ...newToolTraces,
            {
              toolName,
              toolInput: data.toolInput,
              toolResult: data.toolResult,
              success: data.success as boolean | undefined,
              duration: data.duration as number | undefined,
              timestamp: now,
            },
          ]
          newActivityEvents = [
            ...newActivityEvents,
            { type: 'tool_use' as const, id: traceId, toolName, toolInput: data.toolInput, timestamp: now },
            ...(hasResult ? [{
              type: 'tool_result' as const,
              id: traceId,
              toolName,
              toolResult: data.toolResult,
              success: data.success as boolean | undefined,
              duration: data.duration as number | undefined,
              timestamp: now,
            }] : []),
          ]
        }

        // Extract plan mode data from TodoWrite and AskUserQuestion tools
        if (data.toolName === 'TodoWrite') {
          const input = data.toolInput as { todos?: Array<{ content: string; status: string; activeForm: string }> }
          if (input?.todos) {
            newPlanTodos = input.todos.map(t => ({
              content: t.content,
              status: t.status as 'pending' | 'in_progress' | 'completed',
              activeForm: t.activeForm,
            }))
          }
        } else if (data.toolName === 'AskUserQuestion') {
          const input = data.toolInput as { questions?: Array<{ question: string; options: Array<{ label: string }> }> }
          if (input?.questions) {
            newPlanQuestions = [...(newPlanQuestions || [])]
            for (const q of input.questions) {
              newPlanQuestions.push({
                question: q.question,
                options: q.options.map(o => o.label),
              })
            }
          }
        }

        streams.set(taskId, {
          ...existing,
          toolTraces: newToolTraces,
          activityEvents: newActivityEvents,
          planTodos: newPlanTodos,
          planQuestions: newPlanQuestions,
        })
        return { taskStreams: streams }
      })
      // NOTE: No dual-write to execution store - realtime events stay in realtime store only
      // The UI will use either execution store (for local dispatch) OR realtime store (for relay)
      break
    }

    case 'task:file_change': {
      const taskId = data.taskId as string
      const now = new Date()
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(taskId) || createEmptyTaskStream(taskId)
        streams.set(taskId, {
          ...existing,
          fileChanges: [...existing.fileChanges, {
            path: data.path as string,
            action: data.action as string,
            linesAdded: data.linesAdded as number | undefined,
            linesRemoved: data.linesRemoved as number | undefined,
            diff: data.diff as string | undefined,
            timestamp: now,
          }],
          activityEvents: [...existing.activityEvents, {
            type: 'file_change' as const,
            path: data.path as string,
            action: data.action as string,
            diff: data.diff as string | undefined,
            linesAdded: data.linesAdded as number | undefined,
            linesRemoved: data.linesRemoved as number | undefined,
            timestamp: now,
          }],
        })
        return { taskStreams: streams }
      })
      addActivity(set, 'file_change', `File ${data.action}: ${data.path}`, { taskId })
      // NOTE: No dual-write to execution store - realtime events stay in realtime store only
      // The UI will use either execution store (for local dispatch) OR realtime store (for relay)
      break
    }

    case 'task:steer_ack': {
      const taskId = data.taskId as string
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(taskId)
        if (existing && existing.steerMessages.length > 0) {
          // Create new arrays to trigger Zustand selector re-renders
          const newSteerMessages = [...existing.steerMessages]
          const lastIdx = newSteerMessages.length - 1
          newSteerMessages[lastIdx] = {
            ...newSteerMessages[lastIdx],
            accepted: data.accepted as boolean,
            ackMessage: data.message as string | undefined,
            ...(data.interrupted !== undefined ? { interrupted: data.interrupted as boolean } : {}),
          }
          // Also update the corresponding activity event
          const newActivityEvents = [...existing.activityEvents]
          for (let i = newActivityEvents.length - 1; i >= 0; i--) {
            const e = newActivityEvents[i]
            if (e.type === 'steer' && e.accepted === undefined) {
              newActivityEvents[i] = {
                ...e,
                accepted: data.accepted as boolean,
                ackMessage: data.message as string | undefined,
                ...(data.interrupted !== undefined ? { interrupted: data.interrupted as boolean } : {}),
              }
              break
            }
          }
          streams.set(taskId, { ...existing, steerMessages: newSteerMessages, activityEvents: newActivityEvents })
        }
        return { taskStreams: streams }
      })
      break
    }

    // Session attachment events (MCP bridge)
    case 'session:attached': {
      const sessionId = data.sessionId as string
      const taskId = data.taskId as string
      const machineId = data.machineId as string
      const attachedAt = data.attachedAt ? new Date(data.attachedAt as string) : new Date()

      set((state) => {
        const sessions = new Map(state.attachedSessions)
        sessions.set(sessionId, {
          sessionId,
          taskId,
          machineId,
          attachedAt,
          eventCount: 0,
          events: [],
        })
        return { attachedSessions: sessions }
      })

      addActivity(set, 'session', `Session attached to task ${taskId}`, { taskId, machineId })
      break
    }

    case 'session:detached': {
      const sessionId = data.sessionId as string
      const taskId = data.taskId as string
      const reason = data.reason as string | undefined

      set((state) => {
        const sessions = new Map(state.attachedSessions)
        sessions.delete(sessionId)
        return { attachedSessions: sessions }
      })

      addActivity(set, 'session', `Session detached from task ${taskId}${reason ? `: ${reason}` : ''}`, { taskId })
      break
    }

    case 'session:event': {
      const sessionId = data.sessionId as string
      const taskId = data.taskId as string
      const eventData = data.event as { type: string; [key: string]: unknown }

      set((state) => {
        const sessions = new Map(state.attachedSessions)
        const existing = sessions.get(sessionId)
        if (existing) {
          let newEvents = [...existing.events, {
            type: eventData.type,
            timestamp: new Date(),
            data: eventData,
          }]
          // Keep last 100 events per session
          if (newEvents.length > 100) {
            newEvents = newEvents.slice(-100)
          }
          sessions.set(sessionId, { ...existing, eventCount: existing.eventCount + 1, events: newEvents })
        }
        return { attachedSessions: sessions }
      })

      // Add activity for significant events
      if (eventData.type === 'tool_call') {
        const toolName = (eventData as { toolName?: string }).toolName || 'unknown'
        addActivity(set, 'tool', `Tool call: ${toolName}`, { taskId })
      } else if (eventData.type === 'file_change') {
        const path = (eventData as { path?: string }).path || 'unknown'
        const action = (eventData as { action?: string }).action || 'changed'
        addActivity(set, 'file_change', `File ${action}: ${path}`, { taskId })
      } else if (eventData.type === 'error') {
        const message = (eventData as { message?: string }).message || 'Unknown error'
        addActivity(set, 'error', `Session error: ${message}`, { taskId })
      }
      break
    }

    case 'approval:requested': {
      const approvalId = data.approvalId as string
      const nodeId = data.nodeId as string
      const projectId = data.projectId as string
      const executionId = data.executionId as string
      const message = data.message as string
      const options = data.options as string[] | undefined
      const timestamp = new Date(data.timestamp as string)

      // Add to execution store's pending approvals
      const execStore = useExecutionStore.getState()
      execStore.addPendingApproval({
        approvalId,
        nodeId,
        projectId,
        executionId,
        message,
        options,
        timestamp,
      })

      // Add to activity feed
      addActivity(
        set,
        'progress',
        `Approval requested: ${message}`,
        { taskId: executionId }
      )
      break
    }

    case 'approval:responded': {
      const approvalId = data.approvalId as string
      const approved = data.approved as boolean
      const selectedOption = data.selectedOption as string | undefined

      // Activity already logged when user clicks button
      // Just log for debugging
      console.log('[realtime] Approval responded:', { approvalId, approved, selectedOption })
      break
    }

    case 'merge_queue:failed': {
      const nodeId = data.nodeId as string
      const projectId = data.projectId as string
      const reason = data.reason as string

      // Update plan node to awaiting_judgment + failed merge queue status
      const planStore = usePlanStore.getState()
      const node = planStore.nodes.find((n) => n.id === nodeId && n.projectId === projectId)
      if (node) {
        planStore.updateNode(nodeId, {
          status: 'awaiting_judgment',
          mergeQueueStatus: 'failed',
        })
      }

      addActivity(set, 'merge_queue', `Merge queue failed for node ${nodeId}: ${reason}`)
      break
    }

    case 'merge_queue:succeeded': {
      const nodeId = data.nodeId as string
      const projectId = data.projectId as string

      // Update plan node merge queue status and mark task completed
      const planStore = usePlanStore.getState()
      const node = planStore.nodes.find((n) => n.id === nodeId && n.projectId === projectId)
      if (node) {
        planStore.updateNode(nodeId, {
          status: 'completed',
          mergeQueueStatus: 'merged',
        })
      }

      addActivity(set, 'merge_queue', `PR merged via merge queue for node ${nodeId}`)
      break
    }

    case 'task:approval_request': {
      const taskId = data.taskId as string
      const requestId = data.requestId as string
      const question = data.question as string
      const options = data.options as string[]
      const approvalMachineId = data.machineId as string | undefined
      const timestamp = new Date()

      // Add to dynamic approvals map (clear any stale approvals for this task first)
      set((state) => {
        const newApprovals = new Map(state.dynamicApprovals)
        // Remove previous pending approvals for the same task (e.g., timed-out retries)
        for (const [oldReqId, oldApproval] of newApprovals) {
          if (oldApproval.taskId === taskId && oldReqId !== requestId) {
            newApprovals.delete(oldReqId)
          }
        }
        newApprovals.set(requestId, {
          taskId,
          requestId,
          question,
          options,
          machineId: approvalMachineId,
          timestamp,
        })

        // Also push approval_request activity event into task stream
        // Remove stale approval_request events for the same task first
        const streams = new Map(state.taskStreams)
        const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
        stream.activityEvents = [
          ...stream.activityEvents.filter(
            e => !(e.type === 'approval_request' && e.requestId !== requestId)
          ),
          {
            type: 'approval_request' as const,
            requestId,
            question,
            options,
            timestamp,
          },
        ]
        streams.set(taskId, stream)

        return { dynamicApprovals: newApprovals, taskStreams: streams }
      })

      // Add to activity feed
      addActivity(
        set,
        'approval',
        `Agent asking: ${question}`,
        { taskId }
      )

      // Browser notification (shows only when tab is not focused)
      const approvalProjectName = (() => {
        const exec = useExecutionStore.getState().executions.get(taskId)
        if (exec?.projectId) {
          const project = useProjectStore.getState().projects.find((p) => p.id === exec.projectId)
          if (project) return project.name
        }
        return 'Astro'
      })()
      showApprovalNotification(approvalProjectName, question)

      console.log('[realtime] Dynamic approval request received:', { taskId, requestId, question, options })
      break
    }

    case 'task:approval_auto_responded': {
      const taskId = data.taskId as string
      const requestId = data.requestId as string
      const question = data.question as string
      const options = data.options as string[]
      const answer = data.answer as string
      const timestamp = new Date()

      // Push both approval_request and approval_response (auto-approved) into task stream
      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
        streams.set(taskId, {
          ...stream,
          activityEvents: [
            ...stream.activityEvents,
            { type: 'approval_request' as const, requestId, question, options, timestamp },
            { type: 'approval_response' as const, requestId, question, answer, autoApproved: true, timestamp },
          ],
        })
        // Do NOT add to dynamicApprovals — no dialog needed
        return { taskStreams: streams }
      })

      addActivity(set, 'approval', `Auto-approved: ${question} → ${answer}`, { taskId })
      break
    }

    case 'task:safety_prompt': {
      const taskId = data.taskId as string
      const safetyTier = data.safetyTier as string
      const warning = data.warning as string | undefined
      const safetyMachineId = data.machineId as string | undefined
      const options = data.options as Array<{ id: string; label: string; description?: string }>
      const timestamp = new Date()

      // Add to safety prompts map (keyed by taskId)
      set((state) => {
        const newPrompts = new Map(state.safetyPrompts)
        newPrompts.set(taskId, {
          taskId,
          safetyTier,
          warning,
          machineId: safetyMachineId,
          options,
          timestamp,
        })
        return { safetyPrompts: newPrompts }
      })

      addActivity(
        set,
        'safety',
        `Safety prompt: ${warning || `Working directory requires attention (${safetyTier})`}`,
        { taskId }
      )

      console.log('[realtime] Safety prompt received:', { taskId, safetyTier, warning })
      break
    }

    case 'task:ready': {
      const nodeId = data.nodeId as string
      const projectId = data.projectId as string

      addActivity(set, 'info', `Auto-dispatching downstream task`)

      // Dispatch with a small delay to avoid dispatching during SSE handler
      setTimeout(() => {
        const executionStore = useExecutionStore.getState()
        executionStore.startExecution(nodeId, projectId)
      }, 500)
      break
    }
  }
}
