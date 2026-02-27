/**
 * Hook: useRestoredExecution
 *
 * Returns activity events, tool traces, and file changes for a task execution.
 * During live execution, returns in-memory SSE events.
 * After page refresh (events lost), reconstructs them from persisted observation data.
 */

import { useMemo, useEffect, useState } from "react"
import type { TaskExecution, TaskActivityEvent, ToolTrace, FileChange } from "@/types"
import type { TaskStream } from "@/stores/realtime-store"
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
  isRunning?: boolean,
): RestoredExecution {
  const [restoredData, setRestoredData] = useState<{
    activityEvents: TaskActivityEvent[]
    toolTraces: ToolTrace[]
    fileChanges: FileChange[]
  } | null>(null)

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

  // Observation store
  const fetchTrace = useObservationStore((s) => s.fetchTrace)
  const getTrace = useObservationStore((s) => s.getTrace)
  const traceLoading = useObservationStore((s) => s.isLoading(executionId))
  const traceError = useObservationStore((s) => s.errors.get(executionId))

  // Fetch observations when needed (no live events, not running, has executionId)
  useEffect(() => {
    if (!executionId || hasLiveEvents || isRunning) return
    // Check if already fetched
    const existing = getTrace(executionId)
    if (existing) return
    fetchTrace(executionId)
  }, [executionId, hasLiveEvents, isRunning, fetchTrace, getTrace])

  // Reconstruct from trace when available
  const trace = useObservationStore((s) => s.traces.get(executionId))
  useEffect(() => {
    // Only clear restored data when live events arrive (not unconditionally)
    if (hasLiveEvents) {
      setRestoredData(null)
      return
    }
    if (isRunning || !trace) return
    const result = reconstructActivityFromTrace(trace)
    setRestoredData(result)
  }, [trace, hasLiveEvents, isRunning])

  // Use live data when available, otherwise restored data
  if (hasLiveEvents || isRunning) {
    return {
      activityEvents: liveActivityEvents,
      toolTraces: liveToolTraces,
      fileChanges: liveFileChanges,
      isRestoring: false,
    }
  }

  if (restoredData) {
    return {
      activityEvents: restoredData.activityEvents,
      toolTraces: restoredData.toolTraces,
      fileChanges: restoredData.fileChanges,
      isRestoring: false,
    }
  }

  return {
    activityEvents: liveActivityEvents,
    toolTraces: liveToolTraces,
    fileChanges: liveFileChanges,
    isRestoring: traceLoading && !hasLiveEvents && !!executionId,
    restorationError: traceError,
  }
}
