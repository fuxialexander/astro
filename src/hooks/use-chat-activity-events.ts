/**
 * Hook: useChatActivityEvents
 *
 * Returns activity events and display blocks for plan-chat sessions.
 * During live streaming, combines realtime-store events with session messages.
 * After page refresh, hydrates from streaming_events table via catch-up.
 *
 * Adapted from useRestoredExecution, but simplified:
 * - No execution-store dependency (plan chats don't use it)
 * - No observation-store fallback (plan chats don't generate Langfuse traces)
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

  // Track which streamId we've attempted catch-up for
  const catchUpAttempted = useRef<string | null>(null)

  // On mount / session switch: hydrate from streaming_events if no live events
  useEffect(() => {
    if (!streamId) return
    const hasEvents = taskStream && taskStream.activityEvents.length > 0
    if (hasEvents) return
    if (catchUpAttempted.current === streamId) return
    catchUpAttempted.current = streamId
    hydrateFromCatchUp([streamId], 0)
  }, [streamId, taskStream, hydrateFromCatchUp])

  // Reset catch-up tracking when session switches
  useEffect(() => {
    catchUpAttempted.current = null
  }, [streamId])

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
