/**
 * Hook: useRestoredExecution
 *
 * Returns activity events, tool traces, and file changes for a task execution.
 * During live execution, returns in-memory SSE events.
 * After page refresh, reconstructs them from persisted streaming_events via catch-up.
 */

import { useMemo, useEffect, useRef, useState } from "react"
import type { TaskExecution, TaskActivityEvent, ToolTrace, FileChange } from "@/types"
import type { TaskStream } from "@/stores/realtime-store"
import { useRealtimeStore } from "@/stores/realtime-store"

interface RestoredExecution {
  activityEvents: TaskActivityEvent[]
  toolTraces: ToolTrace[]
  fileChanges: FileChange[]
  isRestoring: boolean
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

  // Streaming events catch-up: hydrate from streaming_events table
  const hydrateFromCatchUp = useRealtimeStore((s) => s.hydrateFromCatchUp)
  const catchUpAttempted = useRef<string | null>(null)
  // Track which executionId completed catch-up (setState only in async .then())
  const [catchUpCompletedId, setCatchUpCompletedId] = useState<string | null>(null)

  useEffect(() => {
    if (!executionId || hasLiveEvents) return
    if (catchUpAttempted.current === executionId) return

    // For terminal executions, task_executions has streamText (raw text) but
    // NOT structured activity events (tool calls, file changes). Those are only
    // in streaming_events. So we still need catch-up to display activity on revisit.

    catchUpAttempted.current = executionId
    console.log('[use-restored] trying streaming events catch-up for', executionId)
    hydrateFromCatchUp([executionId], 0)
      .then(() => setCatchUpCompletedId(executionId))
      .catch(() => {
        // On failure, still mark complete so isRestoring doesn't spin forever.
        // Activity will be empty but the UI won't be stuck on a loading spinner.
        console.warn('[use-restored] catch-up failed for', executionId)
        setCatchUpCompletedId(executionId)
      })
  }, [executionId, hasLiveEvents, hydrateFromCatchUp])

  const catchUpDone = catchUpCompletedId === executionId

  return {
    activityEvents: liveActivityEvents,
    toolTraces: liveToolTraces,
    fileChanges: liveFileChanges,
    isRestoring: !catchUpDone && !hasLiveEvents && !!executionId,
  }
}
