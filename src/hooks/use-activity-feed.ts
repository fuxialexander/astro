/**
 * Hook: useActivityFeed
 *
 * Shared activity feed composition for AI pathway components.
 * Merges execution events + chat events with deduplication,
 * groups into display blocks, and scans for approval responses.
 *
 * Dedup logic: when both execution and chat streams contain overlapping
 * events (e.g. steer → agent response appears in both), the execution
 * stream is authoritative. Chat events that duplicate execution events
 * are filtered out. Post-completion chat events (after execution ends)
 * always pass through.
 */

import { useMemo } from "react"
import { useStreamEvents } from "@/hooks/use-stream-events"
import { groupActivityEvents, type DisplayBlock } from "@/components/activity-blocks"
import type { TaskActivityEvent, TaskExecution, SessionMessage } from "@/types"

interface UseActivityFeedOptions {
  /** Execution ID for the execution stream (plan gen, task, playground) */
  executionId?: string
  /** Chat session ID for the chat stream */
  chatSessionId?: string
  /** Execution object (passed through to useStreamEvents) */
  execution?: TaskExecution
  /** Project ID (passed through to useStreamEvents) */
  projectId?: string
  /** Legacy session messages for chat hydration */
  chatMessages?: SessionMessage[]
  /** Previous execution IDs to merge before the primary stream (follow-up continuity) */
  additionalExecutionIds?: string[]
}

interface UseActivityFeedReturn {
  /** Raw execution activity events (before merge) */
  execActivityEvents: TaskActivityEvent[]
  /** Raw chat activity events (before merge) */
  chatActivityEvents: TaskActivityEvent[]
  /** Merged and deduplicated activity events */
  allActivityEvents: TaskActivityEvent[]
  /** Grouped display blocks */
  displayBlocks: DisplayBlock[]
  /** Set of answered approval request IDs */
  answeredRequestIds: Set<string>
  /** Map of request ID → approval_response event */
  approvalResponseMap: Map<string, Extract<TaskActivityEvent, { type: 'approval_response' }>>
  /** Whether execution events are being hydrated from DB */
  isRestoring: boolean
}

export function useActivityFeed({
  executionId,
  chatSessionId,
  execution,
  projectId,
  chatMessages,
  additionalExecutionIds,
}: UseActivityFeedOptions): UseActivityFeedReturn {
  // Execution events (with optional previous execution IDs for follow-up continuity)
  const { activityEvents: execActivityEvents, isHydrating: isRestoring } = useStreamEvents(
    executionId,
    { execution, projectId, additionalStreamIds: additionalExecutionIds },
  )

  // Chat events
  const { activityEvents: chatActivityEvents } = useStreamEvents(
    chatSessionId,
    { legacySessionMessages: chatMessages },
  )

  // Merge with deduplication — execution stream is authoritative
  const allActivityEvents: TaskActivityEvent[] = useMemo(() => {
    if (chatActivityEvents.length === 0) return execActivityEvents
    if (execActivityEvents.length === 0) return chatActivityEvents

    // Dedup: execution and chat streams can overlap during steer/resume.
    // Remove duplicates from chat that already appear in execution.
    const execLastTime = execActivityEvents.length > 0
      ? new Date(execActivityEvents[execActivityEvents.length - 1].timestamp).getTime()
      : 0
    const execHasText = execActivityEvents.some((e) => e.type === 'text')
    const execChatUserMessages = new Set(
      execActivityEvents
        .filter((e): e is Extract<TaskActivityEvent, { type: 'chat_user' }> => e.type === 'chat_user')
        .map((e) => e.message)
    )
    const deduplicatedChat = chatActivityEvents.filter((e) => {
      // System prompts are always in the execution stream
      if (e.type === 'system_prompt') return false
      // Chat user messages already in execution (steer → chat_user)
      if (e.type === 'chat_user') return !execChatUserMessages.has(e.message)
      // Text/assistant events within execution timeline are duplicates;
      // post-completion follow-up chat text must pass through
      if ((e.type === 'text' || e.type === 'chat_assistant') && execHasText) {
        return new Date(e.timestamp).getTime() > execLastTime
      }
      return true
    })
    const merged = [...execActivityEvents, ...deduplicatedChat]
    merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    return merged
  }, [execActivityEvents, chatActivityEvents])

  // Group into display blocks
  const displayBlocks = useMemo(() => groupActivityEvents(allActivityEvents), [allActivityEvents])

  // Scan for approval responses
  const { answeredRequestIds, approvalResponseMap } = useMemo(() => {
    const ids = new Set<string>()
    const responses = new Map<string, Extract<TaskActivityEvent, { type: 'approval_response' }>>()
    for (const event of allActivityEvents) {
      if (event.type === 'approval_response') {
        ids.add(event.requestId)
        responses.set(event.requestId, event)
      }
    }
    return { answeredRequestIds: ids, approvalResponseMap: responses }
  }, [allActivityEvents])

  return {
    execActivityEvents,
    chatActivityEvents,
    allActivityEvents,
    displayBlocks,
    answeredRequestIds,
    approvalResponseMap,
    isRestoring,
  }
}
