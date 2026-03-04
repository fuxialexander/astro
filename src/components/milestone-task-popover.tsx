import { useState, useMemo } from "react"
import { Search, Circle, Send, Loader, CheckCircle2, Eye, Scissors } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { PlanNode } from "@/types"

const STATUS_ICON_MAP: Record<string, { icon: typeof Circle; color: string }> = {
  planned: { icon: Circle, color: "text-muted-foreground" },
  dispatched: { icon: Send, color: "text-info" },
  in_progress: { icon: Loader, color: "text-info" },
  auto_verified: { icon: CheckCircle2, color: "text-success" },
  awaiting_judgment: { icon: Eye, color: "text-warning" },
  awaiting_approval: { icon: Eye, color: "text-warning" },
  completed: { icon: CheckCircle2, color: "text-success" },
  pruned: { icon: Scissors, color: "text-muted-foreground" },
}

interface MilestoneTaskPopoverProps {
  milestoneId: string
  allNodes: PlanNode[]
  onToggleTask: (taskId: string, milestoneId: string | undefined) => void
  children: React.ReactNode
}

export function MilestoneTaskPopover({
  milestoneId,
  allNodes,
  onToggleTask,
  children,
}: MilestoneTaskPopoverProps) {
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)

  const tasks = useMemo(
    () => allNodes.filter((n) => n.type !== "milestone"),
    [allNodes]
  )

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.title?.toLowerCase().includes(q))
  }, [tasks, search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-b border-border">
          <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filteredTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No tasks found
            </p>
          ) : (
            filteredTasks.map((task) => {
              const checked = task.milestoneId === milestoneId
              const statusInfo = STATUS_ICON_MAP[task.status ?? "planned"] ?? STATUS_ICON_MAP.planned
              const StatusIcon = statusInfo.icon

              return (
                <label
                  key={task.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(val) => {
                      onToggleTask(task.id, val ? milestoneId : undefined)
                    }}
                  />
                  <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusInfo.color)} />
                  <span className="text-sm truncate">{task.title || "Untitled"}</span>
                </label>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
