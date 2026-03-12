/**
 * Hook: useChatActivityEvents
 *
 * Returns activity events and display blocks for project-chat sessions.
 * During live streaming, combines realtime-store events with session messages.
 * After page refresh, hydrates from streaming_events table via catch-up.
 *
 * Adapted from useRestoredExecution, but simplified:
 * - No execution-store dependency (project chats don't use it)
 * - No observation-store dependency (project chats don't generate traces)
 * - Uses streamId as the streaming_events executionId
 */

import { useMemo, useEffect, useRef, useCallback } from "react"
import { useRealtimeStore } from "@/stores/realtime-store"
import { groupActivityEvents, type DisplayBlock } from "@/components/activity-blocks"
import type { TaskActivityEvent, SessionMessage } from "@/types"

interface ChatActivityResult {
  activityEvents: TaskActivityEvent[]
  displayBlocks: DisplayBlock[]
  isRestoring: boolean
}

export function useChatActivityEvents(
  streamId: string | undefined,
  sessionMessages: SessionMessage[],
  isStreaming: boolean,
): ChatActivityResult {
  const taskStream = useRealtimeStore(
    useCallback((s) => streamId ? s.taskStreams.get(streamId) : undefined, [streamId])
  )
  const hydrateFromCatchUp = useRealtimeStore((s) => s.hydrateFromCatchUp)

  // Track which streamId we've hydrated to prevent duplicate calls.
  // We intentionally skip the `hasEvents` guard that was here before — during
  // live streaming a `steer_message` (user message) is persisted immediately
  // *before* the assistant response starts, so `taskStream.activityEvents` may
  // contain stale partial data from a previous render.  Relying on that guard
  // caused hydration to be skipped entirely after a mid-stream page refresh.
  const hydratedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!streamId) return
    if (hydratedRef.current === streamId) return
    hydratedRef.current = streamId
    // Hydrate from streaming_events DB table. The global SSE reconnect handler
    // skips chat sessions (derived from session.type) so this is the only
    // hydration path for chat streams.
    hydrateFromCatchUp([streamId], 0)
  }, [streamId, hydrateFromCatchUp])

  // Build the activity events list
  const activityEvents: TaskActivityEvent[] = useMemo(() => {
    const streamEvents = taskStream?.activityEvents ?? []

    // If we have streaming events (live or hydrated), use them as the primary source
    if (streamEvents.length > 0) {
      // Append mutation events from session messages (these aren't in the streaming events)
      const mutationEvents: TaskActivityEvent[] = []
      for (const msg of sessionMessages) {
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
        // Merge and sort chronologically
        const merged = [...streamEvents, ...mutationEvents]
        merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        return merged
      }

      return streamEvents
    }

    // Fallback: no streaming events (old session without streamId, or pre-streaming data)
    // Convert session messages to activity events
    const events: TaskActivityEvent[] = []
    for (const msg of sessionMessages) {
      if (msg.role === 'user') {
        events.push({
          type: 'chat_user',
          message: msg.content,
          timestamp: msg.timestamp,
        })
      } else if (msg.role === 'assistant' && msg.content) {
        events.push({
          type: 'chat_assistant',
          content: msg.content,
          timestamp: msg.timestamp,
        })
      }

      // Include mutation events from messages
      if (msg.appliedMutations) {
        const { nodeUpdates, edgeOps, newNodes } = msg.appliedMutations
        if (nodeUpdates.length > 0 || edgeOps.length > 0 || newNodes.length > 0) {
          events.push({
            type: 'mutation',
            nodeUpdates,
            edgeOps,
            newNodes,
            timestamp: msg.timestamp,
          })
        }
      }
    }
    return events
  }, [taskStream?.activityEvents, sessionMessages])

  // Group for display
  const displayBlocks = useMemo(
    () => groupActivityEvents(activityEvents),
    [activityEvents]
  )

  const isRestoring = !!(
    streamId &&
    activityEvents.length === 0 &&
    !isStreaming &&
    sessionMessages.length > 0
  )

  return { activityEvents, displayBlocks, isRestoring }
}
