import { useState, useMemo } from "react"
import { Link } from "react-router"
import { ChevronRight, CheckCircle2, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { getColorForName } from "@/lib/color-icon-utils"
import { formatRelativeTime } from "@/lib/date-utils"
import type { PlanNode } from "@/types"

interface DoneTodaySectionProps {
  className?: string
}

interface CompletedItem {
  nodeId: string
  projectId: string
  projectName: string
  projectColor: string
  title: string
  completedAt: Date
  status: "completed" | "auto_verified"
}

/** Returns true if the given date is today (local timezone). */
function isToday(date: Date): boolean {
  const now = new Date()
  const d = new Date(date)
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/** Derive the completion timestamp from a plan node. */
function getCompletionDate(node: PlanNode): Date | null {
  if (node.executionCompletedAt && isToday(new Date(node.executionCompletedAt))) {
    return new Date(node.executionCompletedAt)
  }
  if (node.updatedAt && isToday(new Date(node.updatedAt))) {
    return new Date(node.updatedAt)
  }
  return null
}

export function DoneTodaySection({ className }: DoneTodaySectionProps) {
  const [expanded, setExpanded] = useState(false)

  const nodes = usePlanStore((s) => s.nodes)
  const executions = useExecutionStore((s) => s.executions)
  const projects = useProjectStore((s) => s.projects)

  const completedItems = useMemo(() => {
    const projectMap = new Map(projects.map((p) => [p.id, p]))
    const items: CompletedItem[] = []

    // 1. Plan nodes completed today
    const completedStatuses: PlanNode["status"][] = ["completed", "auto_verified"]
    for (const node of nodes.filter(isLive)) {
      if (!completedStatuses.includes(node.status)) continue
      const completedAt = getCompletionDate(node)
      if (!completedAt) continue

      const project = projectMap.get(node.projectId)
      items.push({
        nodeId: node.id,
        projectId: node.projectId,
        projectName: project?.name ?? "Unknown",
        projectColor: project?.color ?? getColorForName(project?.name ?? node.projectId),
        title: node.title,
        completedAt,
        status: node.status as "completed" | "auto_verified",
      })
    }

    // 2. Playground executions completed today (not already covered by plan nodes)
    const nodeIds = new Set(items.map((i) => i.nodeId))
    executions.forEach((exec, nodeId) => {
      if (nodeIds.has(nodeId)) return
      if (!nodeId.startsWith("playground-")) return
      if (exec.status !== "success") return
      if (!exec.completedAt || !isToday(new Date(exec.completedAt))) return

      const project = projectMap.get(exec.projectId)
      items.push({
        nodeId,
        projectId: exec.projectId,
        projectName: project?.name ?? "Playground",
        projectColor: project?.color ?? getColorForName(project?.name ?? exec.projectId),
        title: exec.summary?.workCompleted ?? "Playground session",
        completedAt: new Date(exec.completedAt),
        status: "auto_verified",
      })
    })

    // Sort most recent first
    items.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
    return items
  }, [nodes, executions, projects])

  const count = completedItems.length

  return (
    <section className={cn("", className)}>
      {/* Disclosure header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
        <span className="font-medium">Done Today</span>
        {count > 0 && (
          <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
            {count}
          </span>
        )}
      </button>

      {/* Collapsible list */}
      {expanded && (
        <div className="pb-1">
          {count === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground/60 italic">
              No tasks completed today
            </p>
          ) : (
            <ul className="space-y-0.5">
              {completedItems.map((item) => (
                <li key={item.nodeId}>
                  <Link
                    to={`/project/${item.projectId}/task/${item.nodeId}`}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors group"
                  >
                    {/* Project color dot */}
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.projectColor }}
                    />

                    {/* Task title */}
                    <span className="truncate flex-1 text-muted-foreground group-hover:text-foreground transition-colors">
                      {item.title}
                    </span>

                    {/* Completion time */}
                    <span className="shrink-0 text-xs text-muted-foreground/60 tabular-nums">
                      {formatRelativeTime(item.completedAt)}
                    </span>

                    {/* Status icon */}
                    {item.status === "auto_verified" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success/60" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 shrink-0 text-success/60" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
