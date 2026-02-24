import { Badge } from "@/components/ui/badge"
import { Hourglass } from "lucide-react"
import type { TraceTree } from "@/types/observations"
import type { UsageMetrics } from "@/types"

interface TraceSummaryCardProps {
  trace: TraceTree
  isRunning?: boolean
  executionMetrics?: UsageMetrics
}

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0"
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n === 0) return "0"
  if (n < 1000) return n.toString()
  return `${(n / 1000).toFixed(1)}k`
}

export function TraceSummaryCard({ trace, isRunning, executionMetrics }: TraceSummaryCardProps) {
  const { stats } = trace
  const errorCount = trace.events.filter(
    (e) => e.level === "error"
  ).length

  // Fall back to execution metrics when observation store has no token data
  const effectiveTokens = stats.totalTokens > 0
    ? stats.totalTokens
    : (executionMetrics?.inputTokens || 0) + (executionMetrics?.outputTokens || 0) + (executionMetrics?.tokensUsed || 0)
  const effectiveCost = stats.totalCost > 0
    ? stats.totalCost
    : executionMetrics?.estimatedCostUsd || 0

  const pendingTokens = isRunning && effectiveTokens === 0
  const pendingCost = isRunning && effectiveCost === 0
  // Show dash when task is completed but no token data available from any source
  const unavailableTokens = !isRunning && effectiveTokens === 0
  const unavailableCost = !isRunning && effectiveCost === 0

  return (
    <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-b border-border bg-muted/20 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-foreground">{stats.totalTurns}</span>
        <span>turns</span>
      </div>
      <div className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-foreground">{stats.totalToolCalls}</span>
        <span>tool calls</span>
      </div>
      {stats.model && (
        <>
          <div className="h-3 w-px bg-border" />
          <Badge variant="outline" className="text-[10px] font-mono">
            {stats.model}
          </Badge>
        </>
      )}
      <div className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1.5">
        {pendingTokens ? (
          <>
            <Hourglass className="h-3 w-3 text-muted-foreground animate-pulse" />
            <span>tokens</span>
          </>
        ) : unavailableTokens ? (
          <>
            <span className="font-medium text-foreground tabular-nums">&mdash;</span>
            <span>tokens</span>
          </>
        ) : (
          <>
            <span className="font-medium text-foreground tabular-nums">
              {formatTokens(effectiveTokens)}
            </span>
            <span>tokens</span>
          </>
        )}
      </div>
      {effectiveCost > 0 ? (
        <>
          <div className="h-3 w-px bg-border" />
          <span className="font-medium text-foreground tabular-nums">
            {formatCost(effectiveCost)}
          </span>
        </>
      ) : pendingCost ? (
        <>
          <div className="h-3 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <Hourglass className="h-3 w-3 text-muted-foreground animate-pulse" />
            <span>cost</span>
          </div>
        </>
      ) : unavailableCost ? (
        <>
          <div className="h-3 w-px bg-border" />
          <span className="font-medium text-foreground tabular-nums">&mdash;</span>
        </>
      ) : null}
      <div className="h-3 w-px bg-border" />
      <span className="tabular-nums">{formatDurationMs(stats.durationMs)}</span>
      {errorCount > 0 && (
        <>
          <div className="h-3 w-px bg-border" />
          <Badge variant="destructive" className="text-[10px]">
            {errorCount} error{errorCount !== 1 ? "s" : ""}
          </Badge>
        </>
      )}
    </div>
  )
}
