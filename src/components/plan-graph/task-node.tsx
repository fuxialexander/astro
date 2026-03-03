import { memo, useState, useCallback, useEffect, useRef } from "react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { Plus, GitPullRequest, GitPullRequestCreateArrow, Sparkles, Check, GitMerge, Loader2, CheckCircle2, XCircle, Diamond } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store"
import { usePlanStore } from "@/stores/plan-store"

const statusConfig: Record<string, { bg: string; border: string; dotColor: string }> = {
  planned: { bg: "bg-card", border: "border-border", dotColor: "bg-muted-foreground" },
  dispatched: { bg: "bg-card", border: "border-info", dotColor: "bg-info" },
  in_progress: { bg: "bg-card", border: "border-info", dotColor: "bg-info" },
  auto_verified: { bg: "bg-card", border: "border-success", dotColor: "bg-success" },
  awaiting_judgment: { bg: "bg-card", border: "border-warning", dotColor: "bg-warning" },
  completed: { bg: "bg-card", border: "border-success", dotColor: "bg-success" },
  pruned: { bg: "bg-muted", border: "border-border", dotColor: "bg-muted-foreground" },
}

const priorityHighlight: Record<string, { bg: string; border: string }> = {
  urgent: { bg: "bg-error/10", border: "border-error" },
  high: { bg: "bg-warning/10", border: "border-warning" },
  medium: { bg: "bg-warning/10", border: "border-warning" },
  low: { bg: "bg-info/10", border: "border-info" },
  none: { bg: "bg-card", border: "border-border" },
}

const neutralHighlight = { bg: "bg-card", border: "border-border" }

type TaskNodeData = Node<{
  title: string
  number?: number | null
  description?: string
  status: string
  nodeType: string
  executionId?: string
  priority?: string
  dueDate?: string
  prUrl?: string
  mergeQueueStatus?: string
  autoPr?: boolean
  githubIssueNumber?: number
  githubIssueUrl?: string
  highlightBy?: string
  checked?: boolean
  selectionActive?: boolean
  onDecompose?: (nodeId: string) => void
  onToggleSelect?: (nodeId: string) => void
  governedCount?: number
  readOnly?: boolean
}>

export const TaskNode = memo(function TaskNode({ id, data }: NodeProps<TaskNodeData>) {
  const statusCfg = statusConfig[data.status] ?? statusConfig.planned
  const isMilestone = data.nodeType === "milestone"
  const isTask = data.nodeType === "task"
  const [hovered, setHovered] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedId = useKeyboardNavStore((s) => s.focusedId)
  const isFocused = focusedId === id
  const isRecentlyUpdated = usePlanStore((s) => s.recentlyUpdatedNodeIds.has(id))

  // Show tooltip with delay to avoid flicker on quick mouse passes
  useEffect(() => {
    if (hovered && (data.title.length > 25 || data.description)) {
      tooltipTimer.current = setTimeout(() => setShowTooltip(true), 150)
    } else {
      setShowTooltip(false) // eslint-disable-line react-hooks/set-state-in-effect -- synchronous tooltip dismiss on unhover
    }
    return () => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    }
  }, [hovered, data.title, data.description])

  // Resolve highlight colors based on highlightBy mode
  const highlight = (() => {
    const mode = data.highlightBy ?? "status"
    if (mode === "priority") {
      const h = priorityHighlight[data.priority ?? "none"] ?? neutralHighlight
      return { bg: h.bg, border: h.border, dotColor: statusCfg.dotColor }
    }
    if (mode === "none") {
      return { bg: neutralHighlight.bg, border: neutralHighlight.border, dotColor: statusCfg.dotColor }
    }
    // Default: status-based (original behavior)
    return { bg: statusCfg.bg, border: statusCfg.border, dotColor: statusCfg.dotColor }
  })()

  // Get live progress from realtime store
  const taskStream = useRealtimeStore((s) =>
    data.executionId ? s.taskStreams.get(data.executionId) : undefined
  )
  const progress = taskStream?.progress ?? 0
  const isRunning = data.status === "in_progress" || data.status === "dispatched"

  // Priority dot for urgent/high
  const showPriorityDot = data.priority === "urgent" || data.priority === "high"
  const priorityDotColor = data.priority === "urgent" ? "bg-error" : "bg-warning"

  // Selection state
  const showCheckbox = !data.readOnly && (hovered || data.selectionActive)
  const isChecked = data.checked ?? false

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    data.onToggleSelect?.(id)
  }, [data, id])

  // Overdue detection
  const isOverdue = (() => {
    if (!data.dueDate || data.status === "completed" || data.status === "pruned" || data.status === "auto_verified") return false
    const due = new Date(data.dueDate + "T00:00:00Z")
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return due < today
  })()

  // ── Milestone node ─────────────────────────────────────────────
  if (isMilestone) {
    const governedCount = data.governedCount ?? 0
    return (
      <div
        className={cn(
          "relative flex items-center gap-2 border-2 border-dashed px-4 shadow-sm transition-all duration-200",
          "h-9 w-[240px] rounded-full",
          highlight.border,
          "bg-muted/40",
          data.status === "completed" || data.status === "auto_verified"
            ? "border-success/50 bg-success/5"
            : "border-primary/30 bg-primary/[0.03]",
          data.status === "pruned" && "opacity-50",
          isChecked && "ring-2 ring-primary ring-offset-1 ring-offset-background",
          isFocused && "shadow-[0_0_0_3px_rgba(var(--primary),0.4)] scale-[1.05] z-50",
          isRecentlyUpdated && "ring-2 ring-info/50 animate-pulse"
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {!data.readOnly && (
          <>
            <Handle
              type="target"
              position={Position.Top}
              className={cn(
                "!border-none !rounded-full transition-all duration-150",
                hovered ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair" : "!w-2 !h-2 !bg-border"
              )}
            />
            {hovered && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
                <Plus className="h-3 w-3 text-primary-foreground" />
              </div>
            )}
          </>
        )}

        {showTooltip && (
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-[280px] z-30 pointer-events-none bg-popover border shadow-lg rounded-lg p-3">
            <p className="text-xs font-semibold text-foreground leading-snug">{data.title}</p>
            {data.description && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-4">
                {data.description.slice(0, 200)}{data.description.length > 200 ? "..." : ""}
              </p>
            )}
          </div>
        )}

        {/* Selection checkbox or diamond icon */}
        {showCheckbox ? (
          <button
            type="button"
            onClick={handleCheckboxClick}
            className={cn(
              "relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors cursor-pointer p-1 -m-1",
              isChecked
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40 bg-transparent hover:border-primary/60"
            )}
          >
            {isChecked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          </button>
        ) : (
          <Diamond className={cn(
            "h-3.5 w-3.5 shrink-0 relative z-10",
            data.status === "completed" || data.status === "auto_verified"
              ? "text-success fill-success/20"
              : "text-primary/60 fill-primary/10"
          )} />
        )}

        <span className={cn(
          "truncate text-[11px] font-semibold uppercase tracking-wider relative z-10",
          data.status === "pruned"
            ? "text-muted-foreground line-through"
            : data.status === "completed" || data.status === "auto_verified"
              ? "text-success/80"
              : "text-foreground/70"
        )}>
          {data.title}
        </span>

        {/* Governed task count */}
        {governedCount > 0 && (
          <span className="ml-auto text-[10px] font-medium text-muted-foreground relative z-10 shrink-0">
            {governedCount} {governedCount === 1 ? "task" : "tasks"}
          </span>
        )}

        {!data.readOnly && (
          <>
            <Handle
              type="source"
              position={Position.Bottom}
              className={cn(
                "!border-none !rounded-full transition-all duration-150",
                hovered ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair" : "!w-2 !h-2 !bg-border"
              )}
            />
            {hovered && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
                <Plus className="h-3 w-3 text-primary-foreground" />
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Regular task node ──────────────────────────────────────────
  return (
    <div
      className={cn(
        "relative flex items-center gap-2.5 border px-3 shadow-sm transition-all duration-200",
        highlight.bg,
        highlight.border,
        "h-[44px] w-[180px] rounded-xl",
        data.status === "pruned" && "opacity-50",
        isOverdue && "border-l-error border-l-[3px]",
        isChecked && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        isRunning && "shadow-lg shadow-primary/20",
        isFocused && "shadow-[0_0_0_3px_rgba(var(--primary),0.4)] scale-[1.05] z-50",
        isRecentlyUpdated && "ring-2 ring-info/50 animate-pulse"
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Target handle - grows into draggable '+' button on hover for adding parent nodes */}
      {!data.readOnly && (
        <>
          <Handle
            type="target"
            position={Position.Top}
            className={cn(
              "!border-none !rounded-full transition-all duration-150",
              hovered && data.status !== "pruned"
                ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair"
                : "!w-2 !h-2 !bg-border"
            )}
          />

          {/* Plus icon overlaid on target handle (top) */}
          {hovered && data.status !== "pruned" && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
              <Plus className="h-3 w-3 text-primary-foreground" />
            </div>
          )}
        </>
      )}

      {/* Hover tooltip showing full title + description */}
      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-[280px] z-30 pointer-events-none bg-popover border shadow-lg rounded-lg p-3">
          <p className="text-xs font-semibold text-foreground leading-snug">
            {data.title}
          </p>
          {data.description && (
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-4">
              {data.description.slice(0, 200)}{data.description.length > 200 ? "..." : ""}
            </p>
          )}
        </div>
      )}

      {/* Active glow effect for running tasks */}
      {isRunning && (
        <div className="absolute -inset-4 -z-10 opacity-20 pointer-events-none">
          <div
            className="absolute inset-0 rounded-full blur-xl"
            style={{
              background: "radial-gradient(ellipse 160px 60px at center, rgba(59, 130, 246, 0.25) 0%, rgba(59, 130, 246, 0) 70%)",
            }}
          />
        </div>
      )}

      {/* Progress bar overlay for running tasks (clipped to node border) */}
      {isRunning && progress > 0 && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-xl">
          <div
            className="absolute left-0 top-0 bottom-0 bg-info/10 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Status dot / Selection checkbox */}
      {showCheckbox ? (
        <button
          type="button"
          onClick={handleCheckboxClick}
          className={cn(
            "relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors cursor-pointer p-1 -m-1",
            isChecked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/40 bg-transparent hover:border-primary/60"
          )}
        >
          {isChecked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
        </button>
      ) : (
        <span className={cn("h-2 w-2 rounded-full shrink-0 relative z-10", highlight.dotColor)} />
      )}

      <span className={cn(
        "truncate text-xs font-medium relative z-10",
        data.status === "pruned" ? "text-muted-foreground line-through" : "text-foreground"
      )}>
        {data.number != null && <span className="text-muted-foreground mr-1">#{data.number}</span>}
        {data.title}
      </span>

      {/* GitHub issue badge */}
      {data.githubIssueNumber && (
        <a
          href={data.githubIssueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-medium text-muted-foreground hover:text-primary relative z-10 shrink-0"
          onClick={(e) => e.stopPropagation()}
          title={`GitHub Issue #${data.githubIssueNumber}`}
        >
          #{data.githubIssueNumber}
        </a>
      )}

      {/* Progress percentage for running tasks */}
      {isRunning && progress > 0 && (
        <span className="text-[10px] font-medium text-info relative z-10 ml-auto">
          {progress}%
        </span>
      )}

      {/* Merge queue status badge */}
      {data.mergeQueueStatus && (
        <span className="relative z-10 ml-auto shrink-0" title={`Merge queue: ${data.mergeQueueStatus}`}>
          {data.mergeQueueStatus === 'queued' && <GitMerge className="h-3 w-3 text-info" />}
          {data.mergeQueueStatus === 'testing' && <Loader2 className="h-3 w-3 text-warning animate-spin" />}
          {data.mergeQueueStatus === 'merged' && <CheckCircle2 className="h-3 w-3 text-success" />}
          {data.mergeQueueStatus === 'failed' && <XCircle className="h-3 w-3 text-error" />}
        </span>
      )}

      {/* PR indicator */}
      {data.prUrl && !data.mergeQueueStatus && (
        <GitPullRequest className="h-3 w-3 shrink-0 text-primary relative z-10 ml-auto" />
      )}

      {/* Auto-PR indicator - shows when autoPr is enabled but no PR exists yet */}
      {data.autoPr && !data.prUrl && !data.mergeQueueStatus && (
        <span className="relative z-10 ml-auto shrink-0" title="Auto-PR enabled">
          <GitPullRequestCreateArrow className="h-3 w-3 text-info" />
        </span>
      )}

      {/* Priority dot for urgent/high */}
      {showPriorityDot && (
        <span className={cn("absolute top-1 right-1.5 h-[6px] w-[6px] rounded-full z-10", priorityDotColor)} />
      )}

      {/* Decompose button — visible on hover for tasks */}
      {!data.readOnly && hovered && isTask && data.status !== "pruned" && data.onDecompose && (
        <button
          type="button"
          title="Decompose into sub-tasks"
          className="absolute -top-3 -right-3 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-white shadow-md hover:bg-violet-600 transition-colors cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            data.onDecompose?.(id)
          }}
        >
          <Sparkles className="h-3 w-3" />
        </button>
      )}

      {/* Source handle - grows into draggable '+' button on hover */}
      {!data.readOnly && (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            className={cn(
              "!border-none !rounded-full transition-all duration-150",
              hovered && data.status !== "pruned"
                ? "!w-6 !h-6 !bg-primary shadow-md cursor-crosshair"
                : "!w-2 !h-2 !bg-border"
            )}
          />

          {/* Plus icon overlaid on source handle */}
          {hovered && data.status !== "pruned" && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex items-center justify-center w-6 h-6 pointer-events-none z-20">
              <Plus className="h-3 w-3 text-primary-foreground" />
            </div>
          )}
        </>
      )}
    </div>
  )
})
