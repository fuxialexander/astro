/**
 * Stream Watcher — subscribes to realtime-store taskStream events for a given streamId.
 *
 * Phase 3.4: POST + subscribe. After POSTing to a chat/dispatch endpoint (which returns JSON),
 * the caller uses watchStream() to react to events arriving via the global SSE bus.
 *
 * Events are delivered by the relay → global SSE bus → realtime-store → taskStreams.
 * This watcher processes new events and detects terminal status transitions.
 *
 * Live SSE only updates specialized fields (stdout, toolTraces, fileChanges, status).
 * activityEvents are populated from DB hydration only. So this watcher reads from
 * the specialized fields for real-time callbacks.
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
  let prevStdoutLen = 0
  let prevToolTraceCount = 0
  let prevStatus: string | undefined
  let done = false

  const unsub = useRealtimeStore.subscribe((state) => {
    if (done) return
    const stream = state.taskStreams.get(streamId)
    if (!stream) return

    // Text: track stdout growth (live SSE updates stdout directly)
    if (stream.stdout.length > prevStdoutLen) {
      const newText = stream.stdout.slice(prevStdoutLen)
      prevStdoutLen = stream.stdout.length
      callbacks.onTextChunk?.(newText)
    }

    // Tools: track toolTraces growth (live SSE updates toolTraces directly)
    const traces = stream.toolTraces
    for (let i = prevToolTraceCount; i < traces.length; i++) {
      const t = traces[i]
      if (t.toolInput !== undefined) callbacks.onToolUse?.(t.toolName)
      if (t.toolResult !== undefined) callbacks.onToolResult?.(t.toolName)
    }
    prevToolTraceCount = traces.length

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
