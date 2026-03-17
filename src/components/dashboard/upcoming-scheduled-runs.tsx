import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { ArrowUpRight, Clock3, Cpu, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/api-url"
import { authHeaders } from "@/lib/auth-headers"
import { formatRelativeTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import type { PlanNode, Project, Schedule } from "@/types"

type MachineSummary = {
  name: string
  connected: boolean
}

type ScheduleWithProject = {
  project: Project
  schedule: Schedule
}

interface UpcomingScheduledRunsProps {
  projects: Project[]
  nodes: PlanNode[]
  machinesById: Map<string, MachineSummary>
}

interface ScheduleListResponse {
  data: Schedule[]
}

function toDate(value?: string | Date | null): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

function formatAbsolute(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function UpcomingScheduledRuns({
  projects,
  nodes,
  machinesById,
}: UpcomingScheduledRunsProps) {
  const [items, setItems] = useState<ScheduleWithProject[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectKey = useMemo(
    () => projects.map((project) => project.id).sort().join(","),
    [projects],
  )

  const projectsRef = useRef(projects)
  projectsRef.current = projects

  const loadSchedules = useCallback(async () => {
    const currentProjects = projectsRef.current
    if (currentProjects.length === 0) {
      setItems([])
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const headers = await authHeaders()
      const results = await Promise.all(
        currentProjects.map(async (project) => {
          const res = await fetch(apiUrl(`/api/schedules?projectId=${project.id}`), { headers })
          if (!res.ok) throw new Error(`Failed to load schedules for ${project.name}`)
          const payload = await res.json() as ScheduleListResponse
          return payload.data.map((schedule) => ({ project, schedule }))
        }),
      )

      setItems(
        results
          .flat()
          .filter((item) => item.schedule.enabled && item.schedule.nextRunAt)
          .sort((a, b) => {
            const aTime = toDate(a.schedule.nextRunAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
            const bTime = toDate(b.schedule.nextRunAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
            return aTime - bTime
          }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedules")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSchedules()
  }, [loadSchedules, projectKey])

  const upcomingItems = useMemo(() => items.slice(0, 6), [items])
  const dueSoonCount = useMemo(() => {
    const now = Date.now()
    const hourMs = 60 * 60 * 1000
    return items.filter((item) => {
      const nextRunAt = toDate(item.schedule.nextRunAt)
      return nextRunAt && nextRunAt.getTime() - now <= hourMs
    }).length
  }, [items])

  if (!loading && !error && upcomingItems.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold tracking-wide">Upcoming Jobs</h2>
          {items.length > 0 && (
            <span className="text-[11px] text-muted-foreground/60">
              {items.length} active
              {dueSoonCount > 0 && <span className="text-info"> · {dueSoonCount} due soon</span>}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadSchedules()}
          disabled={loading}
          className="h-6 px-2 text-[11px] text-muted-foreground/60"
        >
          <RefreshCw className={cn("h-3 w-3 mr-1", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/[0.03] px-4 py-3 text-xs text-destructive/80">
            {error}
          </div>
        ) : loading && upcomingItems.length === 0 ? (
          <div className="rounded-xl glass-panel-subtle px-4 py-6 text-sm text-muted-foreground/60">
            Loading schedules...
          </div>
        ) : (
          upcomingItems.map(({ project, schedule }) => {
            const nextRunAt = toDate(schedule.nextRunAt)
            const lastRunAt = toDate(schedule.lastRunAt)
            const machine = machinesById.get(schedule.targetMachineId)
            const node = schedule.scope === "node"
              ? nodes.find((candidate) => candidate.id === schedule.nodeId)
              : null

            return (
              <Link
                key={schedule.id}
                to={`/project/${project.id}/overview`}
                className={cn(
                  "group rounded-xl glass-panel-subtle px-4 py-3",
                  "transition-all duration-300 ease-out hover:translate-y-[-2px]",
                  "hover:shadow-[0_8px_28px_-6px_rgba(0,0,0,0.1)] hover:border-primary/20",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] font-medium truncate group-hover:text-primary transition-colors">
                        {schedule.name}
                      </span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {schedule.scope === "node" ? "task" : "project"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground/60 truncate">
                      {project.name}
                      {node && ` · ${node.title}`}
                    </p>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary/60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200 shrink-0" />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/70">
                  {nextRunAt && (
                    <div className="flex items-center gap-1.5 rounded-full bg-muted/40 px-2 py-1">
                      <Clock3 className="h-3 w-3" />
                      <span>{formatRelativeTime(nextRunAt)}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{formatAbsolute(nextRunAt)}</span>
                    </div>
                  )}
                  <div className="rounded-full bg-muted/40 px-2 py-1 font-mono">
                    {schedule.cronExpression}
                  </div>
                  <div className="rounded-full bg-muted/40 px-2 py-1">
                    {schedule.timezone}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-1 text-muted-foreground/70">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        machine?.connected ? "bg-emerald-500" : "bg-muted-foreground/30",
                      )}
                    />
                    <Cpu className="h-3 w-3" />
                    <span>{machine?.name || schedule.targetMachineId}</span>
                  </div>
                  {lastRunAt && (
                    <span className="text-muted-foreground/50">
                      Last run {formatRelativeTime(lastRunAt)}
                    </span>
                  )}
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
