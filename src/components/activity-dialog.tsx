import { useState, useMemo } from "react"
import {
  CircleCheck,
  Play,
  XCircle,
  PauseCircle,
  FileText,
  Pencil,
  Diamond,
  Trash2,
  FolderGit2,
  Sparkles,
  Filter,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { useActivityStore, type ActivityType } from "@/stores/activity-store"
import { formatRelativeTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

const activityConfig: Record<
  ActivityType,
  { icon: typeof CircleCheck; color: string; label: string }
> = {
  "task.created": { icon: Play, color: "text-blue-500", label: "Created" },
  "task.started": { icon: Play, color: "text-blue-500", label: "Started" },
  "task.completed": { icon: CircleCheck, color: "text-green-500", label: "Completed" },
  "task.failed": { icon: XCircle, color: "text-red-500", label: "Failed" },
  "task.cancelled": { icon: PauseCircle, color: "text-orange-500", label: "Cancelled" },
  "project.created": { icon: Sparkles, color: "text-purple-500", label: "Created" },
  "project.updated": { icon: Pencil, color: "text-muted-foreground", label: "Updated" },
  "milestone.created": { icon: Diamond, color: "text-primary", label: "Created" },
  "milestone.updated": { icon: Diamond, color: "text-primary", label: "Updated" },
  "milestone.deleted": { icon: Trash2, color: "text-red-500", label: "Deleted" },
  "vision.updated": { icon: FileText, color: "text-primary", label: "Updated" },
  "repo.configured": { icon: FolderGit2, color: "text-primary", label: "Configured" },
  "plan.refined": { icon: Sparkles, color: "text-purple-500", label: "Refined" },
}

const activityTypeGroups = {
  all: "All Activity",
  tasks: "Tasks",
  project: "Project",
  milestones: "Milestones",
  resources: "Resources",
}

export function ActivityDialog({ open, onOpenChange, projectId }: Props) {
  const allActivities = useActivityStore((s) => s.activities)
  const activities = useMemo(
    () => allActivities.filter((a) => a.projectId === projectId).slice(0, 100),
    [allActivities, projectId]
  )
  const [filter, setFilter] = useState<keyof typeof activityTypeGroups>("all")

  const filteredActivities = useMemo(() => {
    if (filter === "all") return activities

    const typeMap: Record<string, ActivityType[]> = {
      tasks: ["task.created", "task.started", "task.completed", "task.failed", "task.cancelled"],
      project: ["project.created", "project.updated", "plan.refined"],
      milestones: ["milestone.created", "milestone.updated", "milestone.deleted"],
      resources: ["vision.updated", "repo.configured"],
    }

    return activities.filter((a) => typeMap[filter]?.includes(a.type))
  }, [activities, filter])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>Recent Activity</DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex items-center gap-1.5 flex-wrap">
            {(Object.entries(activityTypeGroups) as [keyof typeof activityTypeGroups, string][]).map(
              ([key, label]) => (
                <Badge
                  key={key}
                  variant={filter === key ? "default" : "outline"}
                  className={cn("cursor-pointer text-xs", filter === key && "bg-primary text-primary-foreground")}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </Badge>
              )
            )}
          </div>
        </div>

        {/* Activity List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filteredActivities.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <p className="text-sm">No activity yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredActivities.map((activity) => {
                const config = activityConfig[activity.type]
                const Icon = config.icon

                return (
                  <div key={activity.id} className="flex gap-3 group">
                    <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", config.color)} />
                    <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                      <span className="text-[13px] truncate">{activity.title}</span>
                      {activity.description && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2">
                          {activity.description}
                        </p>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelativeTime(activity.timestamp)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
