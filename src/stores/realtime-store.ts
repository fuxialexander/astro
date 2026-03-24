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
import { planNodeIdToProjectId } from '@/lib/plan-extraction'
import type { TaskActivityEvent } from '@/types'
import { useToastStore } from './toast-store'
import { useNotificationStore } from './notification-store'
import { buildServerCompletionMessage, buildClientCompletionMessage } from '@/lib/completion-messages'
import { tryAutoExecuteCompletedPlanProject } from '@/lib/plan-auto-execute'

// Per-node fetch generation counter to prevent out-of-order getNode() responses
// from overwriting newer state (e.g., rapid dispatched → in_progress → completed).
const nodeStatusGen = new Map<string, number>()

/** Valid PlanNode status values for runtime validation of SSE payloads. */
const VALID_NODE_STATUSES: ReadonlySet<string> = new Set([
  'planned', 'dispatched', 'in_progress', 'auto_verified',
  'awaiting_judgment', 'awaiting_approval', 'completed', 'pruned',
])

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
    seq?: number
  }>
  fileChanges: Array<{
    path: string
    action: string
    linesAdded?: number
    linesRemoved?: number
    diff?: string
    timestamp: Date
    seq?: number
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
  hydrateFromCatchUp: (executionIds: string[], afterSeq?: number) => Promise<void>
  pushActivityEvent: (executionId: string, event: TaskActivityEvent) => void
  /** Update the last json_render_spec activity event in-place for progressive rendering */
  updateLastSpecEvent: (executionId: string, spec: { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> }) => void
  /** Reconcile running tasks after page refresh: bootstrap execution store + task streams
   *  for plan nodes that are in_progress but have no execution store entries. */
  reconcileRunningTasks: () => void
  /** Add an entry to the dashboard activity feed (public API for cross-store use). */
  addActivityEntry: (type: string, text: string, extra?: { taskId?: string; machineId?: string }) => void
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
    // Push live SSE text into both stdout and activityEvents so that
    // displayBlocks render immediately. DB catch-up mergeBySeq deduplicates
    // once persisted events arrive.
    const stream = {
      ...existing,
      stdout: existing.stdout + text,
      activityEvents: [...existing.activityEvents, {
        type: 'text' as const,
        content: text,
        timestamp: new Date(),
      }],
    }
    streams.set(execId, stream)
    return { taskStreams: streams }
  })
}

function tryAutoExecutePlannedProject(projectId: string): boolean {
  const execStore = useExecutionStore.getState()
  return tryAutoExecuteCompletedPlanProject(projectId, {
    hasAutoExecute: execStore.autoExecuteProjectIds.has(projectId),
    planExecutionStatus: execStore.executions.get(`plan-${projectId}`)?.status,
    options: execStore.autoExecuteProjectIds.get(projectId),
    executeAllProject: (autoProjectId, options) => execStore.executeAllProject(autoProjectId, options),
    clearAutoExecute: (autoProjectId) => execStore.setAutoExecute(autoProjectId, false),
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
      // Catch up ALL streams (not just running ones) so that transitions that
      // occurred while the tab was hidden (e.g., task completed) are recovered.
      const activeIds: string[] = []
      for (const [execId, stream] of taskStreams) {
        if (stream.activityEvents.length > 0 || stream.status === 'running' || stream.status === 'in_progress') {
          activeIds.push(execId)
        }
      }
      if (activeIds.length > 0) {
        console.log('[realtime] SSE reconnected, catching up', activeIds.length, 'streams from seq', realtimeClient.lastSeq)
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
      // Add to steerMessages (for tracking)
      stream.steerMessages.push({ message, interrupted, timestamp: now })
      // Add to activityEvents immediately as pending steer (accepted: undefined)
      // so it appears in the timeline with a clock indicator right away
      stream.activityEvents.push({
        type: 'steer' as const,
        message,
        interrupted,
        accepted: undefined,
        timestamp: now,
      })
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

        // Replace the pending steer event in activityEvents with the resolved version
        const newActivityEvents = [...existing.activityEvents]
        if (update.accepted !== undefined) {
          const steerMsg = newSteerMessages[index]
          // Find and remove the matching pending steer event
          for (let i = newActivityEvents.length - 1; i >= 0; i--) {
            const e = newActivityEvents[i]
            if (e.type === 'steer' && e.accepted === undefined && e.message === steerMsg.message) {
              newActivityEvents.splice(i, 1)
              break
            }
          }
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

  hydrateFromCatchUp: async (executionIds: string[], afterSeq = 0) => {
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

            // Keep existing events that are NOT superseded by a hydrated seq'd version.
            //
            // For no-seq text events: compare total text length to decide which
            // source has more content. If existing (live SSE) has more text than
            // hydrated (DB), keep existing no-seq text events — they contain
            // unflushed data the DB doesn't have yet. If hydrated has equal or more
            // text, the DB is caught up and we can drop no-seq text in favor of
            // the canonical seq'd versions from hydration.
            //
            // Previous approach used timestamp comparison which caused flash/flicker
            // when client/server clocks diverged or hydration raced with live text.
            const hydratedTextLen = hydrated.activityEvents
              .filter(e => e.type === 'text')
              .reduce((acc, e) => acc + ((e as { content: string }).content?.length || 0), 0)
            const existingNoSeqTextLen = existing.activityEvents
              .filter(e => e.type === 'text' && e.seq == null)
              .reduce((acc, e) => acc + ((e as { content: string }).content?.length || 0), 0)
            const liveTextAhead = existingNoSeqTextLen > hydratedTextLen

            // Build counting map of hydrated user-originated events for dedup.
            // When a user sends a message, the frontend pushes a no-seq event locally
            // for instant display, and the backend persists the same event to DB (seq'd).
            // During catch-up, both versions coexist → duplicate display. Track counts
            // so we drop exactly as many local copies as there are DB counterparts
            // (handles identical messages correctly — counting, not just presence).
            const hydratedUserMsgCounts = new Map<string, number>()
            for (const e of hydrated.activityEvents) {
              if (e.seq != null && (e.type === 'chat_user' || e.type === 'steer')) {
                const key = `${e.type}:${(e as { message: string }).message}`
                hydratedUserMsgCounts.set(key, (hydratedUserMsgCounts.get(key) || 0) + 1)
              }
            }

            const existingKept = existing.activityEvents.filter(e => {
              if (e.seq != null) return !hydratedActivitySeqs.has(e.seq)
              // Drop locally-pushed user events when their canonical DB version has arrived
              if (e.type === 'chat_user' || e.type === 'steer') {
                const key = `${e.type}:${(e as { message: string }).message}`
                const remaining = hydratedUserMsgCounts.get(key)
                if (remaining && remaining > 0) {
                  hydratedUserMsgCounts.set(key, remaining - 1)
                  return false
                }
              }
              if (e.type !== 'text') return true
              // Keep no-seq text when live SSE is ahead of DB; drop when DB caught up
              return liveTextAhead
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
            // When live text is ahead, also skip hydrated text events (seq'd or not)
            // to prevent duplicate text rendering.
            const hydratedNew = hydrated.activityEvents.filter(e => {
              if (liveTextAhead && e.type === 'text') return false
              if (e.seq == null) return !existingKeptNoSeqTypes.has(e.type)
              // Always include seq'd hydrated events: existingKept already
              // dropped its copies (line above filters out seqs present in
              // hydrated), so the canonical DB version replaces them.
              return true
            })
            const mergedActivity = [...existingKept, ...hydratedNew]
            mergedActivity.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

            // Rebuild stdout from merged text events; fall back to existing.stdout when
            // no text events survived the merge (e.g. flush not yet in DB at catch-up time)
            const mergedStdout = mergedActivity
              .filter((e): e is Extract<typeof e, { type: 'text' }> => e.type === 'text')
              .map(e => e.content)
              .join('')

            // Use the longer stdout — live SSE updates stdout ahead of DB flushes,
            // so existing.stdout may contain unflushed text beyond what's in mergedStdout.
            const bestStdout = existing.stdout.length >= mergedStdout.length ? existing.stdout : mergedStdout

            // If bestStdout has more text than mergedActivity's text events, synthesize
            // a trailing text event to prevent display blocks from missing content.
            // This closes the gap when live SSE text hasn't been flushed to DB yet
            // but activityEvents dropped the no-seq live text events (liveTextAhead=false).
            if (bestStdout.length > mergedStdout.length) {
              const trailingText = bestStdout.slice(mergedStdout.length)
              if (trailingText.length > 0) {
                mergedActivity.push({
                  type: 'text' as const,
                  content: trailingText,
                  timestamp: new Date(),
                })
              }
            }

            streams.set(execId, {
              ...existing,
              ...metadata,
              stdout: bestStdout,
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
            // Use the longer stdout — live SSE may be ahead of DB-persisted text
            const bestStdout = existing.stdout.length >= (hydrated.stdout || '').length
              ? existing.stdout : (hydrated.stdout || existing.stdout)
            streams.set(execId, {
              ...existing,
              ...metadata,
              stdout: bestStdout,
              activityEvents: mergedActivity,
              toolTraces: mergedToolTraces,
              fileChanges: mergedFileChanges,
            })
          }
        }
        return { taskStreams: streams }
      })

      // Reconstruct dynamicApprovals from pending approval_request events
      // and safetyPrompts from pending safety_prompt events.
      // Also remove any stale dynamicApprovals that SSE delivered before hydration
      // confirmed they were already answered in the DB.
      set((state) => {
        const newApprovals = new Map(state.dynamicApprovals)
        const newSafetyPrompts = new Map(state.safetyPrompts)
        for (const [execId] of byExecution) {
          const hydrated = hydratedByExecution.get(execId)!
          // Remove stale approvals that were already answered (SSE race: approval_request
          // arrived via SSE before hydration confirmed it was answered in the DB)
          for (const answeredId of hydrated.answeredApprovals) {
            newApprovals.delete(answeredId)
          }
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

  updateLastSpecEvent: (executionId, spec) => {
    set((state) => {
      const streams = new Map(state.taskStreams)
      const existing = streams.get(executionId)
      if (!existing) return state
      const events = [...existing.activityEvents]
      // Find the last json_render_spec event and update its spec in-place
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'json_render_spec') {
          events[i] = { ...events[i], spec } as TaskActivityEvent
          streams.set(executionId, { ...existing, activityEvents: events })
          return { taskStreams: streams }
        }
      }
      return state
    })
  },

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

  addActivityEntry: (type, text, extra) => {
    addActivity(set, type, text, extra)
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
  // to server-side batching): keep if strictly newer than the last hydrated
  // event. The text dedup in groupActivityEvents() handles any content
  // duplicates that slip through. Previous 1s buffer was too aggressive
  // and dropped the last block of live events when hydration raced with SSE.
  //
  // Also dedup no-seq chat_user/steer events whose message already appears
  // in a seq'd hydrated event (steer resolution creates a no-seq chat_user
  // locally; the DB persists a seq'd version — both must not coexist).
  const hydratedUserMessages = new Set<string>()
  for (const e of hydrated) {
    const typed = e as unknown as { type?: string; message?: string }
    if (e.seq != null && (typed.type === 'chat_user' || typed.type === 'steer') && typed.message) {
      hydratedUserMessages.add(typed.message)
    }
  }
  const lastHydratedTime = new Date(hydrated[hydrated.length - 1].timestamp).getTime()
  const newLiveItems = live.filter(e => {
    if (e.seq != null) {
      return !hydratedSeqs.has(e.seq)
    }
    // Drop no-seq chat_user/steer when hydrated already has the same message (with seq)
    const typed = e as unknown as { type?: string; message?: string }
    if ((typed.type === 'chat_user' || typed.type === 'steer') && typed.message && hydratedUserMessages.has(typed.message)) {
      return false
    }
    return new Date(e.timestamp).getTime() > lastHydratedTime
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

      for (const [nid, exec] of execStore.executions) {
        if (exec.executionId === executionId && nid.startsWith('plan-')) {
          const planProjectId = planNodeIdToProjectId(nid)!
          const existingProjectNodes = usePlanStore.getState().nodes.filter(n => n.projectId === planProjectId)
          if (existingProjectNodes.length > 0) {
            console.log(`[realtime] Skipping plan catch-up for project ${planProjectId} — ${existingProjectNodes.length} nodes already loaded from DB`)
          } else if (hydrated.planResult) {
            void usePlanStore.getState().load()
          }

          // YOLO auto-execute: catch-up hydration may set status to 'success' before
          // the task:result SSE arrives, causing the SSE handler's already-completed
          // guard to skip auto-execute. Trigger it here as well.
          if (isSuccess) {
            setTimeout(() => {
              if (tryAutoExecutePlannedProject(planProjectId)) {
                console.log(`[realtime] YOLO mode: auto-executing from catch-up hydration for project ${planProjectId}`)
              }
            }, 500)
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

    case 'task:operational': {
      // Operational events are persisted to DB and will appear in activityEvents
      // via periodic catch-up hydration. No live push to activityEvents needed.
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

    case 'task:error': {
      const execId = data.taskId as string
      const error = (data.error as string) || 'Unknown error'

      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(execId) || createEmptyTaskStream(execId)
        streams.set(execId, {
          ...existing,
          status: 'error',
          error,
        })
        return { taskStreams: streams }
      })

      useRealtimeStore.getState().pushActivityEvent(execId, {
        type: 'error',
        error,
        timestamp: new Date(),
      })
      addActivity(set, 'failure', `Task failed: ${execId}`, { taskId: execId })

      const execStore = useExecutionStore.getState()
      const newExecs = new Map(execStore.executions)
      for (const [nid, exec] of execStore.executions) {
        if (exec.executionId !== execId) continue
        newExecs.set(nid, {
          ...exec,
          status: 'failure',
          completedAt: new Date(),
          error,
        })
        useExecutionStore.setState({ executions: newExecs })
        execStore.persist()
        break
      }
      break
    }

    case 'task:result': {
      const execId = data.taskId as string
      const status = data.status as string
      const isSuccess = status === 'success' || status === 'completed'

      // yaml-spec parsing is handled in the unified activity pipeline.

      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(execId) || createEmptyTaskStream(execId)
        streams.set(execId, {
          ...existing,
          status,
          output: data.output as string | undefined,
          error: data.error as string | undefined,
          ...(isSuccess ? { progress: 100 } : {}),
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
      addActivity(
        set,
        isSuccess ? 'success' : 'failure',
        `Task ${isSuccess ? 'completed' : 'failed'}: ${execId}`,
        { taskId: execId }
      )

      // Guard: skip side-effects if execution already completed.
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
      const resultPatch = {
        status: (isSuccess ? 'success' : 'failure') as 'success' | 'failure',
        completedAt: new Date(),
        ...(data.error ? { error: data.error as string } : {}),
        ...(data.branchName ? { branchName: data.branchName as string } : {}),
        ...(data.prUrl ? { prUrl: data.prUrl as string } : {}),
        ...(data.prNumber ? { prNumber: data.prNumber as number } : {}),
        ...(data.deliveryStatus ? { deliveryStatus: data.deliveryStatus as "success" | "failed" | "skipped" } : {}),
      }

      const newExecs = new Map(execStore.executions)
      for (const [nid, exec] of execStore.executions) {
        if (exec.executionId === execId) {
          newExecs.set(nid, { ...exec, ...resultPatch })
          useExecutionStore.setState({ executions: newExecs })
          execStore.persist()
          break
        }
      }

      // Also update the entry in nodeExecutions (parallel tracking list)
      useExecutionStore.setState((state) => {
        const nodeExecs = new Map(state.nodeExecutions)
        for (const [nodeId, list] of nodeExecs) {
          const idx = list.findIndex((e) => e.executionId === execId)
          if (idx >= 0) {
            const updated = [...list]
            updated[idx] = { ...updated[idx], ...resultPatch }
            nodeExecs.set(nodeId, updated)
            return { nodeExecutions: nodeExecs }
          }
        }
        return state
      })

      // Fire-and-forget summary generation for completed task executions
      {
        for (const [nid, exec] of useExecutionStore.getState().executions) {
          if (exec.executionId === execId && (exec.status === 'success' || exec.status === 'failure')) {
            const node = usePlanStore.getState().nodes.find((n) => n.id === nid)
            if (node) {
              import('./execution-store').then(({ requestExecutionSummary }) => {
                void requestExecutionSummary(nid, exec, node)
              })
            }

            // YOLO auto-execute: when a plan-* execution completes successfully,
            // trigger executeAllProject. The plan_result SSE fires before task:result,
            // so the auto-execute check at plan_result time fails (status still 'running').
            // Retry here now that status is 'success'.
            if (isSuccess && nid.startsWith('plan-')) {
              const planProjectId = planNodeIdToProjectId(nid)
              if (planProjectId) {
                setTimeout(() => {
                  if (tryAutoExecutePlannedProject(planProjectId)) {
                    console.log(`[realtime] YOLO mode: auto-executing all tasks after plan completion for project ${planProjectId}`)
                  }
                }, 500)
              }
            }

            break
          }
        }
      }

      // Plan-node status update fallback: if task:result carries finalNodeStatus,
      // update the plan node directly. This prevents "stuck in_progress" when the
      // dispatch SSE drops and node:status_changed is delayed or missed.
      // The node:status_changed handler (DB-authoritative) will overwrite if needed.
      const finalNodeStatus = data.finalNodeStatus as string | undefined
      if (finalNodeStatus) {
        const validStatuses = new Set(['auto_verified', 'awaiting_judgment', 'completed', 'pruned'])
        if (validStatuses.has(finalNodeStatus)) {
          // Find the nodeId for this executionId
          for (const [nid, exec] of useExecutionStore.getState().executions) {
            if (exec.executionId === execId) {
              usePlanStore.getState().updateNode(nid, { status: finalNodeStatus as 'auto_verified' | 'awaiting_judgment' | 'completed' | 'pruned' })
              break
            }
          }
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

      // Tool activity events (tool_use/tool_result) come from DB hydration
      // (periodic catch-up) rather than live SSE to avoid complex dedup.
      // Update toolTraces and plan metadata from live SSE.
      set((state) => {
        const streams = new Map(state.taskStreams)
        const existing = streams.get(execId) || createEmptyTaskStream(execId)

        let newToolTraces = [...existing.toolTraces]
        let newPlanTodos = existing.planTodos
        let newPlanQuestions = existing.planQuestions

        const isResultOnly = hasResult && !hasInput

        if (isResultOnly) {
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
            newToolTraces.push({
              toolName,
              toolInput: undefined,
              toolResult: data.toolResult,
              success: data.success as boolean | undefined,
              duration: data.duration as number | undefined,
              timestamp: now,
            })
          }
        } else {
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
          planTodos: newPlanTodos,
          planQuestions: newPlanQuestions,
        })
        return { taskStreams: streams }
      })
      break
    }

    case 'task:file_change': {
      const execId = data.taskId as string
      const now = new Date()
      // Activity events are populated from DB hydration only.
      // Only update fileChanges from live SSE.
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
          const newActivityEvents = [...existing.activityEvents]

          // Resolve ALL pending steer messages (batch drain delivers multiple at once)
          for (let idx = 0; idx < newSteerMessages.length; idx++) {
            if (newSteerMessages[idx].accepted !== undefined) continue // already resolved
            newSteerMessages[idx] = {
              ...newSteerMessages[idx],
              accepted,
              ackMessage: data.message as string | undefined,
              ...(data.interrupted !== undefined ? { interrupted: data.interrupted as boolean } : {}),
            }
          }

          // Remove ALL pending steer activity events and replace with resolved versions
          const pendingEvents: Array<{ message: string; interrupted?: boolean; timestamp: Date }> = []
          for (let i = newActivityEvents.length - 1; i >= 0; i--) {
            const e = newActivityEvents[i]
            if (e.type === 'steer' && e.accepted === undefined) {
              pendingEvents.push({ message: e.message, interrupted: e.interrupted, timestamp: e.timestamp })
              newActivityEvents.splice(i, 1)
            }
          }

          // Add resolved events for each pending steer
          for (const steerMsg of pendingEvents) {
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
      const initUserId = data.userId as string | undefined

      // Plan-node status update is now handled by node:status_changed SSE event
      // (DB-authoritative: server writes status, emits notification, frontend re-reads from DB)

      // 1. Create or update execution entry so ExecutionPanel can render.
      // Always update machineId + executionId — the entry may exist from
      // startPlaygroundSession (which creates it without machineId) or from
      // a DB load on another tab.
      const execStore = useExecutionStore.getState()
      const existingExec = execStore.executions.get(initNodeId)

      const newExecEntry = {
        nodeId: initNodeId,
        projectId: initProjectId,
        executionId: execId,
        status: 'running' as const,
        streamText: '',
        toolTraces: [],
        fileChanges: [],
        activityEvents: [],
        startedAt: new Date(),
        machineId: initMachineId,
        userId: initUserId,
      }

      if (!existingExec) {
        // No existing execution for this node — set as primary
        useExecutionStore.setState((state) => {
          const newExecs = new Map(state.executions)
          newExecs.set(initNodeId, newExecEntry)
          return { executions: newExecs }
        })
      } else if (existingExec.executionId === execId) {
        // Same execution — update missing fields (playground sessions, DB-loaded entries)
        useExecutionStore.setState((state) => {
          const newExecs = new Map(state.executions)
          const existing = newExecs.get(initNodeId)!
          newExecs.set(initNodeId, {
            ...existing,
            machineId: existing.machineId || initMachineId,
            executionId: existing.executionId || execId,
            userId: existing.userId || initUserId,
            status: 'running',
          })
          return { executions: newExecs }
        })
      }
      // else: different execution for this node (parallel dispatch) —
      // don't overwrite the primary executions map entry.

      // 1b. Parallel execution tracking: always append to nodeExecutions list.
      // This lets the UI show all concurrent executions for a node.
      useExecutionStore.setState((state) => {
        const nodeExecs = new Map(state.nodeExecutions)
        const list = [...(nodeExecs.get(initNodeId) ?? [])]
        // Avoid duplicate entries for the same executionId
        if (!list.some((e) => e.executionId === execId)) {
          list.push(newExecEntry)
          nodeExecs.set(initNodeId, list)
        }
        return { nodeExecutions: nodeExecs }
      })

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
      const eventStatus = data.status as string | undefined

      // Capture pre-patch status for side effects in the async handler below.
      // Must be read BEFORE the synchronous patch so notifications and YOLO
      // auto-execute still detect the status transition correctly.
      const statusBeforePatch = usePlanStore.getState().nodes.find((n) => n.id === nodeId)?.status

      // Synchronously patch plan node status from SSE event data for instant UI response.
      // This prevents stale "Running" indicators and sidebar active counts while the
      // async getNode() round-trip completes. The full DB hydration below overwrites this.
      // Note: This uses setState() directly (not updateNode) because this is a speculative
      // patch — it must NOT write back to the API or trigger worktree cleanup. The async
      // mergeNodeFromDB below handles the authoritative merge with all side effects.
      if (eventStatus && VALID_NODE_STATUSES.has(eventStatus)) {
        const planStore = usePlanStore.getState()
        const existingNode = planStore.nodes.find((n) => n.id === nodeId)
        if (existingNode && existingNode.status !== eventStatus) {
          usePlanStore.setState({
            nodes: planStore.nodes.map((n) =>
              n.id === nodeId ? { ...n, status: eventStatus as typeof n.status } : n
            ),
          })
        }
      }

      // Re-read authoritative state from DB (with generation counter to prevent
      // out-of-order responses from overwriting newer state)
      const gen = (nodeStatusGen.get(nodeId) || 0) + 1
      nodeStatusGen.set(nodeId, gen)

      dataClient.getNode(nodeId).then((freshNode) => {
        if (!freshNode) return
        if ((nodeStatusGen.get(nodeId) || 0) > gen) return // stale response, discard

        const planStore = usePlanStore.getState()
        // Use pre-patch status (not current store status) for transition detection,
        // since the synchronous patch above already updated the store.
        const prevStatus = statusBeforePatch

        // Merge DB state into plan store (DB wins, no write-back).
        // Pass statusBeforePatch so milestone reconciliation can detect the
        // real transition even though the sync pre-patch already updated the store.
        planStore.mergeNodeFromDB(freshNode, statusBeforePatch)

        // Side effects based on status transition.
        // Guard on prevStatus !== undefined: if the node wasn't in the local store
        // yet (e.g., created by another user, SSE arrived before DataLoader), skip
        // notifications and YOLO — the user hasn't seen this node yet.
        if (prevStatus !== undefined && prevStatus !== freshNode.status) {
          const TERMINAL = new Set(['completed', 'auto_verified', 'pruned', 'awaiting_judgment', 'awaiting_approval'])
          const wasTerminal = TERMINAL.has(prevStatus) // prevStatus is narrowed to string by outer guard
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
                setTimeout(() => {
                  if (tryAutoExecutePlannedProject(planProjectId)) {
                    console.log(`[realtime] YOLO mode: auto-executing all tasks for project ${planProjectId}`)
                  }
                }, 1000)
              }
            }
          }

        }

        // Always attempt batch cascade on terminal status, even when the status
        // transition was already applied by the dispatch SSE result handler
        // (prevStatus === freshNode.status). Without this, the cascade breaks
        // when handleSSEEvent updates the plan node before node:status_changed.
        {
          const BATCH_TERMINAL = new Set(['completed', 'auto_verified', 'pruned', 'awaiting_judgment', 'awaiting_approval'])
          if (BATCH_TERMINAL.has(freshNode.status) && !nodeId.startsWith('plan-') && !nodeId.startsWith('playground-')) {
            useExecutionStore.getState().triggerBatchWave(projectId)
          }
        }

        {
          // Check if all tasks in the project are now complete
          const PROJ_TERMINAL = new Set(['completed', 'auto_verified', 'pruned', 'awaiting_judgment', 'awaiting_approval'])
          if (PROJ_TERMINAL.has(freshNode.status) && !nodeId.startsWith('plan-') && !nodeId.startsWith('playground-')) {
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

    case 'task:plan_result': {
      // Plan created via CLI — push plan_result activity event into the task stream
      // so PlanGraphBlock renders inline, and trigger plan store refresh from DB.
      const execId = data.taskId as string
      const nodes = data.nodes as Array<{ id: string; title: string; type: string; status?: string }>
      const edges = data.edges as Array<{ source: string; target: string }>
      const projectName = data.projectName as string | undefined
      const timestamp = new Date()

      set((state) => {
        const streams = new Map(state.taskStreams)
        const stream = streams.get(execId) || createEmptyTaskStream(execId)
        streams.set(execId, {
          ...stream,
          activityEvents: [
            ...stream.activityEvents,
            { type: 'plan_result' as const, nodes, edges, projectName, timestamp },
          ],
        })
        return { taskStreams: streams }
      })

      // Refresh plan store from DB (plan nodes were already created by the CLI)
      import('@/stores/plan-store').then(({ usePlanStore }) => {
        usePlanStore.getState().load().then(() => {
          const planProjectId = data.projectId as string | undefined
          if (planProjectId && tryAutoExecutePlannedProject(planProjectId)) {
            console.log(`[realtime] YOLO mode: auto-executing loaded plan for project ${planProjectId}`)
          }
        })
      })

      addActivity(set, 'info', `Plan created: ${nodes.length} nodes`)
      break
    }
  }
}
