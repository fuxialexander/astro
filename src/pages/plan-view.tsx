import { useState, useMemo, useCallback, useEffect } from "react"
import { useParams, useSearchParams, Link } from "react-router"
import { ArrowLeft, FileText, Plus, Share2, CheckCircle2, Clock, Circle, MessageSquare, XCircle, Diamond, X, Calendar, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { TaskCreationForm } from "@/components/task-creation-form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { GenerationOverlay } from "@/components/agent/generation-overlay"
import { ChatPanel } from "@/components/agent/chat-panel"
import { ExecutionPanel, ProviderStatus } from "@/components/execution"
import { BoardView } from "@/components/board/board-view"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { ItemListView, type ListColumn, type ListGroup, type BatchAction } from "@/components/views/item-list-view"
import { ItemTimelineView, TimelineAddTaskFooter, type TimelineRow } from "@/components/views/item-timeline-view"
import { PropertyPicker } from "@/components/property-picker"
import { useProjectStore } from "@/stores/project-store"
import { useAgentStore } from "@/stores/agent-store"
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
  ],
  showZoom: true,
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
  ]
}

// --- List View ---
function PlanListView({ projectId, onNodeSelect }: { projectId: string; onNodeSelect: (node: PlanNode | null) => void }) {
  const planNodes = usePlanStore((s) => s.nodes)
  const updateNode = usePlanStore((s) => s.updateNode)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const displaySettings = useDisplaySettingsStore((s) => s.get("plan-list"))
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

  // Milestone markers for the timeline (vertical lines with diamond)
  const milestoneMarkers = useMemo(() => {
    return milestones
      .filter((m) => m.endDate || m.dueDate)
      .map((m) => ({ id: m.id, date: (m.dueDate ?? m.endDate)!, label: m.title }))
  }, [milestones])

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
      milestoneMarkers={milestoneMarkers}
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
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const generationPhase = useAgentStore((s) => s.generationPhase)
  const showGenerationOverlay = isGenerating || generationPhase !== 'idle'
  const updateNode = usePlanStore((s) => s.updateNode)
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(initialView && VALID_VIEWS.has(initialView) ? initialView : "graph")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [visionOpen, setVisionOpen] = useState(false)

  // Refresh file tree cache if stale or missing (only on mount / project change)
  useEffect(() => {
    if (!project?.workingDirectory) return
    const updatedAt = project.fileTreeUpdatedAt ? new Date(project.fileTreeUpdatedAt).getTime() : 0
    if (Date.now() - updatedAt < FILE_TREE_STALE_MS && project.fileTree?.length) return

    fetch(`/api/repo/file-tree?workingDirectory=${encodeURIComponent(project.workingDirectory)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.files?.length) {
          updateFileTree(project.id, data.files)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.workingDirectory])

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
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Link to={`/project/${id}`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-[18px] w-[18px]" />
          </Link>
          <span className="font-semibold">{project.name}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">Plan</span>
        </div>
        <div className="flex items-center gap-2.5">
          <ProviderStatus compact />
          <Separator orientation="vertical" className="h-5" />

          <div className="flex items-center rounded-lg bg-secondary p-1 gap-0.5">
            {(["graph", "list", "timeline", "board"] as ViewMode[]).map((mode) => (
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
          {viewMode === "list" && <DisplayPopover config={planListDisplayConfig} />}
          {viewMode === "timeline" && <DisplayPopover config={planTimelineDisplayConfig} />}
          {viewMode === "board" && <DisplayPopover config={planBoardDisplayConfig} />}
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
            onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setSelectedNode(null) }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <Share2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Canvas/List + Detail/Chat pane */}
      <div className="flex flex-1 overflow-hidden relative">
        {viewMode === "graph" ? (
          <div className="absolute inset-0">
            <PlanCanvas projectId={project.id} onNodeSelect={setSelectedNode} />
            {showGenerationOverlay && <GenerationOverlay />}
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

        {/* Chat panel */}
        {chatOpen && <ChatPanel projectId={project.id} visionDoc={project.visionDoc} />}

        {/* Detail pane with Execution Panel */}
        {selectedNode && !chatOpen && (
          <div className={cn(
            "flex flex-col gap-5 border-l border-border bg-card p-6 overflow-auto",
            viewMode === "graph"
              ? "absolute right-0 top-0 bottom-0 w-[400px] z-10 shadow-lg"
              : "w-[400px] shrink-0"
          )}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold truncate flex-1">{selectedNode.title}</h3>
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
              <h4 className="mb-2 text-sm font-semibold">Description</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{selectedNode.description}</p>
            </div>
            <Separator />

            <div>
              <h4 className="mb-3 text-sm font-semibold">Execution</h4>
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
