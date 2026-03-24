/**
 * Generic SSE connection hook with auto-reconnect.
 *
 * Opens an EventSource to the given path and dispatches parsed events
 * through the provided handler. Automatically reconnects on disconnect
 * with exponential backoff (capped at 30 s).
 */
import { useEffect, useRef, useCallback } from 'react'
import { getBaseUrl } from '@desktop/lib/api-client'

export interface SSEEvent {
  type: string
  data: unknown
}

interface UseSSEOptions {
  /** API path for the SSE endpoint (e.g. '/api/events') */
  path: string
  /** Called for each parsed event */
  onEvent: (event: SSEEvent) => void
  /** Called when the connection opens */
  onOpen?: () => void
  /** Called on error (before reconnect) */
  onError?: (error: Event) => void
  /** Whether to keep the connection active (default: true) */
  enabled?: boolean
}

const MAX_RECONNECT_DELAY = 30_000
const BASE_RECONNECT_DELAY = 1_000

export function useSSE({ path, onEvent, onOpen, onError, enabled = true }: UseSSEOptions) {
  const sourceRef = useRef<EventSource | null>(null)
  const retriesRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    cleanup()
    if (!enabled) return

    const url = `${getBaseUrl()}${path}`
    const source = new EventSource(url)
    sourceRef.current = source

    source.onopen = () => {
      retriesRef.current = 0
      onOpen?.()
    }

    source.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as unknown
        onEvent({ type: ev.type, data })
      } catch {
        onEvent({ type: ev.type, data: ev.data })
      }
    }

    // Also listen to named event types the server may send
    const namedTypes = [
      'text', 'tool_use', 'tool_result', 'file_change',
      'progress', 'result', 'error', 'done', 'init',
      'session_init', 'heartbeat', 'aborted',
      'plan_result', 'chat_user', 'chat_assistant',
    ]
    for (const eventType of namedTypes) {
      source.addEventListener(eventType, (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data as string) as unknown
          onEvent({ type: eventType, data })
        } catch {
          onEvent({ type: eventType, data: ev.data })
        }
      })
    }

    source.onerror = (err) => {
      onError?.(err)
      source.close()

      // Exponential backoff reconnect
      const delay = Math.min(
        BASE_RECONNECT_DELAY * Math.pow(2, retriesRef.current),
        MAX_RECONNECT_DELAY,
      )
      retriesRef.current++

      reconnectTimerRef.current = setTimeout(connect, delay)
    }
  }, [path, enabled, onEvent, onOpen, onError, cleanup])

  useEffect(() => {
    connect()
    return cleanup
  }, [connect, cleanup])

  return {
    close: cleanup,
    reconnect: connect,
  }
}
