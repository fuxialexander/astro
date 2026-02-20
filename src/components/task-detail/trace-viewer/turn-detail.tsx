import { Badge } from "@/components/ui/badge"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { ToolCallItem } from "./tool-call-item"
import type { GenerationTurn } from "@/types/observations"

interface TurnDetailProps {
  turn: GenerationTurn
}

export function TurnDetail({ turn }: TurnDetailProps) {
  const tokenCount = (turn.inputTokens ?? 0) + (turn.outputTokens ?? 0)

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Turn header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/10 shrink-0">
        <Badge variant="outline" className="text-[10px] tabular-nums">
          Turn {turn.turnIndex + 1}
        </Badge>
        {turn.model && (
          <Badge variant="secondary" className="text-[10px] font-mono">
            {turn.model}
          </Badge>
        )}
        {tokenCount > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {tokenCount.toLocaleString()} tokens
          </span>
        )}
        {turn.inputTokens != null && turn.outputTokens != null && (
          <span className="text-[10px] text-muted-foreground/50 tabular-nums">
            ({turn.inputTokens.toLocaleString()} in / {turn.outputTokens.toLocaleString()} out)
          </span>
        )}
      </div>

      {/* Generation text */}
      {turn.text && (
        <div className="px-4 py-3 border-b border-border">
          <MarkdownRenderer content={turn.text} className="text-xs leading-relaxed" />
        </div>
      )}

      {/* Tool calls */}
      {turn.toolCalls.length > 0 && (
        <div className="py-1">
          <div className="px-4 py-1.5">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-medium">
              Tool Calls ({turn.toolCalls.length})
            </span>
          </div>
          {turn.toolCalls.map((tool) => (
            <ToolCallItem key={tool.toolObs.id} tool={tool} />
          ))}
        </div>
      )}

      {/* Empty state when no text and no tools */}
      {!turn.text && turn.toolCalls.length === 0 && (
        <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground p-4">
          No content in this turn
        </div>
      )}
    </div>
  )
}
