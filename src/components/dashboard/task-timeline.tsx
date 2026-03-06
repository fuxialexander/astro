import { useNavigate } from "react-router"
import { Loader2, Clock, Cpu, Sparkles, Play } from "lucide-react"
import { cn } from "@/lib/utils"

interface TimelineTask {
  id: string
  title: string
  projectId: string
  projectName: string
  projectColor?: string
  machineName: string
  machineId: string
  startedAt: number
  progress: number
  progressMessage?: string
  costUsd?: number
  category?: string
}

interface TaskTimelineProps {
  tasks: TimelineTask[]
  machines: string[]
  className?: string
}

function formatElapsed(startedAt: number): string {
  const elapsed = Math.max(0, Date.now() - startedAt)
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return "<1m"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`
}

export function TaskTimeline({ tasks, className }: TaskTimelineProps) {
  const navigate = useNavigate()

  if (tasks.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-8 text-muted-foreground/40 text-sm", className)}>
        All quiet — no running tasks
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {tasks.map((task) => (
        <button
          key={task.id}
          onClick={() => {
            if (task.id.startsWith("playground-")) {
              navigate(`/playground?projectId=${task.projectId}`)
            } else if (task.id.startsWith("plan-")) {
              navigate(`/welcome?projectId=${task.projectId}`)
            } else {
              navigate(`/project/${task.projectId}/task/${task.id}`)
            }
          }}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted/40 transition-colors cursor-pointer group w-full"
        >
          {/* Status indicator */}
          <div className="relative shrink-0">
            {task.id.startsWith("plan-") ? (
              <Sparkles className="h-4 w-4 text-info animate-pulse" />
            ) : task.id.startsWith("playground-") ? (
              <Play className="h-4 w-4 text-primary/70" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-primary/70" />
            )}
          </div>

          {/* Task info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold truncate group-hover:text-primary transition-colors">
                {task.title}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground/60 truncate">
                {task.projectName}
              </span>
              {task.progressMessage && (
                <>
                  <span className="text-[10px] text-muted-foreground/30">·</span>
                  <span className="text-[10px] text-muted-foreground/50 truncate">
                    {task.progressMessage}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {task.progress > 0 && (
            <div className="w-16 h-1.5 rounded-full bg-muted/40 overflow-hidden shrink-0">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(task.progress, 100)}%`,
                  backgroundColor: task.projectColor || "var(--primary)",
                  opacity: 0.7,
                }}
              />
            </div>
          )}

          {/* Machine + elapsed */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
              <Cpu className="h-2.5 w-2.5" />
              {task.machineName}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
              <Clock className="h-2.5 w-2.5" />
              {formatElapsed(task.startedAt)}
            </span>
            {task.costUsd != null && task.costUsd > 0 && (
              <span className="text-[10px] text-muted-foreground/40">
                ${task.costUsd.toFixed(2)}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}
