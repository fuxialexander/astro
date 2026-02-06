import { memo } from "react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { CheckCircle2, Circle, Play, Eye, Scissors, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

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
}>

export const TaskNode = memo(function TaskNode({ data }: NodeProps<TaskNodeData>) {
  const config = statusConfig[data.status] ?? statusConfig.planned
  const Icon = config.icon
  const isMilestone = data.nodeType === "milestone"

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 border-[1.5px] px-3.5",
        config.bg,
        config.border,
        isMilestone ? "h-10 w-[200px] rounded-[20px]" : "h-[44px] w-[180px] rounded-[10px]",
        data.status === "pruned" && "opacity-50"
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2 !border-none" />
      <Icon className={cn("h-3.5 w-3.5 shrink-0", config.iconColor, data.status === "in_progress" && "animate-spin")} />
      <span className={cn(
        "truncate text-xs font-medium",
        data.status === "pruned" ? "text-muted-foreground line-through" : "text-foreground"
      )}>
        {data.title}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-border !w-2 !h-2 !border-none" />
    </div>
  )
})
