/**
 * Hook: useStreamEvents
 *
 * Unified hook replacing useRestoredExecution, useChatActivityEvents,
 * and useChatStreamEvents. All pathways (PlanGeneration, ChatPanel,
 * Playground, Task Execution) use this single hook.
 *
 * Part of the Unified Streaming Pipeline (Phase 2).
 *
 * Data flow:
 * 1. Mount / streamId change → hydrateFromCatchUp() loads persisted events
 * 2. Live streaming → global SSE bus pushes events into realtime-store taskStreams
 * 3. This hook reads from taskStreams, groups into DisplayBlocks, derives status
 */

import { useMemo, useEffect, useRef, useState, useCallback } from "react"
import { useRealtimeStore } from "@/stores/realtime-store"
import { groupActivityEvents, type DisplayBlock } from "@/components/activity-blocks"
import { deriveStreamStatus, type StreamStatus } from "@/lib/stream-status"
import type { TaskActivityEvent, ToolTrace, FileChange, SessionMessage, TaskExecution } from "@/types"
import type { PendingApproval } from "@/lib/streaming-event-hydrator"

/** Plan-mutating tool names — triggers plan refresh when detected */
const PLAN_MUTATING_TOOLS = new Set([
  "create_task", "update_task", "delete_task", "create_dependency",
  "create_plan", "Bash",
])

export interface StreamMetadata {
  machineId?: string
  sessionId?: string
  model?: string
  progress?: number
  progressMessage?: string
  branchName?: string
  prUrl?: string
  prNumber?: number
  deliveryStatus?: string
  summary?: string
}

export interface StreamEventsResult {
  /** All activity events (live + hydrated) */
  activityEvents: TaskActivityEvent[]
  /** Grouped display blocks for rendering */
  displayBlocks: DisplayBlock[]
  /** Tool execution traces */
  toolTraces: ToolTrace[]
  /** File changes from execution */
  fileChanges: FileChange[]
  /** Pending approval requests */
  pendingApprovals: PendingApproval[]
  /** Derived stream status */
  status: StreamStatus
  /** Stream metadata (machine, session, model, etc.) */
  metadata: StreamMetadata
  /** True while loading persisted events from DB */
  isHydrating: boolean
  /** Set when the stream has been inactive for 20 minutes while still 'streaming' */
  stalledMessage?: string
  /** True when a Bash tool_use containing 'astro-cli plan create' has no matching tool_result yet */
  isPlanCreating: boolean
}

const EMPTY_TOOL_TRACES: ToolTrace[] = []
const EMPTY_FILE_CHANGES: FileChange[] = []
const EMPTY_PENDING_APPROVALS: PendingApproval[] = []
const EMPTY_BLOCKS: DisplayBlock[] = []
const EMPTY_EVENTS: TaskActivityEvent[] = []

/**
 * Unified streaming events hook.
 *
 * @param streamId - The stream identifier (executionId for tasks, sessionId for chats)
 * @param options.legacySessionMessages - Fallback for pre-migration sessions without streaming_events
 * @param options.execution - Execution object for backward-compat merging during migration
 * @param options.projectId - Project ID to enable plan-mutation detection
 */
export function useStreamEvents(
  streamId: string | undefined,
  options?: {
    legacySessionMessages?: SessionMessage[]
    execution?: TaskExecution
    projectId?: string
  },
): StreamEventsResult {
  const { legacySessionMessages, execution, projectId } = options ?? {}

  // Subscribe to realtime-store taskStreams for this streamId
  const taskStream = useRealtimeStore(
    useCallback((s) => streamId ? s.taskStreams.get(streamId) : undefined, [streamId])
  )
  const hydrateFromCatchUp = useRealtimeStore((s) => s.hydrateFromCatchUp)

  // Track hydration state
  const hydratedRef = useRef<string | null>(null)
  const [catchUpCompletedId, setCatchUpCompletedId] = useState<string | null>(null)
  const latestPersistedSeq = useMemo(() => {
    let maxSeq = 0
    for (const event of taskStream?.activityEvents ?? []) {
      if (event.seq != null && event.seq > maxSeq) maxSeq = event.seq
    }
    for (const trace of taskStream?.toolTraces ?? []) {
      if (trace.seq != null && trace.seq > maxSeq) maxSeq = trace.seq
    }
    for (const change of taskStream?.fileChanges ?? []) {
      if (change.seq != null && change.seq > maxSeq) maxSeq = change.seq
    }
    return maxSeq
  }, [taskStream?.activityEvents, taskStream?.toolTraces, taskStream?.fileChanges])

  // Hydrate from streaming_events on mount / streamId change
  useEffect(() => {
    if (!streamId) return
    if (hydratedRef.current === streamId) return
    hydratedRef.current = streamId

    hydrateFromCatchUp([streamId], 0)
      .then(() => setCatchUpCompletedId(streamId))
      .catch((err) => {
        console.warn('[useStreamEvents] catch-up failed for', streamId, err)
        setCatchUpCompletedId(streamId)
      })
  }, [streamId, hydrateFromCatchUp])

  // When the tab becomes visible again, catch up just this mounted stream.
  // This covers chat streams that aren't part of the global SSE reconnect sweep.
  // Skip catch-up if the stream is actively running — live SSE is delivering events
  // and catch-up hydration can race with the SSE bus, dropping the latest unflushed
  // text events (the "flash and disappear" bug).
  useEffect(() => {
    if (!streamId || typeof document === "undefined") return

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return
      // Skip if stream is actively running — SSE is current, no need to catch up
      const stream = useRealtimeStore.getState().taskStreams.get(streamId)
      if (stream?.status === 'running' || stream?.status === 'in_progress') return
      hydrateFromCatchUp([streamId], latestPersistedSeq).catch((err) => {
        console.warn('[useStreamEvents] visibility catch-up failed for', streamId, err)
      })
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [streamId, latestPersistedSeq, hydrateFromCatchUp])


  // Build activity events — merge taskStream with execution store and legacy fallback
  const activityEvents: TaskActivityEvent[] = useMemo(() => {
    const streamEvents = taskStream?.activityEvents ?? []
    const execEvents = execution?.activityEvents ?? []

    // Primary: streaming events from realtime-store (live or hydrated)
    if (streamEvents.length > 0 || execEvents.length > 0) {
      let events: TaskActivityEvent[]

      if (execEvents.length > 0 && streamEvents.length > 0) {
        // Merge execution-store events with realtime-store events
        // Realtime-store has steer/approval events that execution-store may not
        const steerAndApprovalEvents = streamEvents.filter(
          e => e.type === 'steer' || e.type === 'approval_request' || e.type === 'approval_response'
        )
        if (steerAndApprovalEvents.length > 0) {
          // Filter out AskUserQuestion tool_use (approval_request provides interactive UI)
          const filteredExec = execEvents.filter(
            e => !(e.type === 'tool_use' && (e as { toolName?: string }).toolName === 'AskUserQuestion')
          )
          events = [...filteredExec, ...steerAndApprovalEvents]
          events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          // Deduplicate approval_request by requestId
          const seenRequestIds = new Set<string>()
          for (let i = events.length - 1; i >= 0; i--) {
            const e = events[i]
            if (e.type === 'approval_request') {
              const rid = (e as { requestId: string }).requestId
              if (seenRequestIds.has(rid)) {
                events.splice(i, 1)
              } else {
                seenRequestIds.add(rid)
              }
            }
          }
        } else {
          events = execEvents
        }
      } else if (streamEvents.length > 0) {
        events = streamEvents
      } else {
        events = execEvents
      }

      // Append mutation events from legacy session messages (not in streaming events)
      if (legacySessionMessages) {
        const mutationEvents: TaskActivityEvent[] = []
        for (const msg of legacySessionMessages) {
          if (msg.appliedMutations) {
            const { nodeUpdates, edgeOps, newNodes } = msg.appliedMutations
            if (nodeUpdates.length > 0 || edgeOps.length > 0 || newNodes.length > 0) {
              mutationEvents.push({
                type: 'mutation',
                nodeUpdates,
                edgeOps,
                newNodes,
                timestamp: msg.timestamp,
              })
            }
          }
        }
        if (mutationEvents.length > 0) {
          events = [...events, ...mutationEvents]
          events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        }
      }

      return events
    }

    // Fallback: convert legacy session messages to activity events (pre-streaming sessions)
    if (legacySessionMessages && legacySessionMessages.length > 0) {
      const events: TaskActivityEvent[] = []
      for (const msg of legacySessionMessages) {
        if (msg.role === 'user') {
          events.push({ type: 'chat_user', message: msg.content, timestamp: msg.timestamp })
        } else if (msg.role === 'assistant' && msg.content) {
          events.push({ type: 'text', content: msg.content, timestamp: msg.timestamp })
        }
        if (msg.appliedMutations) {
          const { nodeUpdates, edgeOps, newNodes } = msg.appliedMutations
          if (nodeUpdates.length > 0 || edgeOps.length > 0 || newNodes.length > 0) {
            events.push({ type: 'mutation', nodeUpdates, edgeOps, newNodes, timestamp: msg.timestamp })
          }
        }
      }
      return events
    }

    return EMPTY_EVENTS
  }, [taskStream?.activityEvents, execution?.activityEvents, legacySessionMessages])

  // Group into display blocks
  const displayBlocks = useMemo(
    () => activityEvents.length > 0 ? groupActivityEvents(activityEvents) : EMPTY_BLOCKS,
    [activityEvents]
  )

  // Extract tool traces
  const toolTraces = useMemo(() => {
    const execTraces = execution?.toolTraces
    const streamTraces = taskStream?.toolTraces
    if (execTraces && execTraces.length > 0) return execTraces as ToolTrace[]
    if (streamTraces && streamTraces.length > 0) return streamTraces as ToolTrace[]
    return EMPTY_TOOL_TRACES
  }, [execution?.toolTraces, taskStream?.toolTraces])

  // Extract file changes (deduplicate by path, keep latest)
  const fileChanges = useMemo(() => {
    const execFiles = execution?.fileChanges ?? []
    const streamFiles = taskStream?.fileChanges ?? []
    if (execFiles.length === 0 && streamFiles.length === 0) return EMPTY_FILE_CHANGES
    const latest = new Map<string, FileChange>()
    for (const f of [...execFiles, ...streamFiles.map(sf => ({
      path: sf.path,
      action: sf.action as 'create' | 'modify' | 'delete',
      linesAdded: sf.linesAdded,
      linesRemoved: sf.linesRemoved,
      diff: sf.diff,
      timestamp: sf.timestamp,
    }))]) {
      latest.set(f.path, f)
    }
    return Array.from(latest.values())
  }, [execution?.fileChanges, taskStream?.fileChanges])

  // Extract pending approvals from activity events
  const pendingApprovals = useMemo(() => {
    if (!streamId) return EMPTY_PENDING_APPROVALS
    const requests = new Map<string, PendingApproval>()
    const answered = new Set<string>()
    for (const e of activityEvents) {
      if (e.type === 'approval_request') {
        requests.set(e.requestId, {
          executionId: streamId,
          requestId: e.requestId,
          question: e.question,
          options: e.options,
          timestamp: e.timestamp,
        })
      } else if (e.type === 'approval_response') {
        answered.add(e.requestId)
      }
    }
    const pending = Array.from(requests.values()).filter(r => !answered.has(r.requestId))
    return pending.length > 0 ? pending : EMPTY_PENDING_APPROVALS
  }, [activityEvents, streamId])

  // Derive status (optimistic cancel: pass execution?.status for immediate 'completed')
  const status = useMemo(
    () => deriveStreamStatus(activityEvents, taskStream, execution?.status),
    [activityEvents, taskStream, execution?.status]
  )

  // Extract metadata
  const metadata: StreamMetadata = useMemo(() => ({
    machineId: taskStream?.machineId,
    sessionId: taskStream?.sessionId,
    model: taskStream?.model,
    progress: taskStream?.progress,
    progressMessage: taskStream?.progressMessage,
  }), [taskStream?.machineId, taskStream?.sessionId, taskStream?.model, taskStream?.progress, taskStream?.progressMessage])

  // 20-minute inactivity stall detection
  const STALL_TIMEOUT_MS = 20 * 60 * 1000
  const [isStalled, setIsStalled] = useState(false)
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset stall state when streamId changes
  useEffect(() => {
    setIsStalled(false)
  }, [streamId])

  // Start/reset inactivity timer whenever events arrive while streaming
  useEffect(() => {
    if (status !== 'streaming') {
      if (stallTimerRef.current != null) {
        clearTimeout(stallTimerRef.current)
        stallTimerRef.current = null
      }
      return
    }
    if (stallTimerRef.current != null) clearTimeout(stallTimerRef.current)
    stallTimerRef.current = setTimeout(() => {
      setIsStalled(true)
    }, STALL_TIMEOUT_MS)
    return () => {
      if (stallTimerRef.current != null) {
        clearTimeout(stallTimerRef.current)
        stallTimerRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityEvents.length, status])

  // isPlanCreating: Bash tool_use with 'astro-cli plan create' without matching tool_result
  const isPlanCreating = useMemo(() => {
    for (let i = activityEvents.length - 1; i >= 0; i--) {
      const e = activityEvents[i]
      if (e.type === 'tool_result' && (e as { toolName?: string }).toolName === 'Bash') return false
      if (e.type === 'tool_use' && (e as { toolName?: string }).toolName === 'Bash') {
        const input =
          typeof (e as { toolInput?: unknown }).toolInput === 'string'
            ? (e as { toolInput: string }).toolInput
            : JSON.stringify((e as { toolInput?: unknown }).toolInput ?? '')
        if (input.includes('astro-cli plan create')) return true
      }
    }
    return false
  }, [activityEvents])

  // Plan-mutation detection: trigger plan refresh when plan-mutating tools complete
  const lastEventCountRef = useRef(0)
  useEffect(() => {
    if (!projectId || activityEvents.length === 0) return
    if (activityEvents.length <= lastEventCountRef.current) return
    lastEventCountRef.current = activityEvents.length

    // Check recent events for plan-mutating tool_result
    const recent = activityEvents[activityEvents.length - 1]
    if (recent?.type === 'tool_result' && PLAN_MUTATING_TOOLS.has(recent.toolName)) {
      // Dynamic import to avoid circular dependency
      import('@/stores/plan-store').then(({ usePlanStore }) => {
        usePlanStore.getState().load()
      })
    }
  }, [activityEvents, projectId])

  const isHydrating = !!(
    streamId &&
    catchUpCompletedId !== streamId &&
    activityEvents.length === 0
  )

  const derivedStatus: StreamStatus = isStalled && status === 'streaming' ? 'error' : status
  const stalledMessage =
    isStalled && status === 'streaming'
      ? 'Stream may have stalled — no events received for 20 minutes'
      : undefined

  return {
    activityEvents,
    displayBlocks,
    toolTraces,
    fileChanges,
    pendingApprovals,
    status: derivedStatus,
    metadata,
    isHydrating,
    stalledMessage,
    isPlanCreating,
  }
}
