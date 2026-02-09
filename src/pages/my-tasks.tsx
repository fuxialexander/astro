import { useMemo, useState } from "react"
import { Link } from "react-router"
import {
  CheckSquare,
  ListFilter,
  ChevronDown,
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
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { PRIORITY_CONFIG } from "@/lib/constants"
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

function formatShortDate(dateStr?: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr + "T00:00:00Z")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function isOverdue(dateStr?: string, status?: string): boolean {
  if (!dateStr || status === "completed" || status === "auto_verified" || status === "pruned") return false
  return new Date(dateStr + "T00:00:00Z") < new Date()
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

export function MyTasks() {
  const projects = useProjectStore((s) => s.projects)
  const nodes = usePlanStore((s) => s.nodes)
  const displaySettings = useDisplaySettingsStore((s) => s.get("my-tasks"))

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all")
  const [projectFilter, setProjectFilter] = useState<string>("all")
  const [showFilters, setShowFilters] = useState(false)

  const projectMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of projects) m.set(p.id, p.name)
    return m
  }, [projects])

  // Filter tasks (exclude milestones)
  const filteredTasks = useMemo(() => {
    let tasks = nodes.filter((n) => n.type !== "milestone")

    if (!displaySettings.showCompleted) {
      tasks = tasks.filter((n) => n.status !== "completed" && n.status !== "auto_verified" && n.status !== "pruned")
    }
    if (statusFilter !== "all") {
      tasks = tasks.filter((n) => n.status === statusFilter)
    }
    if (priorityFilter !== "all") {
      tasks = tasks.filter((n) => (n.priority ?? "none") === priorityFilter)
    }
    if (projectFilter !== "all") {
      tasks = tasks.filter((n) => n.projectId === projectFilter)
    }

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

  // Group
  const groups = useMemo(() => {
    if (displaySettings.groupBy === "none") {
      return { "All Tasks": sortedTasks }
    }
    return sortedTasks.reduce<Record<string, PlanNode[]>>((acc, node) => {
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
  }, [sortedTasks, displaySettings.groupBy, projectMap])

  // Stats
  const activeCount = nodes.filter((n) => n.type !== "milestone" && (n.status === "in_progress" || n.status === "dispatched")).length
  const needsReviewCount = nodes.filter((n) => n.type !== "milestone" && n.status === "awaiting_judgment").length
  const hasActiveFilters = statusFilter !== "all" || priorityFilter !== "all" || projectFilter !== "all"

  const clearFilters = () => {
    setStatusFilter("all")
    setPriorityFilter("all")
    setProjectFilter("all")
  }

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
        <DisplayPopover config={myTasksDisplayConfig} />
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

        {/* Inline filter chips */}
        {showFilters && (
          <div className="flex items-center gap-2 ml-2">
            {/* Status filter */}
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

            {/* Priority filter */}
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

            {/* Project filter */}
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

      {/* Column Headers */}
      <div className="flex items-center border-b border-border px-6 h-9 shrink-0">
        <span className="flex-1 text-[13px] font-medium text-muted-foreground">Task</span>
        {displaySettings.visibleProperties.includes("status") && (
          <span className="w-[120px] text-[13px] font-medium text-muted-foreground">Status</span>
        )}
        {displaySettings.visibleProperties.includes("priority") && (
          <span className="w-[90px] text-[13px] font-medium text-muted-foreground">Priority</span>
        )}
        {displaySettings.visibleProperties.includes("project") && (
          <span className="w-[140px] text-[13px] font-medium text-muted-foreground">Project</span>
        )}
        {displaySettings.visibleProperties.includes("dueDate") && (
          <span className="w-[90px] text-[13px] font-medium text-muted-foreground">Due date</span>
        )}
        {displaySettings.visibleProperties.includes("estimate") && (
          <span className="w-[70px] text-[13px] font-medium text-muted-foreground">Estimate</span>
        )}
      </div>

      {/* Table Body */}
      <div className="flex-1 overflow-auto">
        {sortedTasks.length === 0 ? (
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
        ) : (
          Object.entries(groups).map(([groupName, items]) => (
            <div key={groupName}>
              {/* Group Header */}
              {displaySettings.groupBy !== "none" && (
                <div className="flex items-center gap-2 bg-muted px-6 py-2.5">
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  {displaySettings.groupBy === "project" && (
                    <Folder className="h-4 w-4 text-blue-500" />
                  )}
                  {displaySettings.groupBy === "status" && (() => {
                    const entry = Object.values(STATUS_CONFIG).find((s) => s.label === groupName)
                    if (!entry) return null
                    const Icon = entry.icon
                    return <Icon className={cn("h-4 w-4", entry.color)} />
                  })()}
                  {displaySettings.groupBy === "priority" && (() => {
                    const entry = Object.values(PRIORITY_CONFIG).find((p) => p.label === groupName)
                    if (!entry) return null
                    const Icon = entry.icon
                    return <Icon className={cn("h-4 w-4", entry.color)} />
                  })()}
                  <span className="text-sm font-medium">{groupName}</span>
                  <span className="text-[13px] text-muted-foreground">{items.length}</span>
                </div>
              )}

              {/* Task Rows */}
              {items.map((node) => {
                const status = STATUS_CONFIG[node.status]
                const priority = PRIORITY_CONFIG[node.priority ?? "none"]
                const StatusIcon = status.icon
                const PriorityIcon = priority.icon
                const projectName = projectMap.get(node.projectId) ?? ""
                const dueDate = node.dueDate ?? node.endDate
                const overdue = isOverdue(dueDate, node.status)

                return (
                  <Link
                    key={node.id}
                    to={`/project/${node.projectId}/plan`}
                    className={cn(
                      "flex items-center border-b border-border px-6 py-2.5 hover:bg-muted/30 transition-colors",
                      displaySettings.groupBy !== "none" && "pl-12"
                    )}
                  >
                    {/* Title */}
                    <div className="flex flex-1 items-center gap-2.5 min-w-0">
                      <StatusIcon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          status.color,
                          node.status === "in_progress" && "animate-spin"
                        )}
                      />
                      <span className="text-sm truncate">{node.title}</span>
                    </div>

                    {/* Status */}
                    {displaySettings.visibleProperties.includes("status") && (
                      <div className="w-[120px]">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            status.bg,
                            status.color
                          )}
                        >
                          {status.label}
                        </span>
                      </div>
                    )}

                    {/* Priority */}
                    {displaySettings.visibleProperties.includes("priority") && (
                      <div className="w-[90px] flex items-center gap-1.5">
                        <PriorityIcon className={cn("h-3.5 w-3.5", priority.color)} />
                        <span className="text-xs text-muted-foreground">{priority.label}</span>
                      </div>
                    )}

                    {/* Project */}
                    {displaySettings.visibleProperties.includes("project") && (
                      <div className="w-[140px] flex items-center gap-1.5 min-w-0">
                        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground truncate">{projectName}</span>
                      </div>
                    )}

                    {/* Due Date */}
                    {displaySettings.visibleProperties.includes("dueDate") && (
                      <div className="w-[90px]">
                        <span className={cn("text-xs", overdue ? "text-red-500 font-medium" : "text-muted-foreground")}>
                          {formatShortDate(dueDate)}
                        </span>
                      </div>
                    )}

                    {/* Estimate */}
                    {displaySettings.visibleProperties.includes("estimate") && (
                      <div className="w-[70px]">
                        {node.estimate && (
                          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {node.estimate}
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// --- Filter dropdown component ---

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  const isActive = value !== "all"

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer",
          isActive
            ? "bg-primary/10 text-primary"
            : "bg-secondary text-muted-foreground hover:text-foreground"
        )}
      >
        {isActive ? selected?.label : label}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-md border bg-popover p-1 shadow-md">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "w-full rounded-sm px-2 py-1.5 text-left text-xs transition-colors cursor-pointer hover:bg-accent",
                  value === opt.value && "bg-accent font-medium"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
