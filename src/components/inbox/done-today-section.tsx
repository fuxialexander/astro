import { useMemo } from "react"
import { Link } from "react-router"
import { CheckCircle2, XCircle, ChevronRight } from "lucide-react"
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

  const successCount = completedToday.length
  const failCount = failedToday.length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground/70 uppercase">Done Today</h2>
          <span className="flex items-center gap-1.5">
            {successCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-success/60 font-medium tabular-nums">
                <CheckCircle2 className="h-3 w-3" />
                {successCount}
              </span>
            )}
            {failCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-error/60 font-medium tabular-nums">
                <XCircle className="h-3 w-3" />
                {failCount}
              </span>
            )}
          </span>
        </div>
        <Link
          to="/tasks?status=completed"
          className="flex items-center gap-0.5 text-[11px] text-muted-foreground/50 hover:text-foreground/70 transition-colors px-2"
        >
          View All
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="rounded-xl glass-panel-subtle p-1">
        <div className="flex flex-col">
          {items.map((item, idx) => {
            const project = projects.find((p) => p.id === item.projectId)
            const completedAt = item.executionCompletedAt ?? item.updatedAt
            return (
              <Link
                key={item.id}
                to={`/project/${item.projectId}/task/${item.id}`}
                className={
                  "flex items-center gap-3 py-2.5 px-3 group hover:bg-accent/40 rounded-lg transition-colors " +
                  (idx > 0 ? "border-t border-border/10" : "")
                }
              >
                {item.outcome === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success/60 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-error/60 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate group-hover:text-primary transition-colors">
                    {item.title}
                  </p>
                  {project && (
                    <p className="text-[10px] text-muted-foreground/40 truncate">{project.name}</p>
                  )}
                </div>
                {completedAt && (
                  <span className="text-[10px] text-muted-foreground/35 shrink-0 tabular-nums">
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
