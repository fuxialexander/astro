import { useState, useMemo } from "react"
import { useParams, Link } from "react-router"
import { ArrowLeft, FileText, Plus, Share2, CheckCircle2, Clock, Circle, MessageSquare, XCircle, Diamond } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { GenerationOverlay } from "@/components/agent/generation-overlay"
import { ChatPanel } from "@/components/agent/chat-panel"
import { ExecutionPanel, ProviderStatus } from "@/components/execution"
import { useProjectStore } from "@/stores/project-store"
import { useAgentStore } from "@/stores/agent-store"
import { usePlanStore } from "@/stores/plan-store"
import { PRIORITY_CONFIG } from "@/lib/constants"
import { cn } from "@/lib/utils"
import type { PlanNode, Priority } from "@/types"

type ViewMode = "graph" | "list"

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
  const nodes = useMemo(() => planNodes.filter((n) => n.projectId === projectId), [planNodes, projectId])
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const [groupByMilestone, setGroupByMilestone] = useState(false)

  const milestones = nodes.filter((n) => n.type === "milestone")

  const groupedNodes = useMemo(() => {
    if (!groupByMilestone) return null
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
    return groups
  }, [nodes, milestones, groupByMilestone])

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
        <div className="w-[60px] flex items-center">
          {PIcon && <PIcon className={cn("h-3.5 w-3.5", priorityConfig?.color)} />}
        </div>
        <div className="w-[120px]">
          <Badge variant={statusVariant[node.status] ?? "secondary"} className="text-[10px]">
            {node.status.replace(/_/g, " ")}
          </Badge>
        </div>
        <div className="w-[100px]">
          <span className={cn("text-xs", dueDateClass)}>{dueDateText}</span>
        </div>
        <div className="w-[70px]">
          {node.estimate ? (
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              {node.estimate}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">\u2014</span>
          )}
        </div>
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
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex items-center border-b border-border px-6 h-9 bg-muted/30">
        <div className="flex-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase">Name</span>
        </div>
        <span className="w-[60px] text-[11px] font-semibold text-muted-foreground uppercase">Priority</span>
        <span className="w-[120px] text-[11px] font-semibold text-muted-foreground uppercase">Status</span>
        <span className="w-[100px] text-[11px] font-semibold text-muted-foreground uppercase">Due Date</span>
        <span className="w-[70px] text-[11px] font-semibold text-muted-foreground uppercase">Estimate</span>
        <span className="w-[80px] text-[11px] font-semibold text-muted-foreground uppercase">Labels</span>
      </div>

      <div className="flex items-center gap-2 px-6 h-8 bg-muted/20 border-b border-border">
        <button
          onClick={() => setGroupByMilestone(!groupByMilestone)}
          className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        >
          Group by: {groupByMilestone ? "Milestone" : "None"}
        </button>
      </div>

      {groupByMilestone && groupedNodes ? (
        <>
          {milestones.map((milestone) => {
            const tasks = groupedNodes[milestone.id] || []
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
              </div>
            )
          })}
          {groupedNodes.unassigned.length > 0 && (
            <div>
              <div className="flex items-center gap-2 bg-muted/50 px-6 h-8">
                <span className="text-xs font-semibold text-muted-foreground">Unassigned</span>
                <span className="text-[11px] text-muted-foreground">{groupedNodes.unassigned.length}</span>
              </div>
              {groupedNodes.unassigned.map(renderNodeRow)}
            </div>
          )}
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
        </>
      )}
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

          {/* Graph | List toggle */}
          <div className="flex items-center rounded-lg bg-secondary p-1 gap-0.5">
            <button
              onClick={() => setViewMode("graph")}
              className={cn(
                "rounded-md px-3.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                viewMode === "graph" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Graph
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "rounded-md px-3.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                viewMode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              List
            </button>
          </div>
          <Button variant="outline" size="sm">
            <FileText className="h-3.5 w-3.5" />
            Vision
          </Button>
          <Button size="sm">
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
        ) : (
          <ListView projectId={project.id} onNodeSelect={setSelectedNode} />
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
    </div>
  )
}
