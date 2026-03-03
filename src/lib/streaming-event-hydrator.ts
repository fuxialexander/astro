/**
 * Streaming Event Hydrator
 *
 * Converts raw streaming_events rows into TaskStream-compatible data.
 * Simpler than observation-activity-bridge since streaming events are
 * already in the same format as SSE events.
 */

import type { TaskActivityEvent } from '@/types'
import type { StreamingEventRow } from '@/lib/api-client'

export interface PendingApproval {
  executionId: string
  requestId: string
  question: string
  options: string[]
  machineId?: string
  timestamp: Date
}

export interface HydratedStreamData {
  stdout: string
  activityEvents: TaskActivityEvent[]
  toolTraces: Array<{
    toolName: string
    toolInput: unknown
    toolResult?: unknown
    success?: boolean
    duration?: number
    timestamp: Date
  }>
  fileChanges: Array<{
    path: string
    action: string
    linesAdded?: number
    linesRemoved?: number
    diff?: string
    timestamp: Date
  }>
  // Pending approval requests (not yet answered)
  pendingApprovals: PendingApproval[]
  // Metadata from session_init and result events
  status?: string
  output?: string
  error?: string
  sessionId?: string
  model?: string
  progress?: number
  progressMessage?: string
  branchName?: string
  prUrl?: string
  prNumber?: number
  deliveryStatus?: string
  summary?: string
  planResult?: { projectName?: string; nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }
}

let idCounter = 0

export function hydrateStreamingEvents(events: StreamingEventRow[]): HydratedStreamData {
  const activityEvents: TaskActivityEvent[] = []
  const toolTraces: HydratedStreamData['toolTraces'] = []
  const fileChanges: HydratedStreamData['fileChanges'] = []
  // Track approval requests and which have been answered
  const approvalRequests = new Map<string, PendingApproval>()
  const answeredApprovals = new Set<string>()
  let stdout = ''
  let status: string | undefined
  let output: string | undefined
  let error: string | undefined
  let sessionId: string | undefined
  let model: string | undefined
  let progress: number | undefined
  let progressMessage: string | undefined
  let branchName: string | undefined
  let prUrl: string | undefined
  let prNumber: number | undefined
  let deliveryStatus: string | undefined
  let summary: string | undefined
  let planResult: HydratedStreamData['planResult']
  // Map toolName → queue of unpaired tool_use IDs for matching with tool_result
  const unpairedToolUseIds = new Map<string, string[]>()

  for (const event of events) {
    const data = event.data as Record<string, unknown>
    const timestamp = new Date(event.createdAt)

    switch (event.eventType) {
      case 'text': {
        const text = (data.text as string) || ''
        stdout += text
        activityEvents.push({ type: 'text', content: text, timestamp })
        break
      }
      case 'tool_use': {
        const toolName = (data.toolName as string) || 'unknown'
        const id = `hydrated-${++idCounter}`
        // Track unpaired tool_use IDs so matching tool_result gets the same ID
        if (!unpairedToolUseIds.has(toolName)) unpairedToolUseIds.set(toolName, [])
        unpairedToolUseIds.get(toolName)!.push(id)
        activityEvents.push({
          type: 'tool_use',
          id,
          toolName,
          toolInput: data.toolInput,
          timestamp,
        })
        toolTraces.push({
          toolName,
          toolInput: data.toolInput,
          timestamp,
        })
        break
      }
      case 'tool_result': {
        const toolName = (data.toolName as string) || 'unknown'
        // Reuse ID from the matching tool_use so grouping pairs them correctly
        const pendingIds = unpairedToolUseIds.get(toolName)
        const id = pendingIds?.shift() ?? `hydrated-${++idCounter}`
        if (pendingIds?.length === 0) unpairedToolUseIds.delete(toolName)
        activityEvents.push({
          type: 'tool_result',
          id,
          toolName,
          toolResult: data.result,
          success: data.success as boolean | undefined,
          timestamp,
        })
        // Update matching tool trace with result
        for (let i = toolTraces.length - 1; i >= 0; i--) {
          if (toolTraces[i].toolName === toolName && toolTraces[i].toolResult === undefined) {
            toolTraces[i].toolResult = data.result
            toolTraces[i].success = data.success as boolean | undefined
            break
          }
        }
        break
      }
      case 'file_change': {
        activityEvents.push({
          type: 'file_change',
          path: (data.path as string) || '',
          action: (data.action as string) || 'modify',
          linesAdded: data.linesAdded as number | undefined,
          linesRemoved: data.linesRemoved as number | undefined,
          diff: data.diff as string | undefined,
          timestamp,
        })
        fileChanges.push({
          path: (data.path as string) || '',
          action: (data.action as string) || 'modify',
          linesAdded: data.linesAdded as number | undefined,
          linesRemoved: data.linesRemoved as number | undefined,
          diff: data.diff as string | undefined,
          timestamp,
        })
        break
      }
      case 'session_init': {
        sessionId = (data.sessionId as string) || undefined
        model = (data.model as string) || undefined
        break
      }
      case 'progress': {
        progress = (data.progress as number) ?? undefined
        progressMessage = (data.message as string) || undefined
        break
      }
      case 'plan_result': {
        const nodes = data.nodes as Record<string, unknown>[] | undefined
        if (nodes && Array.isArray(nodes)) {
          planResult = {
            projectName: (data.projectName as string) || undefined,
            nodes,
            edges: (data.edges as Record<string, unknown>[]) || [],
          }
        }
        break
      }
      case 'result': {
        status = (data.status as string) || undefined
        output = (data.output as string) || undefined
        error = (data.error as string) || undefined
        branchName = (data.branchName as string) || undefined
        prUrl = (data.prUrl as string) || undefined
        prNumber = (data.prNumber as number) || undefined
        deliveryStatus = (data.deliveryStatus as string) || undefined
        summary = (data.summary as string) || undefined
        break
      }
      case 'approval_request': {
        const requestId = (data.requestId as string) || ''
        approvalRequests.set(requestId, {
          executionId: event.executionId,
          requestId,
          question: (data.question as string) || '',
          options: (data.options as string[]) || [],
          machineId: (data.machineId as string) || undefined,
          timestamp,
        })
        activityEvents.push({
          type: 'approval_request' as const,
          requestId,
          question: (data.question as string) || '',
          options: (data.options as string[]) || [],
          timestamp,
        })
        break
      }
      case 'steer_message': {
        activityEvents.push({
          type: 'chat_user',
          message: (data.message as string) || '',
          timestamp,
        })
        break
      }
      case 'approval_response': {
        const requestId = (data.requestId as string) || ''
        answeredApprovals.add(requestId)
        // Look up the original question from the approval request
        const originalRequest = approvalRequests.get(requestId)
        activityEvents.push({
          type: 'approval_response' as const,
          requestId,
          question: originalRequest?.question || '',
          answer: (data.answer as string) || '',
          timestamp,
        })
        break
      }
    }
  }

  // Only include approvals that haven't been answered yet
  const pendingApprovals = Array.from(approvalRequests.values())
    .filter(a => !answeredApprovals.has(a.requestId))

  return { stdout, activityEvents, toolTraces, fileChanges, pendingApprovals, status, output, error, sessionId, model, progress, progressMessage, branchName, prUrl, prNumber, deliveryStatus, summary, planResult }
}
