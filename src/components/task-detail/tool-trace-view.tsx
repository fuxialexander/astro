import { useState } from "react"
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"

interface ToolTrace {
  toolName: string
  toolInput: unknown
  toolResult?: unknown
  success?: boolean
  duration?: number
  timestamp: Date
}

interface ToolTraceViewProps {
  traces: ToolTrace[]
}

import { formatTime } from "@/lib/date-utils"

function TraceItem({ trace }: { trace: ToolTrace; index: number }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex gap-3">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full border-2",
          trace.success === false
            ? "border-error bg-error/10"
            : trace.success === true
              ? "border-success bg-success/10"
              : "border-border bg-muted"
        )}>
          {trace.success === true ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          ) : trace.success === false ? (
            <XCircle className="h-3.5 w-3.5 text-error" />
          ) : (
            <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-4 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full text-left group cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-sm font-medium font-mono">{trace.toolName}</span>
          <span className="text-xs text-muted-foreground">{formatTime(trace.timestamp)}</span>
          {trace.duration != null && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {trace.duration}ms
            </span>
          )}
        </button>

        {expanded && (
          <div className="mt-2 flex flex-col gap-2">
            {trace.toolInput != null && (
              <div className="rounded-md bg-muted p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Input</p>
                <pre className="font-mono text-xs whitespace-pre-wrap break-all text-foreground">
                  {typeof trace.toolInput === "string"
                    ? trace.toolInput
                    : JSON.stringify(trace.toolInput, null, 2)}
                </pre>
              </div>
            )}
            {trace.toolResult != null && (
              <div className="rounded-md bg-muted p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Result</p>
                <pre className="font-mono text-xs whitespace-pre-wrap break-all text-foreground max-h-[200px] overflow-auto">
                  {typeof trace.toolResult === "string"
                    ? trace.toolResult
                    : JSON.stringify(trace.toolResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function ToolTraceView({ traces }: ToolTraceViewProps) {
  if (traces.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No tool calls recorded
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex flex-col">
        {traces.map((trace, i) => (
          <TraceItem key={i} trace={trace} index={i} />
        ))}
      </div>
    </div>
  )
}
