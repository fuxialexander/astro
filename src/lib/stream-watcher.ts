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

/** How long (ms) without any activity before the watcher considers the stream dead. */
const INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes

/**
 * Watch a stream's events via the realtime store.
 * Returns an unsubscribe function — call it on abort or cleanup.
 *
 * Includes a safety timeout: if no new events arrive for INACTIVITY_TIMEOUT_MS,
 * the watcher fires onError to unblock the caller (prevents permanently stuck
 * streamingSessions when task:result SSE events are lost).
 */
export function watchStream(
  streamId: string,
  callbacks: StreamWatcherCallbacks,
): () => void {
  let prevStdoutLen = 0
  let prevToolTraceCount = 0
  let done = false

  // Initialize prevStatus from the current stream state so we don't
  // accidentally detect a stale terminal status from a previous turn.
  const initialStream = useRealtimeStore.getState().taskStreams.get(streamId)
  let prevStatus: string | undefined = initialStream?.status

  // Safety timeout — reset on every activity
  let lastActivityTime = Date.now()
  const timeoutTimer = setInterval(() => {
    if (done) return
    if (Date.now() - lastActivityTime > INACTIVITY_TIMEOUT_MS) {
      done = true
      clearInterval(timeoutTimer)
      callbacks.onError?.('Stream timed out — no events received for 3 minutes. Try sending your message again.')
      queueMicrotask(() => unsub())
    }
  }, 30_000) // check every 30s

  const unsub = useRealtimeStore.subscribe((state) => {
    if (done) return
    const stream = state.taskStreams.get(streamId)
    if (!stream) return

    // Text: track stdout growth (live SSE updates stdout directly)
    if (stream.stdout.length > prevStdoutLen) {
      const newText = stream.stdout.slice(prevStdoutLen)
      prevStdoutLen = stream.stdout.length
      lastActivityTime = Date.now()
      callbacks.onTextChunk?.(newText)
    }

    // Tools: track toolTraces growth (live SSE updates toolTraces directly)
    const traces = stream.toolTraces
    for (let i = prevToolTraceCount; i < traces.length; i++) {
      const t = traces[i]
      lastActivityTime = Date.now()
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
        clearInterval(timeoutTimer)
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

  // Wrap unsub to also clear the safety timeout
  const cleanup = () => {
    done = true
    clearInterval(timeoutTimer)
    unsub()
  }

  return cleanup
}
