/**
 * Realtime Store
 *
 * Zustand store for real-time events from the SSE event bridge.
 * Manages connected machines, activity feed, and per-task stream data.
 */

import { create } from 'zustand'
import { realtimeClient, type RealtimeEvent } from '@/lib/realtime-client'
import { usePlanStore } from './plan-store'
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

  // Actions
  connect: () => void
  disconnect: () => void
  getTaskStream: (taskId: string) => TaskStream | undefined
  addSteerMessage: (taskId: string, message: string) => void
  updateSteerMessage: (taskId: string, index: number, update: { accepted?: boolean; ackMessage?: string }) => void
  getSessionsForTask: (taskId: string) => AttachedSession[]
}

let activityCounter = 0

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  connected: false,
  machines: new Map(),
  activityFeed: [],
  taskStreams: new Map(),
  attachedSessions: new Map(),

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

  addSteerMessage: (taskId: string, message: string) => {
    const now = new Date()
    set((state) => {
      const streams = new Map(state.taskStreams)
      const stream = streams.get(taskId) || createEmptyTaskStream(taskId)
      stream.steerMessages.push({ message, timestamp: now })
      stream.activityEvents = [...stream.activityEvents, { type: 'steer' as const, message, timestamp: now }]
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
          // Also update the corresponding activity event
          for (let i = stream.activityEvents.length - 1; i >= 0; i--) {
            const e = stream.activityEvents[i]
            if (e.type === 'steer' && e.accepted === undefined) {
              stream.activityEvents[i] = { ...e, accepted: data.accepted as boolean, ackMessage: data.message as string | undefined }
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
  }
}
