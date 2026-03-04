/**
 * Hook: useRestoredExecution
 *
 * Returns activity events, tool traces, and file changes for a task execution.
 * During live execution, returns in-memory SSE events.
 * After page refresh (events lost), reconstructs them from persisted observation data.
 */

import { useMemo, useEffect, useRef } from "react"
import type { TaskExecution, TaskActivityEvent, ToolTrace, FileChange } from "@/types"
import type { TaskStream } from "@/stores/realtime-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useObservationStore } from "@/stores/observation-store"
import { reconstructActivityFromTrace } from "@/lib/observation-activity-bridge"

interface RestoredExecution {
  activityEvents: TaskActivityEvent[]
  toolTraces: ToolTrace[]
  fileChanges: FileChange[]
  isRestoring: boolean
  restorationError?: string
}

const EMPTY_TOOL_TRACES: ToolTrace[] = []
const EMPTY_FILE_CHANGES: FileChange[] = []

export function useRestoredExecution(
  executionId: string,
  execution?: TaskExecution,
  taskStream?: TaskStream,
  _isRunning?: boolean, // eslint-disable-line @typescript-eslint/no-unused-vars -- kept for API compat; may be used for future optimizations
): RestoredExecution {
  // Merge live events from execution + realtime stores
  const liveActivityEvents = useMemo(() => {
    const execEvents = execution?.activityEvents || []
    const streamEvents = taskStream?.activityEvents || []

    if (execEvents.length === 0) return streamEvents
    if (streamEvents.length === 0) return execEvents

    // Merge exec events with steer/approval events from realtime
    const steerAndApprovalEvents = streamEvents.filter(
      e => e.type === 'steer' || e.type === 'approval_request' || e.type === 'approval_response'
    )
    if (steerAndApprovalEvents.length === 0) return execEvents

    // Filter out AskUserQuestion tool_use events (approval_request provides interactive UI)
    const filteredExecEvents = execEvents.filter(
      e => !(e.type === 'tool_use' && (e as { toolName?: string }).toolName === 'AskUserQuestion')
    )

    const seenRequestIds = new Set<string>()
    const deduped = [...filteredExecEvents, ...steerAndApprovalEvents]
    deduped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    for (let i = deduped.length - 1; i >= 0; i--) {
      const e = deduped[i]
      if (e.type === 'approval_request') {
        const rid = (e as { requestId: string }).requestId
        if (seenRequestIds.has(rid)) {
          deduped.splice(i, 1)
        } else {
          seenRequestIds.add(rid)
        }
      }
    }
    return deduped
  }, [execution?.activityEvents, taskStream?.activityEvents])

  const liveToolTraces = useMemo(
    () => execution?.toolTraces || EMPTY_TOOL_TRACES,
    [execution?.toolTraces]
  )

  const liveFileChanges = useMemo(() => {
    const execFiles = execution?.fileChanges || []
    const streamFiles = taskStream?.fileChanges || []
    if (execFiles.length === 0 && streamFiles.length === 0) return EMPTY_FILE_CHANGES
    // Deduplicate by path, keeping latest
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

  const hasLiveEvents = liveActivityEvents.length > 0

  // Streaming events fast path: try catch-up from streaming_events table first
  const hydrateFromCatchUp = useRealtimeStore((s) => s.hydrateFromCatchUp)
  const catchUpAttempted = useRef<string | null>(null)

  useEffect(() => {
    if (!executionId || hasLiveEvents) return
    if (catchUpAttempted.current === executionId) return
    catchUpAttempted.current = executionId
    console.log('[use-restored] trying streaming events catch-up for', executionId)
    hydrateFromCatchUp([executionId], 0)
  }, [executionId, hasLiveEvents, hydrateFromCatchUp])

  // Observation store (fallback when streaming events are empty)
  const fetchTrace = useObservationStore((s) => s.fetchTrace)
  const getTrace = useObservationStore((s) => s.getTrace)
  const traceLoading = useObservationStore((s) => s.isLoading(executionId))
  const traceError = useObservationStore((s) => s.errors.get(executionId))

  // Use primitive length values as stable effect dependencies.
  // The exec/taskStream objects are recreated on every Zustand store update —
  // even when their contents haven't changed — so using them directly as deps
  // causes effects to re-run on every realtime event, which can cascade into
  // an infinite render loop (React error #185).
  const execActivityEventsLength = execution?.activityEvents?.length ?? 0
  const taskStreamEventLength = taskStream?.activityEvents?.length ?? 0

  // Fetch observations when needed:
  // - No live events in memory (post-refresh or completed execution)
  // - Has executionId to query
  // - Streaming events catch-up didn't produce results
  // Note: we fetch even when isRunning — after page refresh, past activity
  // is only available from observations until new SSE events arrive.
  useEffect(() => {
    console.log('[use-restored] fetch check:', {
      executionId: executionId || '(empty)',
      hasLiveEvents,
      execEventsLen: execActivityEventsLength,
      streamEventsLen: taskStreamEventLength,
    })
    if (!executionId || hasLiveEvents) return
    // If streaming events catch-up produced data, skip observation fetch
    if (taskStreamEventLength > 0) {
      console.log('[use-restored] streaming catch-up has data, skipping observation fetch')
      return
    }
    // Check if already fetched
    const existing = getTrace(executionId)
    if (existing) {
      console.log('[use-restored] trace already cached for', executionId)
      return
    }
    console.log('[use-restored] fetching trace for', executionId)
    fetchTrace(executionId)
  }, [executionId, hasLiveEvents, fetchTrace, getTrace, execActivityEventsLength, taskStreamEventLength])

  // Reconstruct activity from trace when available.
  // Using useMemo instead of useState+useEffect avoids calling setState
  // inside an effect, which caused React error #185 (too many re-renders).
  // The execution?.activityEvents dependency was the culprit: Zustand
  // recreates the execution object on every realtime store update, making
  // execution.activityEvents a new array reference even when empty. Using
  // the length (a primitive) as the dep keeps the memo stable.
  const trace = useObservationStore((s) => s.traces.get(executionId))
  const restoredFromTrace = useMemo(() => {
    // When exec-store events are available, Case 1 handles rendering —
    // no need to reconstruct from trace.
    if (!trace || execActivityEventsLength > 0) return null

    const result = reconstructActivityFromTrace(trace)
    console.log('[use-restored] reconstructed:', {
      executionId,
      activityEvents: result.activityEvents.length,
      toolTraces: result.toolTraces.length,
      fileChanges: result.fileChanges.length,
    })
    return result
  }, [trace, executionId, execActivityEventsLength])

  // Determine what to return based on data availability
  const hasExecStoreEvents = execActivityEventsLength > 0

  // Case 1: Primary execution store has events (original tab, no refresh)
  // → use live data exclusively (restored data not needed)
  if (hasExecStoreEvents) {
    return {
      activityEvents: liveActivityEvents,
      toolTraces: liveToolTraces,
      fileChanges: liveFileChanges,
      isRestoring: false,
    }
  }

  // Case 2: Post-refresh with restored data — merge restored history with
  // any new live events from the realtime store (global SSE after reconnect)
  if (restoredFromTrace) {
    const streamEvents = taskStream?.activityEvents || []
    console.log('[use-restored] Case 2: restored=%d stream=%d', restoredFromTrace.activityEvents.length, streamEvents.length)
    if (streamEvents.length > 0) {
      // Merge: restored history + new realtime events, sorted by timestamp.
      // Only include stream events strictly newer than the last restored event
      // to prevent duplicates in the merged array.
      const restoredEndTime = restoredFromTrace.activityEvents.length > 0
        ? new Date(restoredFromTrace.activityEvents[restoredFromTrace.activityEvents.length - 1].timestamp).getTime()
        : 0
      const newStreamEvents = streamEvents.filter(
        e => new Date(e.timestamp).getTime() > restoredEndTime
      )
      const mergedEvents = [...restoredFromTrace.activityEvents, ...newStreamEvents]
      mergedEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

      return {
        activityEvents: mergedEvents,
        toolTraces: restoredFromTrace.toolTraces,
        fileChanges: liveFileChanges.length > 0 ? liveFileChanges : restoredFromTrace.fileChanges,
        isRestoring: false,
      }
    }

    return {
      activityEvents: restoredFromTrace.activityEvents,
      toolTraces: restoredFromTrace.toolTraces,
      fileChanges: restoredFromTrace.fileChanges,
      isRestoring: false,
    }
  }

  // Case 3: No restored data yet — return whatever live data exists
  // (may be empty during initial load / observation fetch)
  return {
    activityEvents: liveActivityEvents,
    toolTraces: liveToolTraces,
    fileChanges: liveFileChanges,
    isRestoring: traceLoading && !hasLiveEvents && !!executionId,
    restorationError: traceError,
  }
}
