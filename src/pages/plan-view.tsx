import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useParams, useSearchParams, Link } from "react-router"
import { FileText, Plus, Share2, CheckCircle2, Clock, Circle, MessageSquare, XCircle, Diamond, X, Calendar, Trash2, GitPullRequestDraft, GitPullRequest, Ellipsis, ChevronDown } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { TaskCreationForm } from "@/components/task-creation-form"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { ChatPanel } from "@/components/agent/chat-panel"
import { ExecutionPanel } from "@/components/execution"
import { BoardView } from "@/components/board/board-view"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { ItemListView, type ListColumn, type ListGroup, type BatchAction } from "@/components/views/item-list-view"
import { ItemTimelineView, TimelineAddTaskFooter, type TimelineRow } from "@/components/views/item-timeline-view"
import { PropertyPicker } from "@/components/property-picker"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { statusLabels, statusBadgeVariants, statusBarColors, statusProgressColors } from "@/lib/status-config"
import { formatDueDateShort } from "@/lib/date-utils"
import { assignDefaultDates } from "@/lib/timeline-utils"
import { cn } from "@/lib/utils"
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
    { value: "name", label: "Name" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "dueDate", label: "Due date" },
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
  const sorted = [...nodes]
  sorted.sort((a, b) => {
    switch (orderBy) {
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
): ListColumn<PlanNode>[] {
  return [
    {
      id: "name",
      label: "Name",
      width: "flex-1",
      sortKey: "name",
      render: (node) => (
        <span className={cn("text-sm truncate", node.status === "pruned" && "line-through")}>
          {node.title}
        </span>
      ),
    },
    {
      id: "priority",
      label: "Priority",
      width: "w-[60px]",
      sortKey: "priority",
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
            className="inline-flex items-center gap-1 text-xs text-purple-500 hover:text-purple-600 transition-colors"
            title={node.branchName ?? `PR #${node.prNumber}`}
          >
            <PrIcon className="h-3.5 w-3.5 shrink-0" />
            {node.prNumber != null && <span>#{node.prNumber}</span>}
          </a>
        )
      },
    },
  ]
}

// --- List View ---
function PlanListView({ projectId, onNodeSelect }: { projectId: string; onNodeSelect: (node: PlanNode | null) => void }) {
  const planNodes = usePlanStore((s) => s.nodes)
  const updateNode = usePlanStore((s) => s.updateNode)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const displaySettings = useDisplaySettingsStore((s) => s.get("plan-list"))
  const updateDisplaySettings = useDisplaySettingsStore((s) => s.update)
  const [creatingInGroup, setCreatingInGroup] = useState<string | null>(null)

  const handleNodeUpdate = useCallback((id: string, updates: Partial<PlanNode>) => {
    updateNode(id, updates)
  }, [updateNode])

  const planBatchActions: BatchAction[] = useMemo(() => [
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: "destructive",
      onAction: (ids) => removeNodes(ids),
    },
  ], [removeNodes])

  const allProjectNodes = useMemo(() => {
    return planNodes.filter((n) => n.projectId === projectId)
  }, [planNodes, projectId])

  const milestones = useMemo(() => allProjectNodes.filter((n) => n.type === "milestone"), [allProjectNodes])

  const milestoneMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const ms of milestones) m.set(ms.id, ms.title)
    return m
  }, [milestones])

  const columns = useMemo(() => makePlanColumns(project, milestoneMap, handleNodeUpdate), [project, milestoneMap, handleNodeUpdate])

  const tasks = useMemo(() => {
    let filtered = allProjectNodes.filter((n) => n.type !== "milestone")
    if (!displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return sortPlanNodes(filtered, displaySettings.orderBy, dir)
  }, [allProjectNodes, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted])

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

    return [{ key: "all", label: "All Tasks", items: tasks }]
  }, [tasks, milestones, displaySettings.groupBy])

  function renderAddTaskRow(groupKey: string) {
    const defaultMilestoneId = groupKey.startsWith("milestone-") ? groupKey.replace("milestone-", "") : undefined
    if (creatingInGroup === groupKey) {
      return (
        <TaskCreationForm
          mode="inline"
          projectId={projectId}
          defaultMilestoneId={defaultMilestoneId}
          onCreated={() => setCreatingInGroup(null)}
          onCancel={() => setCreatingInGroup(null)}
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
      updateDisplaySettings("plan-list", {
        orderDirection: displaySettings.orderDirection === "asc" ? "desc" : "asc",
      })
    } else {
      updateDisplaySettings("plan-list", { orderBy: sortKey, orderDirection: "asc" })
    }
  }, [displaySettings.orderBy, displaySettings.orderDirection, updateDisplaySettings])

  return (
    <ItemListView
      columns={columns}
      groups={groups}
      visibleColumns={displaySettings.visibleProperties}
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
function PlanTimelineView({ projectId, onNodeSelect }: { projectId: string; onNodeSelect: (node: PlanNode | null) => void }) {
  const planNodes = usePlanStore((s) => s.nodes)
  const planEdges = usePlanStore((s) => s.edges)
  const updateNode = usePlanStore((s) => s.updateNode)
  const displaySettings = useDisplaySettingsStore((s) => s.get("plan-list"))
  const [isCreating, setIsCreating] = useState(false)

  const allProjectNodes = useMemo(() => {
    return planNodes.filter((n) => n.projectId === projectId)
  }, [planNodes, projectId])

  const milestones = useMemo(() => allProjectNodes.filter((n) => n.type === "milestone"), [allProjectNodes])

  const tasks = useMemo(() => {
    let filtered = allProjectNodes.filter((n) => n.type !== "milestone")
    if (!displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return sortPlanNodes(filtered, displaySettings.orderBy, dir)
  }, [allProjectNodes, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted])

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
          label: node.title,
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

    return datedTasks.map(nodeToRow)
  }, [datedTasks, milestones, displaySettings.groupBy])

  return (
    <ItemTimelineView
      rows={timelineRows}
      viewKey="plan-list"
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
function PlanBoardView({ projectId, onNodeSelect }: { projectId: string; onNodeSelect: (node: PlanNode | null) => void }) {
  const planNodes = usePlanStore((s) => s.nodes)
  const updateNode = usePlanStore((s) => s.updateNode)
  const boardSettings = useDisplaySettingsStore((s) => s.get("plan-board"))
  const [creatingInColumn, setCreatingInColumn] = useState<string | null>(null)

  const nodes = useMemo(() => {
    return planNodes.filter((n) => n.projectId === projectId)
  }, [planNodes, projectId])

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
        showCompleted={boardSettings.showCompleted}
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

const FILE_TREE_STALE_MS = 5 * 60 * 1000 // 5 minutes

export function PlanView() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const initialView = searchParams.get("view") as ViewMode | null
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id))
  const updateFileTree = useProjectStore((s) => s.updateFileTree)
  const updateNode = usePlanStore((s) => s.updateNode)
  const planNodes = usePlanStore((s) => s.nodes)
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>()
  const [viewMode, setViewMode] = useState<ViewMode>(initialView && VALID_VIEWS.has(initialView) ? initialView : "graph")
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const viewMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mouseInTriggerRef = useRef(false)
  const mouseInContentRef = useRef(false)
  const viewMenuOpenedAtRef = useRef(0)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [visionOpen, setVisionOpen] = useState(false)

  // Clear view menu close timer on unmount
  useEffect(() => {
    return () => {
      if (viewMenuCloseTimerRef.current) clearTimeout(viewMenuCloseTimerRef.current)
    }
  }, [])

  // Handle decompose: open chat with pre-filled message
  const handleDecomposeNode = useCallback((nodeId: string) => {
    const node = planNodes.find((n) => n.id === nodeId)
    if (!node) return
    const message = `Decompose @${node.title} into smaller sub-tasks with minimal overlap. Each sub-task should be agent-solvable in one session.`
    setChatInitialMessage(message)
    setChatOpen(true)
    setSelectedNode(null)
  }, [planNodes])

  // Refresh file tree cache if stale, missing, or from a different machine
  useEffect(() => {
    if (!project?.workingDirectory) return
    const machineId = project.defaultMachineId
    const cachedForMachine = project.fileTreeMachineId || 'local'
    const currentMachine = machineId || 'local'
    const updatedAt = project.fileTreeUpdatedAt ? new Date(project.fileTreeUpdatedAt).getTime() : 0
    const isStale = Date.now() - updatedAt >= FILE_TREE_STALE_MS || !project.fileTree?.length
    const isMachineMismatch = cachedForMachine !== currentMachine
    if (!isStale && !isMachineMismatch) return

    if (machineId) {
      // Remote machine: fetch via relay
      const params = new URLSearchParams({ projectId: project.id, machineId, workingDirectory: project.workingDirectory })
      fetch(`/api/fs/files?${params}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.files?.length) updateFileTree(project.id, data.files, machineId)
        })
        .catch(() => {})
    } else {
      // Local: fetch directly
      fetch(`/api/repo/file-tree?workingDirectory=${encodeURIComponent(project.workingDirectory)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.files?.length) updateFileTree(project.id, data.files)
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.workingDirectory, project?.defaultMachineId])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Project not found
      </div>
    )
  }

  const handleApprove = () => {
    if (selectedNode) {
      updateNode(selectedNode.id, { status: "completed" })
      setSelectedNode({ ...selectedNode, status: "completed" })
    }
  }

  const handleReject = () => {
    if (selectedNode) {
      updateNode(selectedNode.id, { status: "planned" })
      setSelectedNode({ ...selectedNode, status: "planned" })
    }
  }

  const handlePrune = () => {
    if (selectedNode) {
      updateNode(selectedNode.id, { status: "pruned" })
      setSelectedNode({ ...selectedNode, status: "pruned" })
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Single-line header: tabs + view mode + actions (title only on overview page) */}
      <header className="flex items-center gap-3 border-b border-border px-6 h-14 shrink-0 flex-wrap">
        <div className="flex items-center gap-1 shrink-0">
          <Link
            to={`/project/${id}`}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
              "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            Overview
          </Link>
          <Link
            to={`/project/${id}?tab=updates`}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
              "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            Updates
          </Link>
          <span className="rounded-lg px-3 py-1.5 text-sm font-semibold bg-accent text-accent-foreground cursor-default">
            Plan
          </span>
        </div>
        <Separator orientation="vertical" className="h-5 shrink-0" />
        <div className="flex items-center gap-2 shrink-0">
          <DropdownMenu open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/80 cursor-pointer capitalize"
                onMouseEnter={() => {
                  mouseInTriggerRef.current = true
                  viewMenuOpenedAtRef.current = Date.now()
                  if (viewMenuCloseTimerRef.current) {
                    clearTimeout(viewMenuCloseTimerRef.current)
                    viewMenuCloseTimerRef.current = null
                  }
                  setViewMenuOpen(true)
                }}
                onMouseLeave={() => {
                  mouseInTriggerRef.current = false
                  // Ignore spurious leave right after open (e.g. when dropdown content mounts)
                  if (Date.now() - viewMenuOpenedAtRef.current < 120) return
                  if (viewMenuCloseTimerRef.current) clearTimeout(viewMenuCloseTimerRef.current)
                  viewMenuCloseTimerRef.current = setTimeout(() => {
                    viewMenuCloseTimerRef.current = null
                    if (!mouseInTriggerRef.current && !mouseInContentRef.current) setViewMenuOpen(false)
                  }, 220)
                }}
              >
                {viewMode}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-[7rem]"
              onMouseEnter={() => {
                mouseInContentRef.current = true
                if (viewMenuCloseTimerRef.current) {
                  clearTimeout(viewMenuCloseTimerRef.current)
                  viewMenuCloseTimerRef.current = null
                }
                setViewMenuOpen(true)
              }}
              onMouseLeave={() => {
                mouseInContentRef.current = false
                if (viewMenuCloseTimerRef.current) clearTimeout(viewMenuCloseTimerRef.current)
                viewMenuCloseTimerRef.current = setTimeout(() => {
                  viewMenuCloseTimerRef.current = null
                  if (!mouseInTriggerRef.current && !mouseInContentRef.current) setViewMenuOpen(false)
                }, 200)
              }}
            >
              {(["graph", "list", "timeline", "board"] as ViewMode[]).map((mode) => (
                <DropdownMenuItem
                  key={mode}
                  className="capitalize cursor-pointer"
                  onClick={() => setViewMode(mode)}
                >
                  {mode}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {viewMode === "graph" && <DisplayPopover config={planGraphDisplayConfig} />}
          {viewMode === "list" && <DisplayPopover config={planListDisplayConfig} />}
          {viewMode === "timeline" && <DisplayPopover config={planTimelineDisplayConfig} />}
          {viewMode === "board" && <DisplayPopover config={planBoardDisplayConfig} />}
        </div>
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setVisionOpen(true)}>
            <FileText className="h-3.5 w-3.5" />
            Vision
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add Task
          </Button>
          <Button
            variant={chatOpen ? "default" : "outline"}
            size="sm"
            onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setSelectedNode(null); if (chatOpen) setChatInitialMessage(undefined) }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <Share2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Ellipsis className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Canvas/List + Detail/Chat pane */}
      <div className="flex flex-1 overflow-hidden relative">
        {viewMode === "graph" ? (
          <div className="absolute inset-0">
            <PlanCanvas projectId={project.id} onNodeSelect={setSelectedNode} onDecomposeNode={handleDecomposeNode} />
          </div>
        ) : viewMode === "list" ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <PlanListView projectId={project.id} onNodeSelect={setSelectedNode} />
          </div>
        ) : viewMode === "board" ? (
          <PlanBoardView projectId={project.id} onNodeSelect={setSelectedNode} />
        ) : (
          <PlanTimelineView projectId={project.id} onNodeSelect={setSelectedNode} />
        )}

        {/* Chat panel — right sidebar */}
        {chatOpen && (
          <div className={cn(
            "z-20",
            viewMode === "graph"
              ? "absolute right-0 top-0 bottom-0 w-[380px] shadow-lg"
              : "w-[380px] shrink-0"
          )}>
            <ChatPanel projectId={project.id} visionDoc={project.visionDoc} initialMessage={chatInitialMessage} />
          </div>
        )}

        {/* Detail pane with Execution Panel */}
        {selectedNode && !chatOpen && (
          <div className={cn(
            "flex flex-col gap-5 border-l border-border bg-card p-5 overflow-auto",
            viewMode === "graph"
              ? "absolute right-0 top-0 bottom-0 w-[400px] z-10 shadow-lg"
              : "w-[400px] shrink-0"
          )}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-base truncate flex-1">{selectedNode.title}</h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setSelectedNode(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Separator />

            <div className="flex flex-col gap-3">
              {/* Status — editable */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <PropertyPicker
                  value={selectedNode.status}
                  options={STATUS_OPTIONS}
                  title="Set status"
                  onSelect={(id) => {
                    updateNode(selectedNode.id, { status: id as PlanNode["status"] })
                    setSelectedNode({ ...selectedNode, status: id as PlanNode["status"] })
                  }}
                >
                  <Badge variant={statusVariant[selectedNode.status] ?? "secondary"} className="text-[10px]">
                    {statusLabels[selectedNode.status]}
                  </Badge>
                </PropertyPicker>
              </div>

              {/* Priority — editable */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Priority</span>
                <PropertyPicker
                  value={selectedNode.priority ?? "none"}
                  options={PRIORITY_OPTIONS}
                  title="Set priority"
                  onSelect={(id) => {
                    updateNode(selectedNode.id, { priority: id as Priority })
                    setSelectedNode({ ...selectedNode, priority: id as Priority })
                  }}
                >
                  {(() => {
                    const config = PRIORITY_CONFIG[(selectedNode.priority ?? "none") as Priority]
                    const PIcon = config.icon
                    return (
                      <span className="inline-flex items-center gap-1.5">
                        <PIcon className={cn("h-3.5 w-3.5", config.color)} />
                        <span className="text-sm">{config.label}</span>
                      </span>
                    )
                  })()}
                </PropertyPicker>
              </div>

              {/* Estimate — editable */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Estimate</span>
                <PropertyPicker
                  value={selectedNode.estimate}
                  options={ESTIMATE_OPTIONS}
                  title="Set estimate"
                  onSelect={(id) => {
                    updateNode(selectedNode.id, { estimate: id as PlanNode["estimate"] })
                    setSelectedNode({ ...selectedNode, estimate: id as PlanNode["estimate"] })
                  }}
                >
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {selectedNode.estimate ?? "\u2014"}
                  </span>
                </PropertyPicker>
              </div>

              {/* Due date — editable */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Due date</span>
                <label className="inline-flex items-center gap-1.5 rounded-sm p-0.5 -m-0.5 hover:bg-muted transition-colors cursor-pointer">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className={cn("text-sm", selectedNode.dueDate ? "text-foreground" : "text-muted-foreground")}>
                    {selectedNode.dueDate
                      ? new Date(selectedNode.dueDate + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
                      : "\u2014"}
                  </span>
                  <input
                    type="date"
                    className="sr-only"
                    value={selectedNode.dueDate ?? ""}
                    onChange={(e) => {
                      const val = e.target.value || undefined
                      updateNode(selectedNode.id, { dueDate: val })
                      setSelectedNode({ ...selectedNode, dueDate: val })
                    }}
                  />
                </label>
              </div>

              {/* Type — read-only */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Type</span>
                <span className="capitalize">{selectedNode.type}</span>
              </div>

              {/* Verification — read-only */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Verification</span>
                <span className="capitalize">{selectedNode.verification}</span>
              </div>

              {/* Environment — read-only */}
              {selectedNode.environment && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Environment</span>
                  <span className="capitalize">{selectedNode.environment}</span>
                </div>
              )}
            </div>
            <Separator />

            <div>
              <h4 className="mb-3 text-sm font-semibold">Description</h4>
              <FileCompletionTextarea
                projectId={project.id}
                machineId={project.defaultMachineId}
                workingDirectory={project.workingDirectory}
                fileTree={project.fileTree}
                value={selectedNode.description ?? ""}
                onChange={(val) => {
                  updateNode(selectedNode.id, { description: val })
                  setSelectedNode({ ...selectedNode, description: val })
                }}
                placeholder="Describe this task... Use @ to reference files"
                rows={4}
                className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <Separator />

            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">Execution</h4>
              <ExecutionPanel node={selectedNode} projectId={project.id} />
            </div>

            {selectedNode.status === "awaiting_judgment" && (
              <>
                <Separator />
                <div className="flex items-center gap-2.5">
                  <Button size="sm" className="flex-1" onClick={handleApprove}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={handleReject}>
                    <Clock className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePrune}>
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            )}

            {selectedNode.status !== "awaiting_judgment" && selectedNode.status !== "pruned" && (
              <>
                <Separator />
                <div className="flex items-center gap-2.5">
                  <Button variant="outline" size="sm" className="flex-1" onClick={handlePrune}>
                    <Circle className="h-3.5 w-3.5" />
                    Prune Branch
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Task Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
          </DialogHeader>
          <TaskCreationForm
            mode="dialog"
            projectId={project.id}
            onCreated={() => setCreateDialogOpen(false)}
            onCancel={() => setCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Vision Document Dialog */}
      <VisionDocDialog open={visionOpen} onOpenChange={setVisionOpen} project={project} />
    </div>
  )
}
