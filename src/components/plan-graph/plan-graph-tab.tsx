import { useState, useEffect } from "react"
import { CheckCircle2, Clock, Circle, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PlanCanvas } from "@/components/plan-graph/plan-canvas"
import { ChatPanel } from "@/components/agent/chat-panel"
import { ExecutionPanel } from "@/components/execution"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { shouldUseSupabase } from "@/lib/supabase-client"
import { PRIORITY_CONFIG, PRIORITIES, ESTIMATES } from "@/lib/constants"
import { statusLabels, statusBadgeVariants } from "@/lib/status-config"
import { cn } from "@/lib/utils"
import type { PlanNode, Priority, Estimate } from "@/types"

const statusVariant = statusBadgeVariants

interface PlanGraphTabProps {
  projectId: string
  visionDoc?: string
}

function formatDueDate(dateStr?: string): { text: string; className: string } {
  if (!dateStr) return { text: "—", className: "text-muted-foreground" }
  const due = new Date(dateStr + "T00:00:00Z")
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = due.getTime() - today.getTime()
  const diffDays = Math.ceil(diffMs / 86400000)
  const text = due.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  if (diffDays < 0) return { text, className: "text-red-500 font-medium" }
  if (diffDays < 7) return { text, className: "text-orange-500" }
  return { text, className: "text-foreground" }
}

function MachineSelector({ selectedNode, projectId, onUpdate }: {
  selectedNode: PlanNode
  projectId: string
  onUpdate: (updates: Partial<PlanNode>) => void
}) {
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const isMultiTenant = shouldUseSupabase()

  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  const onlineMachines = machines.filter((m) => m.status !== 'offline')
  const effectiveId = selectedNode.machineId || project?.defaultMachineId || ""
  const selectedMachine = effectiveId ? machines.find((m) => m.machineId === effectiveId) : undefined

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">Machine</span>
      <select
        value={effectiveId}
        onChange={(e) => {
          const machineId = e.target.value || undefined
          const machine = machines.find((m) => m.machineId === machineId)
          onUpdate({
            machineId,
            environment: machine?.environmentType || undefined,
          })
        }}
        className="bg-transparent text-sm text-right cursor-pointer focus:outline-none max-w-[180px] truncate"
      >
        {!isMultiTenant && <option value="">Local</option>}
        {isMultiTenant && !effectiveId && <option value="">Select machine</option>}
        {onlineMachines.map((m) => (
          <option key={m.machineId} value={m.machineId}>
            {m.name}
          </option>
        ))}
        {/* Show current selection even if machine is offline */}
        {!selectedMachine && effectiveId && (
          <option value={effectiveId}>{effectiveId} (offline)</option>
        )}
      </select>
    </div>
  )
}

export function PlanGraphTab({ projectId, visionDoc }: PlanGraphTabProps) {
  const updateNode = usePlanStore((s) => s.updateNode)
  const allNodes = usePlanStore((s) => s.nodes)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null)
  const chatOpen = false // TODO: wire up chat toggle

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
    <div className="flex flex-1 overflow-hidden">
      <div className="relative flex-1">
        <PlanCanvas projectId={projectId} onNodeSelect={setSelectedNode} />
      </div>

      {/* Chat panel */}
      {chatOpen && <ChatPanel projectId={projectId} visionDoc={visionDoc} />}

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

          {/* Priority / Due Date / Estimate / Labels / Milestone */}
          <div className="flex flex-col gap-3">
            {/* Priority */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Priority</span>
              <select
                value={selectedNode.priority || "none"}
                onChange={(e) => {
                  const priority = e.target.value as Priority
                  updateNode(selectedNode.id, { priority })
                  setSelectedNode({ ...selectedNode, priority })
                }}
                className="bg-transparent text-sm text-right cursor-pointer focus:outline-none"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>
                ))}
              </select>
            </div>

            {/* Due Date */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Due Date</span>
              <div className="flex items-center gap-1.5">
                {selectedNode.dueDate && (() => {
                  const { text, className: cls } = formatDueDate(selectedNode.dueDate)
                  return <span className={cn("text-xs", cls)}>{text}</span>
                })()}
                <input
                  type="date"
                  value={selectedNode.dueDate || ""}
                  onChange={(e) => {
                    const dueDate = e.target.value || undefined
                    updateNode(selectedNode.id, { dueDate })
                    setSelectedNode({ ...selectedNode, dueDate })
                  }}
                  className="bg-transparent text-sm w-5 opacity-50 hover:opacity-100 cursor-pointer focus:outline-none [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
              </div>
            </div>

            {/* Estimate */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Estimate</span>
              <select
                value={selectedNode.estimate || ""}
                onChange={(e) => {
                  const estimate = (e.target.value || undefined) as Estimate | undefined
                  updateNode(selectedNode.id, { estimate })
                  setSelectedNode({ ...selectedNode, estimate })
                }}
                className="bg-transparent text-sm text-right cursor-pointer focus:outline-none"
              >
                <option value="">—</option>
                {ESTIMATES.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>

            {/* Labels */}
            {project?.labels && project.labels.length > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Labels</span>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {project.labels.map((label) => {
                    const isActive = selectedNode.labelIds?.includes(label.id)
                    return (
                      <button
                        key={label.id}
                        onClick={() => {
                          const current = selectedNode.labelIds || []
                          const labelIds = isActive
                            ? current.filter((id) => id !== label.id)
                            : [...current, label.id]
                          updateNode(selectedNode.id, { labelIds })
                          setSelectedNode({ ...selectedNode, labelIds })
                        }}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border cursor-pointer transition-colors",
                          isActive
                            ? "border-transparent text-white"
                            : "border-border text-muted-foreground hover:border-foreground/30"
                        )}
                        style={isActive ? { backgroundColor: label.color } : undefined}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
                        {label.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Milestone */}
            {selectedNode.type !== "milestone" && (() => {
              const milestones = allNodes.filter((n) => n.projectId === projectId && n.type === "milestone")
              if (milestones.length === 0) return null
              return (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Milestone</span>
                  <select
                    value={selectedNode.milestoneId || ""}
                    onChange={(e) => {
                      const milestoneId = e.target.value || undefined
                      updateNode(selectedNode.id, { milestoneId })
                      setSelectedNode({ ...selectedNode, milestoneId })
                    }}
                    className="bg-transparent text-sm text-right cursor-pointer focus:outline-none max-w-[180px] truncate"
                  >
                    <option value="">—</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>◆ {m.title}</option>
                    ))}
                  </select>
                </div>
              )
            })()}
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
            {/* Machine selector */}
            <MachineSelector
              selectedNode={selectedNode}
              projectId={projectId}
              onUpdate={(updates) => {
                updateNode(selectedNode.id, updates)
                setSelectedNode({ ...selectedNode, ...updates })
              }}
            />
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
            <ExecutionPanel node={selectedNode} projectId={projectId} />
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
  )
}
