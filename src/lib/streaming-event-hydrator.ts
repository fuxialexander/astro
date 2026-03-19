/**
 * Streaming Event Hydrator
 *
 * Converts raw streaming_events rows into TaskStream-compatible data.
 * Streaming events are already in the same format as SSE events,
 * making hydration straightforward.
 */

import type { TaskActivityEvent } from '@/types'
import type { StreamingEventRow } from '@/lib/api-client'
import type { PlanJsonResult } from '@astro/core'

/**
 * Extract the correct string data from a streaming event DB row.
 *
 * Text events are stored as `{ text: "..." }` objects in the DB.
 * Live SSE handlers expect a plain string for text events.
 * This utility normalizes the format so ALL catch-up/replay paths
 * produce consistent output — preventing `'{"text":"..."}'` corruption.
 */
export function extractStreamingEventData(row: StreamingEventRow): string {
  if (
    row.eventType === 'text' &&
    typeof row.data === 'object' &&
    row.data !== null &&
    'text' in row.data
  ) {
    return (row.data as { text: string }).text
  }
  return typeof row.data === 'string' ? row.data : JSON.stringify(row.data)
}

export interface PendingApproval {
  executionId: string
  requestId: string
  question: string
  options: string[]
  machineId?: string
  timestamp: Date
}

export interface PendingSafetyPrompt {
  executionId: string
  taskId: string
  safetyTier: string
  warning?: string
  machineId?: string
  options: Array<{ id: string; label: string; description?: string }>
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
    seq?: number
  }>
  fileChanges: Array<{
    path: string
    action: string
    linesAdded?: number
    linesRemoved?: number
    diff?: string
    timestamp: Date
    seq?: number
  }>
  // Pending approval requests (not yet answered)
  pendingApprovals: PendingApproval[]
  // Pending safety prompts (not yet responded to)
  pendingSafetyPrompts: PendingSafetyPrompt[]
  // Metadata from init, session_init and result events
  machineId?: string
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
  finalStatus?: string
  summary?: string
  planResult?: PlanJsonResult
}

let idCounter = 0

export function hydrateStreamingEvents(events: StreamingEventRow[]): HydratedStreamData {
  const activityEvents: TaskActivityEvent[] = []
  const toolTraces: HydratedStreamData['toolTraces'] = []
  const fileChanges: HydratedStreamData['fileChanges'] = []
  // Track approval requests and which have been answered
  const approvalRequests = new Map<string, PendingApproval>()
  const answeredApprovals = new Set<string>()
  // Track safety prompts and which have been responded to
  const safetyPromptRequests = new Map<string, PendingSafetyPrompt>()
  const answeredSafetyPrompts = new Set<string>()
  let machineId: string | undefined
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
  let finalStatus: string | undefined
  let summary: string | undefined
  let planResult: HydratedStreamData['planResult']
  // Map toolName → queue of unpaired tool_use IDs for matching with tool_result
  const unpairedToolUseIds = new Map<string, string[]>()

  for (const event of events) {
    const data = event.data as Record<string, unknown>
    const timestamp = new Date(event.createdAt)

    switch (event.eventType) {
      case 'init': {
        machineId = (data.machineId as string) || undefined
        // Emit system_prompt activity event if the init event contains a prompt
        if (data.systemPrompt) {
          activityEvents.push({
            type: 'system_prompt',
            content: data.systemPrompt as string,
            pathwayType: (data.pathwayType as string) || undefined,
            timestamp,
            seq: event.seq,
          })
        }
        break
      }
      case 'text': {
        const text = (data.text as string) || ''
        activityEvents.push({ type: 'text', content: text, timestamp, seq: event.seq })
        break
      }
      case 'tool_use': {
        const toolName = (data.toolName as string) || 'unknown'
        const apiToolUseId = data.toolUseId as string | undefined
        // Use Claude API toolUseId as the ID when available for exact matching
        const id = apiToolUseId || `hydrated-${++idCounter}`
        // Track unpaired tool_use IDs so matching tool_result gets the same ID
        if (!unpairedToolUseIds.has(toolName)) unpairedToolUseIds.set(toolName, [])
        unpairedToolUseIds.get(toolName)!.push(id)
        // Also track by toolUseId for exact matching in tool_result
        if (apiToolUseId) unpairedToolUseIds.set(`__exact__${apiToolUseId}`, [id])
        activityEvents.push({
          type: 'tool_use',
          id,
          toolName,
          toolInput: data.toolInput,
          timestamp,
          seq: event.seq,
        })
        toolTraces.push({
          toolName,
          toolInput: data.toolInput,
          timestamp,
          seq: event.seq,
        })
        break
      }
      case 'tool_result': {
        const toolName = (data.toolName as string) || 'unknown'
        const apiToolUseId = data.toolUseId as string | undefined
        // Match by toolUseId first (exact), then fall back to toolName queue
        let id: string
        const exactMatch = apiToolUseId ? unpairedToolUseIds.get(`__exact__${apiToolUseId}`) : undefined
        if (exactMatch?.length) {
          id = exactMatch.shift()!
          unpairedToolUseIds.delete(`__exact__${apiToolUseId}`)
          // Also remove from toolName queue to keep it consistent
          const nameQueue = unpairedToolUseIds.get(toolName)
          if (nameQueue) {
            const idx = nameQueue.indexOf(id)
            if (idx >= 0) nameQueue.splice(idx, 1)
            if (nameQueue.length === 0) unpairedToolUseIds.delete(toolName)
          }
        } else {
          // Fallback to toolName-based FIFO matching
          const pendingIds = unpairedToolUseIds.get(toolName)
          id = pendingIds?.shift() ?? `hydrated-${++idCounter}`
          if (pendingIds?.length === 0) unpairedToolUseIds.delete(toolName)
        }
        activityEvents.push({
          type: 'tool_result',
          id,
          toolName,
          toolResult: data.result,
          success: data.success as boolean | undefined,
          timestamp,
          seq: event.seq,
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
          seq: event.seq,
        })
        fileChanges.push({
          path: (data.path as string) || '',
          action: (data.action as string) || 'modify',
          linesAdded: data.linesAdded as number | undefined,
          linesRemoved: data.linesRemoved as number | undefined,
          diff: data.diff as string | undefined,
          timestamp,
          seq: event.seq,
        })
        break
      }
      case 'session_init': {
        sessionId = (data.sessionId as string) || undefined
        model = (data.model as string) || undefined
        break
      }
      case 'progress': {
        // dispatch.ts persists progress events as { percentage, message }; hydrator reads both
        // field names for backward compatibility with any events stored as { progress, message }.
        progress = (data.percentage as number) ?? (data.progress as number) ?? undefined
        progressMessage = (data.message as string) || undefined
        break
      }
      case 'plan_result': {
        // Keep only the first plan_result — prevents duplicate graph blocks on SSE replay
        if (!planResult) {
          const nodes = data.nodes as Record<string, unknown>[] | undefined
          if (nodes && Array.isArray(nodes)) {
            planResult = {
              projectName: (data.projectName as string) || undefined,
              nodes,
              edges: (data.edges as Record<string, unknown>[]) || [],
            }
            // Emit plan_result activity event for inline graph rendering
            activityEvents.push({
              type: 'plan_result',
              nodes: nodes.map((n) => ({
                id: (n.id as string) || '',
                title: (n.title as string) || '',
                type: (n.type as string) || 'task',
                status: (n.status as string) || undefined,
              })),
              edges: ((data.edges as Record<string, unknown>[]) || []).map((e) => ({
                source: (e.source as string) || '',
                target: (e.target as string) || '',
              })),
              projectName: (data.projectName as string) || undefined,
              timestamp,
            })
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
        finalStatus = (data.finalStatus as string) || undefined
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
          seq: event.seq,
        })
        break
      }
      case 'steer_message': {
        const steerStatus = (data.status as string) || undefined
        if (steerStatus === 'pending' || steerStatus === 'sent') {
          // Steer still in-flight — show as pending steer with indicator
          activityEvents.push({
            type: 'steer' as const,
            message: (data.message as string) || '',
            accepted: undefined, // pending
            timestamp,
            seq: event.seq,
          })
        } else if (steerStatus === 'timed_out') {
          // Steer was rejected/timed out
          activityEvents.push({
            type: 'steer' as const,
            message: (data.message as string) || '',
            accepted: false,
            ackMessage: 'Timed out',
            timestamp,
            seq: event.seq,
          })
        } else {
          // 'acknowledged' or legacy (no status field) — show as accepted
          activityEvents.push({
            type: 'chat_user',
            message: (data.message as string) || '',
            timestamp,
            seq: event.seq,
          })
        }
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
          seq: event.seq,
        })
        break
      }
      case 'error': {
        error = (data.error as string) || 'Unknown error'
        status = 'error'
        activityEvents.push({
          type: 'error' as const,
          error,
          timestamp,
          seq: event.seq,
        })
        break
      }
      case 'safety_prompt': {
        // Key by executionId (one safety prompt per task at a time)
        safetyPromptRequests.set(event.executionId, {
          executionId: event.executionId,
          taskId: event.executionId,
          safetyTier: (data.safetyTier as string) || '',
          warning: (data.warning as string) || undefined,
          machineId: (data.machineId as string) || undefined,
          options: (data.options as Array<{ id: string; label: string; description?: string }>) || [],
          timestamp,
        })
        break
      }
      case 'safety_response': {
        answeredSafetyPrompts.add(event.executionId)
        break
      }
    }
  }

  // Only include approvals that haven't been answered yet
  const pendingApprovals = Array.from(approvalRequests.values())
    .filter(a => !answeredApprovals.has(a.requestId))

  // Only include safety prompts that haven't been responded to
  const pendingSafetyPrompts = Array.from(safetyPromptRequests.values())
    .filter(s => !answeredSafetyPrompts.has(s.executionId))

  // ── Deduplicate text blocks ──────────────────────────────────────────
  // Text duplication can occur from concurrent flushText() races (before the
  // synchronous-delete fix), SSE reconnect overlaps, or agent SDK retries.
  // Group consecutive text events into "text blocks" (separated by non-text
  // events), hash each block's joined content, and remove blocks whose content
  // was already seen. This preserves legitimate repeated short tokens while
  // eliminating full-paragraph duplication (4-14x repetitions).
  const dedupedActivityEvents = deduplicateTextBlocks(activityEvents)

  // Also rebuild stdout from deduplicated text to stay consistent
  const dedupedStdout = dedupedActivityEvents
    .filter((e): e is typeof e & { type: 'text'; content: string } => e.type === 'text')
    .map(e => e.content)
    .join('')

  return { stdout: dedupedStdout, activityEvents: dedupedActivityEvents, toolTraces, fileChanges, pendingApprovals, pendingSafetyPrompts, machineId, status, output, error, sessionId, model, progress, progressMessage, branchName, prUrl, prNumber, deliveryStatus, finalStatus, summary, planResult }
}

/**
 * Deduplicate text blocks in activity events.
 *
 * Groups consecutive text events into "blocks" (separated by non-text events),
 * joins each block's content, and removes blocks whose joined content was
 * already seen earlier in the stream. Only removes blocks with substantial
 * content (>50 chars) to avoid false positives on short repeated tokens.
 */
function deduplicateTextBlocks(events: TaskActivityEvent[]): TaskActivityEvent[] {
  // 1. Identify text block boundaries
  type Segment =
    | { kind: 'text'; events: TaskActivityEvent[]; content: string }
    | { kind: 'other'; events: TaskActivityEvent[] }

  const segments: Segment[] = []
  let currentTextEvents: TaskActivityEvent[] = []

  function flushText() {
    if (currentTextEvents.length === 0) return
    const content = currentTextEvents
      .filter((e): e is typeof e & { type: 'text'; content: string } => e.type === 'text')
      .map(e => e.content)
      .join('')
    segments.push({ kind: 'text', events: [...currentTextEvents], content })
    currentTextEvents = []
  }

  for (const event of events) {
    if (event.type === 'text') {
      currentTextEvents.push(event)
    } else {
      flushText()
      // Merge consecutive non-text events into one segment for efficiency
      const last = segments[segments.length - 1]
      if (last?.kind === 'other') {
        last.events.push(event)
      } else {
        segments.push({ kind: 'other', events: [event] })
      }
    }
  }
  flushText()

  // 2. Remove duplicate text blocks (keep first occurrence)
  const seenTextContent = new Set<string>()
  const result: TaskActivityEvent[] = []

  for (const seg of segments) {
    if (seg.kind === 'other') {
      result.push(...seg.events)
    } else {
      const trimmed = seg.content.trim()
      // Only deduplicate substantial text blocks — short text like newlines,
      // bullets, or single-word tokens can legitimately repeat.
      if (trimmed.length > 50 && seenTextContent.has(trimmed)) {
        // Skip this duplicate text block
        continue
      }
      if (trimmed.length > 50) {
        seenTextContent.add(trimmed)
      }
      result.push(...seg.events)
    }
  }

  return result
}
