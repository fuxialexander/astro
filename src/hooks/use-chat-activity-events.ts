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
import { parseYamlSpecFromText } from "@/lib/json-render/parse-yaml-spec"
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
      // Check if hydrated text events contain yaml-spec fences that need extraction.
      // During live streaming, processChunk() in session-store handles this. But hydrated
      // events from streaming_events DB contain raw text with embedded fences.
      const hasSpecFence = !isStreaming && streamEvents.some(
        (e) => e.type === 'text' && typeof e.content === 'string' && e.content.includes('```yaml-spec')
      )
      if (hasSpecFence && !streamEvents.some(e => e.type === 'json_render_spec')) {
        // Concatenate all text events and re-parse
        const fullText = streamEvents
          .filter((e): e is Extract<TaskActivityEvent, { type: 'text' }> => e.type === 'text')
          .map(e => e.content)
          .join('')
        const parsed = parseYamlSpecFromText(fullText)
        const nonTextEvents = streamEvents.filter(e => e.type !== 'text')
        const textTimestamp = streamEvents.find(e => e.type === 'text')?.timestamp ?? new Date()
        const rebuiltEvents: TaskActivityEvent[] = []
        for (const segment of parsed) {
          if (segment.type === 'text') {
            rebuiltEvents.push({ type: 'text', content: segment.content, timestamp: textTimestamp })
          } else {
            rebuiltEvents.push({ type: 'json_render_spec', spec: segment.spec, timestamp: textTimestamp })
          }
        }
        // Merge rebuilt text/spec events with non-text events, sort chronologically
        const merged = [...rebuiltEvents, ...nonTextEvents]
        merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        return merged
      }

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
        // Parse yaml-spec fences from stored message text to restore rendered specs
        const segments = parseYamlSpecFromText(msg.content)
        for (const segment of segments) {
          if (segment.type === 'text') {
            events.push({
              type: 'chat_assistant',
              content: segment.content,
              timestamp: msg.timestamp,
            })
          } else {
            events.push({
              type: 'json_render_spec',
              spec: segment.spec,
              timestamp: msg.timestamp,
            })
          }
        }
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
  }, [taskStream?.activityEvents, sessionMessages, isStreaming])

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
