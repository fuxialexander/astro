import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useParams, useLocation, useNavigate } from "react-router"
import { FileText, Plus, MessageSquare, Diamond, Trash2, GitPullRequestDraft, GitPullRequest, Sparkles, Star, Play, Download, Folder, Check, Pencil } from "lucide-react"

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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { TaskCreationForm } from "@/components/task-creation-form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { ChatPanel } from "@/components/agent/chat-panel"
import { NodeInspectorSheet, NodeInspectorSidebar } from "@/components/node-inspector"
import { BoardView } from "@/components/board/board-view"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { ItemListView, type ListColumn, type ListGroup, type BatchAction } from "@/components/views/item-list-view"
import { ItemTimelineView, TimelineAddTaskFooter, type TimelineRow } from "@/components/views/item-timeline-view"
import { PropertyPicker } from "@/components/property-picker"
import { ColorIconBadge } from "@/components/color-icon-picker"
import { InlineRenameInput } from "@/components/inline-rename-input"
import { validateProjectName } from "@/lib/project-validation"
import { OverviewTab } from "@/pages/project-overview"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useDisplaySettingsStore, type DisplaySettings, type ViewKey } from "@/stores/display-settings-store"
import { useActivityStore } from "@/stores/activity-store"
import { useExecutionStore } from "@/stores/execution-store"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { statusLabels, statusBadgeVariants, statusBarColors, statusProgressColors } from "@/lib/status-config"
import { formatDueDateShort } from "@/lib/date-utils"
import { assignDefaultDates } from "@/lib/timeline-utils"
import { cn } from "@/lib/utils"
import { extractTitle } from "@/lib/text-utils"
import { generateTitle } from "@/lib/api-client"
import { topologicalSortNodes } from "@/lib/graph-sort-utils"
import { useFileTreeRefresh } from "@/hooks/use-file-tree-refresh"
import { exportProject, downloadBundle } from "@/lib/sharing/export-project"
import type { PlanNode, Priority } from "@/types"

type ViewMode = "graph" | "list" | "timeline" | "board"

const statusVariant = statusBadgeVariants

const planListDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-list",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "milestone", label: "Milestone" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
  ],
  orderByOptions: [
    { value: "number", label: "Number" },
    { value: "name", label: "Name" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "dueDate", label: "Due date" },
    { value: "dependency", label: "Dependency order" },
  ],
  propertyOptions: [
    { value: "priority", label: "Priority" },
    { value: "status", label: "Status" },
    { value: "dueDate", label: "Due date" },
    { value: "estimate", label: "Estimate" },
    { value: "milestone", label: "Milestone" },
    { value: "labels", label: "Labels" },
    { value: "pr", label: "PR" },
  ],
}

const planTimelineDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-list",
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "milestone", label: "Milestone" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "dueDate", label: "Due date" },
    { value: "dependency", label: "Dependency order" },
  ],
  propertyOptions: [
    { value: "priority", label: "Priority" },
    { value: "status", label: "Status" },
    { value: "dueDate", label: "Due date" },
    { value: "estimate", label: "Estimate" },
    { value: "labels", label: "Labels" },
    { value: "pr", label: "PR" },
  ],
  showZoom: true,
}

const planGraphDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-graph",
  groupByLabel: "Highlight by",
  groupByOptions: [
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "none", label: "None" },
  ],
  orderByOptions: [],
  propertyOptions: [],
}

const planBoardDisplayConfig: DisplayPopoverConfig = {
  viewKey: "plan-board",
  columnByOptions: [
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "milestone", label: "Milestone" },
  ],
  groupByOptions: [
    { value: "none", label: "No grouping" },
  ],
  orderByOptions: [
    { value: "priority", label: "Priority" },
    { value: "name", label: "Name" },
    { value: "dueDate", label: "Due date" },
  ],
  propertyOptions: [
    { value: "priority", label: "Priority" },
    { value: "estimate", label: "Estimate" },
    { value: "dueDate", label: "Due date" },
    { value: "labels", label: "Labels" },
    { value: "pr", label: "PR" },
  ],
}

// --- Shared sorting logic for plan nodes ---
function sortPlanNodes(nodes: PlanNode[], orderBy: string, dir: number): PlanNode[] {
  if (orderBy === "dependency") {
    const topoSorted = topologicalSortNodes([...nodes])
    return dir === 1 ? topoSorted : topoSorted.reverse()
  }
  const sorted = [...nodes]
  sorted.sort((a, b) => {
    switch (orderBy) {
      case "number":
        return dir * ((a.number ?? Infinity) - (b.number ?? Infinity))
      case "name":
        return dir * a.title.localeCompare(b.title)
      case "status":
        return dir * a.status.localeCompare(b.status)
      case "priority": {
        const order = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
        return dir * ((order[a.priority as keyof typeof order] ?? 4) - (order[b.priority as keyof typeof order] ?? 4))
      }
      case "dueDate": {
        const da = a.dueDate ?? ""
        const db = b.dueDate ?? ""
        return dir * da.localeCompare(db)
      }
      default:
        return 0
    }
  })
  return sorted
}

// --- Plan List Column Definitions ---
function makePlanColumns(
  project: { labels?: { id: string; name: string; color: string }[] } | undefined,
  milestoneMap: Map<string, string>,
  onNodeUpdate?: (id: string, updates: Partial<PlanNode>) => void,
  projectMap?: Map<string, string>,
): ListColumn<PlanNode>[] {
  return [
    {
      id: "name",
      label: "Name",
      width: "flex-1 min-w-0",
      sortKey: "name",
      render: (node) => (
        <span className={cn("text-sm truncate block", node.status === "pruned" && "line-through")}>
          {node.number != null && <span className="text-muted-foreground font-normal mr-1">#{node.number}</span>}{node.title}
        </span>
      ),
    },
    {
      id: "priority",
      label: "Priority",
      width: "w-[60px]",
      sortKey: "priority",
      batchPropertyOptions: onNodeUpdate ? PRIORITY_OPTIONS : undefined,
      onBatchPropertySet: onNodeUpdate ? (value, selectedIds) => {
        selectedIds.forEach((id) => onNodeUpdate(id, { priority: value as Priority }))
      } : undefined,
      render: (node) => {
        const config = PRIORITY_CONFIG[(node.priority ?? "none") as Priority]
        const PIcon = config.icon
        return (
          <PropertyPicker
            value={node.priority ?? "none"}
            options={PRIORITY_OPTIONS}
            title="Set priority"
            disabled={!onNodeUpdate}
            onSelect={(id) => onNodeUpdate?.(node.id, { priority: id as Priority })}
          >
            <PIcon className={cn("h-3.5 w-3.5", config.color)} />
          </PropertyPicker>
        )
      },
    },
    {
      id: "status",
      label: "Status",
      width: "w-[120px]",
      sortKey: "status",
      batchPropertyOptions: onNodeUpdate ? STATUS_OPTIONS : undefined,
      onBatchPropertySet: onNodeUpdate ? (value, selectedIds) => {
        selectedIds.forEach((id) => onNodeUpdate(id, { status: value as PlanNode["status"] }))
      } : undefined,
      render: (node) => (
        <PropertyPicker
          value={node.status}
          options={STATUS_OPTIONS}
          title="Set status"
          disabled={!onNodeUpdate}
          onSelect={(id) => onNodeUpdate?.(node.id, { status: id as PlanNode["status"] })}
        >
          <Badge variant={statusVariant[node.status] ?? "secondary"} className="text-[10px]">
            {node.status.replace(/_/g, " ")}
          </Badge>
        </PropertyPicker>
      ),
    },
    {
      id: "dueDate",
      label: "Due Date",
      width: "w-[100px]",
      sortKey: "dueDate",
      render: (node) => {
        const { text, className } = formatDueDateShort(node.dueDate)
        return <span className={cn("text-xs", className)}>{text}</span>
      },
    },
    {
      id: "estimate",
      label: "Estimate",
      width: "w-[70px]",
      batchPropertyOptions: onNodeUpdate ? ESTIMATE_OPTIONS : undefined,
      onBatchPropertySet: onNodeUpdate ? (value, selectedIds) => {
        selectedIds.forEach((id) => onNodeUpdate(id, { estimate: value as PlanNode["estimate"] }))
      } : undefined,
      render: (node) => (
        <PropertyPicker
          value={node.estimate}
          options={ESTIMATE_OPTIONS}
          title="Set estimate"
          disabled={!onNodeUpdate}
          onSelect={(id) => onNodeUpdate?.(node.id, { estimate: id as PlanNode["estimate"] })}
        >
          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {node.estimate ?? "\u2014"}
          </span>
        </PropertyPicker>
      ),
    },
    {
      id: "milestone",
      label: "Milestone",
      width: "w-[120px]",
      render: (node) => {
        const name = node.milestoneId ? milestoneMap.get(node.milestoneId) : undefined
        return name ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate">
            <Diamond className="h-3 w-3 shrink-0 text-primary" />
            {name}
          </span>
        ) : null
      },
    },
    {
      id: "labels",
      label: "Labels",
      width: "w-[80px]",
      render: (node) => {
        const nodeLabels = (node.labelIds || [])
          .map((id) => project?.labels?.find((l) => l.id === id))
          .filter(Boolean)
        return (
          <div className="flex items-center gap-1">
            {nodeLabels.map((label) => label && (
              <span
                key={label.id}
                className="h-2.5 w-2.5 rounded-full shrink-0"
                title={label.name}
                style={{ backgroundColor: label.color }}
              />
            ))}
          </div>
        )
      },
    },
    {
      id: "pr",
      label: "PR",
      width: "w-[70px]",
      render: (node) => {
        if (!node.prUrl) return null
        const PrIcon = node.status === "completed" || node.status === "auto_verified"
          ? GitPullRequest
          : GitPullRequestDraft
        return (
          <a
            href={node.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            title={node.branchName ?? `PR #${node.prNumber}`}
          >
            <PrIcon className="h-3.5 w-3.5 shrink-0" />
            {node.prNumber != null && <span>#{node.prNumber}</span>}
          </a>
        )
      },
    },
    {
      id: "project",
      label: "Project",
      width: "w-[120px]",
      render: (node) => {
        const name = projectMap?.get(node.projectId)
        if (!name) return null
        return <span className="text-xs text-muted-foreground truncate">{name}</span>
      },
    },
  ]
}


// --- Inline List Creation Row (reusable) ---
// Renders with the same visual style as a real task row (PropertyPicker, Badge, etc.)
// In cross-project mode (projectId not a valid UUID), shows a project picker before creating.
function InlineListCreationRow({
  projectId,
  columns,
  displaySettings,
  defaultMilestoneId,
  onCreated,
}: {
  projectId: string
  columns: ListColumn<PlanNode>[]
  displaySettings: DisplaySettings
  defaultMilestoneId?: string
  onCreated?: () => void
}) {
  const addNode = usePlanStore((s) => s.addNode)
  const allProjects = useProjectStore((s) => s.projects)
  const [taskName, setTaskName] = useState("")
  const [priority, setPriority] = useState<Priority>("medium")
  const [status, setStatus] = useState<PlanNode["status"]>("planned")
  const [dueDate, setDueDate] = useState("")
  const [estimate, setEstimate] = useState<PlanNode["estimate"]>(undefined)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const projectPickerRef = useRef<HTMLDivElement>(null)

  // Detect cross-project mode: projectId is not a valid UUID
  const isCrossProject = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)
  const effectiveProjectId = isCrossProject ? selectedProjectId : projectId

  const createTask = useCallback((targetProjectId: string) => {
    if (!taskName.trim()) return

    const taskText = taskName.trim()
    const taskTitle = extractTitle(taskText)
    const nodeId = crypto.randomUUID()

    addNode({
      id: nodeId,
      projectId: targetProjectId,
      type: "task",
      title: taskTitle,
      description: taskText,
      status,
      parentId: null,
      dependencies: [],
      verification: "auto",
      position: { x: 0, y: 0 },
      priority,
      dueDate: dueDate || undefined,
      estimate,
      milestoneId: defaultMilestoneId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Fire-and-forget AI title refinement for long descriptions
    if (taskText.length > 80) {
      generateTitle(taskText).then((aiTitle) => {
        if (aiTitle && aiTitle !== taskTitle) {
          usePlanStore.getState().updateNode(nodeId, { title: aiTitle })
        }
      }).catch(() => {}) // silent — heuristic title is fine
    }

    // Reset form
    setTaskName("")
    setPriority("medium")
    setStatus("planned")
    setDueDate("")
    setEstimate(undefined)
    setSelectedProjectId(null)
    setShowProjectPicker(false)
    onCreated?.()
  }, [taskName, status, priority, dueDate, estimate, defaultMilestoneId, addNode, onCreated])

  const handleCreate = () => {
    if (!taskName.trim()) return

    if (isCrossProject) {
      // In cross-project mode, if only one project, use it directly
      if (allProjects.length === 1) {
        createTask(allProjects[0].id)
      } else {
        // Show project picker
        setShowProjectPicker(true)
      }
      return
    }

    createTask(projectId)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && taskName.trim()) {
      e.preventDefault()
      handleCreate()
    } else if (e.key === "Escape") {
      e.preventDefault()
      if (showProjectPicker) {
        setShowProjectPicker(false)
      } else {
        onCreated?.()
      }
    }
  }

  // Match ItemListView column filtering: name always visible, others by displaySettings
  const nameCol = columns.find((c) => c.id === "name")
  const otherCols = columns.filter((c) =>
    c.id !== "name" &&
    (displaySettings.visibleProperties?.includes(c.id) ?? true)
  )

  const { text: dueDateText, className: dueDateClass } = formatDueDateShort(dueDate || undefined)

  const selectedProjectName = effectiveProjectId
    ? allProjects.find((p) => p.id === effectiveProjectId)?.name
    : undefined

  return (
    <div className="flex items-center border-b border-border px-6 py-2.5 hover:bg-muted/30 transition-colors">
      {/* Name column */}
      <div className={cn("min-w-0 overflow-hidden", nameCol?.width ?? "flex-1")}>
        <input
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Task name..."
          autoFocus
          className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Other visible columns — same visual style as real task rows */}
      {otherCols.map((col) => (
        <div key={col.id} className={cn("flex items-center justify-end", col.width)}>
          {col.id === "priority" ? (() => {
            const config = PRIORITY_CONFIG[priority]
            const PIcon = config.icon
            return (
              <PropertyPicker
                value={priority}
                options={PRIORITY_OPTIONS}
                title="Set priority"
                onSelect={(id) => setPriority(id as Priority)}
              >
                <PIcon className={cn("h-3.5 w-3.5", config.color)} />
              </PropertyPicker>
            )
          })() : col.id === "status" ? (
            <PropertyPicker
              value={status}
              options={STATUS_OPTIONS}
              title="Set status"
              onSelect={(id) => setStatus(id as PlanNode["status"])}
            >
              <Badge variant={statusVariant[status] ?? "secondary"} className="text-[10px]">
                {status.replace(/_/g, " ")}
              </Badge>
            </PropertyPicker>
          ) : col.id === "dueDate" ? (
            <div className="relative inline-flex items-center rounded-sm p-0.5 -m-0.5 hover:bg-muted transition-colors">
              <span className={cn("text-xs", dueDateClass)}>{dueDateText}</span>
              <input
                ref={dateInputRef}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                tabIndex={-1}
              />
            </div>
          ) : col.id === "estimate" ? (
            <PropertyPicker
              value={estimate}
              options={ESTIMATE_OPTIONS}
              title="Set estimate"
              onSelect={(id) => setEstimate(id as PlanNode["estimate"])}
            >
              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {estimate ?? "\u2014"}
              </span>
            </PropertyPicker>
          ) : col.id === "project" && isCrossProject ? (
            <div className="relative" ref={projectPickerRef}>
              <Popover open={showProjectPicker} onOpenChange={setShowProjectPicker}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-sm p-0.5 -m-0.5 hover:bg-muted transition-colors cursor-pointer text-xs text-muted-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Folder className="h-3 w-3 shrink-0" />
                    {selectedProjectName ?? "Select project"}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-56 p-1"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Select project</p>
                  {allProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
                        "hover:bg-accent transition-colors",
                        effectiveProjectId === p.id && "bg-accent/50"
                      )}
                      onClick={() => {
                        if (taskName.trim()) {
                          createTask(p.id)
                        } else {
                          setSelectedProjectId(p.id)
                          setShowProjectPicker(false)
                        }
                      }}
                    >
                      <ColorIconBadge icon={p.icon} color={p.color} className="!p-0 !rounded-none" />
                      <span className="flex-1 text-left truncate">{p.name}</span>
                      {effectiveProjectId === p.id && <Check className="h-3.5 w-3.5 text-foreground" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// --- Inline Empty State for List View ---
function ListEmptyState({ projectId, columns }: { projectId: string; columns: ListColumn<PlanNode>[] }) {
  const [visionOpen, setVisionOpen] = useState(false)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const displaySettings = useDisplaySettingsStore((s) => s.get("plan-list"))

  // Filter visible columns (but always show name for creation)
  const visibleColumns = columns.filter((col) =>
    col.id === "name" || // Always show name field for task creation
    !displaySettings.visibleProperties ||
    displaySettings.visibleProperties.includes(col.id)
  )

  return (
    <>
      <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project!} />
      <div className="flex flex-col h-full">
        {/* Header row */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-2 bg-muted/30">
          {visibleColumns.map((col) => (
            <div
              key={col.id}
              className={cn(
                "text-xs font-medium text-muted-foreground uppercase tracking-wide",
                col.width
              )}
            >
              {col.label}
            </div>
          ))}
        </div>

        {/* Inline creation row */}
        <InlineListCreationRow
          projectId={projectId}
          columns={columns}
          displaySettings={displaySettings}
        />

        {/* AI generation option */}
        <div className="flex items-center justify-center gap-2 py-4">
          <span className="text-sm text-muted-foreground">or</span>
          <button
            onClick={() => setVisionOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 rounded-md transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generate plan with AI
          </button>
        </div>
      </div>
    </>
  )
}

// --- List View ---
export function PlanListView({
  projectId,
  nodes,
  onNodeSelect,
  getProjectIdFromGroup,
  applyCompletedFilter = true,
  displayViewKey = "plan-list",
}: {
  projectId: string
  nodes?: PlanNode[] // Optional: pre-filtered nodes for cross-project mode
  onNodeSelect: (node: PlanNode | null) => void
  /** Optional: extract projectId from group key for cross-project task creation */
  getProjectIdFromGroup?: (groupKey: string) => string | undefined
  applyCompletedFilter?: boolean // Whether to apply showCompleted filter (default true)
  displayViewKey?: ViewKey // Which display settings to use (default "plan-list")
}) {
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const addActivity = useActivityStore((s) => s.addActivity)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const projects = useProjectStore((s) => s.projects)
  const displaySettings = useDisplaySettingsStore((s) => s.get(displayViewKey))
  const updateDisplaySettings = useDisplaySettingsStore((s) => s.update)
  const [creatingInGroup, setCreatingInGroup] = useState<string | null>(null)

  const handleNodeUpdate = useCallback((id: string, updates: Partial<PlanNode>) => {
    updateNode(id, updates)
  }, [updateNode])

  const planBatchActions: BatchAction[] = useMemo(() => [
    {
      id: "execute",
      label: "Execute All",
      icon: <Play className="h-3.5 w-3.5" />,
      variant: "default",
      onAction: async (ids) => {
        const { startExecution } = useExecutionStore.getState()
        // Execute all selected tasks in parallel
        const executions = ids.map((id) => {
          const node = planNodes.find((n) => n.id === id)
          if (node) {
            return startExecution(id, node.projectId)
          }
          return Promise.resolve()
        })
        // Wait for all executions to start (not complete)
        await Promise.all(executions)
        // Track activity
        addActivity({
          projectId,
          type: "task.bulk_executed",
          title: `Executing ${ids.length} task${ids.length > 1 ? 's' : ''}`,
        })
      },
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: "destructive",
      onAction: (ids) => {
        const deletedNodes = planNodes.filter((n) => ids.includes(n.id))
        removeNodes(ids)
        // Track activity for each deleted node's project
        const byProject = new Map<string, string[]>()
        for (const n of deletedNodes) {
          const list = byProject.get(n.projectId) ?? []
          list.push(n.title)
          byProject.set(n.projectId, list)
        }
        for (const [pid, titles] of byProject) {
          addActivity({
            projectId: pid,
            type: ids.length > 1 ? "task.bulk_deleted" : "task.deleted",
            title: ids.length > 1
              ? `Deleted ${titles.length} tasks`
              : `Deleted task: ${titles[0]}`,
          })
        }
      },
    },
  ], [removeNodes, planNodes, addActivity, projectId])

  const allProjectNodes = useMemo(() => {
    // If nodes provided (cross-project mode), use those
    if (nodes) return nodes
    // Otherwise filter by projectId (single-project mode)
    return planNodes.filter((n) => n.projectId === projectId)
  }, [planNodes, projectId, nodes])

  const milestones = useMemo(() => allProjectNodes.filter((n) => n.type === "milestone"), [allProjectNodes])

  const milestoneMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const ms of milestones) m.set(ms.id, ms.title)
    return m
  }, [milestones])

  const projectNameMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const columns = useMemo(() => makePlanColumns(project, milestoneMap, handleNodeUpdate, projectNameMap), [project, milestoneMap, handleNodeUpdate, projectNameMap])

  const tasks = useMemo(() => {
    let filtered = allProjectNodes.filter((n) => n.type !== "milestone")
    if (applyCompletedFilter && !displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return sortPlanNodes(filtered, displaySettings.orderBy, dir)
  }, [allProjectNodes, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted, applyCompletedFilter])

  const groups = useMemo((): ListGroup<PlanNode>[] => {
    if (displaySettings.groupBy === "milestone") {
      const result: ListGroup<PlanNode>[] = []
      for (const m of milestones) {
        const grouped = tasks.filter((n) => n.milestoneId === m.id)
        const completedCount = grouped.filter((t) => t.status === "completed" || t.status === "auto_verified").length
        const completion = grouped.length > 0 ? Math.round((completedCount / grouped.length) * 100) : 0
        result.push({
          key: `milestone-${m.id}`,
          label: m.title,
          icon: <Diamond className="h-3 w-3 text-primary" />,
          items: grouped,
          meta: <span className="text-[11px] text-muted-foreground">{completion}% &middot; {grouped.length} tasks</span>,
        })
      }
      const unassigned = tasks.filter((n) => !n.milestoneId)
      if (unassigned.length > 0) {
        result.push({
          key: "unassigned",
          label: "Unassigned",
          items: unassigned,
        })
      }
      return result
    }

    if (displaySettings.groupBy === "status") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of tasks) {
        const key = statusLabels[node.status] ?? node.status
        ;(grouped[key] ??= []).push(node)
      }
      return Object.entries(grouped).map(([label, items]) => ({
        key: label,
        label,
        items,
      }))
    }

    if (displaySettings.groupBy === "priority") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of tasks) {
        const key = node.priority ? (node.priority.charAt(0).toUpperCase() + node.priority.slice(1)) : "No priority"
        ;(grouped[key] ??= []).push(node)
      }
      return Object.entries(grouped).map(([label, items]) => ({
        key: label,
        label,
        items,
      }))
    }

    if (displaySettings.groupBy === "project") {
      const projectMap = new Map(projects.map((p) => [p.id, p.name]))
      // Start with all projects so empty ones get a group too
      const grouped: Record<string, PlanNode[]> = {}
      for (const p of projects) {
        grouped[p.name] = []
      }
      for (const node of tasks) {
        const key = projectMap.get(node.projectId) ?? "Unknown Project"
        ;(grouped[key] ??= []).push(node)
      }
      return Object.entries(grouped).map(([label, items]) => ({
        key: label,
        label,
        items,
      }))
    }

    return [{ key: "all", label: "All Tasks", items: tasks }]
  }, [tasks, milestones, projects, displaySettings.groupBy])

  function renderAddTaskRow(groupKey: string) {
    const defaultMilestoneId = groupKey.startsWith("milestone-") ? groupKey.replace("milestone-", "") : undefined
    // For cross-project mode, extract projectId from group
    const targetProjectId = getProjectIdFromGroup?.(groupKey) ?? projectId

    if (creatingInGroup === groupKey) {
      return (
        <InlineListCreationRow
          projectId={targetProjectId}
          columns={columns}
          displaySettings={displaySettings}
          defaultMilestoneId={defaultMilestoneId}
          onCreated={() => setCreatingInGroup(null)}
        />
      )
    }
    return (
      <button
        type="button"
        onClick={() => setCreatingInGroup(groupKey)}
        className="flex items-center gap-2 px-6 h-9 w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer border-b border-border"
      >
        <Plus className="h-3.5 w-3.5" />
        Add task
      </button>
    )
  }

  const handleSort = useCallback((sortKey: string) => {
    if (displaySettings.orderBy === sortKey) {
      updateDisplaySettings(displayViewKey, {
        orderDirection: displaySettings.orderDirection === "asc" ? "desc" : "asc",
      })
    } else {
      updateDisplaySettings(displayViewKey, { orderBy: sortKey, orderDirection: "asc" })
    }
  }, [displaySettings.orderBy, displaySettings.orderDirection, updateDisplaySettings, displayViewKey])

  // Show empty state if no tasks (with column headers)
  if (tasks.length === 0) {
    return <ListEmptyState projectId={projectId} columns={columns} />
  }

  // Ensure name column is always visible
  const visibleColumnsWithName = displaySettings.visibleProperties?.includes("name")
    ? displaySettings.visibleProperties
    : ["name", ...(displaySettings.visibleProperties || [])]

  return (
    <ItemListView
      columns={columns}
      groups={groups}
      visibleColumns={visibleColumnsWithName}
      onItemClick={(node) => onNodeSelect(node)}
      getItemId={(n) => n.id}
      getItemClass={(n) => cn(n.status === "pruned" && "opacity-50")}
      footer={renderAddTaskRow}
      batchActions={planBatchActions}
      sortColumn={displaySettings.orderBy}
      sortDirection={displaySettings.orderDirection}
      onSort={handleSort}
    />
  )
}

// --- Timeline View ---
export function PlanTimelineView({
  projectId,
  nodes,
  onNodeSelect,
  applyCompletedFilter = true,
  displayViewKey = "plan-list",
}: {
  projectId: string
  nodes?: PlanNode[] // Optional: pre-filtered nodes for cross-project mode
  onNodeSelect: (node: PlanNode | null) => void
  applyCompletedFilter?: boolean // Whether to apply showCompleted filter (default true)
  displayViewKey?: ViewKey // Which display settings to use (default "plan-list")
}) {
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const rawPlanEdges = usePlanStore((s) => s.edges)
  const planEdges = useMemo(() => rawPlanEdges.filter(isLive), [rawPlanEdges])
  const updateNode = usePlanStore((s) => s.updateNode)
  const projects = useProjectStore((s) => s.projects)
  const displaySettings = useDisplaySettingsStore((s) => s.get(displayViewKey))
  const [isCreating, setIsCreating] = useState(false)

  const allProjectNodes = useMemo(() => {
    // If nodes provided (cross-project mode), use those
    if (nodes) return nodes
    // Otherwise filter by projectId (single-project mode)
    return planNodes.filter((n) => n.projectId === projectId)
  }, [planNodes, projectId, nodes])

  const milestones = useMemo(() => allProjectNodes.filter((n) => n.type === "milestone"), [allProjectNodes])

  const tasks = useMemo(() => {
    let filtered = allProjectNodes.filter((n) => n.type !== "milestone")
    if (applyCompletedFilter && !displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return sortPlanNodes(filtered, displaySettings.orderBy, dir)
  }, [allProjectNodes, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted, applyCompletedFilter])

  const edges = useMemo(() => {
    const nodeIds = new Set(tasks.map((n) => n.id))
    return planEdges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target))
  }, [tasks, planEdges])

  const datedTasks = useMemo(() => assignDefaultDates(tasks, edges), [tasks, edges])

  const timelineRows = useMemo((): TimelineRow<PlanNode>[] => {
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
          label: node.number != null ? `#${node.number} ${node.title}` : node.title,
        },
      }
    }

    if (displaySettings.groupBy === "none") {
      return datedTasks.map(nodeToRow)
    }

    if (displaySettings.groupBy === "milestone") {
      const rows: TimelineRow<PlanNode>[] = []
      for (const m of milestones) {
        const grouped = datedTasks.filter((n) => n.milestoneId === m.id)
        rows.push({ kind: "header", label: m.title, count: grouped.length })
        for (const t of grouped) rows.push(nodeToRow(t))
      }
      const unassigned = datedTasks.filter((n) => !n.milestoneId)
      if (unassigned.length > 0) {
        rows.push({ kind: "header", label: "Unassigned", count: unassigned.length })
        for (const t of unassigned) rows.push(nodeToRow(t))
      }
      return rows
    }

    if (displaySettings.groupBy === "status") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of datedTasks) {
        const key = statusLabels[node.status] ?? node.status
        ;(grouped[key] ??= []).push(node)
      }
      const rows: TimelineRow<PlanNode>[] = []
      for (const [label, items] of Object.entries(grouped)) {
        rows.push({ kind: "header", label, count: items.length })
        for (const item of items) rows.push(nodeToRow(item))
      }
      return rows
    }

    if (displaySettings.groupBy === "priority") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of datedTasks) {
        const key = node.priority ? (node.priority.charAt(0).toUpperCase() + node.priority.slice(1)) : "No priority"
        ;(grouped[key] ??= []).push(node)
      }
      const rows: TimelineRow<PlanNode>[] = []
      for (const [label, items] of Object.entries(grouped)) {
        rows.push({ kind: "header", label, count: items.length })
        for (const item of items) rows.push(nodeToRow(item))
      }
      return rows
    }

    if (displaySettings.groupBy === "project") {
      const projectMap = new Map(projects.map((p) => [p.id, p.name]))
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of datedTasks) {
        const key = projectMap.get(node.projectId) ?? "Unknown Project"
        ;(grouped[key] ??= []).push(node)
      }
      const rows: TimelineRow<PlanNode>[] = []
      for (const [label, items] of Object.entries(grouped)) {
        rows.push({ kind: "header", label, count: items.length })
        for (const item of items) rows.push(nodeToRow(item))
      }
      return rows
    }

    return datedTasks.map(nodeToRow)
  }, [datedTasks, milestones, projects, displaySettings.groupBy])

  return (
    <ItemTimelineView
      rows={timelineRows}
      viewKey={displayViewKey}
      renderLeftCell={(node) => (
        <span className={cn(
          "text-sm truncate",
          node.status === "pruned" && "line-through opacity-50"
        )}>
          {node.title}
        </span>
      )}
      onItemClick={(node) => onNodeSelect(node)}
      onDateChange={(nodeId, startDate, endDate) => updateNode(nodeId, { startDate, endDate })}
      footer={
        isCreating ? (
          <TaskCreationForm
            mode="inline"
            projectId={projectId}
            onCreated={() => setIsCreating(false)}
            onCancel={() => setIsCreating(false)}
          />
        ) : (
          <TimelineAddTaskFooter onClick={() => setIsCreating(true)} />
        )
      }
    />
  )
}

// --- Board View Wrapper ---
export function PlanBoardView({
  projectId,
  nodes: providedNodes,
  onNodeSelect,
  applyCompletedFilter = true
}: {
  projectId: string
  nodes?: PlanNode[] // Optional: pre-filtered nodes for cross-project mode
  onNodeSelect: (node: PlanNode | null) => void
  applyCompletedFilter?: boolean // Whether to apply showCompleted filter (default true)
}) {
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const updateNode = usePlanStore((s) => s.updateNode)
  const boardSettings = useDisplaySettingsStore((s) => s.get("plan-board"))
  const [creatingInColumn, setCreatingInColumn] = useState<string | null>(null)

  const nodes = useMemo(() => {
    // If nodes provided (cross-project mode), use those
    if (providedNodes) return providedNodes
    // Otherwise filter by projectId (single-project mode)
    return planNodes.filter((n) => n.projectId === projectId)
  }, [planNodes, projectId, providedNodes])

  const milestones = useMemo(() => {
    return nodes.filter((n) => n.type === "milestone")
  }, [nodes])

  const handleNodeUpdate = useCallback((id: string, updates: Partial<PlanNode>) => {
    updateNode(id, updates)
  }, [updateNode])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {creatingInColumn && (
        <div className="border-b border-border p-4">
          <TaskCreationForm
            mode="inline"
            projectId={projectId}
            onCreated={() => setCreatingInColumn(null)}
            onCancel={() => setCreatingInColumn(null)}
          />
        </div>
      )}
      <BoardView
        nodes={nodes}
        columnBy={(boardSettings.columnBy ?? "status") as "status" | "priority" | "milestone"}
        visibleProperties={boardSettings.visibleProperties}
        showCompleted={applyCompletedFilter ? boardSettings.showCompleted : true}
        orderBy={boardSettings.orderBy}
        orderDirection={boardSettings.orderDirection}
        milestones={milestones}
        onNodeSelect={(node) => onNodeSelect(node)}
        onNodeUpdate={handleNodeUpdate}
        onAddTask={(columnId) => setCreatingInColumn(columnId)}
      />
    </div>
  )
}

// --- Main Plan View Page ---
const VALID_VIEWS = new Set<ViewMode>(["graph", "list", "timeline", "board"])

export function PlanView() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id))
  const allProjects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)
  const [chatOpen, setChatOpen] = useState(false)

  /** Select a node and close chat to show the inspector */
  const handleNodeSelect = useCallback((node: PlanNode | null) => {
    setSelectedNode(node)
    if (node) setChatOpen(false)
  }, [])

  /** Handle node ID click from chat messages */
  const handleChatNodeSelect = useCallback((nodeId: string) => {
    const node = planNodes.find((n) => n.id === nodeId)
    if (node) handleNodeSelect(node)
  }, [planNodes, handleNodeSelect])
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>()
  const [visionOpen, setVisionOpen] = useState(false)
  const isMobile = useMediaQuery("(max-width: 767px)")
  const [isRenaming, setIsRenaming] = useState(false)

  const handleRename = useCallback((newName: string) => {
    if (project) updateProject(project.id, { name: newName })
    setIsRenaming(false)
  }, [project, updateProject])

  const handleValidateRename = useCallback((name: string): string | null => {
    if (!project) return null
    return validateProjectName(name, project.id, allProjects)
  }, [project, allProjects])

  // Determine view mode and active tab from URL path
  const { viewMode, activeTab } = useMemo(() => {
    const pathParts = location.pathname.split('/')
    const lastPart = pathParts[pathParts.length - 1]

    // Check if the last part is a view mode
    if (lastPart === 'overview') {
      return { viewMode: 'graph' as ViewMode, activeTab: 'overview' as const }
    } else if (VALID_VIEWS.has(lastPart as ViewMode)) {
      return { viewMode: lastPart as ViewMode, activeTab: 'plan' as const }
    }

    // Default to graph view in plan tab
    return { viewMode: 'graph' as ViewMode, activeTab: 'plan' as const }
  }, [location.pathname])

  // Redirect to default view if on base project URL
  useEffect(() => {
    const pathParts = location.pathname.split('/')
    const lastPart = pathParts[pathParts.length - 1]

    // If the URL ends with just the project ID (no view specified), redirect to graph view
    if (lastPart === id && id) {
      navigate(`/project/${id}/graph`, { replace: true })
    }
  }, [location.pathname, id, navigate])

  // Close detail panel when switching view modes.
  // This effect legitimately syncs UI state (selectedNode) when the derived
  // viewMode changes from URL navigation. The guard avoids no-op renders.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSelectedNode(null) }, [viewMode])

  // Handle decompose: open chat with pre-filled message
  const handleDecomposeNode = useCallback((nodeId: string) => {
    const node = planNodes.find((n) => n.id === nodeId)
    if (!node) return
    const message = `Decompose @${node.title} into smaller sub-tasks with minimal overlap. Each sub-task should be agent-solvable in one session.`
    setChatInitialMessage(message)
    setChatOpen(true)
    setSelectedNode(null)
  }, [planNodes])

  // Auto-fetch file tree in the background when stale or missing
  useFileTreeRefresh(project)

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Project not found
      </div>
    )
  }

  const inspectorProps = selectedNode ? {
    node: selectedNode,
    project,
    viewMode,
    onClose: () => setSelectedNode(null),
    onNodeUpdate: setSelectedNode,
  } : null

  return (
    <div className="flex h-full flex-col">
      {/* Header: project identity + Plan|Overview toggle + view mode + actions */}
      <header className="flex flex-col md:flex-row md:items-center gap-3 border-b border-border px-4 md:px-6 py-3 md:h-14 md:py-0 shrink-0">
        {/* Project identity */}
        <div className="flex items-center gap-3 shrink-0">
          <ColorIconBadge
            color={project.color}
            icon={project.icon}
            type="project"
            editable
            onColorChange={(color) => updateProject(project.id, { color })}
            onIconChange={(icon) => updateProject(project.id, { icon })}
          />
          {isRenaming ? (
            <InlineRenameInput
              value={project.name}
              onSave={handleRename}
              onCancel={() => setIsRenaming(false)}
              validate={handleValidateRename}
              className="text-lg font-semibold"
            />
          ) : (
            <span
              className="text-lg font-semibold shrink-0 group/name cursor-default"
              onDoubleClick={() => setIsRenaming(true)}
            >
              {project.name}
              <Pencil className="h-3 w-3 ml-1.5 inline-block opacity-0 group-hover/name:opacity-50 transition-opacity" />
            </span>
          )}
          <Star className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
        </div>

        {/* Plan | Overview Toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => navigate(`/project/${project.id}/graph`)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
              activeTab === "plan"
                ? "text-accent-foreground border-b-2 border-accent"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Plan
          </button>
          <button
            onClick={() => navigate(`/project/${project.id}/overview`)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
              activeTab === "overview"
                ? "text-accent-foreground border-b-2 border-accent"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Overview
          </button>
        </div>

        {/* View mode toggle - only visible when Plan is active */}
        {activeTab === "plan" && (
          <>
            <Separator orientation="vertical" className="h-5 shrink-0 hidden md:block" />
            <div className="flex items-center gap-2 shrink-0 overflow-x-auto">
              <div className="flex items-center gap-1">
                {(["graph", "list", "timeline", "board"] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => navigate(`/project/${project.id}/${mode}`)}
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
              {viewMode === "graph" && <DisplayPopover config={planGraphDisplayConfig} />}
              {viewMode === "list" && <DisplayPopover config={planListDisplayConfig} />}
              {viewMode === "timeline" && <DisplayPopover config={planTimelineDisplayConfig} />}
              {viewMode === "board" && <DisplayPopover config={planBoardDisplayConfig} />}
            </div>
          </>
        )}
        <div className="flex-1 min-w-0 hidden md:block" />

        {/* Action buttons - only visible when Plan is active */}
        {activeTab === "plan" && (
          <div className="flex items-center gap-2 shrink-0 overflow-x-auto">
            <Button variant="outline" size="sm" onClick={() => setVisionOpen(true)} className="hidden md:flex">
              <FileText className="h-3.5 w-3.5" />
              Vision
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden md:flex"
              onClick={() => {
                const bundle = exportProject(project.id)
                downloadBundle(bundle)
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
            <Button
              variant={chatOpen ? "default" : "outline"}
              size="sm"
              onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setSelectedNode(null); if (chatOpen) setChatInitialMessage(undefined) }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1.5">Chat</span>
            </Button>
          </div>
        )}
      </header>

      {/* Canvas/List + Detail/Chat pane */}
      <div className="flex flex-1 overflow-hidden relative">
        {activeTab === "overview" ? (
          <OverviewTab project={project} />
        ) : viewMode === "graph" ? (
          <div className="flex-1 relative overflow-hidden">
            <div className="absolute inset-0 touch-pan-x touch-pan-y">
              <PlanCanvas projectId={project.id} onNodeSelect={handleNodeSelect} onDecomposeNode={handleDecomposeNode} />
            </div>
          </div>
        ) : viewMode === "list" ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <PlanListView projectId={project.id} onNodeSelect={handleNodeSelect} />
          </div>
        ) : viewMode === "board" ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <PlanBoardView projectId={project.id} onNodeSelect={handleNodeSelect} />
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <PlanTimelineView projectId={project.id} onNodeSelect={handleNodeSelect} />
          </div>
        )}

        {/* No floating button needed - each view has inline creation */}

        {/* Chat panel — bottom sheet on mobile, right sidebar on desktop */}
        {chatOpen && (
          <>
            {/* Mobile: bottom sheet */}
            {isMobile && (
              <Sheet open={chatOpen} onOpenChange={(open) => { setChatOpen(open); if (!open) setChatInitialMessage(undefined) }}>
                <SheetContent side="bottom" className="h-[80vh] w-full">
                  <SheetHeader>
                    <SheetTitle>Plan Chat</SheetTitle>
                  </SheetHeader>
                  <div className="flex-1 overflow-hidden mt-4">
                    <ChatPanel projectId={project.id} visionDoc={project.visionDoc} initialMessage={chatInitialMessage} onNodeSelect={handleChatNodeSelect} />
                  </div>
                </SheetContent>
              </Sheet>
            )}

            {/* Desktop: right sidebar */}
            {!isMobile && (
              <div className="w-[380px] shrink-0">
                <ChatPanel projectId={project.id} visionDoc={project.visionDoc} initialMessage={chatInitialMessage} onNodeSelect={handleChatNodeSelect} />
              </div>
            )}
          </>
        )}

        {/* Detail pane with Execution Panel — full-screen sheet on mobile, right sidebar on desktop */}
        {inspectorProps && !chatOpen && (
          <>
            {isMobile && <NodeInspectorSheet open={!!selectedNode} {...inspectorProps} />}
            {!isMobile && <NodeInspectorSidebar {...inspectorProps} />}
          </>
        )}
      </div>

      {/* Vision Document Dialog */}
      <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project} />
    </div>
  )
}
