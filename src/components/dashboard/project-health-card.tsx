import { Link } from "react-router"
import { ArrowUpRight } from "lucide-react"
import { StatusStackedBar, type StatusSegment } from "./status-stacked-bar"
import { MicroSparkline } from "./micro-sparkline"
import { cn } from "@/lib/utils"

interface ProjectHealthCardProps {
  projectId: string
  name: string
  icon?: string
  color?: string
  completed: number
  inProgress: number
  planned: number
  awaiting: number
  pruned: number
  total: number
  costUsd: number
  velocityData: number[]
  className?: string
}

export function ProjectHealthCard({
  projectId,
  name,
  icon,
  completed,
  inProgress,
  planned,
  awaiting,
  pruned,
  total,
  costUsd,
  velocityData,
  className,
}: ProjectHealthCardProps) {
  const segments: StatusSegment[] = [
    { label: "completed", count: completed, color: "bg-emerald-500 dark:bg-emerald-400" },
    { label: "in progress", count: inProgress, color: "bg-sky-500 dark:bg-sky-400" },
    { label: "awaiting", count: awaiting, color: "bg-amber-500 dark:bg-amber-400" },
    { label: "planned", count: planned, color: "bg-muted-foreground/25" },
    { label: "pruned", count: pruned, color: "bg-muted/40" },
  ]

  return (
    <Link
      to={`/project/${projectId}/graph`}
      className={cn(
        "group flex flex-col gap-3 rounded-xl p-4",
        "glass-panel-subtle",
        "transition-all duration-300 ease-out",
        "hover:translate-y-[-2px] hover:shadow-[0_8px_28px_-6px_rgba(0,0,0,0.1)]",
        "hover:border-primary/20",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-sm">{icon}</span>}
          <span className="text-[13px] font-medium truncate group-hover:text-primary transition-colors duration-200">
            {name}
          </span>
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary/60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200 shrink-0" />
      </div>

      <StatusStackedBar segments={segments} height={6} />

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground/60">
          {completed}/{total} tasks
          {inProgress > 0 && <span className="text-info"> · {inProgress} running</span>}
          {costUsd > 0 && <span> · ${costUsd.toFixed(2)}</span>}
        </span>
        {velocityData.length >= 2 && (
          <MicroSparkline
            data={velocityData}
            width={60}
            height={16}
            strokeColor="var(--color-emerald-500, #10b981)"
            className="opacity-40 group-hover:opacity-80 transition-opacity duration-300"
          />
        )}
      </div>
    </Link>
  )
}
