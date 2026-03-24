/**
 * ToolBlock — collapsible display of a tool_use or tool_result event.
 */
import { useState } from 'react'
import { ChevronRight, Wrench, CheckCircle, XCircle } from 'lucide-react'
import { cn } from '@desktop/lib/utils'
import type { ToolBlock as ToolBlockType } from '@desktop/stores/chat-store'

interface ToolBlockProps {
  block: ToolBlockType
}

export function ToolBlock({ block }: ToolBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const isResult = block.type === 'tool_result'

  return (
    <div
      className={cn(
        'rounded-lg border text-xs',
        block.isError ? 'border-error/30 bg-error/5' : 'border-border bg-muted/30',
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 w-full px-3 py-2 text-left',
          'hover:bg-muted/50 transition-colors duration-100 rounded-lg',
        )}
      >
        <ChevronRight
          className={cn(
            'w-3 h-3 text-muted-foreground transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        {isResult ? (
          block.isError ? (
            <XCircle className="w-3.5 h-3.5 text-error flex-shrink-0" />
          ) : (
            <CheckCircle className="w-3.5 h-3.5 text-success flex-shrink-0" />
          )
        ) : (
          <Wrench className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        )}
        <span className="font-mono text-foreground truncate">{block.toolName}</span>
        <span className="text-muted-foreground ml-auto flex-shrink-0">
          {isResult ? 'result' : 'call'}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50">
          {block.input != null && (
            <div className="mb-2">
              <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
                Input
              </span>
              <pre
                className="mt-1 p-2 bg-background rounded text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words"
                data-selectable
              >
                {formatUnknown(block.input)}
              </pre>
            </div>
          )}
          {block.output && (
            <div>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
                Output
              </span>
              <pre
                className={cn(
                  'mt-1 p-2 rounded text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words',
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

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
