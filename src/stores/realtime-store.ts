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
import { fetchStreamingEventsCatchUp } from '@/lib/api-client'
import { hydrateStreamingEvents } from '@/lib/streaming-event-hydrator'
import { usePlanStore, isLive } from './plan-store'
import { dataClient } from '@/lib/data-client'
import { useProjectStore } from './project-store'
import { useExecutionStore } from './execution-store'
import { useMachinesStore } from './machines-store'
import { applyPlanFromText, planNodeIdToProjectId } from '@/lib/plan-extraction'
import type { TaskActivityEvent } from '@/types'
import { useToastStore } from './toast-store'
import { useNotificationStore } from './notification-store'
import { buildServerCompletionMessage, buildClientCompletionMessage } from '@/lib/completion-messages'

// Per-node fetch generation counter to prevent out-of-order getNode() responses
// from overwriting newer state (e.g., rapid dispatched → in_progress → completed).
const nodeStatusGen = new Map<string, number>()

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
  /** True for chat-session streams (not task execution streams).
   *  Chat streams are managed by useChatActivityEvents which handles its own
   *  hydration — the global SSE reconnect handler must skip them to prevent
   *  hydratedChatEvents from being updated with events already in chatEventsRef. */
  isChatStream?: boolean
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
  hydrateFromCatchUp: (executionIds: string[], afterSeq?: number, streamType?: 'chat') => Promise<void>
  pushActivityEvent: (executionId: string, event: TaskActivityEvent) => void
  /** Reconcile running tasks after page refresh: bootstrap execution store + task streams
   *  for plan nodes that are in_progress but have no execution store entries. */
  reconcileRunningTasks: () => void
}

let activityCounter = 0

// ─── Text Batching for Smooth Streaming ────────────────────────────
// Same pattern as execution-store: accumulate text chunks in a buffer
// and flush to Zustand every 50ms (~20fps) to avoid per-token re-renders.
const realtimeTextBatch = new Map<string, string>()
const realtimeTextTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Clear text-batch state for a given taskId (used by resetExecution). */
export function clearRealtimeTextBatch(taskId: string) {
  const timer = realtimeTextTimers.get(taskId)
  if (timer) clearTimeout(timer)
  realtimeTextTimers.delete(taskId)
  realtimeTextBatch.delete(taskId)
}

function flushRealtimeText(
  execId: string,
  set: (fn: (state: RealtimeState) => Partial<RealtimeState>) => void,
) {
  const timer = realtimeTextTimers.get(execId)
  if (timer) {
    clearTimeout(timer)
    realtimeTextTimers.delete(execId)
  }

  const text = realtimeTextBatch.get(execId)
  realtimeTextBatch.delete(execId)

  if (!text) return

  console.log('[realtime] text for', execId, ':', text.slice(0, 80))
  set((state) => {
    const streams = new Map(state.taskStreams)
    const existing = streams.get(execId) || createEmptyTaskStream(execId)
    const stream = {
      ...existing,
      stdout: existing.stdout + text,
      activityEvents: [...existing.activityEvents, { type: 'text' as const, content: text, timestamp: new Date() }],
    }
    streams.set(execId, stream)
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

    // On SSE reconnect after network blip, reconcile running tasks (in case
    // task:init events were missed during the disconnect) then catch up missed
    // streaming events for all active executions.
    realtimeClient.onReconnect = () => {
      // Re-run reconciliation so tasks dispatched during the disconnect get
      // bootstrapped in the execution store + taskStreams.
      get().reconcileRunningTasks()

      const { taskStreams, hydrateFromCatchUp } = get()
      // Collect execution IDs from all active task execution streams.
      // Skip chat-session streams (isChatStream=true) — they self-manage via
      // useChatActivityEvents. The global reconnect must not update them or it
      // would add current-turn events to hydratedChatEvents that are already
      // in chatEventsRef, causing duplication in the merged activity feed.
      const activeIds: string[] = []
      for (const [execId, stream] of taskStreams) {
        if (stream.isChatStream) continue
        if (stream.status === 'running' || stream.status === 'in_progress') {
          activeIds.push(execId)
        }
      }
      if (activeIds.length > 0) {
        console.log('[realtime] SSE reconnected, catching up', activeIds.length, 'active executions from seq', realtimeClient.lastSeq)
        hydrateFromCatchUp(activeIds, realtimeClient.lastSeq)
      }
    }

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

    realtimeClient.onReconnect = null
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
      // Add to steerMessages (for tracking) but NOT to activityEvents yet —
      // the message should only appear in the timeline after the agent ack's it.
      stream.steerMessages.push({ message, interrupted, timestamp: now })
      streams.set(taskId, stream)
      return { taskStreams: streams }
    })
  },

  updateSteerMessage: (taskId: string, index: number, update: { accepted?: boolean; ackMessage?: string }) => {
    set((state) => {
      const streams = new Map(state.taskStreams)
      const existing = streams.get(taskId)
      if (existing && existing.steerMessages[index]) {
        const newSteerMessages = [...existing.steerMessages]
        newSteerMessages[index] = { ...newSteerMessages[index], ...update }

        // Only add to activityEvents when the agent acknowledged the message
        const newActivityEvents = [...existing.activityEvents]
        if (update.accepted !== undefined) {
          const steerMsg = newSteerMessages[index]
          if (update.accepted) {
            // Accepted steers render as chat_user (visually identical to post-completion chat)
            newActivityEvents.push({
              type: 'chat_user' as const,
              message: steerMsg.message,
              timestamp: steerMsg.timestamp,
            })
          } else {
            // Failed steers keep the steer type (shows error indicator)
            newActivityEvents.push({
              type: 'steer' as const,
              message: steerMsg.message,
              interrupted: steerMsg.interrupted,
              accepted: false,
              ackMessage: update.ackMessage,
              timestamp: steerMsg.timestamp,
            })
          }
        }

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
    const approval = get().dynamicApprovals.get(requestId)
    const machineId = resolveMachineId(taskId, approval?.machineId, get)
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
    const safetyPrompt = get().safetyPrompts.get(taskId)
    const machineId = resolveMachineId(taskId, safetyPrompt?.machineId, get)
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

  hydrateFromCatchUp: async (executionIds: string[], afterSeq = 0, streamType?: 'chat') => {
    if (executionIds.length === 0) return
    try {
      const { events, lastSeq: newSeq } = await fetchStreamingEventsCatchUp(executionIds, afterSeq)
      if (events.length === 0) return

      // Update realtimeClient.lastSeq so next reconnect doesn't re-fetch these events
      realtimeClient.lastSeq = newSeq

      // Group events by executionId and hydrate into task streams
      const byExecution = new Map<string, typeof events>()
      for (const ev of events) {
        const list = byExecution.get(ev.executionId) || []
        list.push(ev)
        byExecution.set(ev.executionId, list)
      }

      // afterSeq > 0 means reconnection catch-up: append missed events to existing data
      // afterSeq === 0 means full hydration (page refresh): use hydrated data only if existing is empty
      const isReconnect = afterSeq > 0

      // Hydrate once per execution (avoid calling hydrateStreamingEvents multiple
      // times which increments a global idCounter, producing mismatched IDs)
      const hydratedByExecution = new Map<string, ReturnType<typeof hydrateStreamingEvents>>()
      for (const [execId, execEvents] of byExecution) {
        hydratedByExecution.set(execId, hydrateStreamingEvents(execEvents))
      }

      set((state) => {
        const streams = new Map(state.taskStreams)
        for (const [execId] of byExecution) {
          const existing = streams.get(execId) || createEmptyTaskStream(execId)
          const hydrated = hydratedByExecution.get(execId)!

          // Always apply metadata from hydrated events (status, output, error, sessionId, model)
          const metadata: Partial<TaskStream> = {}
          if (hydrated.status) metadata.status = hydrated.status
          if (hydrated.output) metadata.output = hydrated.output
          if (hydrated.error) metadata.error = hydrated.error
          if (hydrated.sessionId) metadata.sessionId = hydrated.sessionId
          if (hydrated.model) metadata.model = hydrated.model
          if (hydrated.progress !== undefined) metadata.progress = hydrated.progress
          if (hydrated.progressMessage) metadata.progressMessage = hydrated.progressMessage
          if (hydrated.machineId) metadata.machineId = hydrated.machineId

          if (isReconnect) {
            // On SSE reconnect, deduplicate events to prevent showing text twice.
            // Text events are batched server-side: SSE delivers individual chunks (no seq),
            // then heartbeat/structural events flush them to DB as a single row (with seq >
            // lastSeq). Naive concatenation would render the same text twice.
            //
            // Strategy:
            //  - Build seq sets for both sides for O(1) lookup
            //  - From existing: keep seq'd events not overwritten by hydrated; drop no-seq
            //    text events (their content is already in existing.stdout from SSE delivery,
            //    and the DB has the canonical seq'd version in hydrated)
            //  - From hydrated: add events with new seqs not already in existing
            //  - Rebuild stdout from merged text events to stay consistent
            const hydratedActivitySeqs = new Set<number>()
            for (const e of hydrated.activityEvents) {
              if (e.seq != null) hydratedActivitySeqs.add(e.seq)
            }
            const existingActivitySeqs = new Set<number>()
            for (const e of existing.activityEvents) {
              if (e.seq != null) existingActivitySeqs.add(e.seq)
            }

            // Keep existing events that are NOT superseded by a hydrated seq'd version
            // Drop no-seq text events: their content is captured in existing.stdout and
            // the DB has a batched seq'd version in the hydrated set
            const existingKept = existing.activityEvents.filter(e => {
              if (e.seq != null) return !hydratedActivitySeqs.has(e.seq)
              return e.type !== 'text'
            })
            // Build set of no-seq event types already present in existingKept so that
            // no-seq events from hydrated (e.g. plan_result, which carries no DB seq)
            // don't produce duplicates when already delivered via SSE.
            const existingKeptNoSeqTypes = new Set(
              existingKept.filter(e => e.seq == null).map(e => e.type)
            )
            // Add hydrated events not already covered by existing seqs.
            // For no-seq hydrated events (e.g. plan_result), skip if the same type
            // already exists in existingKept to avoid duplicating SSE-delivered events.
            const hydratedNew = hydrated.activityEvents.filter(e =>
              e.seq == null
                ? !existingKeptNoSeqTypes.has(e.type)
                : !existingActivitySeqs.has(e.seq)
            )
            const mergedActivity = [...existingKept, ...hydratedNew]
            mergedActivity.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

            // Rebuild stdout from merged text events; fall back to existing.stdout when
            // no text events survived the merge (e.g. flush not yet in DB at catch-up time)
            const mergedStdout = mergedActivity
              .filter((e): e is Extract<typeof e, { type: 'text' }> => e.type === 'text')
              .map(e => e.content)
              .join('')

            streams.set(execId, {
              ...existing,
              ...metadata,
              stdout: mergedStdout || existing.stdout,
              activityEvents: mergedActivity,
              // Use mergeBySeq to deduplicate toolTraces and fileChanges. When the
              // heartbeat fires with an empty text buffer (textSeq = null), lastSeq is
              // not advanced, so a subsequent catch-up may include tool_use/file_change
              // events that were already delivered via SSE. Naive concat would duplicate
              // them in the activity feed.
              toolTraces: mergeBySeq(existing.toolTraces, hydrated.toolTraces),
              fileChanges: mergeBySeq(existing.fileChanges, hydrated.fileChanges),
            })
          } else {
            // Full hydration (page refresh): hydrated events are the complete history
            // from the DB. If some live events arrived via SSE before hydration completed,
            // append only genuinely new live events after the hydrated base. This prevents
            // discarding historical events (e.g. approval_responses) when a race between
            // SSE reconnect and catch-up hydration causes `existing` to be partially populated.
            const mergedActivity = mergeBySeq(hydrated.activityEvents, existing.activityEvents)
            const mergedToolTraces = mergeBySeq(hydrated.toolTraces, existing.toolTraces)
            const mergedFileChanges = mergeBySeq(hydrated.fileChanges, existing.fileChanges)
            streams.set(execId, {
              ...existing,
              ...metadata,
              stdout: hydrated.stdout || existing.stdout,
              activityEvents: mergedActivity,
              toolTraces: mergedToolTraces,
              fileChanges: mergedFileChanges,
              // Mark chat-session streams so the global reconnect handler skips them.
              // Chat streams self-manage hydration via useChatActivityEvents — the global
              // reconnect must not update them or hydratedChatEvents gains current-turn
              // events that are already in chatEventsRef, causing duplication.
              ...(streamType === 'chat' ? { isChatStream: true } : {}),
            })
          }
        }
        return { taskStreams: streams }
      })

      // Reconstruct dynamicApprovals from pending approval_request events
      // and safetyPrompts from pending safety_prompt events
      set((state) => {
        const newApprovals = new Map(state.dynamicApprovals)
        const newSafetyPrompts = new Map(state.safetyPrompts)
        for (const [execId] of byExecution) {
          const hydrated = hydratedByExecution.get(execId)!
          for (const approval of hydrated.pendingApprovals) {
            newApprovals.set(approval.requestId, {
              taskId: approval.executionId,
              requestId: approval.requestId,
              question: approval.question,
              options: approval.options,
              machineId: approval.machineId,
              timestamp: approval.timestamp,
            })
          }
          for (const safetyPrompt of hydrated.pendingSafetyPrompts) {
            newSafetyPrompts.set(safetyPrompt.taskId, {
              taskId: safetyPrompt.taskId,
              safetyTier: safetyPrompt.safetyTier,
              warning: safetyPrompt.warning,
              machineId: safetyPrompt.machineId,
              options: safetyPrompt.options,
              timestamp: safetyPrompt.timestamp,
            })
          }
        }
        return { dynamicApprovals: newApprovals, safetyPrompts: newSafetyPrompts }
      })

      // Reconcile plan nodes and execution store with hydrated result data
      for (const [execId] of byExecution) {
        const hydrated = hydratedByExecution.get(execId)!
        if (hydrated.status) {
          reconcileResultFromCatchUp(execId, hydrated)
        }
      }

      console.log('[realtime] Hydrated', events.length, 'streaming events for', executionIds.length, 'executions')
    } catch (err) {
      console.warn('[realtime] Catch-up hydration failed:', err)
    }
  },

  pushActivityEvent: (() => {
    // Throttle text events to prevent React re-render on every token.
    // Non-text events (tool_use, tool_result, etc.) flush immediately.
    const pendingTextEvents = new Map<string, TaskActivityEvent[]>()
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      flushTimer = null
      const entries = Array.from(pendingTextEvents.entries())
      pendingTextEvents.clear()
      if (entries.length === 0) return

      set((state) => {
        const streams = new Map(state.taskStreams)
        for (const [eid, events] of entries) {
          const existing = streams.get(eid) || createEmptyTaskStream(eid)
          streams.set(eid, {
            ...existing,
            activityEvents: [...existing.activityEvents, ...events],
          })
        }
        return { taskStreams: streams }
      })
    }

    return (executionId: string, event: TaskActivityEvent) => {
      // Text events are throttled (high frequency, low urgency)
      if (event.type === 'text') {
        const existing = pendingTextEvents.get(executionId) || []
        existing.push(event)
        pendingTextEvents.set(executionId, existing)
        if (!flushTimer) {
          flushTimer = setTimeout(flush, 50)
        }
        return
      }
      // Non-text events: flush pending text first, then push immediately
      if (flushTimer) {
        clearTimeout(flushTimer)
        flush()
      }
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(executionId) || createEmptyTaskStream(executionId)
        streams.set(executionId, {
          ...existing,
          activityEvents: [...existing.activityEvents, event],
        })
        return { taskStreams: streams }
      })
    }
  })(),

  reconcileRunningTasks: () => {
    const planStore = usePlanStore.getState()
    const execStore = useExecutionStore.getState()
    const state = get()

    const newExecs = new Map(execStore.executions)
    const newStreams = new Map(state.taskStreams)
    let execChanged = false
    let streamChanged = false
    const catchUpIds: string[] = []

    // 1. Reconcile plan nodes with in_progress/dispatched status
    const runningNodes = planStore.nodes.filter(
      (n) => (n.status === 'in_progress' || n.status === 'dispatched') && n.executionId
    )

    for (const node of runningNodes) {
      const execId = node.executionId!

      // Bootstrap execution store entry if missing
      if (!newExecs.has(node.id)) {
        newExecs.set(node.id, {
          nodeId: node.id,
          projectId: node.projectId,
          executionId: execId,
          status: 'running',
          streamText: '',
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
          startedAt: node.executionStartedAt ? new Date(node.executionStartedAt) : new Date(),
          machineId: node.machineId,
        })
        execChanged = true
      }

      // Bootstrap task stream entry if missing
      if (!newStreams.has(execId)) {
        newStreams.set(execId, createEmptyTaskStream(execId))
        streamChanged = true
        catchUpIds.push(execId)
      }
    }

    // 2. Reconcile execution store entries (playground/plan sessions) that have
    //    executionId but no corresponding task stream
    for (const [, exec] of execStore.executions) {
      if ((exec.status !== 'running' && exec.status !== 'pending') || !exec.executionId) continue
      if (!newStreams.has(exec.executionId)) {
        newStreams.set(exec.executionId, createEmptyTaskStream(exec.executionId))
        streamChanged = true
        catchUpIds.push(exec.executionId)
      }
    }

    if (execChanged) {
      useExecutionStore.setState({ executions: newExecs })
    }
    if (streamChanged) {
      set({ taskStreams: newStreams })
    }

    // Trigger catch-up hydration for newly discovered running tasks
    if (catchUpIds.length > 0) {
      console.log('[realtime] Reconciling', catchUpIds.length, 'running tasks after page load')
      get().hydrateFromCatchUp(catchUpIds, 0)
    }
  },
}))

/**
 * Resolve machineId for a task through a 4-step fallback chain:
 * 1. Provided machineId (from event)
 * 2. Execution store via plan node lookup
 * 3. Iteration through all executions
 * 4. TaskStream machineId (from hydrated init event)
 */
function resolveMachineId(taskId: string, eventMachineId: string | undefined, getState: () => RealtimeState): string | undefined {
  if (eventMachineId) return eventMachineId

  const planStore = usePlanStore.getState()
  const node = planStore.nodes.find((n) => n.executionId === taskId)
  if (node) {
    const execution = useExecutionStore.getState().getExecution(node.id)
    if (execution?.machineId) return execution.machineId
  }

  const execStore = useExecutionStore.getState()
  for (const exec of execStore.executions.values()) {
    if (exec.executionId === taskId && exec.machineId) {
      return exec.machineId
    }
  }

  return getState().taskStreams.get(taskId)?.machineId
}

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

/**
 * Seq-based merge: hydrated (DB history) forms the base; live events
 * with seq > maxHydratedSeq (or no seq) are appended. Falls back to
 * timestamp comparison for events without seq (e.g. text events whose
 * seq is not available due to server-side batching).
 */
function mergeBySeq<T extends { seq?: number; timestamp: Date }>(
  hydrated: T[],
  live: T[],
): T[] {
  if (live.length === 0) return hydrated
  if (hydrated.length === 0) return live

  // Build a set of all hydrated seq numbers for O(1) lookup
  const hydratedSeqs = new Set<number>()
  for (const e of hydrated) {
    if (e.seq != null) hydratedSeqs.add(e.seq)
  }
  // For events with seq: skip if already in the hydrated set
  // For events without seq (e.g. text events whose seq is unavailable due
  // to server-side batching): fall back to timestamp comparison. This is
  // a known-lossy heuristic — text events within 1s of the last hydrated
  // event may be dropped. Acceptable because the P0 guard in events.ts
  // eliminates the primary source of text duplication (double-delivery).
  const lastHydratedTime = new Date(hydrated[hydrated.length - 1].timestamp).getTime()
  const newLiveItems = live.filter(e => {
    if (e.seq != null) {
      return !hydratedSeqs.has(e.seq)
    }
    return new Date(e.timestamp).getTime() > lastHydratedTime + 1000
  })

  return newLiveItems.length > 0
    ? [...hydrated, ...newLiveItems]
    : hydrated
}

/**
 * After catch-up hydration, reconcile plan node and execution store
 * with result data (status, output, prUrl, etc.) that may have been
 * missed during a page refresh or network blip.
 */
function reconcileResultFromCatchUp(
  executionId: string,
  hydrated: import('@/lib/streaming-event-hydrator').HydratedStreamData,
) {
  if (!hydrated.status) return
  const isSuccess = hydrated.status === 'success' || hydrated.status === 'completed'

  // Find the result event data for PR/branch metadata
  // The hydrated object has status/output/error but not prUrl etc.
  // We need to look at the raw data — but since we already have the result fields
  // on the hydrated object, we can only update what we have.

  // Update execution store (build new Map to maintain Zustand immutability)
  const execStore = useExecutionStore.getState()
  const newExecutions = new Map(execStore.executions)
  for (const [nid, exec] of execStore.executions) {
    if (exec.executionId === executionId && exec.status !== 'success') {
      newExecutions.set(nid, {
        ...exec,
        status: isSuccess ? 'success' : 'failure',
        completedAt: new Date(),
        ...(hydrated.error ? { error: hydrated.error } : {}),
        ...(hydrated.branchName ? { branchName: hydrated.branchName } : {}),
        ...(hydrated.prUrl ? { prUrl: hydrated.prUrl } : {}),
        ...(hydrated.prNumber ? { prNumber: hydrated.prNumber } : {}),
        ...(hydrated.deliveryStatus ? { deliveryStatus: hydrated.deliveryStatus as "success" | "failed" | "skipped" } : {}),
      })
      useExecutionStore.setState({ executions: newExecutions })
      execStore.persist()
      break
    }
  }

  // Update plan node status — re-read from DB (DB-authoritative pattern)
  const planStore = usePlanStore.getState()
  const node = planStore.nodes.find((n) => n.executionId === executionId)
  if (node && node.status !== 'completed' && node.status !== 'auto_verified' && node.status !== 'pruned') {
    dataClient.getNode(node.id).then((freshNode) => {
      if (freshNode) {
        usePlanStore.getState().mergeNodeFromDB(freshNode)
        console.log('[realtime] Reconciled plan node', node.id, '→', freshNode.status, 'from catch-up (DB-authoritative)')
      }
    }).catch((err) => {
      console.error('[realtime] Failed to fetch node from DB during catch-up:', err)
    })
  }

  // If this is a plan session, extract plan nodes from caught-up stdout
  for (const [nid, exec] of execStore.executions) {
    if (exec.executionId === executionId && nid.startsWith('plan-')) {
      const planProjectId = planNodeIdToProjectId(nid)!
      // Only extract if project doesn't already have plan nodes
      // Prefer pre-extracted plan_result from hydrator; fall back to regex extraction from stdout
      const result = hydrated.planResult
        ? applyPlanFromText(planProjectId, '', executionId, false, hydrated.planResult)
        : hydrated.stdout
          ? applyPlanFromText(planProjectId, hydrated.stdout, executionId)
          : null
      if (result?.applied) {
        console.log('[realtime] Plan extracted from catch-up:', result.nodeCount, 'nodes')
      }
      break
    }
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

  // NOTE: The wire protocol uses `data.taskId` for execution IDs (i.e. the ID
  // returned by the dispatch/agent routes). To avoid confusion with plan node IDs,
  // local variables in this handler are named `execId`.

  // Flush pending text batches before non-text events to preserve ordering
  if (event.type !== 'task:stdout' && event.type !== 'task:text') {
    const execId = (data?.taskId as string) || ''
    if (execId && realtimeTextBatch.has(execId)) {
      flushRealtimeText(execId, set)
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
      const execId = data.taskId as string
      const text = data.data as string
      // Batch text chunks — flush every 50ms for smooth ~20fps rendering
      realtimeTextBatch.set(execId, (realtimeTextBatch.get(execId) || '') + text)
      if (!realtimeTextTimers.has(execId)) {
        realtimeTextTimers.set(execId, setTimeout(() => {
          realtimeTextTimers.delete(execId)
          flushRealtimeText(execId, set)
        }, 50))
      }
      break
    }

    case 'task:session_init': {
      const execId = data.taskId as string
      const sessionId = data.sessionId as string
      const model = data.model as string | undefined
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(execId) || createEmptyTaskStream(execId)
        streams.set(execId, { ...existing, sessionId, model })
        return { taskStreams: streams }
      })
      break
    }

    case 'task:progress': {
      const execId = data.taskId as string
      const progress = data.progress as number
      const message = data.message as string | undefined
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(execId) || createEmptyTaskStream(execId)
        streams.set(execId, { ...existing, progress, progressMessage: message })
        return { taskStreams: streams }
      })
      // Update plan node if in_progress
      if (progress > 0) {
        addActivity(set, 'progress', `Task progress: ${progress}%${message ? ` - ${message}` : ''}`, {
          taskId: execId,
        })
      }
      break
    }

    case 'task:result': {
      const execId = data.taskId as string
      const status = data.status as string
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(execId) || createEmptyTaskStream(execId)
        streams.set(execId, {
          ...existing,
          status,
          output: data.output as string | undefined,
          error: data.error as string | undefined,
        })

        // Clean up any pending dynamic approvals for this task
        const newApprovals = new Map(state.dynamicApprovals)
        let changed = false
        for (const [reqId, approval] of newApprovals) {
          if (approval.taskId === execId) {
            newApprovals.delete(reqId)
            changed = true
          }
        }

        return {
          taskStreams: streams,
          ...(changed ? { dynamicApprovals: newApprovals } : {}),
        }
      })

      const isSuccess = status === 'success' || status === 'completed'
      addActivity(
        set,
        isSuccess ? 'success' : 'failure',
        `Task ${isSuccess ? 'completed' : 'failed'}: ${execId}`,
        { taskId: execId }
      )

      // Guard: skip side-effects if execution already completed (duplicate delivery
      // now possible since activeDispatchStreams no longer suppresses task:result)
      const execStore = useExecutionStore.getState()
      {
        let alreadyCompleted = false
        for (const [, exec] of execStore.executions) {
          if (exec.executionId === execId) {
            alreadyCompleted = exec.status === 'success' || exec.status === 'failure' || exec.status === 'cancelled'
            break
          }
        }
        if (alreadyCompleted) break
      }

      // Update execution store entry (so UI reflects terminal status after refresh)
      // Build new Map to maintain Zustand immutability (don't mutate live state)
      const newExecs = new Map(execStore.executions)
      for (const [nid, exec] of execStore.executions) {
        if (exec.executionId === execId) {
          newExecs.set(nid, {
            ...exec,
            status: isSuccess ? 'success' : 'failure',
            completedAt: new Date(),
            ...(data.error ? { error: data.error as string } : {}),
            ...(data.branchName ? { branchName: data.branchName as string } : {}),
            ...(data.prUrl ? { prUrl: data.prUrl as string } : {}),
            ...(data.prNumber ? { prNumber: data.prNumber as number } : {}),
            ...(data.deliveryStatus ? { deliveryStatus: data.deliveryStatus as "success" | "failed" | "skipped" } : {}),
          })
          useExecutionStore.setState({ executions: newExecs })
          execStore.persist()
          break
        }
      }

      // Plan-node status update + notifications + YOLO trigger are now handled
      // by the node:status_changed SSE event (DB-authoritative pattern).

      // If this is a plan session result, extract plan nodes from accumulated stdout
      for (const [nid, exec] of execStore.executions) {
        if (exec.executionId === execId && nid.startsWith('plan-')) {
          const planProjectId = planNodeIdToProjectId(nid)!
          // Get accumulated stdout from task stream — use executionId for idempotency
          // to prevent race duplication with the SSE path in execution-store
          const stream = useRealtimeStore.getState().taskStreams.get(execId)
          if (stream?.stdout) {
            const result = applyPlanFromText(planProjectId, stream.stdout, execId)
            if (result.applied) {
              console.log('[realtime] Plan extracted from live SSE result:', result.nodeCount, 'nodes')
            }
          }
          break
        }
      }
      break
    }

    case 'task:tool_trace': {
      const execId = data.taskId as string
      const now = new Date()
      const toolName = data.toolName as string
      const hasInput = data.toolInput !== undefined
      const hasResult = data.toolResult !== undefined

      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(execId) || createEmptyTaskStream(execId)

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

        streams.set(execId, {
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
      const execId = data.taskId as string
      const now = new Date()
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(execId) || createEmptyTaskStream(execId)
        streams.set(execId, {
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
      addActivity(set, 'file_change', `File ${data.action}: ${data.path}`, { taskId: execId })
      // NOTE: No dual-write to execution store - realtime events stay in realtime store only
      // The UI will use either execution store (for local dispatch) OR realtime store (for relay)
      break
    }

    case 'task:steer_ack': {
      const execId = data.taskId as string
      const accepted = data.accepted as boolean
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(execId)
        if (existing && existing.steerMessages.length > 0) {
          // Create new arrays to trigger Zustand selector re-renders
          const newSteerMessages = [...existing.steerMessages]
          const lastIdx = newSteerMessages.length - 1
          newSteerMessages[lastIdx] = {
            ...newSteerMessages[lastIdx],
            accepted,
            ackMessage: data.message as string | undefined,
            ...(data.interrupted !== undefined ? { interrupted: data.interrupted as boolean } : {}),
          }
          // Remove any pending steer activity event and replace with final version
          const newActivityEvents = [...existing.activityEvents]
          // Find and remove the pending steer event (accepted === undefined)
          for (let i = newActivityEvents.length - 1; i >= 0; i--) {
            const e = newActivityEvents[i]
            if (e.type === 'steer' && e.accepted === undefined) {
              newActivityEvents.splice(i, 1)
              break
            }
          }
          // Add the resolved event
          const steerMsg = newSteerMessages[lastIdx]
          if (accepted) {
            // Accepted steers render as chat_user
            newActivityEvents.push({
              type: 'chat_user' as const,
              message: steerMsg.message,
              timestamp: steerMsg.timestamp,
            })
          } else {
            // Failed steers keep the steer type (shows error indicator)
            newActivityEvents.push({
              type: 'steer' as const,
              message: steerMsg.message,
              interrupted: steerMsg.interrupted,
              accepted: false,
              ackMessage: data.message as string | undefined,
              ...(data.interrupted !== undefined ? { interrupted: data.interrupted as boolean } : {}),
              timestamp: steerMsg.timestamp,
            })
          }
          streams.set(execId, { ...existing, steerMessages: newSteerMessages, activityEvents: newActivityEvents })
        }
        return { taskStreams: streams }
      })
      break
    }

    // Session attachment events (MCP bridge)
    case 'session:attached': {
      const sessionId = data.sessionId as string
      const execId = data.taskId as string
      const machineId = data.machineId as string
      const attachedAt = data.attachedAt ? new Date(data.attachedAt as string) : new Date()

      set((state) => {
        const sessions = new Map(state.attachedSessions)
        sessions.set(sessionId, {
          sessionId,
          taskId: execId,
          machineId,
          attachedAt,
          eventCount: 0,
          events: [],
        })
        return { attachedSessions: sessions }
      })

      addActivity(set, 'session', `Session attached to task ${execId}`, { taskId: execId, machineId })
      break
    }

    case 'session:detached': {
      const sessionId = data.sessionId as string
      const execId = data.taskId as string
      const reason = data.reason as string | undefined

      set((state) => {
        const sessions = new Map(state.attachedSessions)
        sessions.delete(sessionId)
        return { attachedSessions: sessions }
      })

      addActivity(set, 'session', `Session detached from task ${execId}${reason ? `: ${reason}` : ''}`, { taskId: execId })
      break
    }

    case 'session:event': {
      const sessionId = data.sessionId as string
      const execId = data.taskId as string
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
        addActivity(set, 'tool', `Tool call: ${toolName}`, { taskId: execId })
      } else if (eventData.type === 'file_change') {
        const path = (eventData as { path?: string }).path || 'unknown'
        const action = (eventData as { action?: string }).action || 'changed'
        addActivity(set, 'file_change', `File ${action}: ${path}`, { taskId: execId })
      } else if (eventData.type === 'error') {
        const message = (eventData as { message?: string }).message || 'Unknown error'
        addActivity(set, 'error', `Session error: ${message}`, { taskId: execId })
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
      const execId = data.taskId as string
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
          if (oldApproval.taskId === execId && oldReqId !== requestId) {
            newApprovals.delete(oldReqId)
          }
        }
        newApprovals.set(requestId, {
          taskId: execId,
          requestId,
          question,
          options,
          machineId: approvalMachineId,
          timestamp,
        })

        // Push approval_request activity event into task stream.
        // Do NOT remove previous approval_request events — they are historical
        // timeline entries that the UI needs to render answered approvals.
        // Only the dynamicApprovals map (above) tracks the "pending" state.
        const streams = new Map(state.taskStreams)
        const stream = streams.get(execId) || createEmptyTaskStream(execId)
        // Deduplicate: skip if this exact requestId is already in the stream (e.g., from hydration)
        const alreadyExists = stream.activityEvents.some(
          e => e.type === 'approval_request' && e.requestId === requestId
        )
        if (!alreadyExists) {
          stream.activityEvents = [
            ...stream.activityEvents,
            {
              type: 'approval_request' as const,
              requestId,
              question,
              options,
              timestamp,
            },
          ]
        }
        streams.set(execId, stream)

        return { dynamicApprovals: newApprovals, taskStreams: streams }
      })

      // Add to activity feed
      addActivity(
        set,
        'approval',
        `Agent asking: ${question}`,
        { taskId: execId }
      )

      // Browser notification (shows only when tab is not focused)
      const approvalProjectName = (() => {
        const exec = useExecutionStore.getState().executions.get(execId)
        if (exec?.projectId) {
          const project = useProjectStore.getState().projects.find((p) => p.id === exec.projectId)
          if (project) return project.name
        }
        return 'Astro'
      })()
      showApprovalNotification(approvalProjectName, question)

      console.log('[realtime] Dynamic approval request received:', { execId, requestId, question, options })
      break
    }

    case 'task:approval_auto_responded': {
      const execId = data.taskId as string
      const requestId = data.requestId as string
      const question = data.question as string
      const options = data.options as string[]
      const answer = data.answer as string
      const timestamp = new Date()

      // Push both approval_request and approval_response (auto-approved) into task stream
      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(execId) || createEmptyTaskStream(execId)
        streams.set(execId, {
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

      addActivity(set, 'approval', `Auto-approved: ${question} → ${answer}`, { taskId: execId })
      break
    }

    case 'task:safety_prompt': {
      const execId = data.taskId as string
      const safetyTier = data.safetyTier as string
      const warning = data.warning as string | undefined
      const safetyMachineId = data.machineId as string | undefined
      const options = data.options as Array<{ id: string; label: string; description?: string }>
      const timestamp = new Date()

      // Add to safety prompts map (keyed by executionId)
      set((state) => {
        const newPrompts = new Map(state.safetyPrompts)
        newPrompts.set(execId, {
          taskId: execId,
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
        { taskId: execId }
      )

      console.log('[realtime] Safety prompt received:', { execId, safetyTier, warning })
      break
    }

    case 'task:safety_auto_proceeded': {
      const execId = data.taskId as string
      const safetyTier = data.safetyTier as string
      const warning = data.warning as string | undefined

      addActivity(
        set,
        'approval',
        `YOLO auto-proceed: ${warning || `non-git directory (${safetyTier})`}`,
        { taskId: execId }
      )

      console.log('[realtime] Safety auto-proceeded (YOLO):', { execId, safetyTier })
      break
    }

    case 'task:init': {
      // Server-side dispatch started — bootstrap frontend tracking so the UI
      // shows live progress (progress bar, activity events, etc.) for tasks
      // that were auto-dispatched (YOLO cascading) without a browser SSE bridge.
      const execId = data.executionId as string
      const initNodeId = data.nodeId as string
      const initProjectId = data.projectId as string
      const initMachineId = data.machineId as string | undefined

      // Plan-node status update is now handled by node:status_changed SSE event
      // (DB-authoritative: server writes status, emits notification, frontend re-reads from DB)

      // 1. Create execution entry so ExecutionPanel can render
      const execStore = useExecutionStore.getState()
      if (!execStore.executions.has(initNodeId)) {
        useExecutionStore.setState((state) => {
          const newExecs = new Map(state.executions)
          newExecs.set(initNodeId, {
            nodeId: initNodeId,
            projectId: initProjectId,
            executionId: execId,
            status: 'running',
            streamText: '',
            toolTraces: [],
            fileChanges: [],
            activityEvents: [],
            startedAt: new Date(),
            machineId: initMachineId,
          })
          return { executions: newExecs }
        })
      }

      // 2. Create taskStream entry so progress/text events can be routed
      set((state) => {
        const streams = new Map(state.taskStreams)
        if (!streams.has(execId)) {
          streams.set(execId, createEmptyTaskStream(execId))
        }
        const existing = streams.get(execId)!
        streams.set(execId, { ...existing, status: 'running', machineId: initMachineId })
        return { taskStreams: streams }
      })

      const initNodeTitle = usePlanStore.getState().nodes.find((n) => n.id === initNodeId)?.title
      addActivity(set, 'info', `Task "${initNodeTitle || initNodeId}" dispatched automatically`, {
        taskId: execId,
      })
      break
    }

    case 'node:status_changed': {
      // DB-authoritative handler: re-read the node from DB and merge into plan store.
      // This is the ONLY path that updates plan-node status from server events.
      const nodeId = data.nodeId as string
      const projectId = data.projectId as string
      const execId = data.executionId as string | undefined

      // Re-read authoritative state from DB (with generation counter to prevent
      // out-of-order responses from overwriting newer state)
      const gen = (nodeStatusGen.get(nodeId) || 0) + 1
      nodeStatusGen.set(nodeId, gen)

      dataClient.getNode(nodeId).then((freshNode) => {
        if (!freshNode) return
        if ((nodeStatusGen.get(nodeId) || 0) > gen) return // stale response, discard

        const planStore = usePlanStore.getState()
        const prevNode = planStore.nodes.find((n) => n.id === nodeId)
        const prevStatus = prevNode?.status

        // Merge DB state into plan store (DB wins, no write-back)
        planStore.mergeNodeFromDB(freshNode)

        // Side effects based on status transition
        if (prevStatus !== freshNode.status) {
          const TERMINAL = new Set(['completed', 'auto_verified', 'pruned', 'awaiting_judgment', 'awaiting_approval'])
          const wasTerminal = prevStatus ? TERMINAL.has(prevStatus) : false
          const isNowTerminal = TERMINAL.has(freshNode.status)

          // Browser notification for task completion/failure
          if (isNowTerminal && !wasTerminal) {
            const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
            const pName = project?.name || 'Astro'
            const isSuccess = freshNode.status === 'completed' || freshNode.status === 'auto_verified'
            showTaskNotification(pName, freshNode.title, isSuccess ? 'completed' : 'failed')
            if (!isSuccess && freshNode.status !== 'pruned') {
              showTaskNotification(pName, freshNode.title, 'awaiting_judgment')
            }
          }

          // YOLO auto-execute: when a plan-* node completes, trigger executeAllProject
          if (execId && nodeId.startsWith('plan-')) {
            const isSuccess = freshNode.status === 'completed' || freshNode.status === 'auto_verified'
            if (isSuccess) {
              const planProjectId = planNodeIdToProjectId(nodeId)
              if (planProjectId) {
                const execStore = useExecutionStore.getState()
                if (execStore.autoExecuteProjectIds.has(planProjectId)) {
                  execStore.setAutoExecute(planProjectId, false)
                  setTimeout(() => {
                    console.log(`[realtime] YOLO mode: auto-executing all tasks for project ${planProjectId}`)
                    execStore.executeAllProject(planProjectId)
                  }, 1000)
                }
              }
            }
          }

          // Trigger batch execution next wave (now safe — node status is fresh from DB)
          if (isNowTerminal && !nodeId.startsWith('plan-') && !nodeId.startsWith('playground-')) {
            useExecutionStore.getState().triggerBatchWave(projectId)
          }

          // Check if all tasks in the project are now complete
          if (isNowTerminal && !nodeId.startsWith('plan-') && !nodeId.startsWith('playground-')) {
            const execStore = useExecutionStore.getState()
            if (!execStore.completedProjectIds.has(projectId)) {
              const COMPLETE_TERMINAL = new Set(['completed', 'auto_verified', 'pruned'])
              const projectNodes = usePlanStore.getState().nodes.filter(
                (n) => n.projectId === projectId && n.type === 'task' && isLive(n)
              )
              if (projectNodes.length > 0 && projectNodes.every((n) => COMPLETE_TERMINAL.has(n.status))) {
                useExecutionStore.setState((state) => {
                  const next = new Set(state.completedProjectIds)
                  next.add(projectId)
                  return { completedProjectIds: next }
                })
                const proj = useProjectStore.getState().projects.find((p) => p.id === projectId)
                const allSuccess = projectNodes.every(
                  (n) => n.status === 'completed' || n.status === 'auto_verified'
                )
                const msg = buildClientCompletionMessage({
                  projectName: proj?.name,
                  projectBranch: proj?.projectBranch,
                  allSuccess,
                })
                useToastStore.getState().add({ ...msg, duration: 8000 })
                useNotificationStore.getState().add({ ...msg, projectId })
              }
            }
          }
        }
      }).catch((err) => {
        console.error('[realtime] Failed to fetch node from DB for node:status_changed:', err)
      })

      addActivity(set, 'info', `Node status updated: ${nodeId} → ${data.status as string}`, {
        taskId: execId,
      })
      break
    }

    case 'project:completed': {
      const projectId = data.projectId as string
      const projectBranch = data.projectBranch as string
      const prUrl = data.projectPrUrl as string | undefined
      const projectName = data.projectName as string | undefined
      const deliveryMode = data.deliveryMode as string | undefined
      const baseBranch = data.baseBranch as string | undefined

      // The execution-store already shows a "All tasks complete" toast (client-side detection).
      // This server-side event arrives later with delivery details (PR URL, branch).
      // Only show a follow-up toast if there's actionable info (e.g., PR created).
      const alreadyNotified = useExecutionStore.getState().completedProjectIds.has(projectId)
      const msg = buildServerCompletionMessage({
        projectName, projectBranch, projectPrUrl: prUrl,
        deliveryMode, baseBranch, alreadyNotified,
      })

      if (msg) {
        useToastStore.getState().add({ ...msg, duration: 12000 })
        useNotificationStore.getState().add({
          ...msg, projectId, prUrl: msg.prUrl,
        })

        if (!alreadyNotified) {
          // Mark as notified so execution-store doesn't double-toast
          useExecutionStore.setState((state) => {
            const next = new Set(state.completedProjectIds)
            next.add(projectId)
            return { completedProjectIds: next }
          })
        }
      }

      // Update project store with PR info if returned by server
      if (prUrl) {
        useProjectStore.getState().updateProject(projectId, {
          projectPrUrl: prUrl,
          projectPrNumber: data.projectPrNumber as number | undefined,
        })
      }

      addActivity(
        set,
        'success',
        prUrl
          ? `Project "${projectName || projectId}" completed — PR created`
          : `Project "${projectName || projectId}" completed on branch ${projectBranch}`,
      )
      break
    }

    case 'task:ready': {
      addActivity(set, 'info', `Downstream task dispatching server-side`)
      // Server handles dispatch — frontend just tracks status via SSE
      break
    }
  }
}
