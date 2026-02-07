import { useState, useMemo, useRef, useCallback } from "react"
import { useParams, Link } from "react-router"
import { ArrowLeft, FileText, Plus, Share2, CheckCircle2, Clock, Circle, MessageSquare, XCircle, Diamond } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TaskCreationForm } from "@/components/task-creation-form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { GenerationOverlay } from "@/components/agent/generation-overlay"
import { ChatPanel } from "@/components/agent/chat-panel"
import { ExecutionPanel, ProviderStatus } from "@/components/execution"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import { useProjectStore } from "@/stores/project-store"
import { useAgentStore } from "@/stores/agent-store"
import { usePlanStore } from "@/stores/plan-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { PRIORITY_CONFIG } from "@/lib/constants"
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
import type { PlanNode, Priority } from "@/types"

type ViewMode = "graph" | "list" | "timeline"

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

// --- List View ---
function ListView({ projectId, onNodeSelect }: { projectId: string; onNodeSelect: (node: PlanNode | null) => void }) {
  const planNodes = usePlanStore((s) => s.nodes)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const displaySettings = useDisplaySettingsStore((s) => s.get("plan-list"))
  const [creatingInGroup, setCreatingInGroup] = useState<string | null>(null)

  // Filter and sort nodes
  const nodes = useMemo(() => {
    let filtered = planNodes.filter((n) => n.projectId === projectId)
    if (!displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (displaySettings.orderBy) {
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
  }, [planNodes, projectId, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted])

  const milestones = nodes.filter((n) => n.type === "milestone")

  const groupedNodes = useMemo(() => {
    if (displaySettings.groupBy === "none") return null
    if (displaySettings.groupBy === "milestone") {
      const groups: Record<string, typeof nodes> = { unassigned: [] }
      for (const m of milestones) groups[m.id] = []
      for (const node of nodes) {
        if (node.type === "milestone") continue
        if (node.milestoneId && groups[node.milestoneId]) {
          groups[node.milestoneId].push(node)
        } else {
          groups.unassigned.push(node)
        }
      }
      return { type: "milestone" as const, groups }
    }
    if (displaySettings.groupBy === "status") {
      const groups: Record<string, PlanNode[]> = {}
      for (const node of nodes) {
        if (node.type === "milestone") continue
        const key = statusLabels[node.status] ?? node.status
        ;(groups[key] ??= []).push(node)
      }
      return { type: "generic" as const, groups }
    }
    if (displaySettings.groupBy === "priority") {
      const groups: Record<string, PlanNode[]> = {}
      for (const node of nodes) {
        if (node.type === "milestone") continue
        const key = node.priority ? (node.priority.charAt(0).toUpperCase() + node.priority.slice(1)) : "No priority"
        ;(groups[key] ??= []).push(node)
      }
      return { type: "generic" as const, groups }
    }
    return null
  }, [nodes, milestones, displaySettings.groupBy])

  function computeMilestoneCompletion(milestoneId: string): number {
    const tasks = nodes.filter((n) => n.milestoneId === milestoneId && n.type !== "milestone")
    if (tasks.length === 0) return 0
    const completed = tasks.filter((t) => t.status === "completed" || t.status === "auto_verified").length
    return Math.round((completed / tasks.length) * 100)
  }

  function renderNodeRow(node: PlanNode) {
    const priorityConfig = node.priority ? PRIORITY_CONFIG[node.priority as Priority] : null
    const PIcon = priorityConfig?.icon
    const { text: dueDateText, className: dueDateClass } = formatDueDateShort(node.dueDate)
    const nodeLabels = (node.labelIds || []).map((id) => project?.labels?.find((l) => l.id === id)).filter(Boolean)

    return (
      <div
        key={node.id}
        onClick={() => onNodeSelect(node)}
        className={cn(
          "flex items-center border-b border-border px-6 h-11 hover:bg-muted/30 transition-colors cursor-pointer",
          node.status === "pruned" && "opacity-50"
        )}
      >
        <span className={cn("flex-1 text-sm truncate", node.status === "pruned" && "line-through")}>
          {node.type === "milestone" ? "\u25C6 " : ""}{node.title}
        </span>
        {displaySettings.visibleProperties.includes("priority") && (
          <div className="w-[60px] flex items-center">
            {PIcon && <PIcon className={cn("h-3.5 w-3.5", priorityConfig?.color)} />}
          </div>
        )}
        {displaySettings.visibleProperties.includes("status") && (
          <div className="w-[120px]">
            <Badge variant={statusVariant[node.status] ?? "secondary"} className="text-[10px]">
              {node.status.replace(/_/g, " ")}
            </Badge>
          </div>
        )}
        {displaySettings.visibleProperties.includes("dueDate") && (
          <div className="w-[100px]">
            <span className={cn("text-xs", dueDateClass)}>{dueDateText}</span>
          </div>
        )}
        {displaySettings.visibleProperties.includes("estimate") && (
          <div className="w-[70px]">
            {node.estimate ? (
              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                {node.estimate}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">\u2014</span>
            )}
          </div>
        )}
        {displaySettings.visibleProperties.includes("labels") && (
          <div className="w-[80px] flex items-center gap-1">
            {nodeLabels.map((label) => label && (
              <span
                key={label.id}
                className="h-2.5 w-2.5 rounded-full shrink-0"
                title={label.name}
                style={{ backgroundColor: label.color }}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  function renderAddTaskRow(groupKey: string, defaultMilestoneId?: string) {
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
    <div className="flex-1 overflow-auto">
      <div className="flex items-center border-b border-border px-6 h-9 bg-muted/30">
        <div className="flex-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase">Name</span>
        </div>
        {displaySettings.visibleProperties.includes("priority") && (
          <span className="w-[60px] text-[11px] font-semibold text-muted-foreground uppercase">Priority</span>
        )}
        {displaySettings.visibleProperties.includes("status") && (
          <span className="w-[120px] text-[11px] font-semibold text-muted-foreground uppercase">Status</span>
        )}
        {displaySettings.visibleProperties.includes("dueDate") && (
          <span className="w-[100px] text-[11px] font-semibold text-muted-foreground uppercase">Due Date</span>
        )}
        {displaySettings.visibleProperties.includes("estimate") && (
          <span className="w-[70px] text-[11px] font-semibold text-muted-foreground uppercase">Estimate</span>
        )}
        {displaySettings.visibleProperties.includes("labels") && (
          <span className="w-[80px] text-[11px] font-semibold text-muted-foreground uppercase">Labels</span>
        )}
      </div>

      {groupedNodes && groupedNodes.type === "milestone" ? (
        <>
          {milestones.map((milestone) => {
            const tasks = groupedNodes.groups[milestone.id] || []
            const completion = computeMilestoneCompletion(milestone.id)
            return (
              <div key={milestone.id}>
                <div className="flex items-center gap-2 bg-muted/50 px-6 h-8">
                  <Diamond className="h-3 w-3 text-primary" />
                  <span className="text-xs font-semibold text-muted-foreground">{milestone.title}</span>
                  <span className="text-[11px] text-muted-foreground">{completion}%</span>
                  <span className="text-[11px] text-muted-foreground">&middot; {tasks.length} tasks</span>
                </div>
                {tasks.map(renderNodeRow)}
                {renderAddTaskRow(`milestone-${milestone.id}`, milestone.id)}
              </div>
            )
          })}
          {(groupedNodes.groups.unassigned?.length ?? 0) > 0 && (
            <div>
              <div className="flex items-center gap-2 bg-muted/50 px-6 h-8">
                <span className="text-xs font-semibold text-muted-foreground">Unassigned</span>
                <span className="text-[11px] text-muted-foreground">{groupedNodes.groups.unassigned.length}</span>
              </div>
              {groupedNodes.groups.unassigned.map(renderNodeRow)}
            </div>
          )}
          {renderAddTaskRow("bottom")}
        </>
      ) : groupedNodes && groupedNodes.type === "generic" ? (
        <>
          {Object.entries(groupedNodes.groups).map(([groupName, groupNodes]) => (
            <div key={groupName}>
              <div className="flex items-center gap-2 bg-muted/50 px-6 h-8">
                <span className="text-xs font-semibold text-muted-foreground">{groupName}</span>
                <span className="text-[11px] text-muted-foreground">{groupNodes.length}</span>
              </div>
              {groupNodes.map(renderNodeRow)}
            </div>
          ))}
          {renderAddTaskRow("bottom")}
        </>
      ) : (
        <>
          {milestones.length > 0 && (
            <>
              <div className="flex items-center gap-2 bg-muted/50 px-6 h-8">
                <span className="text-xs font-semibold text-muted-foreground">Milestones</span>
                <span className="text-[11px] text-muted-foreground">{milestones.length}</span>
              </div>
              {milestones.map(renderNodeRow)}
            </>
          )}
          <div className="flex items-center gap-2 bg-muted/50 px-6 h-8">
            <span className="text-xs font-semibold text-muted-foreground">Tasks</span>
            <span className="text-[11px] text-muted-foreground">{nodes.filter((n) => n.type !== "milestone").length}</span>
          </div>
          {nodes.filter((n) => n.type !== "milestone").map(renderNodeRow)}
          {renderAddTaskRow("bottom")}
        </>
      )}
    </div>
  )
}

// --- Timeline View ---
type ZoomLevel = "month" | "quarter" | "year"

function TimelineView({ projectId, onNodeSelect }: { projectId: string; onNodeSelect: (node: PlanNode | null) => void }) {
  const planNodes = usePlanStore((s) => s.nodes)
  const planEdges = usePlanStore((s) => s.edges)
  const displaySettings = useDisplaySettingsStore((s) => s.get("plan-list"))
  const updateDisplaySettings = useDisplaySettingsStore((s) => s.update)
  const zoom = (displaySettings.zoom ?? "month") as ZoomLevel
  const [isCreating, setIsCreating] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)

  // Filter nodes for this project, apply showCompleted, sort
  const nodes = useMemo(() => {
    let filtered = planNodes.filter((n) => n.projectId === projectId)
    if (!displaySettings.showCompleted) {
      filtered = filtered.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (displaySettings.orderBy) {
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
  }, [planNodes, projectId, displaySettings.orderBy, displaySettings.orderDirection, displaySettings.showCompleted])

  // Assign dates via topological sort
  const edges = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id))
    return planEdges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target))
  }, [nodes, planEdges])

  const datedNodes = useMemo(() => assignDefaultDates(nodes, edges), [nodes, edges])

  // Compute timeline bounds
  const { timelineStart, columns, colWidth, totalWidth } = useMemo(() => {
    if (datedNodes.length === 0) {
      const now = new Date()
      const start = snapToMonday(now)
      const weeks = Array.from({ length: 12 }, (_, i) => fmtDate(addDays(start, i * 7)))
      return { timelineStart: start, columns: weeks, colWidth: 7 * DAY_WIDTH, totalWidth: weeks.length * 7 * DAY_WIDTH }
    }

    let minDate = parseDate(datedNodes[0].startDate!)
    let maxDate = parseDate(datedNodes[0].endDate!)
    for (const n of datedNodes) {
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
  }, [datedNodes, zoom])

  const todayOffset = useMemo(() => {
    const today = new Date()
    return diffDays(timelineStart, today) * DAY_WIDTH
  }, [timelineStart])

  const scrollToToday = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayOffset - scrollRef.current.clientWidth / 2)
    }
  }, [todayOffset])

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

  // Sync vertical scroll between left panel and gantt area
  const handleGanttScroll = useCallback(() => {
    if (scrollRef.current && leftRef.current) {
      leftRef.current.scrollTop = scrollRef.current.scrollTop
    }
  }, [])

  const handleLeftScroll = useCallback(() => {
    if (leftRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = leftRef.current.scrollTop
    }
  }, [])

  const ROW_HEIGHT = 40

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left panel: task names */}
      <div className="w-[280px] shrink-0 border-r border-border flex flex-col">
        {/* Toolbar row (matches right side toolbar) */}
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase">Task</span>
        </div>
        {/* Scrollable task list */}
        <div ref={leftRef} className="flex-1 overflow-auto" onScroll={handleLeftScroll} style={{ overflowX: "hidden" }}>
          {/* Spacer matching sticky column header height */}
          <div className="h-10 shrink-0" />
          {datedNodes.map((node) => (
            <div
              key={node.id}
              onClick={() => onNodeSelect(node)}
              className="flex items-center border-b border-border px-4 hover:bg-muted/30 transition-colors cursor-pointer"
              style={{ height: `${ROW_HEIGHT}px` }}
            >
              <span className={cn(
                "text-sm truncate",
                node.status === "pruned" && "line-through opacity-50"
              )}>
                {node.type === "milestone" ? "\u25C6 " : ""}{node.title}
              </span>
            </div>
          ))}
          {isCreating ? (
            <TaskCreationForm
              mode="inline"
              projectId={projectId}
              onCreated={() => setIsCreating(false)}
              onCancel={() => setIsCreating(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 px-4 h-9 w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer border-b border-border"
            >
              <Plus className="h-3.5 w-3.5" />
              Add task
            </button>
          )}
        </div>
      </div>

      {/* Right column: toolbar + gantt */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-border px-4 gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={scrollToToday}>
            Today
          </Button>
          <div className="flex items-center rounded-lg bg-secondary p-0.5 gap-0.5">
            {(["month", "quarter", "year"] as ZoomLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => updateDisplaySettings("plan-list", { zoom: level })}
                className={cn(
                  "rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer capitalize",
                  zoom === level ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Gantt chart area */}
        <div ref={scrollRef} className="flex-1 overflow-auto relative" onScroll={handleGanttScroll}>
          {/* Column headers */}
          <div
            className="sticky top-0 flex h-10 items-center border-b border-border bg-background z-10"
            style={{ width: `${totalWidth}px` }}
          >
            {columns.map((col) => (
              <span
                key={col}
                className="shrink-0 text-center text-[11px] text-muted-foreground"
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

          {/* Task Gantt rows */}
          <div className="relative" style={{ width: `${totalWidth}px` }}>
            {datedNodes.map((node) => {
              if (!node.startDate || !node.endDate) return (
                <div key={node.id} className="border-b border-border" style={{ height: `${ROW_HEIGHT}px` }} />
              )

              const start = parseDate(node.startDate)
              const end = parseDate(node.endDate)
              const barLeft = diffDays(timelineStart, start) * DAY_WIDTH
              const barWidth = Math.max(diffDays(start, end) * DAY_WIDTH, 4)
              const barTop = (ROW_HEIGHT - 20) / 2

              return (
                <div
                  key={node.id}
                  className="border-b border-border relative"
                  style={{ height: `${ROW_HEIGHT}px` }}
                >
                  <div
                    onClick={() => onNodeSelect(node)}
                    className={cn(
                      "absolute h-5 rounded cursor-pointer transition-all hover:brightness-110",
                      statusColors[node.status],
                      node.type === "milestone" && "!rounded-sm"
                    )}
                    style={{ left: `${barLeft}px`, width: `${barWidth}px`, top: `${barTop}px` }}
                    title={`${node.title} (${node.status})`}
                  >
                    {progressColors[node.status] && (
                      <div
                        className={cn("h-full rounded-l", progressColors[node.status])}
                        style={{ width: "40%" }}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Main Plan View Page ---
export function PlanView() {
  const { id } = useParams()
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id))
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const updateNode = usePlanStore((s) => s.updateNode)
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("graph")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

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
          {/* Provider Status Indicator */}
          <ProviderStatus compact />

          <Separator orientation="vertical" className="h-5" />

          {/* Graph | List | Timeline toggle */}
          <div className="flex items-center rounded-lg bg-secondary p-1 gap-0.5">
            {(["graph", "list", "timeline"] as ViewMode[]).map((mode) => (
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
          <Button variant="outline" size="sm">
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
          <ListView projectId={project.id} onNodeSelect={setSelectedNode} />
        ) : (
          <TimelineView projectId={project.id} onNodeSelect={setSelectedNode} />
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

            {/* Node Details */}
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

            {/* Description */}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Description</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{selectedNode.description}</p>
            </div>
            <Separator />

            {/* Execution Panel */}
            <div>
              <h4 className="mb-3 text-sm font-semibold">Execution</h4>
              <ExecutionPanel node={selectedNode} projectId={project.id} />
            </div>

            {/* Action buttons for awaiting_judgment status */}
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

            {/* Prune button for other statuses */}
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
    </div>
  )
}
