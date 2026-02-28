/**
 * ChatActivityView
 *
 * Lightweight activity view for chat sessions (plan-chat, task-chat, etc.).
 * Reuses the shared activity block components from activity-blocks.tsx.
 * Shows tool calls, file changes, and text events from the realtime store.
 */

import { useEffect, useRef } from "react"
import { useRealtimeStore } from "@/stores/realtime-store"
import {
  groupActivityEvents,
  TextBlock,
  ToolBlock,
  ToolGroupBlock,
  FileChangeBlock,
  ErrorBlock,
} from "@/components/activity-blocks"
import type { TaskActivityEvent } from "@/types"

interface ChatActivityViewProps {
  sessionId: string
  isStreaming: boolean
}

export function ChatActivityView({ sessionId, isStreaming }: ChatActivityViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const taskStream = useRealtimeStore((s) => s.taskStreams.get(sessionId))
  const hydrateFromCatchUp = useRealtimeStore((s) => s.hydrateFromCatchUp)

  // Hydrate persisted events on mount
  useEffect(() => {
    if (sessionId) {
      hydrateFromCatchUp([sessionId], 0)
    }
  }, [sessionId, hydrateFromCatchUp])

  // Auto-scroll on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [taskStream?.activityEvents.length])

  const activityEvents = taskStream?.activityEvents ?? []

  // Filter to only tool-related and file change events (skip text for chat activity)
  const relevantEvents = activityEvents.filter(
    (e: TaskActivityEvent) =>
      e.type === 'tool_use' ||
      e.type === 'tool_result' ||
      e.type === 'file_change' ||
      e.type === 'error'
  )

  if (relevantEvents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No activity yet
      </div>
    )
  }

  const blocks = groupActivityEvents(relevantEvents)

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return <TextBlock key={i} events={block.events} isStreaming={isStreaming} />
          case 'tool':
            return <ToolBlock key={i} events={block.events} isRunning={isStreaming} />
          case 'tool_group':
            return <ToolGroupBlock key={i} events={block.events} isRunning={isStreaming} />
          case 'file_change':
            return <FileChangeBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'file_change' }>} />
          case 'error':
            return <ErrorBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'error' }>} />
          default:
            return null
        }
      })}

      {/* Streaming cursor */}
      {isStreaming && relevantEvents.length > 0 && (
        <span className="px-4 animate-pulse text-info text-xs font-mono">|</span>
      )}
    </div>
  )
}
