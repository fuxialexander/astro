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

