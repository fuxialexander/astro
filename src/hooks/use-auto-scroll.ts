/**
 * Hook: useAutoScroll
 *
 * Shared auto-scroll logic used by all AI pathway components
 * (plan-generation, unified-activity-view, playground, chat-panel).
 *
 * Scrolls to bottom when new content arrives and user hasn't scrolled up.
 */

import { useState, useEffect, useCallback, type RefObject } from "react"

interface UseAutoScrollOptions {
  /** Pixel threshold from bottom to consider "at bottom" (default: 50) */
  threshold?: number
}

interface UseAutoScrollReturn {
  autoScroll: boolean
  setAutoScroll: (v: boolean) => void
  handleScroll: () => void
  scrollToBottom: () => void
}

export function useAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  deps: unknown[],
  options?: UseAutoScrollOptions,
): UseAutoScrollReturn {
  const threshold = options?.threshold ?? 50
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScroll, ...deps])

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < threshold)
  }, [containerRef, threshold])

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true)
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" })
  }, [containerRef])

  return { autoScroll, setAutoScroll, handleScroll, scrollToBottom }
}
