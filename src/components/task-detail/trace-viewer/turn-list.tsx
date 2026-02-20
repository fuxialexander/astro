import { Badge } from "@/components/ui/badge"
import { CheckCircle2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { GenerationTurn } from "@/types/observations"

interface TurnListProps {
  turns: GenerationTurn[]
  selectedIndex: number | null
  onSelect: (index: number) => void
}

export function TurnList({ turns, selectedIndex, onSelect }: TurnListProps) {
  if (turns.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground p-4">
        No turns recorded
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {turns.map((turn, idx) => {
        const isSelected = selectedIndex === idx
        const hasErrors = turn.toolCalls.some((t) => !t.success)
        const allSuccess =
          turn.toolCalls.length > 0 && turn.toolCalls.every((t) => t.success)
        const preview = turn.text.slice(0, 80).replace(/\n/g, " ") || "(no text)"

        return (
          <button
            key={turn.generation.id}
            onClick={() => onSelect(idx)}
            className={cn(
              "flex items-start gap-2 px-3 py-2.5 text-left border-b border-border hover:bg-muted/40 transition-colors cursor-pointer",
              isSelected && "bg-accent/50 border-l-2 border-l-primary"
            )}
          >
            <Badge
              variant="outline"
              className="text-[10px] shrink-0 mt-0.5 tabular-nums min-w-[28px] justify-center"
            >
              {idx + 1}
            </Badge>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate leading-snug">
                {preview}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {turn.toolCalls.length > 0 && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    {hasErrors ? (
                      <XCircle className="h-2.5 w-2.5 text-red-500" />
                    ) : allSuccess ? (
                      <CheckCircle2 className="h-2.5 w-2.5 text-green-500" />
                    ) : null}
                    {turn.toolCalls.length} tool{turn.toolCalls.length !== 1 ? "s" : ""}
                  </span>
                )}
                {(turn.inputTokens != null || turn.outputTokens != null) && (
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                    {((turn.inputTokens ?? 0) + (turn.outputTokens ?? 0)).toLocaleString()} tok
                  </span>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
