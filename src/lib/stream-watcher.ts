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
 * How long (ms) without any task-specific activity before the watcher considers the stream dead.
 * Set to 10 minutes to accommodate long-running agent tool steps (e.g., builds, large file edits)
 * where no SSE events are emitted until the step completes.
 */
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

/** Shorter timeout for the initial connection — if no events arrive at all. */
const INITIAL_TIMEOUT_MS = 60 * 1000 // 1 minute

/**
 * Watch a stream's events via the realtime store.
 * Returns an unsubscribe function — call it on abort or cleanup.
 *
 * Includes a safety timeout: if no new events arrive for INACTIVITY_TIMEOUT_MS,
 * the watcher fires onError to unblock the caller (prevents permanently stuck
 * streamingSessions when task:result SSE events are lost).
 *
 * The caller MUST call resetChatStream(streamId) before calling watchStream()
 * when reusing the same streamId across conversation turns. This prevents
 * stale stdout/toolTraces from being replayed as "new" data.
 */
export function watchStream(
  streamId: string,
  callbacks: StreamWatcherCallbacks,
): () => void {
  let prevStdoutLen = 0
  let prevToolTraceCount = 0
  let done = false
  let cleanedUp = false
  let receivedFirstEvent = false

  // Initialize prevStatus from the current stream state so we don't
  // accidentally detect a stale terminal status from a previous turn.
  // This is critical when the same streamId is reused across turns:
  // after resetChatStream sets status to 'running', prevStatus must match
  // so we only fire onComplete for NEW terminal transitions.
  const initialStream = useRealtimeStore.getState().taskStreams.get(streamId)
  let prevStatus: string | undefined = initialStream?.status

  // Safety timeout — reset on every activity.
  // Starts with a shorter initial timeout; extends to full timeout after first event.
  let lastActivityTime = Date.now()
  const timeoutTimer = setInterval(() => {
    if (done) return
    const timeout = receivedFirstEvent ? INACTIVITY_TIMEOUT_MS : INITIAL_TIMEOUT_MS
    if (Date.now() - lastActivityTime > timeout) {
      done = true
      clearInterval(timeoutTimer)
      const msg = receivedFirstEvent
        ? 'Stream timed out — no events received for 10 minutes. Try sending your message again.'
        : 'No response from agent runner — the request may not have reached a connected machine. Try again.'
      callbacks.onError?.(msg)
      queueMicrotask(() => cleanup())
    }
  }, 10_000) // check every 10s

  const unsub = useRealtimeStore.subscribe((state) => {
    if (done) return
    const stream = state.taskStreams.get(streamId)
    if (!stream) return

    // Text: track stdout growth (live SSE updates stdout directly)
    if (stream.stdout.length > prevStdoutLen) {
      const newText = stream.stdout.slice(prevStdoutLen)
      prevStdoutLen = stream.stdout.length
      lastActivityTime = Date.now()
      receivedFirstEvent = true
      callbacks.onTextChunk?.(newText)
    }

    // Tools: track toolTraces growth (live SSE updates toolTraces directly)
    const traces = stream.toolTraces
    for (let i = prevToolTraceCount; i < traces.length; i++) {
      const t = traces[i]
      lastActivityTime = Date.now()
      receivedFirstEvent = true
      if (t.toolInput !== undefined) callbacks.onToolUse?.(t.toolName)
      if (t.toolResult !== undefined) callbacks.onToolResult?.(t.toolName)
    }
    prevToolTraceCount = traces.length

    // Terminal status detection
    if (stream.status && stream.status !== prevStatus) {
      lastActivityTime = Date.now()
      receivedFirstEvent = true
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
        queueMicrotask(() => cleanup())
      }
    }
  })

  // Guard against double cleanup (timeout + terminal + external cleanup can race)
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    done = true
    clearInterval(timeoutTimer)
    unsub()
  }

  return cleanup
}

/**
 * Reset a chat stream in the realtime store for a new conversation turn.
 *
 * When the same streamId (session ID) is reused across turns, stale data
 * from the previous turn (stdout, toolTraces, status) must be cleared.
 * Otherwise watchStream() would replay old stdout as "new" text chunks.
 *
 * Call this BEFORE setChatStreamStatus(sid, 'running') and watchStream().
 */
export function resetChatStream(streamId: string) {
  useRealtimeStore.setState((state) => {
    const streams = new Map(state.taskStreams)
    const existing = streams.get(streamId)
    // Reset stdout/toolTraces/status for the new turn, but preserve activityEvents
    // so the UI doesn't flash blank while re-hydrating from DB.
    streams.set(streamId, {
      taskId: streamId,
      stdout: '',
      progress: 0,
      toolTraces: [],
      fileChanges: [],
      steerMessages: [],
      activityEvents: existing?.activityEvents ?? [],
      status: 'running',
    })
    return { taskStreams: streams }
  })
}
