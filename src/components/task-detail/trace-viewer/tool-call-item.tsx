import { useState } from "react"
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ToolCallWithResult } from "@/types/observations"

interface ToolCallItemProps {
  tool: ToolCallWithResult
}

export function ToolCallItem({ tool }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false)

  const hasOutput = tool.output != null
  const isComplete = hasOutput || tool.durationMs != null

  return (
    <div className="mx-4 my-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-muted/30 rounded transition-colors cursor-pointer group"
      >
        <div
          className={cn(
            "flex h-3.5 w-3.5 items-center justify-center shrink-0",
            !tool.success
              ? "text-red-500"
              : isComplete
                ? "text-green-500"
                : "text-blue-500"
          )}
        >
          {!isComplete ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : tool.success ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
        </div>
        <span className="text-[11px] font-mono flex-1 truncate text-muted-foreground">
          {tool.name}
        </span>
        {tool.durationMs != null && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
            {tool.durationMs < 1000
              ? `${Math.round(tool.durationMs)}ms`
              : `${(tool.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 ml-5 mr-2 px-2 py-1.5 rounded-md bg-muted/30 border-l-2 border-muted-foreground/20 flex flex-col gap-1.5">
          {tool.input != null && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
                Input
              </p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/80 max-h-[150px] overflow-auto">
                {typeof tool.input === "string"
                  ? tool.input
                  : JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          )}
          {tool.output != null && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
                Output
              </p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/80 max-h-[150px] overflow-auto">
                {typeof tool.output === "string"
                  ? tool.output.slice(0, 5000)
                  : JSON.stringify(tool.output, null, 2).slice(0, 5000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
