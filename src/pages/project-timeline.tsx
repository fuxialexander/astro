import { useMemo, useState } from "react"
import { useParams, Link } from "react-router"
import { ArrowLeft, Plus, MessageSquare, Filter, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import {
  DAY_WIDTH,
  statusColors,
  progressColors,
  parseDate,
  fmtDate,
  diffDays,
  addDays,
  snapToMonday,
  assignDefaultDates,
} from "@/lib/timeline-utils"
import { cn } from "@/lib/utils"

type ZoomLevel = "month" | "quarter" | "year"

const projectColors = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-rose-500",
]

export function ProjectTimeline() {
  const { id } = useParams()
  const projects = useProjectStore((s) => s.projects)
  const project = projects.find((p) => p.id === id)
  const allNodes = usePlanStore((s) => s.nodes)
  const allEdges = usePlanStore((s) => s.edges)
  const [zoom, setZoom] = useState<ZoomLevel>("month")

  const activeProjects = useMemo(() => projects.filter((p) => p.status === "active"), [projects])

  // Build per-project data for all active projects
  const projectData = useMemo(() => {
    return activeProjects.map((proj, idx) => {
      const projNodes = allNodes.filter((n) => n.projectId === proj.id)
      const projNodeIds = new Set(projNodes.map((n) => n.id))
      const projEdges = allEdges.filter((e) => projNodeIds.has(e.source) || projNodeIds.has(e.target))
      const datedNodes = assignDefaultDates(projNodes, projEdges)

      const total = datedNodes.filter((n) => n.type !== "milestone").length
      const completed = datedNodes.filter(
        (n) => n.type !== "milestone" && (n.status === "completed" || n.status === "auto_verified")
      ).length
      const inProgress = datedNodes.filter(
        (n) => n.type !== "milestone" && (n.status === "in_progress" || n.status === "dispatched")
      ).length
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0

      return {
        project: proj,
        nodes: datedNodes,
        total,
        completed,
        inProgress,
        pct,
        colorClass: projectColors[idx % projectColors.length],
      }
    })
  }, [activeProjects, allNodes, allEdges])

  // Compute timeline bounds across all projects
  const { timelineStart, columns, colWidth, totalWidth } = useMemo(() => {
    const allDatedNodes = projectData.flatMap((pd) => pd.nodes)
    if (allDatedNodes.length === 0) {
      const now = new Date()
      const start = snapToMonday(now)
      const weeks = Array.from({ length: 12 }, (_, i) => fmtDate(addDays(start, i * 7)))
      return { timelineStart: start, columns: weeks, colWidth: 7 * DAY_WIDTH, totalWidth: weeks.length * 7 * DAY_WIDTH }
    }

    let minDate = parseDate(allDatedNodes[0].startDate!)
    let maxDate = parseDate(allDatedNodes[0].endDate!)
    for (const n of allDatedNodes) {
      if (!n.startDate || !n.endDate) continue
      const s = parseDate(n.startDate)
      const e = parseDate(n.endDate)
      if (s < minDate) minDate = s
      if (e > maxDate) maxDate = e
    }

    const start = snapToMonday(addDays(minDate, -14))
    const end = addDays(maxDate, 14)

    if (zoom === "month") {
      const totalDays = diffDays(start, end)
      const numWeeks = Math.max(8, Math.ceil(totalDays / 7))
      const cols = Array.from({ length: numWeeks }, (_, i) => fmtDate(addDays(start, i * 7)))
      const cw = 7 * DAY_WIDTH
      return { timelineStart: start, columns: cols, colWidth: cw, totalWidth: cols.length * cw }
    } else if (zoom === "quarter") {
      const months: string[] = []
      const cur = new Date(start)
      cur.setUTCDate(1)
      while (cur <= end) {
        months.push(fmtDate(new Date(cur)))
        cur.setUTCMonth(cur.getUTCMonth() + 1)
      }
      const cw = 7 * DAY_WIDTH
      return { timelineStart: start, columns: months, colWidth: Math.max(80, cw), totalWidth: months.length * Math.max(80, cw) }
    } else {
      const quarters: string[] = []
      const cur = new Date(start)
      cur.setUTCDate(1)
      cur.setUTCMonth(Math.floor(cur.getUTCMonth() / 3) * 3)
      while (cur <= end) {
        quarters.push(fmtDate(new Date(cur)))
        cur.setUTCMonth(cur.getUTCMonth() + 3)
      }
      const cw = 12 * 7 * DAY_WIDTH / 4
      return { timelineStart: start, columns: quarters, colWidth: Math.max(120, cw), totalWidth: quarters.length * Math.max(120, cw) }
    }
  }, [projectData, zoom])

  const todayOffset = useMemo(() => {
    const today = new Date()
    const days = diffDays(timelineStart, today)
    return days * DAY_WIDTH
  }, [timelineStart])

  function scrollToToday() {
    const ganttArea = document.getElementById("timeline-gantt-scroll")
    if (ganttArea) {
      ganttArea.scrollLeft = Math.max(0, todayOffset - ganttArea.clientWidth / 2)
    }
  }

  function formatColumnHeader(dateStr: string): string {
    const d = parseDate(dateStr)
    if (zoom === "month") {
      return `${d.toLocaleString("default", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`
    } else if (zoom === "quarter") {
      return `${d.toLocaleString("default", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`
    } else {
      const q = Math.floor(d.getUTCMonth() / 3) + 1
      return `Q${q} ${d.getUTCFullYear()}`
    }
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Project not found
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Link to={`/project/${id}`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-[18px] w-[18px]" />
          </Link>
          <span className="font-semibold">{project.name}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">Timeline</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Link to={`/project/${id}/plan`}>
            <div className="flex items-center rounded-lg bg-secondary p-1 gap-0.5">
              <span className="rounded-md px-3.5 py-1 text-xs text-muted-foreground">Graph</span>
              <span className="rounded-md bg-card px-3.5 py-1 text-xs font-medium shadow-sm">Timeline</span>
            </div>
          </Link>
          <Button size="sm" disabled>
            <Plus className="h-3.5 w-3.5" />
            Add Task
          </Button>
          <Button variant="outline" size="sm">
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </Button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Filter</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={scrollToToday}>
            Today
          </Button>
          <div className="flex items-center rounded-lg bg-secondary p-0.5 gap-0.5">
            {(["month", "quarter", "year"] as ZoomLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => setZoom(level)}
                className={cn(
                  "rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer capitalize",
                  zoom === level ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {level}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <Monitor className="h-3 w-3" />
            Display
          </Button>
        </div>
      </div>

      {/* Body: Left panel + Gantt area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: project rows */}
        <div className="w-[360px] shrink-0 border-r border-border flex flex-col">
          <div className="flex h-10 items-center border-b border-border px-4">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Projects</span>
          </div>
          <div className="flex-1 overflow-auto">
            {projectData.map(({ project: proj, total, completed, inProgress, pct, colorClass }) => (
              <Link
                key={proj.id}
                to={`/project/${proj.id}`}
                className={cn(
                  "flex items-center gap-3 border-b border-border px-4 h-14 hover:bg-muted/30 transition-colors",
                  proj.id === id && "bg-muted/50"
                )}
              >
                <div className={cn("h-4 w-4 rounded shrink-0", colorClass)} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{proj.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {total} tasks &middot; {completed} done &middot; {inProgress} active
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="h-1.5 w-12 rounded-full bg-border overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] text-muted-foreground w-7 text-right">{pct}%</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Gantt chart area */}
        <div id="timeline-gantt-scroll" className="flex-1 overflow-auto relative">
          {/* Column headers */}
          <div
            className="sticky top-0 flex h-10 items-center border-b border-border bg-background z-10"
            style={{ width: `${totalWidth}px` }}
          >
            {columns.map((col) => (
              <span
                key={col}
                className="shrink-0 text-center text-[11px] text-muted-foreground font-primary"
                style={{ width: `${colWidth}px` }}
              >
                {formatColumnHeader(col)}
              </span>
            ))}
          </div>

          {/* Grid lines + today line */}
          <div className="absolute top-10 left-0 bottom-0" style={{ width: `${totalWidth}px` }}>
            {columns.map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-border opacity-30"
                style={{ left: `${i * colWidth}px` }}
              />
            ))}
            {todayOffset > 0 && todayOffset < totalWidth && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary opacity-60"
                style={{ left: `${todayOffset}px` }}
              />
            )}
          </div>

          {/* Project Gantt rows */}
          <div className="relative" style={{ width: `${totalWidth}px` }}>
            {projectData.map(({ project: proj, nodes }) => (
              <div key={proj.id} className={cn("flex h-14 items-center border-b border-border relative", proj.id === id && "bg-primary/5")}>
                {nodes
                  .filter((n) => n.startDate && n.endDate)
                  .map((node) => {
                    const start = parseDate(node.startDate!)
                    const end = parseDate(node.endDate!)
                    const barLeft = diffDays(timelineStart, start) * DAY_WIDTH
                    const barWidth = Math.max(diffDays(start, end) * DAY_WIDTH, 4)

                    return (
                      <div
                        key={node.id}
                        className={cn(
                          "absolute h-5 rounded transition-all",
                          statusColors[node.status],
                          node.type === "milestone" && "!rounded-sm"
                        )}
                        style={{ left: `${barLeft}px`, width: `${barWidth}px`, top: "18px" }}
                        title={`${node.title} (${node.status})`}
                      >
                        {progressColors[node.status] && (
                          <div
                            className={cn("h-full rounded-l", progressColors[node.status])}
                            style={{ width: "40%" }}
                          />
                        )}
                      </div>
                    )
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
