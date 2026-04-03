/**
 * ToolBlockRow — collapsible tool_use / tool_result display.
 *
 * Matches the main frontend's compact style: collapsed by default,
 * shows tool name + status icon on the header row.
 */
import { useState } from 'react'
import { ChevronRight, ChevronDown, Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import type { ToolBlock } from '@desktop/stores/chat-store'

interface ToolBlockRowProps {
  block: ToolBlock
}

export function ToolBlockRow({ block }: ToolBlockRowProps) {
  const [expanded, setExpanded] = useState(false)
  const isResult = block.type === 'tool_result'

  const { colorClass, Icon } = getToolStatus(isResult, block.isError)

  return (
    <div className="my-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-muted/30 rounded transition-colors cursor-pointer group"
      >
        <div className={cn('flex h-3.5 w-3.5 items-center justify-center shrink-0', colorClass)}>
          <Icon className="w-3 h-3" />
        </div>
        <span className="text-[11px] font-mono shrink-0 text-muted-foreground">{block.toolName}</span>
        {block.input != null && (
          <span className="text-[10px] font-mono truncate text-muted-foreground/60">
            {getInputSummary(block.toolName, block.input)}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 ml-5 mr-2 px-2 py-1.5 rounded-md bg-muted/30 border-l-2 border-muted-foreground/20 flex flex-col gap-1.5">
          {block.input != null && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Input</p>
              <pre
                className="p-2 bg-background rounded text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words"
                data-selectable
              >
                {formatUnknown(block.input)}
              </pre>
            </div>
          )}
          {block.output && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Result</p>
              <pre
                className={cn(
                  'p-2 rounded text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto',
                  block.isError ? 'bg-error/10 text-error' : 'bg-background',
                )}
                data-selectable
              >
                {block.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function getToolStatus(isResult: boolean, isError?: boolean) {
  if (!isResult) {
    // tool_use with no result yet — running
    return { colorClass: 'text-primary', Icon: Wrench }
  }
  if (isError) {
    return { colorClass: 'text-destructive', Icon: XCircle }
  }
  return { colorClass: 'text-green-600', Icon: CheckCircle2 }
}

function getInputSummary(toolName: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const obj = input as Record<string, unknown>

  // Common patterns from Claude tool use
  if (obj.command && typeof obj.command === 'string') return obj.command.slice(0, 80)
  if (obj.file_path && typeof obj.file_path === 'string') return obj.file_path
  if (obj.path && typeof obj.path === 'string') return obj.path
  if (obj.pattern && typeof obj.pattern === 'string') return obj.pattern
  if (obj.query && typeof obj.query === 'string') return obj.query.slice(0, 60)
  if (obj.url && typeof obj.url === 'string') return obj.url.slice(0, 60)

  return ''
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
