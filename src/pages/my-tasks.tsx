import { useMemo, useState, useCallback, useEffect } from "react"
import { useSearchParams } from "react-router"
import {
  CheckSquare,
  ListFilter,
  Folder,
  X,
  Plus,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { TaskRow } from "@/components/task-row"
import { TaskCreationForm } from "@/components/task-creation-form"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { BoardView } from "@/components/board/board-view"
import { type ListGroup } from "@/components/views/item-list-view"
import { ItemTimelineView, type TimelineRow } from "@/components/views/item-timeline-view"
import { FilterSelect } from "@/components/views/filter-select"
import { PlanListView, PlanTimelineView, PlanBoardView } from "@/pages/plan-view"
import { NodeInspectorSheet, NodeInspectorSidebar } from "@/components/node-inspector"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { PRIORITY_CONFIG } from "@/lib/constants"
import { STATUS_CONFIG, statusBarColors, statusProgressColors } from "@/lib/status-config"
import { assignDefaultDates } from "@/lib/timeline-utils"
import { cn } from "@/lib/utils"
import type { PlanNode, Priority } from "@/types"

// Media query hook for responsive rendering
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia(query).matches
    }
    return false
  })

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mediaQuery.addEventListener("change", handler)
    return () => mediaQuery.removeEventListener("change", handler)
  }, [query])

  return matches
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
    { value: "pr", label: "PR" },
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
    { value: "pr", label: "PR" },
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


export function MyTasks() {
  const projects = useProjectStore((s) => s.projects)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const rawEdges = usePlanStore((s) => s.edges)
  const edges = useMemo(() => rawEdges.filter(isLive), [rawEdges])
  const displaySettings = useDisplaySettingsStore((s) => s.get("my-tasks"))
  const boardSettings = useDisplaySettingsStore((s) => s.get("my-tasks-board"))
  const updateNode = usePlanStore((s) => s.updateNode)
  const isDesktop = useMediaQuery("(min-width: 1024px)")

  const [searchParams, setSearchParams] = useSearchParams()
  const [viewMode, setViewMode] = useState<MyTasksViewMode>("list")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const param = searchParams.get("status")
    const validStatuses = ["planned", "dispatched", "in_progress", "auto_verified", "awaiting_judgment", "completed", "pruned"]
    return param && validStatuses.includes(param) ? param as StatusFilter : "all"
  })
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all")
  const [projectFilter, setProjectFilter] = useState<string>("all")
  const [creatingInGroup, setCreatingInGroup] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)

  // Clear URL search params after initializing filters
  useEffect(() => {
    if (searchParams.has("status")) {
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projectMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of projects) m.set(p.id, p.name)
    return m
  }, [projects])

  // Reverse map: project name -> project id (for cross-project task creation)
  const projectNameToIdMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of projects) m.set(p.name, p.id)
    return m
  }, [projects])

  // Node inspector: resolve selected node's project
  const handleNodeSelect = useCallback((node: PlanNode | null) => {
    setSelectedNode(node)
  }, [])

  const selectedNodeProject = useMemo(() => {
    if (!selectedNode) return null
    return projects.find((p) => p.id === selectedNode.projectId) ?? null
  }, [selectedNode, projects])

  // Filter tasks
  const filteredTasks = useMemo(() => {
    let tasks = nodes.filter((n) => n.type !== "milestone")
    // Apply showCompleted filter only if no explicit status filter is set
    // This allows users to filter for completed tasks even when showCompleted is false
    if (!displaySettings.showCompleted && statusFilter === "all") {
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
        icon = <Folder className="h-4 w-4 text-info" />
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
          barClass: statusBarColors[node.status] ?? "bg-primary/70",
          progressClass: statusProgressColors[node.status],
          progressPct: statusProgressColors[node.status] ? 40 : undefined,
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
    handleNodeSelect(node)
  }, [handleNodeSelect])
  const handleBoardNodeUpdate = useCallback((id: string, updates: Partial<PlanNode>) => {
    updateNode(id, updates)
  }, [updateNode])

  const emptyState = (
    <EmptyState
      icon={CheckSquare}
      title={hasActiveFilters ? "No matching tasks" : "Welcome to Astro"}
      description={
        hasActiveFilters
          ? "Try adjusting your filters to see more tasks."
          : projects.length === 0
          ? "Create your first project to start organizing your work with tasks."
          : "All your tasks will appear here. Go to a project to add tasks, or create a new project."
      }
      action={
        hasActiveFilters
          ? { label: "Clear Filters", onClick: clearFilters }
          : projects.length === 0
          ? { label: "Create Project", href: "/projects/new" }
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
          <h1 className="text-xl font-primary font-semibold">Tasks</h1>
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
        <div className="flex items-center gap-3">
          {/* Only show view toggle when there are tasks */}
          {sortedTasks.length > 0 && (
            <div className="flex items-center gap-1">
              {(["list", "timeline", "board"] as MyTasksViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer capitalize",
                    viewMode === mode
                      ? "text-accent-foreground border-b-2 border-accent"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}
          {sortedTasks.length > 0 && viewMode === "list" && <DisplayPopover config={myTasksDisplayConfig} />}
          {sortedTasks.length > 0 && viewMode === "timeline" && <DisplayPopover config={myTasksTimelineDisplayConfig} />}
          {sortedTasks.length > 0 && viewMode === "board" && <DisplayPopover config={myTasksBoardDisplayConfig} />}
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

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer ml-auto"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
      {isDesktop ? (
        // Desktop: Use Plan View components
        viewMode === "board" ? (
          <div className="flex-1 overflow-hidden">
            {sortedTasks.length === 0 ? (
              emptyState
            ) : (
              <PlanBoardView
                projectId="cross-project-mode"
                nodes={sortedTasks}
                onNodeSelect={handleNodeSelect}
                applyCompletedFilter={false}
              />
            )}
          </div>
        ) : viewMode === "timeline" ? (
          sortedTasks.length === 0 ? (
            emptyState
          ) : (
            <PlanTimelineView
              projectId="cross-project-mode"
              nodes={sortedTasks}
              onNodeSelect={handleNodeSelect}
              applyCompletedFilter={false}
              displayViewKey="my-tasks-timeline"
            />
          )
        ) : (
          sortedTasks.length === 0 ? (
            <div className="flex-1 overflow-auto">{emptyState}</div>
          ) : (
            <PlanListView
              projectId="cross-project-mode"
              nodes={sortedTasks}
              onNodeSelect={handleNodeSelect}
              getProjectIdFromGroup={(groupKey) => {
                // When grouped by project, extract projectId from the group label
                if (displaySettings.groupBy === "project") {
                  return projectNameToIdMap.get(groupKey)
                }
                return undefined
              }}
              applyCompletedFilter={false}
              displayViewKey="my-tasks"
            />
          )
        )
      ) : (
        // Mobile/Tablet: Existing UI (TaskRow-based) - unchanged
        viewMode === "board" ? (
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
                  <span className="text-sm truncate">{node.number != null && <span className="text-muted-foreground font-normal mr-1">#{node.number}</span>}{node.title}</span>
                </div>
              )}
              onItemClick={(node) => handleNodeSelect(node)}
              onDateChange={(nodeId, startDate, endDate) => updateNode(nodeId, { startDate, endDate })}
            />
          )
        ) : (
          sortedTasks.length === 0 ? (
            <div className="flex-1 overflow-auto">{emptyState}</div>
          ) : (
            <div className="flex-1 overflow-auto px-6 py-6">
              <div className="flex flex-col gap-6">
                {listGroups.map((group) => {
                  // Determine projectId for task creation when grouped by project
                  const targetProjectId = displaySettings.groupBy === "project"
                    ? projectNameToIdMap.get(group.label)
                    : undefined

                  return (
                    <div key={group.key} className="flex flex-col gap-4">
                      {/* Group Header */}
                      {displaySettings.groupBy !== "none" && (
                        <div className="flex items-center gap-2 px-2">
                          {group.icon}
                          <h2 className="text-sm font-semibold text-foreground">
                            {group.label}
                          </h2>
                          <span className="text-xs text-foreground/60">
                            ({group.items.length})
                          </span>
                        </div>
                      )}
                      {/* Task List */}
                      <div className="flex flex-col gap-4">
                        {group.items.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            projectName={projectMap.get(task.projectId)}
                            showProject={displaySettings.groupBy !== "project"}
                            onClick={() => handleNodeSelect(task)}
                          />
                        ))}
                      </div>
                      {/* Add Task Footer - only show when grouped by project */}
                      {displaySettings.groupBy === "project" && targetProjectId && (
                        <div className="mt-2">
                          {creatingInGroup === group.key ? (
                            <div className="rounded-2xl border border-border bg-card p-4">
                              <TaskCreationForm
                                mode="inline"
                                projectId={targetProjectId}
                                onCreated={() => setCreatingInGroup(null)}
                                onCancel={() => setCreatingInGroup(null)}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setCreatingInGroup(group.key)}
                              className="w-full flex items-center gap-3 rounded-2xl bg-card p-4 transition-all shadow-sm hover:shadow-md border border-border border-dashed text-left text-muted-foreground hover:text-foreground"
                            >
                              <div className="relative flex-shrink-0">
                                <div className="w-7 h-7 rounded-full border-[2.5px] border-dashed border-muted-foreground/30 flex items-center justify-center">
                                  <Plus className="h-4 w-4" />
                                </div>
                              </div>
                              <span className="text-sm font-medium">Add task</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        )
      )}
      </div>

      {/* Node Inspector Sidebar (desktop) / Sheet (mobile) */}
      {selectedNode && selectedNodeProject && (
        isDesktop ? (
          <NodeInspectorSidebar
            node={selectedNode}
            project={{
              id: selectedNodeProject.id,
              workingDirectory: selectedNodeProject.workingDirectory,
              defaultMachineId: selectedNodeProject.defaultMachineId,
            }}
            viewMode="list"
            onClose={() => setSelectedNode(null)}
            onNodeUpdate={(updated) => setSelectedNode(updated)}
          />
        ) : (
          <NodeInspectorSheet
            open={true}
            node={selectedNode}
            project={{
              id: selectedNodeProject.id,
              workingDirectory: selectedNodeProject.workingDirectory,
              defaultMachineId: selectedNodeProject.defaultMachineId,
            }}
            viewMode="list"
            onClose={() => setSelectedNode(null)}
            onNodeUpdate={(updated) => setSelectedNode(updated)}
          />
        )
      )}
      </div>
    </div>
  )
}
