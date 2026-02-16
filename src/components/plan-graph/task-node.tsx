import { memo, useState, useCallback } from "react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { Plus, GitPullRequest, Sparkles, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRealtimeStore } from "@/stores/realtime-store"

const statusConfig: Record<string, { bg: string; border: string; dotColor: string }> = {
  planned: { bg: "bg-card", border: "border-border", dotColor: "bg-muted-foreground" },
  dispatched: { bg: "bg-card", border: "border-blue-500", dotColor: "bg-blue-500" },
  in_progress: { bg: "bg-card", border: "border-blue-500", dotColor: "bg-blue-500" },
  auto_verified: { bg: "bg-card", border: "border-green-500", dotColor: "bg-green-500" },
  awaiting_judgment: { bg: "bg-card", border: "border-amber-500", dotColor: "bg-amber-500" },
  completed: { bg: "bg-card", border: "border-green-500", dotColor: "bg-green-500" },
  pruned: { bg: "bg-muted", border: "border-border", dotColor: "bg-muted-foreground" },
}

const priorityHighlight: Record<string, { bg: string; border: string }> = {
  urgent: { bg: "bg-red-500/10", border: "border-red-500" },
  high: { bg: "bg-orange-500/10", border: "border-orange-500" },
  medium: { bg: "bg-yellow-500/10", border: "border-yellow-500" },
  low: { bg: "bg-blue-500/10", border: "border-blue-400" },
  none: { bg: "bg-card", border: "border-border" },
}

const neutralHighlight = { bg: "bg-card", border: "border-border" }

type TaskNodeData = Node<{
  title: string
  status: string
  nodeType: string
  executionId?: string
  priority?: string
  dueDate?: string
  prUrl?: string
  highlightBy?: string
  checked?: boolean
  selectionActive?: boolean
  onDecompose?: (nodeId: string) => void
  onToggleSelect?: (nodeId: string) => void
}>

export const TaskNode = memo(function TaskNode({ id, data }: NodeProps<TaskNodeData>) {
  const statusCfg = statusConfig[data.status] ?? statusConfig.planned
  const isMilestone = data.nodeType === "milestone"
  const isTask = data.nodeType === "task"
  const [hovered, setHovered] = useState(false)

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
  const priorityDotColor = data.priority === "urgent" ? "bg-red-500" : "bg-orange-500"

  // Selection state
  const showCheckbox = hovered || data.selectionActive
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

  return (
    <div
      className={cn(
        "relative flex items-center gap-2.5 border px-3 shadow-sm",
        highlight.bg,
        highlight.border,
        isMilestone ? "h-10 w-[200px] rounded-[20px]" : "h-[44px] w-[180px] rounded-xl",
        data.status === "pruned" && "opacity-50",
        isOverdue && "border-l-red-500 border-l-[3px]",
        isChecked && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        isRunning && "shadow-lg shadow-primary/20"
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2 !border-none" />

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
        <div className={cn(
          "absolute inset-0 overflow-hidden pointer-events-none",
          isMilestone ? "rounded-[20px]" : "rounded-xl"
        )}>
          <div
            className="absolute left-0 top-0 bottom-0 bg-blue-500/10 transition-all duration-500"
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
            "relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors cursor-pointer",
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
        {data.title}
      </span>

      {/* Progress percentage for running tasks */}
      {isRunning && progress > 0 && (
        <span className="text-[10px] font-medium text-blue-500 relative z-10 ml-auto">
          {progress}%
        </span>
      )}

      {/* PR indicator */}
      {data.prUrl && (
        <GitPullRequest className="h-3 w-3 shrink-0 text-purple-500 relative z-10 ml-auto" />
      )}

      {/* Priority dot for urgent/high */}
      {showPriorityDot && (
        <span className={cn("absolute top-1 right-1.5 h-[6px] w-[6px] rounded-full z-10", priorityDotColor)} />
      )}

      {/* Decompose button — visible on hover for tasks */}
      {hovered && isTask && data.status !== "pruned" && data.onDecompose && (
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
    </div>
  )
})
