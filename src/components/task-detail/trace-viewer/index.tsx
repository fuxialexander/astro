import { useState, useEffect, useRef, useMemo } from "react"
import { Loader2, AlertCircle, Layers } from "lucide-react"
import { useObservationStore } from "@/stores/observation-store"
import { TraceSummaryCard } from "./trace-summary-card"
import { TurnList } from "./turn-list"
import { TurnDetail } from "./turn-detail"
import type { RawObservation } from "@/types/observations"

interface TraceViewerProps {
  executionId: string
  isRunning: boolean
}

export function TraceViewer({ executionId, isRunning }: TraceViewerProps) {
  const fetchTrace = useObservationStore((s) => s.fetchTrace)
  const trace = useObservationStore((s) => s.traces.get(executionId))
  const loading = useObservationStore((s) => s.loading.get(executionId) ?? false)
  const error = useObservationStore((s) => s.errors.get(executionId))
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch on mount
  useEffect(() => {
    if (executionId) {
      fetchTrace(executionId)
    }
  }, [executionId, fetchTrace])

  // Poll while running
  useEffect(() => {
    if (isRunning && executionId) {
      pollRef.current = setInterval(() => {
        fetchTrace(executionId)
      }, 3000)
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [isRunning, executionId, fetchTrace])

  // Auto-select first turn: derive effective selection without setState in effect
  const effectiveSelectedTurn = useMemo(() => {
    if (selectedTurn !== null) return selectedTurn
    if (trace && trace.turns.length > 0) return 0
    return null
  }, [selectedTurn, trace])

  // Loading state
  if (loading && !trace) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading trace data...</span>
      </div>
    )
  }

  // Error state
  if (error && !trace) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-4">
        <AlertCircle className="h-5 w-5" />
        <span className="text-sm">{error}</span>
      </div>
    )
  }

  // Empty state
  if (!trace || (trace.turns.length === 0 && trace.events.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-4">
        <Layers className="h-5 w-5" />
        <span className="text-sm">
          {isRunning ? "Waiting for trace data..." : "No trace data available"}
        </span>
        {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
    )
  }

  // Fallback: provider doesn't emit generation observations — show flat tool/event list
  if (trace.turns.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2.5 border-b border-border bg-muted/20 text-xs text-muted-foreground">
          Limited trace data — provider does not support structured output
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {trace.events.map((ev) => (
            <FlatEventItem key={ev.id} obs={ev} />
          ))}
        </div>
      </div>
    )
  }

  const activeTurn =
    effectiveSelectedTurn !== null && effectiveSelectedTurn < trace.turns.length
      ? trace.turns[effectiveSelectedTurn]
      : null

  return (
    <div className="flex flex-col h-full">
      {/* Summary banner */}
      <TraceSummaryCard trace={trace} />

      {/* Split panel: turn list (left) + detail (right) */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — turn list */}
        <div className="w-[40%] border-r border-border overflow-y-auto">
          <TurnList
            turns={trace.turns}
            selectedIndex={effectiveSelectedTurn}
            onSelect={setSelectedTurn}
          />
        </div>

        {/* Right panel — turn detail */}
        <div className="w-[60%] overflow-y-auto">
          {activeTurn ? (
            <TurnDetail turn={activeTurn} />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Select a turn to view details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Simple flat display for events when no generation turns exist
function FlatEventItem({ obs }: { obs: RawObservation }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground hover:bg-muted/20">
      <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
        {new Date(obs.startTime).toLocaleTimeString()}
      </span>
      <span className="font-mono truncate">{obs.name}</span>
      {obs.level === "error" && (
        <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
      )}
    </div>
  )
}
