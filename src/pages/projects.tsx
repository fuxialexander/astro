import { useMemo, useState, useCallback } from "react"
import { Link, useNavigate } from "react-router"
import { Folder, ListFilter, Plus, Rocket, FlaskConical, Users, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { FilterSelect } from "@/components/views/filter-select"
import { ItemListView, type ListColumn, type ListGroup, type BatchAction } from "@/components/views/item-list-view"
import { ItemTimelineView, type TimelineRow } from "@/components/views/item-timeline-view"
import { ColorIconBadge } from "@/components/color-icon-picker"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { useInitiativeStore } from "@/stores/initiative-store"
import { fmtDate, addDays, isValidDateStr } from "@/lib/timeline-utils"
import { formatShortDate, isOverdue } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import type { Project } from "@/types"

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

const projectsDisplayConfig: DisplayPopoverConfig = {
  viewKey: "projects",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "initiative", label: "Initiative" },
    { value: "status", label: "Status" },
    { value: "health", label: "Health" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "targetDate", label: "Target date" },
    { value: "progress", label: "Progress" },
    { value: "health", label: "Health" },
  ],
  propertyOptions: [
    { value: "status", label: "Status" },
    { value: "health", label: "Health" },
    { value: "progress", label: "Progress" },
    { value: "targetDate", label: "Target date" },
  ],
}

const projectsTimelineDisplayConfig: DisplayPopoverConfig = {
  viewKey: "projects-timeline",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "initiative", label: "Initiative" },
    { value: "status", label: "Status" },
    { value: "health", label: "Health" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "targetDate", label: "Target date" },
    { value: "progress", label: "Progress" },
    { value: "health", label: "Health" },
  ],
  propertyOptions: [],
  showZoom: true,
}

// --- Column definitions for project list ---
const PROJECT_COLUMNS: ListColumn<Project>[] = [
  {
    id: "name",
    label: "Name",
    width: "flex-1",
    sortKey: "name",
    render: (p) => (
      <Link
        to={`/project/${p.id}`}
        className="flex items-center gap-2.5 min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <ColorIconBadge
          color={p.color}
          icon={p.icon}
          type="project"
        />
        <span className="text-sm truncate">{p.name}</span>
      </Link>
    ),
  },
  {
    id: "status",
    label: "Status",
    width: "w-[100px]",
    render: (p) => (
      <Badge variant="success" className="text-xs">
        {p.status === "active" ? "Active" : "Archived"}
      </Badge>
    ),
  },
  {
    id: "health",
    label: "Health",
    width: "w-[100px]",
    sortKey: "health",
    render: (p) => {
      const health = healthConfig[p.health ?? "on_track"]
      return (
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${health.dotClass}`} />
          <span className={`text-xs ${health.textClass}`}>{health.label}</span>
        </div>
      )
    },
  },
  {
    id: "progress",
    label: "Progress",
    width: "w-[80px]",
    sortKey: "progress",
    render: (p) => <span className="text-xs">{p.progress ?? 0}%</span>,
  },
  {
    id: "targetDate",
    label: "Target date",
    width: "w-[100px]",
    sortKey: "targetDate",
    render: (p) => (
      <span className={cn(
        "text-xs",
        isOverdue(p.targetDate, (p.progress ?? 0) >= 100 ? "completed" : "planned")
          ? "text-red-500"
          : "text-muted-foreground"
      )}>
        {formatShortDate(p.targetDate) || "\u2014"}
      </span>
    ),
  },
]

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

type ViewTab = "all" | "timeline" | "board"

export function Projects() {
  const projects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const rawAllNodes = usePlanStore((s) => s.nodes)
  const allNodes = useMemo(() => rawAllNodes.filter(isLive), [rawAllNodes])
  const initiatives = useInitiativeStore((s) => s.initiatives)
  const navigate = useNavigate()
  const displaySettings = useDisplaySettingsStore((s) => s.get("projects"))
  const updateDisplaySettings = useDisplaySettingsStore((s) => s.update)
  const [viewTab, setViewTab] = useState<ViewTab>("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [healthFilter, setHealthFilter] = useState("all")
  const [initiativeFilter, setInitiativeFilter] = useState("all")

  // Helper to get initiative name from ID
  const getInitiativeName = useCallback((initiativeId?: string) => {
    if (!initiativeId) return undefined
    return initiatives.find(i => i.id === initiativeId)?.name
  }, [initiatives])

  const projectBatchActions: BatchAction[] = useMemo(() => [
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: "destructive",
      onAction: (ids) => { for (const id of ids) deleteProject(id) },
    },
  ], [deleteProject])

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

  // Sort projects
  const sortedProjects = useMemo(() => {
    let filtered = displaySettings.showCompleted
      ? projects
      : projects.filter((p) => (p.progress ?? 0) < 100)
    if (statusFilter !== "all") {
      filtered = filtered.filter((p) => p.status === statusFilter)
    }
    if (healthFilter !== "all") {
      filtered = filtered.filter((p) => p.health === healthFilter)
    }
    if (initiativeFilter !== "all") {
      filtered = filtered.filter((p) => p.initiativeId === initiativeFilter)
    }
    const sorted = [...filtered]
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    sorted.sort((a, b) => {
      switch (displaySettings.orderBy) {
        case "name":
          return dir * a.name.localeCompare(b.name)
        case "targetDate": {
          const da = a.targetDate ?? ""
          const db = b.targetDate ?? ""
          return dir * da.localeCompare(db)
        }
        case "progress":
          return dir * ((a.progress ?? 0) - (b.progress ?? 0))
        case "health": {
          const order = { on_track: 0, at_risk: 1, off_track: 2 }
          return dir * ((order[a.health ?? "on_track"] ?? 0) - (order[b.health ?? "on_track"] ?? 0))
        }
        default:
          return 0
      }
    })
    return sorted
  }, [projects, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted, statusFilter, healthFilter, initiativeFilter])

  // Group projects for list view
  const listGroups = useMemo((): ListGroup<Project>[] => {
    if (displaySettings.groupBy === "none") {
      return [{ key: "all", label: "All Projects", items: sortedProjects }]
    }
    const grouped = sortedProjects.reduce<Record<string, Project[]>>((acc, p) => {
      let group: string
      switch (displaySettings.groupBy) {
        case "initiative":
          group = getInitiativeName(p.initiativeId) ?? "Other"
          break
        case "status":
          group = p.status === "active" ? "Active" : "Archived"
          break
        case "health":
          group = healthConfig[p.health ?? "on_track"]?.label ?? "On track"
          break
        default:
          group = "All Projects"
      }
      ;(acc[group] ??= []).push(p)
      return acc
    }, {})
    return Object.entries(grouped).map(([label, items]) => {
      const Icon = displaySettings.groupBy === "initiative" ? (initiativeIcons[label] ?? Users) : Folder
      const iconColor = displaySettings.groupBy === "initiative" ? (initiativeIconColors[label] ?? "text-green-600") : "text-muted-foreground"
      return {
        key: label,
        label,
        icon: <Icon className={`h-4 w-4 ${iconColor}`} />,
        items,
      }
    })
  }, [sortedProjects, displaySettings.groupBy, getInitiativeName])

  // Timeline-specific settings
  const timelineDisplaySettings = useDisplaySettingsStore((s) => s.get("projects-timeline"))

  // Derive date ranges for projects that lack explicit startDate/targetDate
  // by looking at their plan nodes' startDate/endDate
  const projectDateRanges = useMemo(() => {
    const ranges: Record<string, { startDate: string; targetDate: string }> = {}
    for (const p of projects) {
      if (isValidDateStr(p.startDate) && isValidDateStr(p.targetDate)) {
        ranges[p.id] = { startDate: p.startDate, targetDate: p.targetDate }
        continue
      }
      // Derive from plan nodes
      const projectNodes = allNodes.filter((n) => n.projectId === p.id)
      let minDate: string | undefined
      let maxDate: string | undefined
      for (const n of projectNodes) {
        if (isValidDateStr(n.startDate) && (!minDate || n.startDate < minDate)) minDate = n.startDate
        if (isValidDateStr(n.endDate) && (!maxDate || n.endDate > maxDate)) maxDate = n.endDate
        if (isValidDateStr(n.dueDate) && (!maxDate || n.dueDate > maxDate)) maxDate = n.dueDate
      }
      const today = fmtDate(new Date())
      ranges[p.id] = {
        startDate: p.startDate ?? minDate ?? today,
        targetDate: p.targetDate ?? maxDate ?? fmtDate(addDays(new Date(), 30)),
      }
    }
    return ranges
  }, [projects, allNodes])

  // Sort projects for timeline (uses timeline display settings)
  const timelineSortedProjects = useMemo(() => {
    const filtered = timelineDisplaySettings.showCompleted
      ? projects
      : projects.filter((p) => (p.progress ?? 0) < 100)
    const sorted = [...filtered]
    const dir = timelineDisplaySettings.orderDirection === "asc" ? 1 : -1
    sorted.sort((a, b) => {
      switch (timelineDisplaySettings.orderBy) {
        case "name":
          return dir * a.name.localeCompare(b.name)
        case "targetDate": {
          const da = projectDateRanges[a.id]?.targetDate ?? ""
          const db = projectDateRanges[b.id]?.targetDate ?? ""
          return dir * da.localeCompare(db)
        }
        case "progress":
          return dir * ((a.progress ?? 0) - (b.progress ?? 0))
        case "health": {
          const order = { on_track: 0, at_risk: 1, off_track: 2 }
          return dir * ((order[a.health ?? "on_track"] ?? 0) - (order[b.health ?? "on_track"] ?? 0))
        }
        default:
          return 0
      }
    })
    return sorted
  }, [projects, projectDateRanges, timelineDisplaySettings.orderBy, timelineDisplaySettings.orderDirection, timelineDisplaySettings.showCompleted])

  // Timeline rows (with grouping support)
  const timelineRows = useMemo((): TimelineRow<Project>[] => {
    const makeItemRow = (p: Project): TimelineRow<Project> => {
      const { bg, progress } = getProjectBarColors(p)
      const pct = p.progress ?? 0
      const dates = projectDateRanges[p.id]
      return {
        kind: "item" as const,
        item: p,
        timeline: {
          id: p.id,
          startDate: dates?.startDate ?? "",
          endDate: dates?.targetDate ?? "",
          barClass: bg,
          progressClass: progress || undefined,
          progressPct: pct,
          label: p.name,
        },
      }
    }

    if (timelineDisplaySettings.groupBy === "none") {
      return timelineSortedProjects.map(makeItemRow)
    }

    // Group projects
    const grouped: Record<string, Project[]> = {}
    for (const p of timelineSortedProjects) {
      let group: string
      switch (timelineDisplaySettings.groupBy) {
        case "initiative":
          group = getInitiativeName(p.initiativeId) ?? "Other"
          break
        case "status":
          group = p.status === "active" ? "Active" : "Archived"
          break
        case "health":
          group = healthConfig[p.health ?? "on_track"]?.label ?? "On track"
          break
        default:
          group = "All Projects"
      }
      ;(grouped[group] ??= []).push(p)
    }

    const result: TimelineRow<Project>[] = []
    for (const [label, items] of Object.entries(grouped)) {
      result.push({ kind: "header", label, count: items.length })
      for (const p of items) {
        result.push(makeItemRow(p))
      }
    }
    return result
  }, [timelineSortedProjects, projectDateRanges, timelineDisplaySettings.groupBy, getInitiativeName])

  const handleSort = useCallback((sortKey: string) => {
    if (displaySettings.orderBy === sortKey) {
      updateDisplaySettings("projects", {
        orderDirection: displaySettings.orderDirection === "asc" ? "desc" : "asc",
      })
    } else {
      updateDisplaySettings("projects", { orderBy: sortKey, orderDirection: "asc" })
    }
  }, [displaySettings.orderBy, displaySettings.orderDirection, updateDisplaySettings])

  const viewTabs: { id: ViewTab; label: string }[] = [
    { id: "all", label: "All projects" },
    { id: "timeline", label: "Timeline" },
    { id: "board", label: "Board" },
  ]

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold font-secondary">Projects</h1>
            <div className="flex items-center gap-1">
              {viewTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setViewTab(tab.id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
                    viewTab === tab.id
                      ? "text-accent-foreground border-b-2 border-accent"
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
            {viewTab !== "timeline" && <DisplayPopover config={projectsDisplayConfig} />}
            {viewTab === "timeline" && <DisplayPopover config={projectsTimelineDisplayConfig} />}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Filter</span>
          </div>
          <div className="flex items-center gap-3">
            <FilterSelect
              label="Status"
              value={statusFilter}
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "archived", label: "Archived" },
              ]}
              onChange={setStatusFilter}
            />
            <FilterSelect
              label="Health"
              value={healthFilter}
              options={[
                { value: "all", label: "All health" },
                { value: "on_track", label: "On track" },
                { value: "at_risk", label: "At risk" },
                { value: "off_track", label: "Off track" },
              ]}
              onChange={setHealthFilter}
            />
            <FilterSelect
              label="Initiative"
              value={initiativeFilter}
              options={[
                { value: "all", label: "All initiatives" },
                ...initiatives.map((i) => ({ value: i.id, label: i.name })),
              ]}
              onChange={setInitiativeFilter}
            />
          </div>
        </div>

        {viewTab === "all" && (
          projects.length === 0 ? (
            <div className="flex-1 overflow-auto">
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
            </div>
          ) : (
            <ItemListView
              columns={PROJECT_COLUMNS}
              groups={listGroups}
              visibleColumns={displaySettings.visibleProperties}
              onItemClick={(p) => navigate(`/project/${p.id}/graph`)}
              getItemId={(p) => p.id}
              batchActions={projectBatchActions}
              sortColumn={displaySettings.orderBy}
              sortDirection={displaySettings.orderDirection}
              onSort={handleSort}
            />
          )
        )}

        {viewTab === "timeline" && (
          timelineRows.length > 0 ? (
            <ItemTimelineView
              rows={timelineRows}
              viewKey="projects-timeline"
              leftHeader="Projects"
              rowHeight={64}
              renderLeftCell={(proj) => {
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
                return (
                  <Link
                    to={`/project/${proj.id}`}
                    className="flex items-center gap-3 w-full hover:bg-muted/30 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ColorIconBadge
                      color={proj.color}
                      icon={proj.icon}
                      type="project"
                    />
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
                )
              }}
              onItemClick={(proj) => navigate(`/project/${proj.id}/graph`)}
              onDateChange={(id, startDate, endDate) => updateProject(id, { startDate, targetDate: endDate })}
            />
          ) : (
            <div className="flex-1 overflow-auto">
              <EmptyState
                icon={Folder}
                title="No projects to display"
                description="Create a project to see it on the timeline."
                action={{ label: "Create Project", onClick: () => navigate("/projects/new") }}
                className="h-full"
              />
            </div>
          )
        )}

        {viewTab === "board" && (
          <div className="flex flex-1 overflow-x-auto p-4 gap-4">
            {projects.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={Folder}
                  title="What are you working on?"
                  description="Create your first project and let AI help you break it down into a structured plan."
                  action={{
                    label: "Create Project",
                    onClick: () => navigate("/projects/new"),
                  }}
                />
              </div>
            ) : (
              (() => {
                const boardColumns: { key: string; label: string; dotClass: string; projects: Project[] }[] = [
                  { key: "on_track", label: "On track", dotClass: "bg-green-500", projects: [] },
                  { key: "at_risk", label: "At risk", dotClass: "bg-amber-500", projects: [] },
                  { key: "off_track", label: "Off track", dotClass: "bg-red-500", projects: [] },
                ]
                for (const p of sortedProjects) {
                  const h = p.health ?? "on_track"
                  const col = boardColumns.find((c) => c.key === h)
                  if (col) col.projects.push(p)
                }
                return boardColumns.map((col) => (
                  <div key={col.key} className="flex w-[300px] shrink-0 flex-col rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2 px-3 py-3">
                      <span className={cn("h-2.5 w-2.5 rounded-full", col.dotClass)} />
                      <span className="text-sm font-medium">{col.label}</span>
                      <span className="text-xs text-muted-foreground">{col.projects.length}</span>
                    </div>
                    <div className="flex flex-col gap-2 px-2 pb-2 overflow-y-auto">
                      {col.projects.map((project) => {
                        const counts = projectTaskCounts[project.id]
                        const pct = project.progress ?? 0
                        return (
                          <Link
                            key={project.id}
                            to={`/project/${project.id}`}
                            className="rounded-lg border border-border bg-card p-3 hover:border-primary/40 hover:shadow-sm transition-all"
                          >
                            <div className="flex items-start gap-2 mb-2">
                              <ColorIconBadge
                                color={project.color}
                                icon={project.icon}
                                type="project"
                              />
                              <span className="text-sm font-medium leading-snug">{project.name}</span>
                            </div>
                            <div className="mb-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] text-muted-foreground">{pct}% complete</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {counts?.completed ?? 0}/{counts?.total ?? 0} tasks
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    pct >= 95 ? "bg-green-500" : pct > 0 ? "bg-primary" : ""
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                              {getInitiativeName(project.initiativeId) && (
                                <span className="truncate">{getInitiativeName(project.initiativeId)}</span>
                              )}
                              {project.targetDate && (
                                <span className={cn(
                                  "shrink-0",
                                  isOverdue(project.targetDate, pct >= 100 ? "completed" : "planned")
                                    ? "text-red-500"
                                    : ""
                                )}>
                                  {formatShortDate(project.targetDate)}
                                </span>
                              )}
                            </div>
                          </Link>
                        )
                      })}
                      {col.projects.length === 0 && (
                        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                          No projects
                        </div>
                      )}
                    </div>
                  </div>
                ))
              })()
            )}
          </div>
        )}
    </div>
  )
}
