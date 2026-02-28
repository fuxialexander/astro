/**
 * Hook: useChatStreamEvents
 *
 * Reusable infrastructure for tracking chat activity events (text, tool_use,
 * tool_result) during post-completion chat sessions. Used by plan-chat-phase,
 * unified-activity-view, and playground to render proper tool blocks instead
 * of raw XML in chat responses.
 *
 * Provides:
 * - Local event accumulation with batched re-renders (~20fps)
 * - Tool ID matching (tool_use ↔ tool_result by tool name)
 *
 * Hydration is handled by parent views via useRestoredExecution (task-chat,
 * plan-chat) or useChatActivityEvents (chat-panel playground).
 */

import { useState, useRef, useEffect, useCallback } from "react"
import type { TaskActivityEvent } from "@/types"

interface ChatStreamEventsResult {
  /** Current chat activity events (accumulated across all turns) */
  chatEventsRef: React.MutableRefObject<TaskActivityEvent[]>
  /** Version counter — include in useMemo deps to trigger re-computation */
  chatEventsVersion: number
  /** Push a single activity event (batched re-render) */
  pushChatEvent: (event: TaskActivityEvent) => void
  /** Force immediate re-render (call at end of turn) */
  flushChatEvents: () => void
  /** Counter ref for generating unique tool IDs within a session */
  chatToolCounterRef: React.MutableRefObject<number>
}

export function useChatStreamEvents(): ChatStreamEventsResult {
  const chatEventsRef = useRef<TaskActivityEvent[]>([])
  const [chatEventsVersion, setChatEventsVersion] = useState(0)
  const chatFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatToolCounterRef = useRef(0)

  const pushChatEvent = useCallback((event: TaskActivityEvent) => {
    chatEventsRef.current = [...chatEventsRef.current, event]
    // Batch re-renders at ~20fps for smooth streaming
    if (!chatFlushTimerRef.current) {
      chatFlushTimerRef.current = setTimeout(() => {
        setChatEventsVersion(v => v + 1)
        chatFlushTimerRef.current = null
      }, 50)
    }
  }, [])

  const flushChatEvents = useCallback(() => {
    if (chatFlushTimerRef.current) {
      clearTimeout(chatFlushTimerRef.current)
      chatFlushTimerRef.current = null
    }
    setChatEventsVersion(v => v + 1)
  }, [])

  // Cleanup flush timer on unmount
  useEffect(() => {
    return () => {
      if (chatFlushTimerRef.current) clearTimeout(chatFlushTimerRef.current)
    }
  }, [])

  return {
    chatEventsRef,
    chatEventsVersion,
    pushChatEvent,
    flushChatEvents,
    chatToolCounterRef,
  }
}
