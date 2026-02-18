/**
 * Realtime Store
 *
 * Zustand store for real-time events from the SSE event bridge.
 * Manages connected machines, activity feed, and per-task stream data.
 */

import { create } from 'zustand'
import { realtimeClient, type RealtimeEvent } from '@/lib/realtime-client'
import { usePlanStore } from './plan-store'
import { useExecutionStore } from './execution-store'
import { useMachinesStore } from './machines-store'
import type { TaskActivityEvent } from '@/types'

export interface HpcCapability {
  clusterName?: string
  partitions: string[]
  defaultPartition?: string
  accounts: string[]
}

export interface MachineEntry {
  machineId: string
  name: string
  environmentType: string
  connectionStatus: string
  providers: Array<{
    type: string
    status: string
    currentTasks: number
    maxConcurrentTasks: number
    hpcCapability?: HpcCapability
  }>
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

  // Actions
  connect: () => void
  disconnect: () => void
  getTaskStream: (taskId: string) => TaskStream | undefined
  addSteerMessage: (taskId: string, message: string, interrupted?: boolean) => void
  updateSteerMessage: (taskId: string, index: number, update: { accepted?: boolean; ackMessage?: string }) => void
  getSessionsForTask: (taskId: string) => AttachedSession[]
  getDynamicApproval: (requestId: string) => DynamicApprovalRequest | undefined
  respondToDynamicApproval: (taskId: string, requestId: string, answer: string) => Promise<void>
}

let activityCounter = 0

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  connected: false,
  machines: new Map(),
  activityFeed: [],
  taskStreams: new Map(),
  attachedSessions: new Map(),
  dynamicApprovals: new Map(),

  connect: () => {
    realtimeClient.connect()

    realtimeClient.on('*', (event: RealtimeEvent) => {
      handleRealtimeEvent(event, set)
    })

    // Track connection state
    const checkConnection = setInterval(() => {
      set({ connected: realtimeClient.connected })
    }, 2000)

    // Store cleanup ref
    ;(window as unknown as Record<string, unknown>).__realtimeInterval = checkConnection
  },

  disconnect: () => {
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
      const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
      stream.steerMessages.push({ message, interrupted, timestamp: now })
      stream.activityEvents = [...stream.activityEvents, { type: 'steer' as const, message, interrupted, timestamp: now }]
      streams.set(taskId, stream)
      return { taskStreams: streams }
    })
  },

  updateSteerMessage: (taskId: string, index: number, update: { accepted?: boolean; ackMessage?: string }) => {
    set((state) => {
      const streams = new Map(state.taskStreams)
      const stream = streams.get(taskId)
      if (stream && stream.steerMessages[index]) {
        stream.steerMessages[index] = { ...stream.steerMessages[index], ...update }
        // Also update the corresponding activity event
        let steerCount = 0
        stream.activityEvents = stream.activityEvents.map(e => {
          if (e.type === 'steer') {
            if (steerCount === index) {
              steerCount++
              return { ...e, ...update }
            }
            steerCount++
          }
          return e
        })
        streams.set(taskId, stream)
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
    if (!node) {
      console.error('[realtime] No node found for executionId:', taskId)
      return
    }

    // Get the machine ID for this task from execution store
    const execution = useExecutionStore.getState().getExecution(node.id)
    if (!execution?.machineId) {
      console.error('[realtime] No machine ID for task:', taskId)
      return
    }

    try {
      const response = await fetch('/api/dispatch/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          machineId: execution.machineId,
          requestId,
          answered: true,
          answer,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to send approval response: ${response.status}`)
      }

      // Remove from pending approvals
      set((state) => {
        const newApprovals = new Map(state.dynamicApprovals)
        newApprovals.delete(requestId)
        return { dynamicApprovals: newApprovals }
      })

      console.log('[realtime] Approval response sent:', { taskId, requestId, answer })
    } catch (error) {
      console.error('[realtime] Failed to send approval response:', error)
      throw error
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

  switch (event.type) {
    case 'machines:snapshot': {
      const machineList = event.data as MachineEntry[]
      const machines = new Map<string, MachineEntry>()
      for (const m of machineList) {
        machines.set(m.machineId, m)
      }
      set(() => ({ machines }))
      break
    }

    case 'machine:connected': {
      const entry = data as unknown as MachineEntry
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

    case 'task:stdout': {
      const taskId = data.taskId as string
      const text = data.data as string
      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
        stream.stdout += text
        stream.activityEvents = [...stream.activityEvents, { type: 'text', content: text, timestamp: new Date() }]
        streams.set(taskId, stream)
        return { taskStreams: streams }
      })
      // Dual-write: also update execution store (find nodeId from plan store)
      const stdoutNode = usePlanStore.getState().nodes.find((n) => n.executionId === taskId)
      if (stdoutNode) {
        useExecutionStore.getState().appendText(stdoutNode.id, text)
      }
      break
    }

    case 'task:text': {
      const taskId = data.taskId as string
      const text = data.data as string
      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
        stream.stdout += text
        stream.activityEvents = [...stream.activityEvents, { type: 'text', content: text, timestamp: new Date() }]
        streams.set(taskId, stream)
        return { taskStreams: streams }
      })
      // Dual-write
      const textNode = usePlanStore.getState().nodes.find((n) => n.executionId === taskId)
      if (textNode) {
        useExecutionStore.getState().appendText(textNode.id, text)
      }
      break
    }

    case 'task:session_init': {
      const taskId = data.taskId as string
      const sessionId = data.sessionId as string
      const model = data.model as string | undefined
      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
        stream.sessionId = sessionId
        stream.model = model
        streams.set(taskId, stream)
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
        const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
        stream.progress = progress
        stream.progressMessage = message
        streams.set(taskId, stream)
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
        const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
        stream.status = status
        stream.output = data.output as string | undefined
        stream.error = data.error as string | undefined
        streams.set(taskId, stream)
        return { taskStreams: streams }
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
        planStore.updateNode(node.id, {
          status: isSuccess ? 'auto_verified' : 'awaiting_judgment',
          executionOutput: data.output as string | undefined,
          executionError: data.error as string | undefined,
          executionCompletedAt: new Date(),
        })
      }
      break
    }

    case 'task:tool_trace': {
      const taskId = data.taskId as string
      const now = new Date()
      const traceId = `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`
      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
        stream.toolTraces.push({
          toolName: data.toolName as string,
          toolInput: data.toolInput,
          toolResult: data.toolResult,
          success: data.success as boolean | undefined,
          duration: data.duration as number | undefined,
          timestamp: now,
        })
        // Push both tool_use and tool_result activity events if result is present
        stream.activityEvents = [
          ...stream.activityEvents,
          { type: 'tool_use' as const, id: traceId, toolName: data.toolName as string, toolInput: data.toolInput, timestamp: now },
          ...(data.toolResult !== undefined ? [{
            type: 'tool_result' as const,
            id: traceId,
            toolName: data.toolName as string,
            toolResult: data.toolResult,
            success: data.success as boolean | undefined,
            duration: data.duration as number | undefined,
            timestamp: now,
          }] : []),
        ]
        streams.set(taskId, stream)
        return { taskStreams: streams }
      })
      // Dual-write to execution store
      const traceNode = usePlanStore.getState().nodes.find((n) => n.executionId === taskId)
      if (traceNode) {
        const execStore = useExecutionStore.getState()
        execStore.addToolTrace(traceNode.id, {
          id: traceId,
          toolName: data.toolName as string,
          toolInput: data.toolInput as Record<string, unknown>,
          toolResult: data.toolResult as unknown,
          success: data.success as boolean | undefined,
          duration: data.duration as number | undefined,
          timestamp: now,
        })
        if (data.toolResult !== undefined) {
          execStore.updateToolTraceResult(traceNode.id, data.toolName as string, data.toolResult, data.success as boolean | undefined, data.duration as number | undefined)
        }
      }
      break
    }

    case 'task:file_change': {
      const taskId = data.taskId as string
      const now = new Date()
      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
        stream.fileChanges.push({
          path: data.path as string,
          action: data.action as string,
          linesAdded: data.linesAdded as number | undefined,
          linesRemoved: data.linesRemoved as number | undefined,
          diff: data.diff as string | undefined,
          timestamp: now,
        })
        stream.activityEvents = [...stream.activityEvents, {
          type: 'file_change' as const,
          path: data.path as string,
          action: data.action as string,
          diff: data.diff as string | undefined,
          linesAdded: data.linesAdded as number | undefined,
          linesRemoved: data.linesRemoved as number | undefined,
          timestamp: now,
        }]
        streams.set(taskId, stream)
        return { taskStreams: streams }
      })
      addActivity(set, 'file_change', `File ${data.action}: ${data.path}`, { taskId })
      // Dual-write to execution store
      const fcNode = usePlanStore.getState().nodes.find((n) => n.executionId === taskId)
      if (fcNode) {
        useExecutionStore.getState().addFileChange(fcNode.id, {
          path: data.path as string,
          action: (data.action as string) as 'create' | 'modify' | 'delete',
          linesAdded: data.linesAdded as number | undefined,
          linesRemoved: data.linesRemoved as number | undefined,
          diff: data.diff as string | undefined,
          timestamp: now,
        })
      }
      break
    }

    case 'task:steer_ack': {
      const taskId = data.taskId as string
      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(taskId)
        if (stream && stream.steerMessages.length > 0) {
          // Update the last steer message with ack info
          const last = stream.steerMessages[stream.steerMessages.length - 1]
          last.accepted = data.accepted as boolean
          last.ackMessage = data.message as string | undefined
          if (data.interrupted !== undefined) {
            last.interrupted = data.interrupted as boolean
          }
          // Also update the corresponding activity event
          for (let i = stream.activityEvents.length - 1; i >= 0; i--) {
            const e = stream.activityEvents[i]
            if (e.type === 'steer' && e.accepted === undefined) {
              stream.activityEvents[i] = {
                ...e,
                accepted: data.accepted as boolean,
                ackMessage: data.message as string | undefined,
                ...(data.interrupted !== undefined ? { interrupted: data.interrupted as boolean } : {}),
              }
              break
            }
          }
          streams.set(taskId, stream)
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
        const session = sessions.get(sessionId)
        if (session) {
          session.eventCount++
          session.events.push({
            type: eventData.type,
            timestamp: new Date(),
            data: eventData,
          })
          // Keep last 100 events per session
          if (session.events.length > 100) {
            session.events = session.events.slice(-100)
          }
          sessions.set(sessionId, session)
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

    case 'task:approval_request': {
      const taskId = data.taskId as string
      const requestId = data.requestId as string
      const question = data.question as string
      const options = data.options as string[]
      const timestamp = new Date()

      // Add to dynamic approvals map
      set((state) => {
        const newApprovals = new Map(state.dynamicApprovals)
        newApprovals.set(requestId, {
          taskId,
          requestId,
          question,
          options,
          timestamp,
        })
        return { dynamicApprovals: newApprovals }
      })

      // Add to activity feed
      addActivity(
        set,
        'approval',
        `Agent asking: ${question}`,
        { taskId }
      )

      console.log('[realtime] Dynamic approval request received:', { taskId, requestId, question, options })
      break
    }
  }
}
