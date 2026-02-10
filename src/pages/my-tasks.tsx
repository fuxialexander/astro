import { useMemo, useState, useCallback } from "react"
import {
  CheckSquare,
  ListFilter,
  Circle,
  Loader,
  CheckCircle2,
  Eye,
  Scissors,
  Send,
  Folder,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { BoardView } from "@/components/board/board-view"
import { ItemListView, type ListColumn, type ListGroup } from "@/components/views/item-list-view"
import { ItemTimelineView, type TimelineRow } from "@/components/views/item-timeline-view"
import { FilterSelect } from "@/components/views/filter-select"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { PRIORITY_CONFIG } from "@/lib/constants"
import { statusColors, progressColors, assignDefaultDates } from "@/lib/timeline-utils"
import { formatShortDate, isOverdue } from "@/lib/view-utils"
import { cn } from "@/lib/utils"
import type { PlanNode, Priority } from "@/types"

// --- Status config ---

const STATUS_CONFIG: Record<
  PlanNode["status"],
  { icon: typeof Circle; label: string; color: string; bg: string }
> = {
  planned: { icon: Circle, label: "Planned", color: "text-muted-foreground", bg: "bg-muted" },
  dispatched: { icon: Send, label: "Dispatched", color: "text-blue-600", bg: "bg-blue-500/10" },
  in_progress: { icon: Loader, label: "In Progress", color: "text-blue-600", bg: "bg-blue-500/10" },
  auto_verified: { icon: CheckCircle2, label: "Auto Verified", color: "text-green-600", bg: "bg-green-500/10" },
  awaiting_judgment: { icon: Eye, label: "Needs Review", color: "text-amber-600", bg: "bg-amber-500/10" },
  completed: { icon: CheckCircle2, label: "Completed", color: "text-green-600", bg: "bg-green-500/10" },
  pruned: { icon: Scissors, label: "Pruned", color: "text-muted-foreground", bg: "bg-muted" },
}

// --- Filter types ---

type StatusFilter = PlanNode["status"] | "all"
type PriorityFilter = Priority | "all"

// --- Display config ---

const myTasksDisplayConfig: DisplayPopoverConfig = {
  viewKey: "my-tasks",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "project", label: "Project" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
  ],
  orderByOptions: [
    { value: "updatedAt", label: "Last updated" },
    { value: "name", label: "Name" },
    { value: "priority", label: "Priority" },
    { value: "status", label: "Status" },
    { value: "dueDate", label: "Due date" },
  ],
  propertyOptions: [
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "project", label: "Project" },
    { value: "dueDate", label: "Due date" },
    { value: "estimate", label: "Estimate" },
  ],
}

const myTasksBoardDisplayConfig: DisplayPopoverConfig = {
  viewKey: "my-tasks-board",
  columnByOptions: [
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
  ],
  groupByOptions: [
    { value: "none", label: "No grouping" },
  ],
  orderByOptions: [
    { value: "priority", label: "Priority" },
    { value: "name", label: "Name" },
    { value: "dueDate", label: "Due date" },
    { value: "updatedAt", label: "Last updated" },
  ],
  propertyOptions: [
    { value: "priority", label: "Priority" },
    { value: "project", label: "Project" },
    { value: "dueDate", label: "Due date" },
    { value: "estimate", label: "Estimate" },
  ],
}

const myTasksTimelineDisplayConfig: DisplayPopoverConfig = {
  viewKey: "my-tasks-timeline",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "project", label: "Project" },
    { value: "status", label: "Status" },
  ],
  orderByOptions: [
    { value: "dueDate", label: "Due date" },
    { value: "name", label: "Name" },
    { value: "priority", label: "Priority" },
  ],
  propertyOptions: [],
  showZoom: true,
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
const STATUS_ORDER: Record<string, number> = {
  awaiting_judgment: 0,
  in_progress: 1,
  dispatched: 2,
  planned: 3,
  auto_verified: 4,
  completed: 5,
  pruned: 6,
}

type MyTasksViewMode = "list" | "timeline" | "board"

// --- Column definitions for task list ---
function makeTaskColumns(projectMap: Map<string, string>): ListColumn<PlanNode>[] {
  return [
    {
      id: "name",
      label: "Task",
      width: "flex-1",
      render: (node) => {
        const status = STATUS_CONFIG[node.status]
        const StatusIcon = status.icon
        return (
          <div className="flex items-center gap-2.5 min-w-0">
            <StatusIcon
              className={cn(
                "h-4 w-4 shrink-0",
                status.color,
                node.status === "in_progress" && "animate-spin"
              )}
            />
            <span className="text-sm truncate">{node.title}</span>
          </div>
        )
      },
    },
    {
      id: "status",
      label: "Status",
      width: "w-[120px]",
      render: (node) => {
        const status = STATUS_CONFIG[node.status]
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              status.bg,
              status.color
            )}
          >
            {status.label}
          </span>
        )
      },
    },
    {
      id: "priority",
      label: "Priority",
      width: "w-[90px]",
      render: (node) => {
        const priority = PRIORITY_CONFIG[node.priority ?? "none"]
        const PriorityIcon = priority.icon
        return (
          <div className="flex items-center gap-1.5">
            <PriorityIcon className={cn("h-3.5 w-3.5", priority.color)} />
            <span className="text-xs text-muted-foreground">{priority.label}</span>
          </div>
        )
      },
    },
    {
      id: "project",
      label: "Project",
      width: "w-[140px]",
      render: (node) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground truncate">{projectMap.get(node.projectId) ?? ""}</span>
        </div>
      ),
    },
    {
      id: "dueDate",
      label: "Due date",
      width: "w-[90px]",
      render: (node) => {
        const dueDate = node.dueDate ?? node.endDate
        const overdue = isOverdue(dueDate, node.status)
        return (
          <span className={cn("text-xs", overdue ? "text-red-500 font-medium" : "text-muted-foreground")}>
            {formatShortDate(dueDate)}
          </span>
        )
      },
    },
    {
      id: "estimate",
      label: "Estimate",
      width: "w-[70px]",
      render: (node) => node.estimate ? (
        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {node.estimate}
        </span>
      ) : null,
    },
  ]
}

export function MyTasks() {
  const projects = useProjectStore((s) => s.projects)
  const nodes = usePlanStore((s) => s.nodes)
  const edges = usePlanStore((s) => s.edges)
  const displaySettings = useDisplaySettingsStore((s) => s.get("my-tasks"))
  const boardSettings = useDisplaySettingsStore((s) => s.get("my-tasks-board"))
  const updateNode = usePlanStore((s) => s.updateNode)

  const [viewMode, setViewMode] = useState<MyTasksViewMode>("list")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all")
  const [projectFilter, setProjectFilter] = useState<string>("all")
  const [showFilters, setShowFilters] = useState(false)

  const projectMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of projects) m.set(p.id, p.name)
    return m
  }, [projects])

  const columns = useMemo(() => makeTaskColumns(projectMap), [projectMap])

  // Filter tasks
  const filteredTasks = useMemo(() => {
    let tasks = nodes.filter((n) => n.type !== "milestone")
    if (!displaySettings.showCompleted) {
      tasks = tasks.filter((n) => n.status !== "completed" && n.status !== "auto_verified" && n.status !== "pruned")
    }
    if (statusFilter !== "all") tasks = tasks.filter((n) => n.status === statusFilter)
    if (priorityFilter !== "all") tasks = tasks.filter((n) => (n.priority ?? "none") === priorityFilter)
    if (projectFilter !== "all") tasks = tasks.filter((n) => n.projectId === projectFilter)
    return tasks
  }, [nodes, displaySettings.showCompleted, statusFilter, priorityFilter, projectFilter])

  // Sort
  const sortedTasks = useMemo(() => {
    const sorted = [...filteredTasks]
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    sorted.sort((a, b) => {
      switch (displaySettings.orderBy) {
        case "name":
          return dir * a.title.localeCompare(b.title)
        case "priority":
          return dir * ((PRIORITY_ORDER[a.priority ?? "none"] ?? 4) - (PRIORITY_ORDER[b.priority ?? "none"] ?? 4))
        case "status":
          return dir * ((STATUS_ORDER[a.status] ?? 6) - (STATUS_ORDER[b.status] ?? 6))
        case "dueDate": {
          const da = a.dueDate ?? a.endDate ?? ""
          const db = b.dueDate ?? b.endDate ?? ""
          if (!da && !db) return 0
          if (!da) return dir
          if (!db) return -dir
          return dir * da.localeCompare(db)
        }
        case "updatedAt":
          return dir * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
        default:
          return 0
      }
    })
    return sorted
  }, [filteredTasks, displaySettings.orderBy, displaySettings.orderDirection])

  // Group for list view
  const listGroups = useMemo((): ListGroup<PlanNode>[] => {
    if (displaySettings.groupBy === "none") {
      return [{ key: "all", label: "All Tasks", items: sortedTasks }]
    }
    const grouped = sortedTasks.reduce<Record<string, PlanNode[]>>((acc, node) => {
      let group: string
      switch (displaySettings.groupBy) {
        case "project":
          group = projectMap.get(node.projectId) ?? "Unknown Project"
          break
        case "status":
          group = STATUS_CONFIG[node.status]?.label ?? node.status
          break
        case "priority":
          group = PRIORITY_CONFIG[node.priority ?? "none"]?.label ?? "None"
          break
        default:
          group = "All Tasks"
      }
      ;(acc[group] ??= []).push(node)
      return acc
    }, {})
    return Object.entries(grouped).map(([label, items]) => {
      let icon = undefined
      if (displaySettings.groupBy === "project") {
        icon = <Folder className="h-4 w-4 text-blue-500" />
      } else if (displaySettings.groupBy === "status") {
        const entry = Object.values(STATUS_CONFIG).find((s) => s.label === label)
        if (entry) {
          const Icon = entry.icon
          icon = <Icon className={cn("h-4 w-4", entry.color)} />
        }
      } else if (displaySettings.groupBy === "priority") {
        const entry = Object.values(PRIORITY_CONFIG).find((p) => p.label === label)
        if (entry) {
          const Icon = entry.icon
          icon = <Icon className={cn("h-4 w-4", entry.color)} />
        }
      }
      return { key: label, label, icon, items }
    })
  }, [sortedTasks, displaySettings.groupBy, projectMap])

  // Timeline rows
  const timelineRows = useMemo((): TimelineRow<PlanNode>[] => {
    const datedTasks = assignDefaultDates(sortedTasks, edges)
    const timelineDisplaySettings = useDisplaySettingsStore.getState().get("my-tasks-timeline")

    function nodeToRow(node: PlanNode): TimelineRow<PlanNode> {
      const dated = datedTasks.find((n) => n.id === node.id) ?? node
      return {
        kind: "item",
        item: node,
        timeline: {
          id: node.id,
          startDate: dated.startDate ?? "",
          endDate: dated.endDate ?? "",
          barClass: statusColors[node.status] ?? "bg-primary/70",
          progressClass: progressColors[node.status],
          progressPct: progressColors[node.status] ? 40 : undefined,
          label: node.title,
        },
      }
    }

    if (timelineDisplaySettings.groupBy === "project") {
      const rows: TimelineRow<PlanNode>[] = []
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of sortedTasks) {
        const name = projectMap.get(node.projectId) ?? "Unknown"
        ;(grouped[name] ??= []).push(node)
      }
      for (const [label, items] of Object.entries(grouped)) {
        rows.push({ kind: "header", label, count: items.length })
        for (const item of items) rows.push(nodeToRow(item))
      }
      return rows
    }

    if (timelineDisplaySettings.groupBy === "status") {
      const rows: TimelineRow<PlanNode>[] = []
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of sortedTasks) {
        const key = STATUS_CONFIG[node.status]?.label ?? node.status
        ;(grouped[key] ??= []).push(node)
      }
      for (const [label, items] of Object.entries(grouped)) {
        rows.push({ kind: "header", label, count: items.length })
        for (const item of items) rows.push(nodeToRow(item))
      }
      return rows
    }

    return sortedTasks.map(nodeToRow)
  }, [sortedTasks, edges, projectMap])

  // Stats
  const activeCount = nodes.filter((n) => n.type !== "milestone" && (n.status === "in_progress" || n.status === "dispatched")).length
  const needsReviewCount = nodes.filter((n) => n.type !== "milestone" && n.status === "awaiting_judgment").length
  const hasActiveFilters = statusFilter !== "all" || priorityFilter !== "all" || projectFilter !== "all"

  const clearFilters = () => {
    setStatusFilter("all")
    setPriorityFilter("all")
    setProjectFilter("all")
  }

  const getProjectName = useCallback((node: PlanNode) => projectMap.get(node.projectId), [projectMap])
  const handleBoardNodeSelect = useCallback((node: PlanNode) => {
    window.location.href = `/project/${node.projectId}/plan`
  }, [])
  const handleBoardNodeUpdate = useCallback((id: string, updates: Partial<PlanNode>) => {
    updateNode(id, updates)
  }, [updateNode])

  const emptyState = (
    <EmptyState
      icon={CheckSquare}
      title={hasActiveFilters ? "No matching tasks" : "No tasks yet"}
      description={
        hasActiveFilters
          ? "Try adjusting your filters to see more tasks."
          : "Tasks from all your projects will appear here. Create a project and generate a plan to get started."
      }
      action={
        hasActiveFilters
          ? { label: "Clear Filters", onClick: clearFilters }
          : { label: "View Projects", href: "/projects" }
      }
      className="h-full"
    />
  )

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold">My Tasks</span>
          {activeCount > 0 && (
            <Badge variant="info" className="text-xs">
              {activeCount} active
            </Badge>
          )}
          {needsReviewCount > 0 && (
            <Badge variant="warning" className="text-xs">
              {needsReviewCount} review
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-secondary p-1 gap-0.5">
            {(["list", "timeline", "board"] as MyTasksViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "rounded-md px-3.5 py-1 text-xs font-medium transition-colors cursor-pointer capitalize",
                  viewMode === mode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          {viewMode === "list" && <DisplayPopover config={myTasksDisplayConfig} />}
          {viewMode === "timeline" && <DisplayPopover config={myTasksTimelineDisplayConfig} />}
          {viewMode === "board" && <DisplayPopover config={myTasksBoardDisplayConfig} />}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-2 shrink-0">
        <button
          className="flex items-center gap-2 hover:bg-muted/30 rounded-md px-2 py-1 transition-colors cursor-pointer"
          onClick={() => setShowFilters(!showFilters)}
        >
          <ListFilter className={cn("h-4 w-4", showFilters ? "text-primary" : "text-muted-foreground")} />
          <span className={cn("text-sm", showFilters ? "text-foreground" : "text-muted-foreground")}>Filter</span>
        </button>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}

        {showFilters && (
          <div className="flex items-center gap-2 ml-2">
            <FilterSelect
              label="Status"
              value={statusFilter}
              options={[
                { value: "all", label: "All statuses" },
                { value: "planned", label: "Planned" },
                { value: "dispatched", label: "Dispatched" },
                { value: "in_progress", label: "In Progress" },
                { value: "awaiting_judgment", label: "Needs Review" },
                { value: "completed", label: "Completed" },
                { value: "pruned", label: "Pruned" },
              ]}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
            />
            <FilterSelect
              label="Priority"
              value={priorityFilter}
              options={[
                { value: "all", label: "All priorities" },
                { value: "urgent", label: "Urgent" },
                { value: "high", label: "High" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low" },
                { value: "none", label: "None" },
              ]}
              onChange={(v) => setPriorityFilter(v as PriorityFilter)}
            />
            <FilterSelect
              label="Project"
              value={projectFilter}
              options={[
                { value: "all", label: "All projects" },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={setProjectFilter}
            />
          </div>
        )}
      </div>

      {viewMode === "board" ? (
        <div className="flex-1 overflow-hidden">
          {sortedTasks.length === 0 ? (
            emptyState
          ) : (
            <BoardView
              nodes={sortedTasks}
              columnBy={(boardSettings.columnBy ?? "status") as "status" | "priority" | "milestone"}
              visibleProperties={boardSettings.visibleProperties}
              showCompleted={boardSettings.showCompleted}
              orderBy={boardSettings.orderBy}
              orderDirection={boardSettings.orderDirection}
              projectName={getProjectName}
              onNodeSelect={handleBoardNodeSelect}
              onNodeUpdate={handleBoardNodeUpdate}
            />
          )}
        </div>
      ) : viewMode === "timeline" ? (
        sortedTasks.length === 0 ? (
          emptyState
        ) : (
          <ItemTimelineView
            rows={timelineRows}
            viewKey="my-tasks-timeline"
            renderLeftCell={(node) => (
              <div className="flex items-center gap-2 min-w-0 w-full">
                {(() => {
                  const status = STATUS_CONFIG[node.status]
                  const StatusIcon = status.icon
                  return <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", status.color)} />
                })()}
                <span className="text-sm truncate">{node.title}</span>
              </div>
            )}
            onItemClick={(node) => { window.location.href = `/project/${node.projectId}/plan` }}
          />
        )
      ) : (
        sortedTasks.length === 0 ? (
          <div className="flex-1 overflow-auto">{emptyState}</div>
        ) : (
          <ItemListView
            columns={columns}
            groups={listGroups}
            visibleColumns={displaySettings.visibleProperties}
            onItemClick={(node) => { window.location.href = `/project/${node.projectId}/plan` }}
            getItemId={(n) => n.id}
          />
        )
      )}
    </div>
  )
}
