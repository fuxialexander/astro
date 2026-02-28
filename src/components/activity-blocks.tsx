/**
 * Reusable activity event display blocks.
 *
 * Extracted from unified-activity-view.tsx so the plan session chat
 * and task detail views can share the same rendering components.
 */

import React, { useState } from "react"
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { TaskActivityEvent, ExecutionSummary } from "@/types"
import { StreamingMarkdown } from "@/components/ui/streaming-markdown"

// ─── Types ──────────────────────────────────────────────────────────

export interface DisplayBlock {
  type: 'text' | 'tool' | 'tool_group' | 'steer' | 'file_change' | 'error' | 'chat_user' | 'chat_assistant' | 'approval_request' | 'approval_response' | 'mutation'
  events: TaskActivityEvent[]
}

// ─── Grouping ───────────────────────────────────────────────────────

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

    for (const useEvent of useEvents) {
      const pair: TaskActivityEvent[] = [useEvent]
      const resultEvent = currentToolEvents.find(
        e => e.type === 'tool_result' && e.id === useEvent.id
      )
      if (resultEvent) pair.push(resultEvent)
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
      case 'tool_result':
        flushText()
        currentToolEvents.push(event)
        break
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
    }
  }

  flushText()
  flushTools()
  return blocks
}

// ─── Helpers ────────────────────────────────────────────────────────

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

  for (const toolUse of useEvents) {
    const toolResult = events.find(
      (e): e is Extract<TaskActivityEvent, { type: 'tool_result' }> =>
        e.type === 'tool_result' && e.id === toolUse.id
    )
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
