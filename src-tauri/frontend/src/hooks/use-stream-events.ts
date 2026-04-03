/**
 * Typed streaming event handler for execution and chat events.
 *
 * Connects to the SSE endpoint and routes events to the appropriate
 * stores (chat, activity, plan).
 */
import { useCallback } from 'react'
import { useSSE } from '@desktop/hooks/use-sse'
import { useChatStore } from '@desktop/stores/chat-store'
import { useActivityStore } from '@desktop/stores/activity-store'
import { usePlanStore } from '@desktop/stores/plan-store'
import type { SSEEvent } from '@desktop/hooks/use-sse'
import type { ToolBlock } from '@desktop/stores/chat-store'
import type { ActivityEvent, ActivityEventType } from '@desktop/stores/activity-store'
import type { PlanNodeStatus } from '@desktop/types'

interface UseStreamEventsOptions {
  /** Project ID to filter events for */
  projectId: string
  /** Whether to enable the SSE connection */
  enabled?: boolean
}

/**
 * Hook that connects to the streaming events SSE endpoint and dispatches
 * events to the chat, activity, and plan stores.
 */
export function useStreamEvents({ projectId, enabled = true }: UseStreamEventsOptions) {
  const appendStreamChunk = useChatStore((s) => s.appendStreamChunk)
  const appendToolBlock = useChatStore((s) => s.appendToolBlock)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const addEvent = useActivityStore((s) => s.addEvent)
  const updateNodeStatus = usePlanStore((s) => s.updateNodeStatus)

  const onEvent = useCallback(
    (event: SSEEvent) => {
      const data = event.data as Record<string, unknown> | undefined

      switch (event.type) {
        // ── Legacy format ─────────────────────────────────────────
        case 'text': {
          const text = (data?.text ?? data?.content ?? '') as string
          if (text) appendStreamChunk(text)
          break
        }

        case 'tool_use': {
          const block: ToolBlock = {
            id: (data?.id ?? `tool-${Date.now()}`) as string,
            type: 'tool_use',
            toolName: (data?.name ?? data?.toolName ?? 'unknown') as string,
            input: data?.input,
          }
          appendToolBlock(block)
          break
        }

        case 'tool_result': {
          const block: ToolBlock = {
            id: (data?.id ?? `result-${Date.now()}`) as string,
            type: 'tool_result',
            toolName: (data?.name ?? data?.toolName ?? 'unknown') as string,
            output: (data?.output ?? data?.content ?? '') as string,
            isError: (data?.isError ?? false) as boolean,
          }
          appendToolBlock(block)
          break
        }

        case 'done': {
          finalizeStream()
          break
        }

        case 'progress': {
          const nodeId = data?.nodeId as string | undefined
          const status = data?.status as PlanNodeStatus | undefined
          if (nodeId && status) updateNodeStatus(nodeId, status)
          addEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: mapProgressToActivityType(status),
            title: (data?.title ?? `Task ${status ?? 'updated'}`) as string,
            description: data?.message as string | undefined,
            nodeId,
            timestamp: new Date().toISOString(),
          })
          break
        }

        case 'file_change': {
          addEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'file_change',
            title: 'File changed',
            description: (data?.path ?? data?.file ?? '') as string,
            timestamp: new Date().toISOString(),
            metadata: data as Record<string, unknown>,
          })
          break
        }

        case 'error': {
          const message = (data?.message ?? data?.error) as string | undefined
          if (message) {
            addEvent({
              id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'error',
              title: 'Error',
              description: message,
              timestamp: new Date().toISOString(),
            })
          }
          break
        }

        case 'result': {
          const nodeId = data?.nodeId as string | undefined
          if (nodeId) updateNodeStatus(nodeId, 'completed')
          addEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'task_completed',
            title: (data?.title ?? 'Task completed') as string,
            description: (data?.summary ?? '') as string,
            nodeId,
            timestamp: new Date().toISOString(),
          })
          finalizeStream()
          break
        }

        // ── Relay format from /api/events ─────────────────────────
        case 'task:stdout': {
          // { taskId, data: string } — batched text output from the agent
          const text = (data as Record<string, unknown>)?.data as string | undefined
          if (text) appendStreamChunk(text)
          break
        }

        case 'task:tool_trace': {
          // { taskId, toolName, toolInput, toolResult, success, toolUseId? }
          const d = data as Record<string, unknown>
          const useBlock: ToolBlock = {
            id: (d?.toolUseId ?? `tool-${Date.now()}`) as string,
            type: 'tool_use',
            toolName: (d?.toolName ?? 'unknown') as string,
            input: d?.toolInput,
          }
          appendToolBlock(useBlock)
          if (d?.toolResult !== undefined) {
            const resultBlock: ToolBlock = {
              id: `result-${Date.now()}`,
              type: 'tool_result',
              toolName: (d?.toolName ?? 'unknown') as string,
              output: typeof d.toolResult === 'string'
                ? d.toolResult
                : JSON.stringify(d.toolResult),
              isError: !(d?.success as boolean),
            }
            appendToolBlock(resultBlock)
          }
          break
        }

        case 'task:result': {
          const d = data as Record<string, unknown>
          const nodeId = d?.nodeId as string | undefined
          if (nodeId) updateNodeStatus(nodeId, 'completed')
          addEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'task_completed',
            title: (d?.title ?? 'Task completed') as string,
            description: (d?.summary ?? '') as string,
            nodeId,
            timestamp: new Date().toISOString(),
          })
          finalizeStream()
          break
        }

        case 'task:file_change': {
          const d = data as Record<string, unknown>
          addEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'file_change',
            title: 'File changed',
            description: (d?.path ?? '') as string,
            timestamp: new Date().toISOString(),
            metadata: d,
          })
          break
        }

        case 'task:progress': {
          const d = data as Record<string, unknown>
          const nodeId = d?.nodeId as string | undefined
          const status = d?.status as PlanNodeStatus | undefined
          if (nodeId && status) updateNodeStatus(nodeId, status)
          addEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: mapProgressToActivityType(status),
            title: (d?.title ?? `Task ${status ?? 'updated'}`) as string,
            description: d?.message as string | undefined,
            nodeId,
            timestamp: new Date().toISOString(),
          })
          break
        }

        // heartbeat, init, session_init, task:session_init, task:operational, task:init, task:ready — no-op
        default:
          break
      }
    },
    [appendStreamChunk, appendToolBlock, finalizeStream, addEvent, updateNodeStatus],
  )

  return useSSE({
    path: `/api/events/stream?projectId=${projectId}`,
    onEvent,
    enabled,
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────

function mapProgressToActivityType(status?: string): ActivityEventType {
  switch (status) {
    case 'in_progress':
    case 'dispatched':
      return 'task_started'
    case 'completed':
    case 'auto_verified':
      return 'task_completed'
    case 'pruned':
      return 'task_failed'
    default:
      return 'system'
  }
}

// Re-export for convenience
export type { ActivityEvent }
