import { useState, useMemo, useCallback } from "react"
import { useParams, useSearchParams, Link } from "react-router"
import { ArrowLeft, FileText, Plus, Share2, CheckCircle2, Clock, Circle, MessageSquare, XCircle, Diamond } from "lucide-react"
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
import { ItemListView, type ListColumn, type ListGroup } from "@/components/views/item-list-view"
import { ItemTimelineView, TimelineAddTaskFooter, type TimelineRow } from "@/components/views/item-timeline-view"
import { useProjectStore } from "@/stores/project-store"
import { useAgentStore } from "@/stores/agent-store"
import { usePlanStore } from "@/stores/plan-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { PRIORITY_CONFIG } from "@/lib/constants"
import {
  statusColors,
  progressColors,
  assignDefaultDates,
} from "@/lib/timeline-utils"
import { cn } from "@/lib/utils"
import type { PlanNode, Priority } from "@/types"

type ViewMode = "graph" | "list" | "timeline" | "board"

const statusLabels: Record<string, string> = {
  planned: "Planned",
  dispatched: "Dispatched",
  in_progress: "In Progress",
  auto_verified: "Auto Verified",
  awaiting_judgment: "Awaiting Judgment",
  completed: "Completed",
  pruned: "Pruned",
}

const statusVariant: Record<string, "secondary" | "info" | "success" | "warning" | "outline"> = {
  planned: "secondary",
  dispatched: "info",
  in_progress: "info",
  auto_verified: "success",
  awaiting_judgment: "warning",
  completed: "success",
  pruned: "outline",
}

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

function formatDueDateShort(dateStr?: string): { text: string; className: string } {
  if (!dateStr) return { text: "\u2014", className: "text-muted-foreground" }
  const due = new Date(dateStr + "T00:00:00Z")
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = due.getTime() - today.getTime()
  const diffDays = Math.ceil(diffMs / 86400000)
  const text = due.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  if (diffDays < 0) return { text, className: "text-red-500" }
  if (diffDays < 7) return { text, className: "text-orange-500" }
  return { text, className: "text-muted-foreground" }
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
function makePlanColumns(project: { labels?: { id: string; name: string; color: string }[] } | undefined): ListColumn<PlanNode>[] {
  return [
    {
      id: "name",
      label: "Name",
      width: "flex-1",
      render: (node) => (
        <span className={cn("text-sm truncate", node.status === "pruned" && "line-through")}>
          {node.type === "milestone" ? "\u25C6 " : ""}{node.title}
        </span>
      ),
    },
    {
      id: "priority",
      label: "Priority",
      width: "w-[60px]",
      render: (node) => {
        const config = node.priority ? PRIORITY_CONFIG[node.priority as Priority] : null
        const PIcon = config?.icon
        return PIcon ? <PIcon className={cn("h-3.5 w-3.5", config?.color)} /> : null
      },
    },
    {
      id: "status",
      label: "Status",
      width: "w-[120px]",
      render: (node) => (
        <Badge variant={statusVariant[node.status] ?? "secondary"} className="text-[10px]">
          {node.status.replace(/_/g, " ")}
        </Badge>
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
      render: (node) => node.estimate ? (
        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
          {node.estimate}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{"\u2014"}</span>
      ),
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
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const displaySettings = useDisplaySettingsStore((s) => s.get("plan-list"))
  const [creatingInGroup, setCreatingInGroup] = useState<string | null>(null)

  const columns = useMemo(() => makePlanColumns(project), [project])

  const nodes = useMemo(() => {
    let filtered = planNodes.filter((n) => n.projectId === projectId)
    if (!displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return sortPlanNodes(filtered, displaySettings.orderBy, dir)
  }, [planNodes, projectId, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted])

  const milestones = nodes.filter((n) => n.type === "milestone")

  const groups = useMemo((): ListGroup<PlanNode>[] => {
    if (displaySettings.groupBy === "milestone") {
      const result: ListGroup<PlanNode>[] = []
      for (const m of milestones) {
        const tasks = nodes.filter((n) => n.type !== "milestone" && n.milestoneId === m.id)
        const completedCount = tasks.filter((t) => t.status === "completed" || t.status === "auto_verified").length
        const completion = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0
        result.push({
          key: `milestone-${m.id}`,
          label: m.title,
          icon: <Diamond className="h-3 w-3 text-primary" />,
          items: tasks,
          meta: <span className="text-[11px] text-muted-foreground">{completion}% &middot; {tasks.length} tasks</span>,
        })
      }
      const unassigned = nodes.filter((n) => n.type !== "milestone" && !n.milestoneId)
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
      for (const node of nodes) {
        if (node.type === "milestone") continue
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
      for (const node of nodes) {
        if (node.type === "milestone") continue
        const key = node.priority ? (node.priority.charAt(0).toUpperCase() + node.priority.slice(1)) : "No priority"
        ;(grouped[key] ??= []).push(node)
      }
      return Object.entries(grouped).map(([label, items]) => ({
        key: label,
        label,
        items,
      }))
    }

    // No grouping — show milestones header then tasks
    const tasks = nodes.filter((n) => n.type !== "milestone")
    if (milestones.length > 0) {
      return [
        { key: "milestones", label: "Milestones", items: milestones },
        { key: "tasks", label: "Tasks", items: tasks },
      ]
    }
    return [{ key: "all", label: "All Tasks", items: tasks }]
  }, [nodes, milestones, displaySettings.groupBy])

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
    />
  )
}

// --- Timeline View ---
function PlanTimelineView({ projectId, onNodeSelect }: { projectId: string; onNodeSelect: (node: PlanNode | null) => void }) {
  const planNodes = usePlanStore((s) => s.nodes)
  const planEdges = usePlanStore((s) => s.edges)
  const displaySettings = useDisplaySettingsStore((s) => s.get("plan-list"))
  const [isCreating, setIsCreating] = useState(false)

  const nodes = useMemo(() => {
    let filtered = planNodes.filter((n) => n.projectId === projectId)
    if (!displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return sortPlanNodes(filtered, displaySettings.orderBy, dir)
  }, [planNodes, projectId, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted])

  const edges = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id))
    return planEdges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target))
  }, [nodes, planEdges])

  const datedNodes = useMemo(() => assignDefaultDates(nodes, edges), [nodes, edges])
  const milestones = useMemo(() => nodes.filter((n) => n.type === "milestone"), [nodes])

  const timelineRows = useMemo((): TimelineRow<PlanNode>[] => {
    function nodeToRow(node: PlanNode): TimelineRow<PlanNode> {
      const dated = datedNodes.find((n) => n.id === node.id) ?? node
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

    if (displaySettings.groupBy === "none") {
      return datedNodes.map(nodeToRow)
    }

    if (displaySettings.groupBy === "milestone") {
      const rows: TimelineRow<PlanNode>[] = []
      for (const m of milestones) {
        const tasks = datedNodes.filter((n) => n.type !== "milestone" && n.milestoneId === m.id)
        rows.push({ kind: "header", label: m.title, count: tasks.length })
        rows.push(nodeToRow(m))
        for (const t of tasks) rows.push(nodeToRow(t))
      }
      const unassigned = datedNodes.filter((n) => n.type !== "milestone" && !n.milestoneId)
      if (unassigned.length > 0) {
        rows.push({ kind: "header", label: "Unassigned", count: unassigned.length })
        for (const t of unassigned) rows.push(nodeToRow(t))
      }
      return rows
    }

    if (displaySettings.groupBy === "status") {
      const grouped: Record<string, PlanNode[]> = {}
      for (const node of datedNodes) {
        if (node.type === "milestone") continue
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
      for (const node of datedNodes) {
        if (node.type === "milestone") continue
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

    return datedNodes.map(nodeToRow)
  }, [datedNodes, milestones, displaySettings.groupBy])

  return (
    <ItemTimelineView
      rows={timelineRows}
      viewKey="plan-list"
      renderLeftCell={(node) => (
        <span className={cn(
          "text-sm truncate",
          node.status === "pruned" && "line-through opacity-50"
        )}>
          {node.type === "milestone" ? "\u25C6 " : ""}{node.title}
        </span>
      )}
      onItemClick={(node) => onNodeSelect(node)}
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

export function PlanView() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const initialView = searchParams.get("view") as ViewMode | null
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id))
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const updateNode = usePlanStore((s) => s.updateNode)
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(initialView && VALID_VIEWS.has(initialView) ? initialView : "graph")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [visionOpen, setVisionOpen] = useState(false)

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
      <div className="flex flex-1 overflow-hidden">
        {viewMode === "graph" ? (
          <div className="relative flex-1">
            <PlanCanvas projectId={project.id} onNodeSelect={setSelectedNode} />
            {isGenerating && <GenerationOverlay />}
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
          <div className="flex w-[400px] shrink-0 flex-col gap-5 border-l border-border bg-card p-6 overflow-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{selectedNode.title}</h3>
              <Badge variant={statusVariant[selectedNode.status] ?? "secondary"}>
                {statusLabels[selectedNode.status]}
              </Badge>
            </div>
            <Separator />

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Type</span>
                <span className="capitalize">{selectedNode.type}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Verification</span>
                <span className="capitalize">{selectedNode.verification}</span>
              </div>
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
