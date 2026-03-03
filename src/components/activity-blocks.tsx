/**
 * Reusable activity event display blocks.
 *
 * Extracted from unified-activity-view.tsx so the plan session chat
 * and task detail views can share the same rendering components.
 */

import React, { useState, useCallback } from "react"
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  FileEdit,
  AlertCircle,
  Plus,
  Minus,
  Pencil,
  GitBranch,
  PlusCircle,
  MessageSquare,
  Send,
  ExternalLink,
  FileCode,
  ShieldCheck,
  ShieldAlert,
  MessageCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { TaskActivityEvent, ExecutionSummary } from "@/types"
import { StreamingMarkdown } from "@/components/ui/streaming-markdown"
import type { GitHubReviewThread } from "@/types"

// ─── Types ──────────────────────────────────────────────────────────

export interface DisplayBlock {
  type: 'text' | 'tool' | 'tool_group' | 'steer' | 'file_change' | 'error' | 'chat_user' | 'chat_assistant' | 'approval_request' | 'approval_response' | 'mutation' | 'github_comment' | 'github_review'
  events: TaskActivityEvent[]
}

// ─── Grouping ───────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function groupActivityEvents(events: TaskActivityEvent[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = []
  let currentTextEvents: TaskActivityEvent[] = []
  let currentToolEvents: TaskActivityEvent[] = []

  function flushText() {
    if (currentTextEvents.length > 0) {
      blocks.push({ type: 'text', events: [...currentTextEvents] })
      currentTextEvents = []
    }
  }

  function flushTools() {
    if (currentToolEvents.length === 0) return

    // Group tool_use and tool_result pairs
    const toolPairs: TaskActivityEvent[][] = []
    const useEvents = currentToolEvents.filter((e): e is Extract<TaskActivityEvent, { type: 'tool_use' }> => e.type === 'tool_use')

    const pairedResultIds = new Set<string>()
    for (const useEvent of useEvents) {
      const pair: TaskActivityEvent[] = [useEvent]
      // Match by exact ID first, then fall back to toolName (handles hydrated events
      // where tool_use and tool_result get different sequential IDs)
      let resultEvent = currentToolEvents.find(
        e => e.type === 'tool_result' && e.id === useEvent.id && !pairedResultIds.has(String(e.id))
      )
      if (!resultEvent && 'toolName' in useEvent) {
        resultEvent = currentToolEvents.find(
          e => e.type === 'tool_result' && 'toolName' in e && e.toolName === useEvent.toolName && !pairedResultIds.has(String(e.id))
        )
      }
      if (resultEvent && 'id' in resultEvent) {
        pair.push(resultEvent)
        pairedResultIds.add(String(resultEvent.id))
      }
      toolPairs.push(pair)
    }

    // If more than 1 tool, create a tool_group, otherwise individual tool blocks
    if (toolPairs.length > 1) {
      blocks.push({ type: 'tool_group', events: currentToolEvents })
    } else {
      for (const pair of toolPairs) {
        blocks.push({ type: 'tool', events: pair })
      }
    }

    currentToolEvents = []
  }

  for (const event of events) {
    switch (event.type) {
      case 'text':
        flushTools()
        currentTextEvents.push(event)
        break
      case 'tool_use':
        flushText()
        currentToolEvents.push(event)
        break
      case 'tool_result': {
        flushText()
        // If the matching tool_use was already flushed into a previous block,
        // inject this result into that block instead of the current batch.
        // This handles the common case where text events arrive between
        // tool_use and tool_result, causing them to be in different blocks.
        const resultEvent = event as Extract<TaskActivityEvent, { type: 'tool_result' }>
        const matchingBlock = [...blocks].reverse().find(b =>
          (b.type === 'tool' || b.type === 'tool_group') &&
          b.events.some(e => e.type === 'tool_use' && (
            e.id === resultEvent.id ||
            ('toolName' in e && e.toolName === resultEvent.toolName &&
              !b.events.some(r => r.type === 'tool_result' && r.id === e.id))
          ))
        )
        if (matchingBlock) {
          matchingBlock.events.push(event)
        } else {
          currentToolEvents.push(event)
        }
        break
      }
      case 'steer':
        flushText()
        flushTools()
        blocks.push({ type: 'steer', events: [event] })
        break
      case 'file_change':
        flushText()
        flushTools()
        blocks.push({ type: 'file_change', events: [event] })
        break
      case 'error':
        flushText()
        flushTools()
        blocks.push({ type: 'error', events: [event] })
        break
      case 'chat_user':
        flushText()
        flushTools()
        blocks.push({ type: 'chat_user', events: [event] })
        break
      case 'chat_assistant':
        flushText()
        flushTools()
        blocks.push({ type: 'chat_assistant', events: [event] })
        break
      case 'approval_request':
        flushText()
        flushTools()
        blocks.push({ type: 'approval_request', events: [event] })
        break
      case 'approval_response':
        flushText()
        flushTools()
        blocks.push({ type: 'approval_response', events: [event] })
        break
      case 'mutation':
        flushText()
        flushTools()
        blocks.push({ type: 'mutation', events: [event] })
        break
      case 'github_comment':
        flushText()
        flushTools()
        blocks.push({ type: 'github_comment', events: [event] })
        break
      case 'github_review':
        flushText()
        flushTools()
        blocks.push({ type: 'github_review', events: [event] })
        break
    }
  }

  flushText()
  flushTools()
  return blocks
}

// ─── Helpers ────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function getToolInputSummary(toolName: string, toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== 'object') return null
  const input = toolInput as Record<string, unknown>

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit': {
      const fp = input.file_path
      if (typeof fp === 'string') {
        const segments = fp.split('/')
        return segments.slice(-2).join('/')
      }
      return null
    }
    case 'Glob': {
      const pattern = input.pattern
      return typeof pattern === 'string' ? pattern : null
    }
    case 'Grep': {
      const pattern = input.pattern
      return typeof pattern === 'string' ? `/${pattern}/` : null
    }
    case 'Bash': {
      const cmd = input.command
      return typeof cmd === 'string' ? cmd.slice(0, 60) : null
    }
    case 'Task': {
      const desc = input.description
      return typeof desc === 'string' ? desc : null
    }
    case 'WebFetch': {
      const url = input.url
      return typeof url === 'string' ? url : null
    }
    default:
      return null
  }
}

/**
 * Compute the status of a tool call for icon rendering.
 *
 * A tool call is "complete" when either:
 * 1. Its tool_result event has been paired (proper completion), OR
 * 2. The task has stopped running (no more results will ever arrive)
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getToolStatus(hasResult: boolean, isRunning: boolean, success?: boolean) {
  const isComplete = hasResult || !isRunning

  const colorClass = success === false
    ? "text-muted-foreground"
    : success === true
      ? "text-success"
      : isComplete
        ? "text-muted-foreground"
        : "text-info"

  let icon: 'spinner' | 'check' | 'x' | 'check-muted'
  if (!isComplete) {
    icon = 'spinner'
  } else if (success === true) {
    icon = 'check'
  } else if (success === false) {
    icon = 'x'
  } else {
    icon = 'check-muted'
  }

  return { isComplete, colorClass, icon }
}

export function ToolStatusIcon({ icon }: { icon: 'spinner' | 'check' | 'x' | 'check-muted' }) {
  switch (icon) {
    case 'spinner':
      return <Loader2 className="h-3 w-3 animate-spin" />
    case 'check':
      return <CheckCircle2 className="h-3 w-3" />
    case 'x':
      return <XCircle className="h-3 w-3" />
    case 'check-muted':
      return <CheckCircle2 className="h-3 w-3" />
  }
}

// ─── Block Components ───────────────────────────────────────────────

export function TextBlock({ events, isStreaming, onLinkClick, preprocessContent }: { events: TaskActivityEvent[]; isStreaming?: boolean; onLinkClick?: (href: string, e: React.MouseEvent) => boolean | void; preprocessContent?: (text: string) => string }) {
  let text = events
    .filter((e): e is Extract<TaskActivityEvent, { type: 'text' }> => e.type === 'text')
    .map(e => e.content)
    .join('')

  if (!text) return null
  if (preprocessContent) text = preprocessContent(text)

  return (
    <div className="px-4 py-1">
      <StreamingMarkdown content={text} isStreaming={isStreaming} className="text-xs leading-relaxed" onLinkClick={onLinkClick} />
    </div>
  )
}

export function ToolBlock({ events, isRunning }: { events: TaskActivityEvent[]; isRunning?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const toolUse = events.find((e): e is Extract<TaskActivityEvent, { type: 'tool_use' }> => e.type === 'tool_use')
  const toolResult = events.find((e): e is Extract<TaskActivityEvent, { type: 'tool_result' }> => e.type === 'tool_result')

  if (!toolUse) return null

  const hasResult = toolResult !== undefined
  const { colorClass, icon } = getToolStatus(hasResult, !!isRunning, toolResult?.success)

  return (
    <div className="mx-4 my-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-muted/30 rounded transition-colors cursor-pointer group"
      >
        <div className={cn("flex h-3.5 w-3.5 items-center justify-center shrink-0", colorClass)}>
          <ToolStatusIcon icon={icon} />
        </div>
        <span className="text-[11px] font-mono shrink-0 text-muted-foreground">{toolUse.toolName}</span>
        {(() => {
          const inputSummary = getToolInputSummary(toolUse.toolName, toolUse.toolInput)
          return inputSummary ? <span className="text-[10px] font-mono truncate text-muted-foreground/60">{inputSummary}</span> : null
        })()}
        {toolResult?.duration != null && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
            {toolResult.duration}ms
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 ml-5 mr-2 px-2 py-1.5 rounded-md bg-muted/30 border-l-2 border-muted-foreground/20 flex flex-col gap-1.5">
          {toolUse.toolInput != null && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Input</p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/80 max-h-[150px] overflow-auto">
                {typeof toolUse.toolInput === "string"
                  ? toolUse.toolInput
                  : JSON.stringify(toolUse.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {toolResult?.toolResult != null && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Result</p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/80 max-h-[150px] overflow-auto">
                {typeof toolResult.toolResult === "string"
                  ? toolResult.toolResult
                  : JSON.stringify(toolResult.toolResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolGroupBlock({ events, isRunning }: { events: TaskActivityEvent[]; isRunning?: boolean }) {
  const [expanded, setExpanded] = useState(false)

  const toolPairs: Array<{
    toolUse: Extract<TaskActivityEvent, { type: 'tool_use' }>
    toolResult?: Extract<TaskActivityEvent, { type: 'tool_result' }>
  }> = []

  const useEvents = events.filter((e): e is Extract<TaskActivityEvent, { type: 'tool_use' }> => e.type === 'tool_use')
  const pairedResultIds = new Set<string>()

  for (const toolUse of useEvents) {
    // Match by exact ID first, then fall back to toolName
    let toolResult = events.find(
      (e): e is Extract<TaskActivityEvent, { type: 'tool_result' }> =>
        e.type === 'tool_result' && e.id === toolUse.id && !pairedResultIds.has(e.id)
    )
    if (!toolResult) {
      toolResult = events.find(
        (e): e is Extract<TaskActivityEvent, { type: 'tool_result' }> =>
          e.type === 'tool_result' && e.toolName === toolUse.toolName && !pairedResultIds.has(e.id)
      )
    }
    if (toolResult) pairedResultIds.add(toolResult.id)
    toolPairs.push({ toolUse, toolResult })
  }

  if (toolPairs.length === 0) return null

  return (
    <div className="mx-4 my-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-muted/30 rounded transition-colors cursor-pointer group"
      >
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {toolPairs.map((pair, idx) => {
            const hasResult = pair.toolResult !== undefined
            const status = getToolStatus(hasResult, !!isRunning, pair.toolResult?.success)

            return (
              <div
                key={idx}
                className={cn("flex h-3.5 w-3.5 items-center justify-center shrink-0", status.colorClass)}
                title={pair.toolUse.toolName}
              >
                <ToolStatusIcon icon={status.icon} />
              </div>
            )
          })}
          <span className="text-[11px] font-mono text-muted-foreground ml-1">
            {toolPairs.length} tools
          </span>
        </div>

        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 ml-2 mr-2 flex flex-col gap-1">
          {toolPairs.map((pair, idx) => {
            const hasResult = pair.toolResult !== undefined
            const status = getToolStatus(hasResult, !!isRunning, pair.toolResult?.success)

            return (
              <div key={idx} className="border-l-2 border-muted-foreground/20 pl-3">
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <div className={cn("flex h-3.5 w-3.5 items-center justify-center shrink-0", status.colorClass)}>
                    <ToolStatusIcon icon={status.icon} />
                  </div>
                  <span className="text-[11px] font-mono shrink-0 text-muted-foreground">
                    {pair.toolUse.toolName}
                  </span>
                  {(() => {
                    const inputSummary = getToolInputSummary(pair.toolUse.toolName, pair.toolUse.toolInput)
                    return inputSummary ? <span className="text-[10px] font-mono truncate text-muted-foreground/60">{inputSummary}</span> : null
                  })()}
                  {pair.toolResult?.duration != null && (
                    <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
                      {pair.toolResult.duration}ms
                    </span>
                  )}
                </div>

                <div className="px-2 py-1.5 rounded-md bg-muted/30 flex flex-col gap-1.5 text-xs">
                  {pair.toolUse.toolInput != null && (
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Input</p>
                      <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/80 max-h-[150px] overflow-auto">
                        {typeof pair.toolUse.toolInput === "string"
                          ? pair.toolUse.toolInput
                          : JSON.stringify(pair.toolUse.toolInput, null, 2)}
                      </pre>
                    </div>
                  )}
                  {pair.toolResult?.toolResult != null && (
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Result</p>
                      <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/80 max-h-[150px] overflow-auto">
                        {typeof pair.toolResult.toolResult === "string"
                          ? pair.toolResult.toolResult
                          : JSON.stringify(pair.toolResult.toolResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SteerBlock({ event }: { event: Extract<TaskActivityEvent, { type: 'steer' }> }) {
  // SteerBlock now only renders for failed/rejected steers.
  // Accepted steers are emitted as chat_user events and rendered by ChatUserBlock.
  return (
    <div className="flex flex-col items-end gap-1 px-4 py-1.5">
      <div className="rounded-lg px-3 py-2 text-sm max-w-[80%] bg-error/20 text-foreground border border-error/30">
        <p className="whitespace-pre-wrap">{event.message}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <XCircle className="h-3 w-3 text-error" />
        <span className="text-[10px] text-error">{event.ackMessage || "Failed to send"}</span>
      </div>
    </div>
  )
}

export function FileChangeBlock({ event }: { event: Extract<TaskActivityEvent, { type: 'file_change' }> }) {
  const filename = event.path.split('/').pop() || event.path

  return (
    <div className="flex items-center gap-2 mx-4 my-1 px-3 py-1.5 rounded-md bg-muted/50 text-xs text-muted-foreground">
      <FileEdit className="h-3 w-3 shrink-0" />
      <span className="font-medium text-foreground">{filename}</span>
      <span className="truncate">{event.path}</span>
      {event.linesAdded != null && event.linesAdded > 0 && (
        <span className="flex items-center gap-0.5 text-success font-mono shrink-0">
          <Plus className="h-2.5 w-2.5" />{event.linesAdded}
        </span>
      )}
      {event.linesRemoved != null && event.linesRemoved > 0 && (
        <span className="flex items-center gap-0.5 text-error font-mono shrink-0">
          <Minus className="h-2.5 w-2.5" />{event.linesRemoved}
        </span>
      )}
    </div>
  )
}

export function SummaryCard({ summary }: { summary: ExecutionSummary }) {
  const statusColor = summary.status === 'success'
    ? 'border-success/30 bg-success/5'
    : summary.status === 'partial'
      ? 'border-warning/30 bg-warning/5'
      : 'border-error/30 bg-error/5'

  const statusBadge = summary.status === 'success'
    ? 'bg-success/10 text-success'
    : summary.status === 'partial'
      ? 'bg-warning/10 text-warning'
      : 'bg-error/10 text-error'

  return (
    <div className={cn("mx-4 my-2 rounded-lg border p-3", statusColor)}>
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold">Summary</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", statusBadge)}>
              {summary.status}
            </span>
            {summary.filesChanged.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {summary.filesChanged.length} file{summary.filesChanged.length !== 1 ? 's' : ''} changed
              </span>
            )}
          </div>
          <p className="text-sm text-foreground leading-relaxed">{summary.workCompleted}</p>
          {summary.followUps.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Follow-ups</span>
              <ul className="mt-0.5">
                {summary.followUps.map((f, i) => (
                  <li key={i} className="text-xs text-muted-foreground">- {f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function ErrorBlock({ event }: { event: Extract<TaskActivityEvent, { type: 'error' }> }) {
  return (
    <div className="flex items-start gap-2 mx-4 my-1.5 px-3 py-2 rounded-md bg-error/10 border border-error/20 text-sm text-error">
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
      <pre className="font-mono text-xs whitespace-pre-wrap break-all">{event.error}</pre>
    </div>
  )
}

export function ChatUserBlock({ event }: { event: Extract<TaskActivityEvent, { type: 'chat_user' }> }) {
  return (
    <div className="flex flex-col items-end gap-1 px-4 py-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">You</span>
      <div className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground max-w-[80%]">
        <p className="whitespace-pre-wrap">{event.message}</p>
      </div>
    </div>
  )
}

export function ChatAssistantBlock({ event, isStreaming, onLinkClick }: { event: Extract<TaskActivityEvent, { type: 'chat_assistant' }>; isStreaming?: boolean; onLinkClick?: (href: string, e: React.MouseEvent) => boolean | void }) {
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Claude</span>
      <div className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground max-w-[90%]">
        <StreamingMarkdown content={event.content} isStreaming={isStreaming} className="text-xs leading-relaxed" onLinkClick={onLinkClick} />
      </div>
    </div>
  )
}

export function MutationBlock({
  event,
  getNodeTitle,
  onNodeSelect,
}: {
  event: Extract<TaskActivityEvent, { type: 'mutation' }>
  getNodeTitle?: (nodeId: string) => string
  onNodeSelect?: (nodeId: string) => void
}) {
  const { nodeUpdates, edgeOps, newNodes } = event
  const hasContent = nodeUpdates.length > 0 || edgeOps.length > 0 || newNodes.length > 0

  if (!hasContent) return null

  return (
    <div className="mx-4 my-1.5 space-y-1">
      {nodeUpdates.map((update, i) => {
        const { nodeId, ...fields } = update
        const title = getNodeTitle?.(nodeId) || nodeId.slice(0, 8)
        const fieldEntries = Object.entries(fields).filter(([k]) => k !== 'nodeId')
        return (
          <div key={`upd-${i}`} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 text-xs">
            <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
            <button
              className={cn("font-medium truncate", onNodeSelect ? "text-primary hover:underline cursor-pointer" : "text-foreground")}
              onClick={() => onNodeSelect?.(nodeId)}
              disabled={!onNodeSelect}
            >
              {title}
            </button>
            <span className="text-muted-foreground truncate">
              {fieldEntries.map(([k, v]) => `${k}\u2192${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')}
            </span>
            <CheckCircle2 className="h-3 w-3 text-success shrink-0 ml-auto" />
          </div>
        )
      })}
      {edgeOps.map((op, i) => (
        <div key={`edge-${i}`} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 text-xs">
          <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">
            {op.action === 'add' ? 'Added' : 'Removed'} edge: {getNodeTitle?.(op.source) || op.source.slice(0, 8)} &rarr; {getNodeTitle?.(op.target) || op.target.slice(0, 8)}
          </span>
        </div>
      ))}
      {newNodes.map((node, i) => (
        <div key={`new-${i}`} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 text-xs">
          <PlusCircle className="h-3 w-3 text-success shrink-0" />
          <span className="font-medium text-foreground">{node.title}</span>
          {node.type && <span className="text-muted-foreground">({node.type})</span>}
        </div>
      ))}
    </div>
  )
}

// ─── GitHub Comment Block ──────────────────────────────────────────

export function GitHubCommentBlock({
  event,
  onReply,
  isGitHubConnected = true,
}: {
  event: Extract<TaskActivityEvent, { type: 'github_comment' }>
  onReply?: (body: string) => Promise<void>
  isGitHubConnected?: boolean
}) {
  const [showReply, setShowReply] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  const handleSubmitReply = useCallback(async () => {
    if (!replyText.trim() || sending || !onReply) return
    setSending(true)
    try {
      await onReply(replyText.trim())
      setReplyText('')
      setShowReply(false)
    } catch (err) {
      console.error('Failed to post reply:', err)
    } finally {
      setSending(false)
    }
  }, [replyText, sending, onReply])

  const timeAgo = formatTimeAgo(event.createdAt)

  return (
    <div className="mx-4 my-1.5">
      <div className="rounded-lg border border-border bg-card">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
          {event.authorAvatarUrl ? (
            <img src={event.authorAvatarUrl} alt={event.author} className="h-5 w-5 rounded-full" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium">
              {event.author[0]?.toUpperCase()}
            </div>
          )}
          <span className="text-xs font-medium text-foreground">{event.author}</span>
          <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
          {event.isPrReview && (
            <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded font-medium text-muted-foreground">
              review
            </span>
          )}
          <div className="flex-1" />
          <a
            href={event.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            <span>GitHub</span>
          </a>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          <StreamingMarkdown content={event.body} className="text-xs leading-relaxed" />
        </div>

        {/* File context for review comments */}
        {event.path && (
          <div className="px-3 pb-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <FileCode className="h-3 w-3" />
            <span className="font-mono">{event.path}</span>
            {event.line && <span>:{event.line}</span>}
          </div>
        )}

        {/* Reply section */}
        {onReply && isGitHubConnected && (
          <div className="px-3 pb-2">
            {!showReply ? (
              <button
                onClick={() => setShowReply(true)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <MessageSquare className="h-3 w-3" />
                Reply
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  rows={3}
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleSubmitReply()
                    }
                    if (e.key === 'Escape') {
                      setShowReply(false)
                      setReplyText('')
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Cmd+Enter to send</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowReply(false); setReplyText('') }}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitReply}
                      disabled={!replyText.trim() || sending}
                      className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Connect GitHub prompt */}
        {onReply && !isGitHubConnected && (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              <a href="/settings" className="text-primary hover:underline">
                Connect GitHub to reply
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── GitHub Review Block ──────────────────────────────────────────

export function GitHubReviewBlock({
  event,
}: {
  event: Extract<TaskActivityEvent, { type: 'github_review' }>
}) {
  const stateConfig = {
    APPROVED: { icon: ShieldCheck, label: 'Approved', className: 'text-success bg-success/10 border-success/30' },
    CHANGES_REQUESTED: { icon: ShieldAlert, label: 'Changes requested', className: 'text-warning bg-warning/10 border-warning/30' },
    COMMENTED: { icon: MessageCircle, label: 'Commented', className: 'text-muted-foreground bg-muted/50 border-border' },
    DISMISSED: { icon: XCircle, label: 'Dismissed', className: 'text-muted-foreground bg-muted/50 border-border' },
    PENDING: { icon: Loader2, label: 'Pending', className: 'text-muted-foreground bg-muted/50 border-border' },
  }

  const config = stateConfig[event.state] || stateConfig.COMMENTED
  const Icon = config.icon
  const timeAgo = formatTimeAgo(event.submittedAt)

  return (
    <div className="mx-4 my-1.5">
      <div className={cn("rounded-lg border px-3 py-2", config.className)}>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" />
          {event.authorAvatarUrl ? (
            <img src={event.authorAvatarUrl} alt={event.author} className="h-4 w-4 rounded-full" />
          ) : (
            <div className="h-4 w-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium">
              {event.author[0]?.toUpperCase()}
            </div>
          )}
          <span className="text-xs font-medium">{event.author}</span>
          <span className="text-xs">{config.label}</span>
          <span className="text-[10px] opacity-70">{timeAgo}</span>
          <div className="flex-1" />
          <a
            href={event.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] opacity-70 hover:opacity-100"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {event.body && (
          <div className="mt-1.5 ml-6">
            <StreamingMarkdown content={event.body} className="text-xs leading-relaxed opacity-90" />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PR Review Thread Component ───────────────────────────────────

export function PrReviewThreadBlock({
  thread,
  onReply,
  isGitHubConnected = true,
}: {
  thread: GitHubReviewThread
  onReply?: (commentId: number, body: string) => Promise<void>
  isGitHubConnected?: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [showReply, setShowReply] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  const rootComment = thread.comments[0]
  const lastCommentId = thread.comments[thread.comments.length - 1]?.id ?? rootComment?.id ?? 0
  const filename = thread.path.split('/').pop() || thread.path

  const handleSubmitReply = useCallback(async () => {
    if (!replyText.trim() || sending || !onReply || !lastCommentId) return
    setSending(true)
    try {
      await onReply(lastCommentId, replyText.trim())
      setReplyText('')
      setShowReply(false)
    } catch (err) {
      console.error('Failed to reply to thread:', err)
    } finally {
      setSending(false)
    }
  }, [replyText, sending, onReply, lastCommentId])

  if (!rootComment) return null

  return (
    <div className="mx-4 my-1.5">
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {/* File path header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/30 transition-colors"
        >
          <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-mono text-foreground">{filename}</span>
          <span className="text-[10px] font-mono text-muted-foreground truncate">{thread.path}</span>
          {thread.line && (
            <span className="text-[10px] font-mono text-muted-foreground">:{thread.line}</span>
          )}
          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground">{thread.comments.length} comment{thread.comments.length !== 1 ? 's' : ''}</span>
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground/50" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          )}
        </button>

        {expanded && (
          <>
            {/* Diff hunk */}
            {thread.diffHunk && (
              <div className="border-t border-b border-border/50 bg-muted/20">
                <pre className="px-3 py-1.5 text-[10px] font-mono leading-relaxed text-muted-foreground overflow-x-auto max-h-[120px]">
                  {thread.diffHunk}
                </pre>
              </div>
            )}

            {/* Comments */}
            <div className="divide-y divide-border/30">
              {thread.comments.map((comment) => (
                <div key={comment.id} className="px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    {comment.authorAvatarUrl ? (
                      <img src={comment.authorAvatarUrl} alt={comment.author} className="h-4 w-4 rounded-full" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium">
                        {comment.author[0]?.toUpperCase()}
                      </div>
                    )}
                    <span className="text-[11px] font-medium text-foreground">{comment.author}</span>
                    <span className="text-[10px] text-muted-foreground">{formatTimeAgo(comment.createdAt)}</span>
                    <div className="flex-1" />
                    <a
                      href={comment.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                  <div className="ml-6">
                    <StreamingMarkdown content={comment.body} className="text-xs leading-relaxed" />
                  </div>
                </div>
              ))}
            </div>

            {/* Reply input */}
            {onReply && isGitHubConnected && (
              <div className="px-3 py-2 border-t border-border/30">
                {!showReply ? (
                  <button
                    onClick={() => setShowReply(true)}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <MessageSquare className="h-3 w-3" />
                    Reply
                  </button>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write a reply..."
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          handleSubmitReply()
                        }
                        if (e.key === 'Escape') {
                          setShowReply(false)
                          setReplyText('')
                        }
                      }}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setShowReply(false); setReplyText('') }}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSubmitReply}
                        disabled={!replyText.trim() || sending}
                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Reply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {onReply && !isGitHubConnected && (
              <div className="px-3 py-2 border-t border-border/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <MessageSquare className="h-3 w-3" />
                  <a href="/settings" className="text-primary hover:underline">
                    Connect GitHub to reply
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function formatTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then

  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  if (diffMs < 604_800_000) return `${Math.floor(diffMs / 86_400_000)}d ago`
  return new Date(dateStr).toLocaleDateString()
}
