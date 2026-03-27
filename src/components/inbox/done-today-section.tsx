import { useMemo } from "react"
import { Link } from "react-router"
import { CheckCircle2, XCircle } from "lucide-react"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { formatRelativeTime } from "@/lib/date-utils"

export function DoneTodaySection() {
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const allExecutions = useExecutionStore((s) => s.executions)

  const todayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [])

  const completedToday = useMemo(() => {
    return nodes
      .filter((n) => {
        if (!["completed", "auto_verified"].includes(n.status)) return false
        const completedAt = n.executionCompletedAt ?? n.updatedAt
        if (!completedAt) return false
        return new Date(completedAt).getTime() >= todayStart
      })
      .sort((a, b) => {
        const aTime = new Date(a.executionCompletedAt ?? a.updatedAt).getTime()
        const bTime = new Date(b.executionCompletedAt ?? b.updatedAt).getTime()
        return bTime - aTime
      })
      .slice(0, 20)
  }, [nodes, todayStart])

  const failedToday = useMemo(() => {
    return nodes
      .filter((n) => {
        if (n.status !== "pruned") return false
        const execution = allExecutions.get(n.id)
        if (!execution || execution.status !== "failure") return false
        const completedAt = n.executionCompletedAt ?? n.updatedAt
        if (!completedAt) return false
        return new Date(completedAt).getTime() >= todayStart
      })
      .slice(0, 10)
  }, [nodes, allExecutions, todayStart])

  const items = useMemo(() => {
    const all = [
      ...completedToday.map((n) => ({ ...n, outcome: "success" as const })),
      ...failedToday.map((n) => ({ ...n, outcome: "failure" as const })),
    ]
    return all.sort((a, b) => {
      const aTime = new Date(a.executionCompletedAt ?? a.updatedAt).getTime()
      const bTime = new Date(b.executionCompletedAt ?? b.updatedAt).getTime()
      return bTime - aTime
    })
  }, [completedToday, failedToday])

  if (items.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold tracking-wide">
          Done Today
          <span className="ml-2 text-[11px] text-muted-foreground/50">({items.length})</span>
        </h2>
        <Link to="/tasks?status=completed" className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors px-2">
          View All
        </Link>
      </div>

      <div className="rounded-xl glass-panel-subtle p-3">
        <div className="flex flex-col divide-y divide-border/20">
          {items.map((item) => {
            const project = projects.find((p) => p.id === item.projectId)
            const completedAt = item.executionCompletedAt ?? item.updatedAt
            return (
              <Link
                key={item.id}
                to={`/project/${item.projectId}/task/${item.id}`}
                className="flex items-center gap-3 py-2.5 px-1 group hover:bg-accent/30 rounded-md transition-colors -mx-1"
              >
                {item.outcome === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success/70 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-error/70 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate group-hover:text-primary transition-colors">
                    {item.title}
                  </p>
                  {project && (
                    <p className="text-[10px] text-muted-foreground/50 truncate">{project.name}</p>
                  )}
                </div>
                {completedAt && (
                  <span className="text-[10px] text-muted-foreground/40 shrink-0">
                    {formatRelativeTime(new Date(completedAt))}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
