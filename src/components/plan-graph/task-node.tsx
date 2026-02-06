import { memo } from "react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { CheckCircle2, Circle, Play, Eye, Scissors, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRealtimeStore } from "@/stores/realtime-store"

const statusConfig: Record<string, { icon: typeof Circle; bg: string; border: string; iconColor: string }> = {
  planned: { icon: Circle, bg: "bg-card", border: "border-border", iconColor: "text-muted-foreground" },
  dispatched: { icon: Play, bg: "bg-blue-500/10", border: "border-blue-500", iconColor: "text-blue-500" },
  in_progress: { icon: Loader2, bg: "bg-blue-500/10", border: "border-blue-500", iconColor: "text-blue-500" },
  auto_verified: { icon: CheckCircle2, bg: "bg-green-500/10", border: "border-green-500", iconColor: "text-green-500" },
  awaiting_judgment: { icon: Eye, bg: "bg-amber-500/10", border: "border-amber-500", iconColor: "text-amber-500" },
  completed: { icon: CheckCircle2, bg: "bg-green-500/10", border: "border-green-500", iconColor: "text-green-500" },
  pruned: { icon: Scissors, bg: "bg-muted", border: "border-border", iconColor: "text-muted-foreground" },
}

type TaskNodeData = Node<{
  title: string
  status: string
  nodeType: string
  executionId?: string
  priority?: string
  dueDate?: string
}>

export const TaskNode = memo(function TaskNode({ data }: NodeProps<TaskNodeData>) {
  const config = statusConfig[data.status] ?? statusConfig.planned
  const Icon = config.icon
  const isMilestone = data.nodeType === "milestone"

  // Get live progress from realtime store
  const taskStream = useRealtimeStore((s) =>
    data.executionId ? s.taskStreams.get(data.executionId) : undefined
  )
  const progress = taskStream?.progress ?? 0
  const isRunning = data.status === "in_progress" || data.status === "dispatched"

  // Priority dot for urgent/high
  const showPriorityDot = data.priority === "urgent" || data.priority === "high"
  const priorityDotColor = data.priority === "urgent" ? "bg-red-500" : "bg-orange-500"

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
        "relative flex items-center gap-2.5 border-[1.5px] px-3.5 overflow-hidden",
        config.bg,
        config.border,
        isMilestone ? "h-10 w-[200px] rounded-[20px]" : "h-[44px] w-[180px] rounded-[10px]",
        data.status === "pruned" && "opacity-50",
        isOverdue && "border-l-red-500 border-l-[3px]"
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2 !border-none" />

      {/* Progress bar overlay for running tasks */}
      {isRunning && progress > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 bg-blue-500/10 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      )}

      <Icon className={cn("h-3.5 w-3.5 shrink-0 relative z-10", config.iconColor, data.status === "in_progress" && "animate-spin")} />
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

      {/* Priority dot for urgent/high */}
      {showPriorityDot && (
        <span className={cn("absolute top-1 right-1.5 h-[6px] w-[6px] rounded-full z-10", priorityDotColor)} />
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-border !w-2 !h-2 !border-none" />
    </div>
  )
})
