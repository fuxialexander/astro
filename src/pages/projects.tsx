import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router"
import { Folder, ListFilter, Plus, ChevronDown, Rocket, FlaskConical, SlidersHorizontal, Users, CircleCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { DAY_WIDTH, parseDate, fmtDate, diffDays, addDays, snapToMonday } from "@/lib/timeline-utils"
import { cn } from "@/lib/utils"
import type { Project } from "@/types"

type ZoomLevel = "month" | "quarter" | "year"

const HEADER_HEIGHT = 48
const ROW_HEIGHT = 64
const LEFT_W = 280

function getProjectBarColors(project: Project) {
  const pct = project.progress ?? 0
  if (pct >= 95) return { bg: "bg-green-400/80", progress: "bg-green-600" }
  switch (project.health) {
    case "off_track": return { bg: "bg-red-400/80", progress: "bg-red-600" }
    case "at_risk": return { bg: "bg-amber-400/80", progress: "bg-amber-600" }
    default:
      if (pct === 0) return { bg: "bg-slate-300 dark:bg-slate-600", progress: "" }
      return { bg: "bg-blue-400/80", progress: "bg-blue-600" }
  }
}

const healthConfig: Record<string, { label: string; dotClass: string; textClass: string }> = {
  on_track: { label: "On track", dotClass: "bg-green-500", textClass: "text-green-600" },
  at_risk: { label: "At risk", dotClass: "bg-amber-500", textClass: "text-amber-600" },
  off_track: { label: "Off track", dotClass: "bg-red-500", textClass: "text-red-600" },
}

const initiativeIcons: Record<string, typeof Rocket> = {
  "Platform Development": Rocket,
  "Research Projects": FlaskConical,
}

const initiativeIconColors: Record<string, string> = {
  "Platform Development": "text-primary",
  "Research Projects": "text-destructive",
}

function formatShortDate(dateStr?: string): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr + "T00:00:00Z")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

type ViewTab = "all" | "timeline" | "board"

export function Projects() {
  const projects = useProjectStore((s) => s.projects)
  const allNodes = usePlanStore((s) => s.nodes)
  const navigate = useNavigate()
  const [viewTab, setViewTab] = useState<ViewTab>("all")
  const [showFilter, setShowFilter] = useState(false)
  const [showDisplay, setShowDisplay] = useState(false)
  const [dayWidth, setDayWidth] = useState(DAY_WIDTH)
  const ganttRef = useRef<HTMLDivElement>(null)
  const dayWidthRef = useRef(dayWidth)
  dayWidthRef.current = dayWidth

  // Derive zoom level from dayWidth for button highlighting
  const activeZoom: ZoomLevel = dayWidth >= 14 ? "month" : dayWidth >= 5 ? "quarter" : "year"

  // Task counts per project
  const projectTaskCounts = useMemo(() => {
    const counts: Record<string, { total: number; completed: number; inProgress: number }> = {}
    for (const p of projects) {
      const nodes = allNodes.filter((n) => n.projectId === p.id && n.type !== "milestone")
      counts[p.id] = {
        total: nodes.length,
        completed: nodes.filter((n) => n.status === "completed" || n.status === "auto_verified").length,
        inProgress: nodes.filter((n) => n.status === "in_progress" || n.status === "dispatched").length,
      }
    }
    return counts
  }, [projects, allNodes])

  // Timeline: always use week columns with variable dayWidth
  const timelineData = useMemo(() => {
    if (viewTab !== "timeline") return null
    const withDates = projects.filter((p) => p.startDate && p.targetDate)
    if (withDates.length === 0) return null

    let minDate = parseDate(withDates[0].startDate!)
    let maxDate = parseDate(withDates[0].targetDate!)
    for (const p of withDates) {
      const s = parseDate(p.startDate!)
      const e = parseDate(p.targetDate!)
      if (s < minDate) minDate = s
      if (e > maxDate) maxDate = e
    }

    const start = snapToMonday(addDays(minDate, -14))
    const end = addDays(maxDate, 14)
    const totalDays = diffDays(start, end)
    const numWeeks = Math.max(12, Math.ceil(totalDays / 7))
    const columns = Array.from({ length: numWeeks }, (_, i) => fmtDate(addDays(start, i * 7)))
    const colWidth = 7 * dayWidth
    return { timelineStart: start, columns, colWidth, totalWidth: columns.length * colWidth }
  }, [projects, dayWidth, viewTab])

  const todayOffset = useMemo(() => {
    if (!timelineData) return 0
    return diffDays(timelineData.timelineStart, new Date()) * dayWidth
  }, [timelineData, dayWidth])

  // Month spans for two-row header
  const monthSpans = useMemo(() => {
    if (!timelineData) return []
    const spans: { label: string; colCount: number }[] = []
    let prevMonth = -1
    let prevYear = -1

    for (const col of timelineData.columns) {
      const d = parseDate(col)
      const m = d.getUTCMonth()
      const y = d.getUTCFullYear()

      if (m === prevMonth && y === prevYear) {
        spans[spans.length - 1].colCount++
      } else {
        const label =
          m === 0 || spans.length === 0
            ? `${d.toLocaleString("default", { month: "long", timeZone: "UTC" })} ${y}`
            : d.toLocaleString("default", { month: "long", timeZone: "UTC" })
        spans.push({ label, colCount: 1 })
        prevMonth = m
        prevYear = y
      }
    }
    return spans
  }, [timelineData])

  // Wheel/pinch zoom — attach non-passive listener for preventDefault
  useEffect(() => {
    const el = ganttRef.current
    if (!el || viewTab !== "timeline") return

    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()

      const currentDW = dayWidthRef.current
      const rect = el!.getBoundingClientRect()
      // Mouse position in gantt content space (offset by left panel)
      const mouseXInGantt = e.clientX - rect.left + el!.scrollLeft - LEFT_W

      const factor = 1 - e.deltaY * 0.005
      const newDW = Math.min(60, Math.max(2, currentDW * factor))

      const ratio = newDW / currentDW
      const newScrollLeft = mouseXInGantt * ratio + LEFT_W - (e.clientX - rect.left)

      setDayWidth(newDW)
      requestAnimationFrame(() => {
        if (el) el.scrollLeft = Math.max(0, newScrollLeft)
      })
    }

    el.addEventListener("wheel", handleWheel, { passive: false })
    return () => el.removeEventListener("wheel", handleWheel)
  }, [viewTab])

  function handleZoomPreset(level: ZoomLevel) {
    switch (level) {
      case "month": setDayWidth(20); break
      case "quarter": setDayWidth(7); break
      case "year": setDayWidth(3); break
    }
  }

  function scrollToToday() {
    if (ganttRef.current) {
      ganttRef.current.scrollLeft = Math.max(0, todayOffset + LEFT_W - ganttRef.current.clientWidth / 2)
    }
  }

  function isTodayColumn(dateStr: string): boolean {
    const colDate = parseDate(dateStr)
    const today = new Date()
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    const colEnd = addDays(colDate, 7)
    return todayStart >= colDate && todayStart < colEnd
  }

  // Group by initiative
  const groups = useMemo(() => {
    return projects.reduce<Record<string, Project[]>>((acc, p) => {
      const group = p.initiative ?? "Other"
      ;(acc[group] ??= []).push(p)
      return acc
    }, {})
  }, [projects])

  // Initiative counts for right panel
  const initiativeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of projects) {
      const init = p.initiative ?? "Other"
      counts[init] = (counts[init] ?? 0) + 1
    }
    return counts
  }, [projects])

  const viewTabs: { id: ViewTab; label: string }[] = [
    { id: "all", label: "All projects" },
    { id: "timeline", label: "Timeline" },
    { id: "board", label: "Board" },
  ]

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-base font-semibold">Projects</span>
            <div className="flex items-center rounded-lg bg-secondary p-1 gap-0.5">
              {viewTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setViewTab(tab.id)}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-[13px] transition-colors cursor-pointer",
                    viewTab === tab.id
                      ? "bg-card font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" asChild>
              <Link to="/projects/new">
                <Plus className="h-3.5 w-3.5" />
                Add project
              </Link>
            </Button>
            <Button
              variant={showDisplay ? "default" : "outline"}
              size="sm"
              onClick={() => setShowDisplay(!showDisplay)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Display
            </Button>
          </div>
        </div>

        {/* Filter / Toolbar Bar */}
        <div className="flex items-center justify-between border-b border-border px-6 py-2 shrink-0">
          <button
            className="flex items-center gap-3 hover:bg-muted/30 rounded-md px-2 py-1 transition-colors cursor-pointer"
            onClick={() => setShowFilter(!showFilter)}
          >
            <ListFilter className={cn("h-4 w-4", showFilter ? "text-primary" : "text-muted-foreground")} />
            <span className={cn("text-sm", showFilter ? "text-foreground" : "text-muted-foreground")}>Filter</span>
          </button>

          {viewTab === "timeline" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={scrollToToday}>
                Today
              </Button>
              <div className="flex items-center rounded-lg bg-secondary p-0.5 gap-0.5">
                {(["month", "quarter", "year"] as ZoomLevel[]).map((level) => (
                  <button
                    key={level}
                    onClick={() => handleZoomPreset(level)}
                    className={cn(
                      "rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer capitalize",
                      activeZoom === level ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs">
                <SlidersHorizontal className="h-3 w-3" />
                Display
              </Button>
            </div>
          )}
        </div>

        {viewTab === "all" && (
          <>
            {/* Column Headers */}
            <div className="flex items-center border-b border-border px-6 h-9 shrink-0">
              <span className="flex-1 text-[13px] font-medium text-muted-foreground">Name</span>
              <span className="w-[100px] text-[13px] font-medium text-muted-foreground">Status</span>
              <span className="w-[100px] text-[13px] font-medium text-muted-foreground">Health</span>
              <span className="w-[80px] text-[13px] font-medium text-muted-foreground">Progress</span>
              <span className="w-[100px] text-[13px] font-medium text-muted-foreground">Target date</span>
            </div>

            {/* Table Body */}
            <div className="flex-1 overflow-auto">
              {projects.length === 0 ? (
                <EmptyState
                  icon={Folder}
                  title="What are you working on?"
                  description="Create your first project and let AI help you break it down into a structured plan with clear dependencies and verification steps."
                  action={{
                    label: "Create Project",
                    onClick: () => navigate("/projects/new"),
                  }}
                  className="h-full"
                />
              ) : (
                Object.entries(groups).map(([initiative, items]) => {
                  const Icon = initiativeIcons[initiative] ?? Users
                  const iconColor = initiativeIconColors[initiative] ?? "text-green-600"
                  return (
                    <div key={initiative}>
                      {/* Initiative Group Header */}
                      <div className="flex items-center gap-2 bg-muted px-6 py-2.5">
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        <Icon className={`h-4 w-4 ${iconColor}`} />
                        <span className="text-sm font-medium">{initiative}</span>
                        <span className="text-[13px] text-muted-foreground">{items.length}</span>
                      </div>

                      {/* Project Rows */}
                      {items.map((project) => {
                        const health = healthConfig[project.health ?? "on_track"]
                        return (
                          <Link
                            key={project.id}
                            to={`/project/${project.id}`}
                            className="flex items-center border-b border-border px-6 pl-12 py-2.5 hover:bg-muted/30 transition-colors"
                          >
                            {/* Name */}
                            <div className="flex flex-1 items-center gap-2.5 min-w-0">
                              <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                              <span className="text-sm truncate">{project.name}</span>
                            </div>

                            {/* Status */}
                            <div className="w-[100px]">
                              <Badge variant="success" className="text-xs">
                                {project.status === "active" ? "Active" : "Archived"}
                              </Badge>
                            </div>

                            {/* Health */}
                            <div className="w-[100px] flex items-center gap-1.5">
                              <span className={`h-2 w-2 rounded-full ${health.dotClass}`} />
                              <span className={`text-xs ${health.textClass}`}>{health.label}</span>
                            </div>

                            {/* Progress */}
                            <div className="w-[80px]">
                              <span className="text-xs">{project.progress ?? 0}%</span>
                            </div>

                            {/* Target Date */}
                            <div className="w-[100px]">
                              <span className={cn(
                                "text-xs",
                                project.targetDate && new Date(project.targetDate + "T00:00:00Z") < new Date() && (project.progress ?? 0) < 100
                                  ? "text-red-500"
                                  : "text-muted-foreground"
                              )}>
                                {formatShortDate(project.targetDate)}
                              </span>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}

        {/* ===== TIMELINE TAB — single scroll container with sticky left panel ===== */}
        {viewTab === "timeline" && timelineData && (
          <div className="flex-1 overflow-auto" ref={ganttRef}>
            <div style={{ width: `${LEFT_W + timelineData.totalWidth}px` }}>
              {/* Sticky header row */}
              <div
                className="sticky top-0 z-20 flex border-b border-border bg-background"
                style={{ height: `${HEADER_HEIGHT}px` }}
              >
                {/* Left header — sticky horizontally */}
                <div
                  className="shrink-0 sticky left-0 z-30 bg-background border-r border-border flex items-end px-4 pb-2"
                  style={{ width: `${LEFT_W}px` }}
                >
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Projects</span>
                </div>

                {/* Column headers */}
                <div className="flex flex-col" style={{ width: `${timelineData.totalWidth}px` }}>
                  {/* Month labels row */}
                  <div className="flex flex-1 items-end">
                    {monthSpans.map((span, i) => (
                      <div
                        key={i}
                        className="shrink-0 px-2 text-xs font-medium text-foreground truncate"
                        style={{ width: `${span.colCount * timelineData.colWidth}px` }}
                      >
                        {span.label}
                      </div>
                    ))}
                  </div>

                  {/* Week day labels row */}
                  <div className="flex flex-1 items-center">
                    {timelineData.columns.map((col) => {
                      const isToday = isTodayColumn(col)
                      return (
                        <span
                          key={col}
                          className="shrink-0 text-center text-[11px] text-muted-foreground"
                          style={{ width: `${timelineData.colWidth}px` }}
                        >
                          {isToday ? (
                            <span className="inline-flex items-center justify-center rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                              {(() => {
                                const today = new Date()
                                return `${today.toLocaleString("default", { month: "short", timeZone: "UTC" }).toUpperCase()} ${today.getUTCDate()}`
                              })()}
                            </span>
                          ) : dayWidth >= 8 ? (
                            `${parseDate(col).getUTCDate()}`
                          ) : null}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Body: grid lines (behind) + rows */}
              <div className="relative" style={{ minHeight: `${projects.length * ROW_HEIGHT}px` }}>
                {/* Grid lines — absolute behind everything */}
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: `${LEFT_W}px`, width: `${timelineData.totalWidth}px` }}
                >
                  {timelineData.columns.map((_, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 w-px bg-border/30"
                      style={{ left: `${i * timelineData.colWidth}px` }}
                    />
                  ))}
                  {/* Today line */}
                  {todayOffset > 0 && todayOffset < timelineData.totalWidth && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-primary/60"
                      style={{ left: `${todayOffset}px` }}
                    />
                  )}
                </div>

                {/* Project rows */}
                {projects.map((proj) => {
                  const counts = projectTaskCounts[proj.id]
                  const pct = proj.progress ?? 0
                  const statusLabel =
                    pct >= 95
                      ? "completed"
                      : (counts?.inProgress ?? 0) > 0
                        ? `${counts.inProgress} in progress`
                        : pct === 0
                          ? "not started"
                          : `${pct}% done`

                  // Bar positioning
                  const hasBar = proj.startDate && proj.targetDate
                  const barLeft = hasBar ? diffDays(timelineData.timelineStart, parseDate(proj.startDate!)) * dayWidth : 0
                  const barWidth = hasBar ? Math.max(diffDays(parseDate(proj.startDate!), parseDate(proj.targetDate!)) * dayWidth, 20) : 0
                  const { bg, progress } = getProjectBarColors(proj)

                  return (
                    <div
                      key={proj.id}
                      className="flex border-b border-border"
                      style={{ height: `${ROW_HEIGHT}px` }}
                    >
                      {/* Left cell — sticky */}
                      <Link
                        to={`/project/${proj.id}`}
                        className="shrink-0 sticky left-0 z-[5] bg-background border-r border-border flex items-center gap-3 px-4 hover:bg-muted/30 transition-colors"
                        style={{ width: `${LEFT_W}px` }}
                      >
                        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{proj.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {counts?.total ?? 0} tasks &middot; {statusLabel}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="h-1.5 w-12 rounded-full bg-border overflow-hidden">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </Link>

                      {/* Gantt cell */}
                      <div className="relative" style={{ width: `${timelineData.totalWidth}px` }}>
                        {hasBar && (
                          <>
                            <Link
                              to={`/project/${proj.id}`}
                              className={cn(
                                "absolute h-8 rounded-md flex items-center overflow-hidden cursor-pointer hover:brightness-95 transition-all",
                                bg
                              )}
                              style={{
                                left: `${barLeft}px`,
                                width: `${barWidth}px`,
                                top: `${(ROW_HEIGHT - 32) / 2}px`,
                              }}
                            >
                              {/* Progress fill */}
                              {progress && pct > 0 && pct < 95 && (
                                <div
                                  className={cn("absolute inset-y-0 left-0 rounded-l-md", progress)}
                                  style={{ width: `${pct}%` }}
                                />
                              )}
                              {/* Label */}
                              <span className="relative z-10 px-2.5 text-xs font-medium text-white truncate">
                                {proj.name}
                              </span>
                            </Link>
                            {/* Completed checkmark */}
                            {pct >= 95 && (
                              <CircleCheck
                                className="absolute h-4 w-4 text-green-600"
                                style={{
                                  left: `${barLeft + barWidth + 6}px`,
                                  top: `${(ROW_HEIGHT - 16) / 2}px`,
                                }}
                              />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {viewTab === "timeline" && !timelineData && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <p className="text-sm">No projects with dates to display</p>
          </div>
        )}

        {viewTab === "board" && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <Folder className="h-8 w-8" />
              <p className="text-sm font-medium">Board view coming soon</p>
              <p className="text-xs">Kanban-style project board</p>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel — Initiatives (hidden in timeline mode) */}
      <div className={cn("flex w-[280px] shrink-0 flex-col border-l border-border bg-card", viewTab === "timeline" && "hidden")}>
        {/* Panel Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 h-12">
          <Folder className="h-4 w-4" />
          <span className="text-sm font-semibold">Projects</span>
        </div>

        {/* Panel Tabs */}
        <div className="flex border-b border-border px-4">
          <button className="border-b-2 border-primary px-3 py-3 text-[13px] font-medium cursor-pointer">Initiatives</button>
          <button className="px-3 py-3 text-[13px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors">Health</button>
        </div>

        {/* Initiative List */}
        <div className="flex flex-col gap-1 p-2">
          {Object.entries(initiativeCounts).map(([name, count]) => {
            const Icon = initiativeIcons[name] ?? Users
            const iconColor = initiativeIconColors[name] ?? "text-green-600"
            return (
              <div key={name} className="flex items-center gap-2.5 rounded-md px-3 py-2.5">
                <Icon className={`h-4 w-4 ${iconColor}`} />
                <span className="flex-1 text-[13px]">{name}</span>
                <span className="text-[13px] text-muted-foreground">{count}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
