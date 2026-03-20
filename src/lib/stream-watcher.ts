/**
 * Stream Watcher — subscribes to realtime-store taskStream events for a given streamId.
 *
 * Phase 3.4: POST + subscribe. After POSTing to a chat/dispatch endpoint (which returns JSON),
 * the caller uses watchStream() to react to events arriving via the global SSE bus.
 *
 * Events are delivered by the relay → global SSE bus → realtime-store → taskStreams.
 * This watcher processes new activity events and detects terminal status transitions.
 */

import { useRealtimeStore } from "@/stores/realtime-store"

export interface StreamWatcherCallbacks {
  /** Called for each new text chunk (batched ~50ms by realtime-store) */
  onTextChunk?: (chunk: string) => void
  /** Called when a tool_use event is detected */
  onToolUse?: (toolName: string) => void
  /** Called when a tool_result event is detected */
  onToolResult?: (toolName: string) => void
  /** Called when the stream completes successfully */
  onComplete?: (info: { sessionId?: string; status: string }) => void
  /** Called when the stream errors */
  onError?: (error: string) => void
}

/**
 * Watch a stream's events via the realtime store.
 * Returns an unsubscribe function — call it on abort or cleanup.
 */
export function watchStream(
  streamId: string,
  callbacks: StreamWatcherCallbacks,
): () => void {
  let processedEventCount = 0
  let prevStatus: string | undefined
  let done = false

  const unsub = useRealtimeStore.subscribe((state) => {
    if (done) return
    const stream = state.taskStreams.get(streamId)
    if (!stream) return

    // Process new activity events
    const events = stream.activityEvents
    for (let i = processedEventCount; i < events.length; i++) {
      const e = events[i]
      if (e.type === "text") callbacks.onTextChunk?.((e as { content: string }).content)
      if (e.type === "tool_use") callbacks.onToolUse?.((e as { toolName: string }).toolName)
      if (e.type === "tool_result") callbacks.onToolResult?.((e as { toolName: string }).toolName)
    }
    processedEventCount = events.length

    // Terminal status detection
    if (stream.status && stream.status !== prevStatus) {
      prevStatus = stream.status
      const isTerminal = stream.status === "success" || stream.status === "completed" ||
        stream.status === "error" || stream.status === "failure" ||
        stream.status === "aborted" || stream.status === "cancelled"
      if (isTerminal) {
        done = true
        if (stream.status === "error" || stream.status === "failure") {
          callbacks.onError?.(stream.error || "Unknown error")
        } else {
          callbacks.onComplete?.({ sessionId: stream.sessionId, status: stream.status })
        }
        // Defer unsub to avoid mutating subscriber list during iteration
        queueMicrotask(() => unsub())
      }
    }
  })

  return unsub
}
