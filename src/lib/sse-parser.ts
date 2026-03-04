/**
 * Unified SSE Stream Parser
 *
 * Replaces the 3 inline SSE parsers in api-client.ts and execution-store.ts.
 * Handles buffer management, event/data extraction, and flush-on-empty-line.
 */

export interface SSEEvent {
  event: string
  data: string
  /** SSE `id:` field — typically a seq number for reconnection tracking */
  id?: string
}

/**
 * Strip exactly one leading space from a field value per the SSE spec.
 * "data: hello" → "hello", "data:hello" → "hello", "data:  two" → " two"
 */
function stripOneLeadingSpace(value: string): string {
  return value.startsWith(" ") ? value.slice(1) : value
}

/**
 * Low-level SSE line parser. Reads a fetch Response body and emits parsed events.
 */
export async function parseSSEStream(
  response: Response,
  handlers: {
    onEvent: (event: SSEEvent) => void
    /** Called whenever an SSE `id:` field is received — useful for tracking last seq */
    onId?: (id: string) => void
  },
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""
  let currentId: string | undefined = undefined
  let dataLines: string[] = []

  function flushEvent() {
    if (!currentEvent) return
    // Per SSE spec (RFC 8895 §9.2.6), events with no data lines are valid.
    // Emit with empty string data so heartbeats and signal-only events aren't dropped.
    const data = dataLines.join("\n")
    handlers.onEvent({ event: currentEvent, data, id: currentId })
    if (currentId !== undefined) {
      handlers.onId?.(currentId)
    }
    currentEvent = ""
    currentId = undefined
    dataLines = []
  }

  function processLine(line: string) {
    if (line.startsWith("event:")) {
      flushEvent()
      currentEvent = line.slice(6).trim()
    } else if (line.startsWith("data:")) {
      dataLines.push(stripOneLeadingSpace(line.slice(5)))
    } else if (line.startsWith("id:")) {
      currentId = stripOneLeadingSpace(line.slice(3))
    } else if (line === "") {
      flushEvent()
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      processLine(line)
    }
  }

  // Process any remaining content in the buffer (stream ended without trailing newline)
  if (buffer) {
    processLine(buffer)
  }

  // Flush any remaining event
  flushEvent()
}

/**
 * Typed wrapper for chat/generation SSE endpoints.
 * Handles: text, plan_result, done, error, aborted events.
 */
export async function parseChatSSE(
  response: Response,
  handlers: {
    onText?: (text: string) => void
    onToolUse?: (data: { toolName: string; toolInput: unknown }) => void
    onToolResult?: (data: { toolName: string; success: boolean; result: unknown }) => void
    onSessionInit?: (data: { sessionId: string; model?: string }) => void
    onPlanResult?: (result: unknown) => void
    onDone?: (sessionId: string) => void
    onError?: (error: string) => void
    /** Called when an SSE event carries a numeric `id:` field (seq number). */
    onSeq?: (seq: number) => void
    /** Called when an SSE `id:` field is received — tracks last seq for reconnection */
    onId?: (id: string) => void
  },
): Promise<void> {
  await parseSSEStream(response, {
    onId: (handlers.onId || handlers.onSeq)
      ? (id: string) => {
          handlers.onId?.(id)
          if (handlers.onSeq) {
            const seq = Number(id)
            if (!isNaN(seq)) handlers.onSeq!(seq)
          }
        }
      : undefined,
    onEvent: ({ event, data }) => {
      switch (event) {
        case "text":
          handlers.onText?.(data)
          break
        case "tool_use":
          try { handlers.onToolUse?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "tool_result":
          try { handlers.onToolResult?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "session_init":
          try { handlers.onSessionInit?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "plan_result":
          try {
            handlers.onPlanResult?.(JSON.parse(data))
          } catch {
            handlers.onError?.("Failed to parse plan result")
          }
          break
        case "done":
          try {
            const { sessionId } = JSON.parse(data)
            handlers.onDone?.(sessionId)
          } catch {
            handlers.onDone?.("")
          }
          break
        case "error":
          handlers.onError?.(data)
          break
        case "aborted":
          handlers.onDone?.("")
          break
        case "heartbeat":
          break
      }
    },
  })
}

/**
 * Typed wrapper for dispatch/execution SSE endpoints.
 * Handles: init, session_init, text, tool_use, tool_result, file_change,
 * progress, result, error, done, aborted, heartbeat events.
 */
export async function parseExecutionSSE(
  response: Response,
  handlers: {
    onInit?: (data: { executionId: string; nodeId: string; providerId: string; providerName: string }) => void
    onSessionInit?: (data: { sessionId: string; model?: string }) => void
    onText?: (text: string) => void
    onToolUse?: (data: { toolName: string; toolInput: unknown }) => void
    onToolResult?: (data: { toolName: string; success: boolean; result: unknown; duration?: number }) => void
    onFileChange?: (data: { path: string; action: string; diff?: string; linesAdded?: number; linesRemoved?: number }) => void
    onProgress?: (data: { message: string; percentage?: number }) => void
    onResult?: (data: {
      executionId: string
      nodeId: string
      status: string
      output: string
      metrics?: Record<string, unknown>
      verification?: Record<string, unknown>
      sessionId?: string
      finalStatus?: string
      branchName?: string
      prUrl?: string
      prNumber?: number
      error?: string
    }) => void
    onError?: (error: string) => void
    onDone?: (data: { executionId: string; nodeId: string; sessionId?: string }) => void
  },
): Promise<void> {
  await parseSSEStream(response, {
    onEvent: ({ event, data }) => {
      switch (event) {
        case "init":
          try { handlers.onInit?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "session_init":
          try { handlers.onSessionInit?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "text":
          handlers.onText?.(data)
          break
        case "tool_use":
          try { handlers.onToolUse?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "tool_result":
          try { handlers.onToolResult?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "file_change":
          try { handlers.onFileChange?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "progress":
          try { handlers.onProgress?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "result":
          try { handlers.onResult?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "error":
          try {
            const parsed = JSON.parse(data)
            handlers.onError?.(parsed.error || parsed.message || data)
          } catch {
            handlers.onError?.(data)
          }
          break
        case "done":
          try { handlers.onDone?.(JSON.parse(data)) } catch { /* ignore */ }
          break
        case "aborted":
          handlers.onDone?.({ executionId: "", nodeId: "" })
          break
        case "heartbeat":
          // Informational, no action needed
          break
      }
    },
  })
}
