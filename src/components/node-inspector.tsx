import { useState, useEffect, useMemo, useCallback } from "react"
import { Link } from "react-router"
import { FileText, XCircle, RotateCcw, X, Plus, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { InlineRenameInput } from "@/components/inline-rename-input"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { PropertyPicker } from "@/components/property-picker"
import { LabelPicker } from "@/components/label-picker"
import { LabelManagerDialog } from "@/components/label-manager-dialog"

import { ExecutionPanel } from "@/components/execution"

import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { statusLabels } from "@/lib/status-config"
import { cn, getShortId } from "@/lib/utils"
import type { PlanNode, Priority } from "@/types"

interface NodeInspectorProps {
  node: PlanNode
  /** Project context for file completion and execution links */
  project: {
    id: string
    workingDirectory?: string
    defaultMachineId?: string
    fileTree?: string[]
  }
  /** Current view mode, used in "View Execution" link query param */
  viewMode?: string
  /** Called when inspector wants to close */
  onClose: () => void
  /** Called when node is updated (to sync local state) */
  onNodeUpdate: (node: PlanNode) => void
}

function ElapsedTime({ node }: { node: PlanNode }) {
  const execution = useExecutionStore((s) => s.getExecution(node.id))
  const [, setTick] = useState(0)

  const startedAt = execution?.startedAt
    ?? (node.executionStartedAt ? new Date(node.executionStartedAt) : undefined)
  const completedAt = execution?.completedAt
    ?? (node.executionCompletedAt ? new Date(node.executionCompletedAt) : undefined)
  const isRunning = !completedAt && !!startedAt

  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isRunning])

  if (!startedAt || isNaN(startedAt.getTime())) {
    return <span className="text-[13px] text-muted-foreground">-</span>
  }

  const endTime = completedAt ?? new Date()
  const seconds = Math.floor((endTime.getTime() - startedAt.getTime()) / 1000)
  if (seconds < 0) return <span className="text-[13px] text-muted-foreground">-</span>
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return (
    <span className="text-[13px] font-medium text-info tabular-nums">
      {m}:{s.toString().padStart(2, "0")}
    </span>
  )
}

/**
 * Reusable node inspector content panel.
 * Shows priority, estimate, dependencies, status, description, and action buttons.
 */
export function NodeInspectorContent({
  node,
  project,
  viewMode = "list",
  onNodeUpdate,
}: NodeInspectorProps) {
  const updateNode = usePlanStore((s) => s.updateNode)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const [isResetting, setIsResetting] = useState(false)

  const allNodes = usePlanStore((s) => s.nodes)
  const allEdges = usePlanStore((s) => s.edges)
  const addEdge = usePlanStore((s) => s.addEdge)
  const removeEdge = usePlanStore((s) => s.removeEdge)

  // Upstream dependencies: edges pointing INTO this node
  const upstreamDeps = useMemo(() => {
    const liveEdges = allEdges.filter(isLive)
    const depEdges = liveEdges.filter((e) => e.target === node.id)
    const liveNodes = allNodes.filter(isLive)
    return depEdges.map((e) => {
      const depNode = liveNodes.find((n) => n.id === e.source)
      return { id: e.source, title: depNode?.title ?? e.source, status: depNode?.status }
    })
  }, [allEdges, allNodes, node.id])

  // Candidate nodes that can be added as dependencies (same project, not self, not already a dep)
  const addCandidates = useMemo(() => {
    const existingDepIds = new Set(upstreamDeps.map((d) => d.id))
    return allNodes
      .filter(isLive)
      .filter((n) => n.projectId === node.projectId && n.id !== node.id && !existingDepIds.has(n.id))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [allNodes, upstreamDeps, node.projectId, node.id])

  const [addDepOpen, setAddDepOpen] = useState(false)
  const [addDepSearch, setAddDepSearch] = useState("")
  const [labelManagerOpen, setLabelManagerOpen] = useState(false)

  // Get project labels for this node
  const projectForLabels = useProjectStore((s) => s.projects.find((p) => p.id === node.projectId))
  const projectLabels = projectForLabels?.labels ?? []

  const filteredCandidates = useMemo(() => {
    if (!addDepSearch) return addCandidates
    const q = addDepSearch.toLowerCase()
    return addCandidates.filter((n) => n.title.toLowerCase().includes(q))
  }, [addCandidates, addDepSearch])

  const handleAddDep = useCallback((sourceId: string) => {
    addEdge({
      id: crypto.randomUUID(),
      source: sourceId,
      target: node.id,
      type: "dependency",
    })
    // Sync node.dependencies array
    const targetNode = allNodes.find((n) => n.id === node.id)
    if (targetNode && !targetNode.dependencies.includes(sourceId)) {
      updateNode(node.id, { dependencies: [...targetNode.dependencies, sourceId] })
    }
    setAddDepOpen(false)
    setAddDepSearch("")
  }, [addEdge, node.id, allNodes, updateNode])

  const handleRemoveDep = useCallback((sourceId: string) => {
    removeEdge(sourceId, node.id)
    const targetNode = allNodes.find((n) => n.id === node.id)
    if (targetNode) {
      updateNode(node.id, { dependencies: targetNode.dependencies.filter((d) => d !== sourceId) })
    }
  }, [removeEdge, node.id, allNodes, updateNode])

  const handleUpdate = useCallback((updates: Partial<PlanNode>) => {
    updateNode(node.id, updates)
    onNodeUpdate({ ...node, ...updates })
  }, [node, updateNode, onNodeUpdate])

  const handlePrune = useCallback(() => {
    handleUpdate({ status: "pruned" })
  }, [handleUpdate])




  return (
    <>
      <div className="flex flex-col gap-3.5">
        {/* Priority */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Priority</span>
          <PropertyPicker
            value={node.priority ?? "none"}
            options={PRIORITY_OPTIONS}
            title="Set priority"
            onSelect={(id) => handleUpdate({ priority: id as Priority })}
          >
            {(() => {
              const config = PRIORITY_CONFIG[(node.priority ?? "none") as Priority]
              return (
                <span className={cn("text-[13px] font-medium", config.color)}>
                  {config.label}
                </span>
              )
            })()}
          </PropertyPicker>
        </div>

        {/* Estimate */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Estimate</span>
          <PropertyPicker
            value={node.estimate}
            options={ESTIMATE_OPTIONS}
            title="Set estimate"
            onSelect={(id) => handleUpdate({ estimate: id as PlanNode["estimate"] })}
          >
            <span className="text-[13px] font-medium text-foreground">
              {node.estimate ?? "\u2014"}
            </span>
          </PropertyPicker>
        </div>

        {/* Labels */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Labels</span>
          {projectLabels.length > 0 ? (
            <LabelPicker
              labelIds={node.labelIds ?? []}
              allLabels={projectLabels}
              displayMode="badges"
              onChange={(labelIds) => handleUpdate({ labelIds })}
              onManageLabels={() => setLabelManagerOpen(true)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setLabelManagerOpen(true)}
              className="text-[13px] text-primary hover:underline cursor-pointer"
            >
              Add labels
            </button>
          )}
        </div>
        <LabelManagerDialog
          open={labelManagerOpen}
          onOpenChange={setLabelManagerOpen}
          projectId={node.projectId}
        />

        {/* Dependencies */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Dependencies</span>
            <Popover open={addDepOpen} onOpenChange={(o) => { setAddDepOpen(o); if (!o) setAddDepSearch("") }}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded-sm p-0.5 -m-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-56 p-1"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={addDepSearch}
                  onChange={(e) => setAddDepSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground/50"
                  autoFocus
                />
                <div className="max-h-48 overflow-y-auto py-1">
                  {filteredCandidates.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">No tasks available</p>
                  ) : (
                    filteredCandidates.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => handleAddDep(n.id)}
                      >
                        <span className="text-muted-foreground text-xs font-mono min-w-[48px]">{getShortId(n.id)}</span>
                        <span className="flex-1 text-left truncate">{n.title}</span>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          {upstreamDeps.length > 0 ? (
            <div className="flex flex-col gap-1">
              {upstreamDeps.map((dep) => (
                <div
                  key={dep.id}
                  className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      dep.status === "completed" || dep.status === "auto_verified"
                        ? "bg-success"
                        : dep.status === "in_progress" || dep.status === "dispatched"
                          ? "bg-warning"
                          : "border border-muted-foreground/40"
                    )}
                  />
                  <span className="flex-1 truncate text-foreground">{dep.title}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveDep(dep.id) }}
                    className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 shrink-0 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-muted-foreground/60 px-1.5">No dependencies</span>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Status</span>
          <PropertyPicker
            value={node.status}
            options={STATUS_OPTIONS}
            title="Set status"
            onSelect={(id) => handleUpdate({ status: id as PlanNode["status"] })}
          >
            <span className="text-[13px] font-medium text-foreground">
              {statusLabels[node.status]}
            </span>
          </PropertyPicker>
        </div>

        {/* Elapsed time */}
        {node.executionId && (
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Elapsed</span>
            <ElapsedTime node={node} />
          </div>
        )}
      </div>
      <Separator />

      <div className="flex flex-col gap-2.5">
        {node.executionId ? (
          <>
            <Link
              to={`/project/${project.id}/task/${node.id}?from=${viewMode}&tab=activity`}
              className="flex items-center justify-center gap-2 h-10 rounded-[10px] bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <FileText className="h-4 w-4" />
              View Execution
            </Link>
            <button
              disabled={isResetting}
              onClick={async () => {
                setIsResetting(true)
                try {
                  await resetExecution(node.id)
                  const freshNode = usePlanStore.getState().nodes.find((n) => n.id === node.id)
                  if (freshNode) onNodeUpdate(freshNode)
                } finally {
                  setIsResetting(false)
                }
              }}
              className="flex items-center justify-center gap-2 h-10 rounded-[10px] border border-border bg-transparent text-sm font-semibold hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              <RotateCcw className={cn("h-4 w-4", isResetting && "animate-spin")} />
              {isResetting ? "Resetting..." : "Reset"}
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <ExecutionPanel node={node} projectId={project.id} viewMode={viewMode} />
          </div>
        )}

        {node.status !== "pruned" && (
          <button
            onClick={handlePrune}
            className="flex items-center justify-center gap-2 h-10 rounded-[10px] border border-border bg-transparent text-destructive text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <XCircle className="h-4 w-4" />
            Prune Branch
          </button>
        )}
      </div>
    </>
  )
}

/**
 * Mobile: floating card dialog wrapping NodeInspectorContent.
 */
export function NodeInspectorSheet(props: NodeInspectorProps & { open: boolean }) {
  const { open, onClose, node, onNodeUpdate, ...rest } = props
  const [isRenaming, setIsRenaming] = useState(false)
  const updateNode = usePlanStore((s) => s.updateNode)

  const handleRename = useCallback((newTitle: string) => {
    updateNode(node.id, { title: newTitle })
    onNodeUpdate({ ...node, title: newTitle })
    setIsRenaming(false)
  }, [node, updateNode, onNodeUpdate])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="fixed inset-3 left-auto right-3 top-3 bottom-3 w-[calc(100%-1.5rem)] max-w-sm translate-x-0 translate-y-0 rounded-2xl bg-card/90 backdrop-blur-md shadow-2xl border-border/40 p-0 overflow-hidden">
        <div className="flex flex-col gap-5 p-4 overflow-auto h-full">
          <div className="flex items-center justify-between gap-2">
            {isRenaming ? (
              <InlineRenameInput
                value={node.title}
                onSave={handleRename}
                onCancel={() => setIsRenaming(false)}
                className="text-base font-semibold"
              />
            ) : (
              <h3
                className="font-semibold text-base truncate flex-1 pr-8 group/title cursor-default"
                onDoubleClick={() => setIsRenaming(true)}
              >
                {node.title}
                <Pencil className="h-3 w-3 ml-1.5 inline-block opacity-0 group-hover/title:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer" onClick={(e) => { e.stopPropagation(); setIsRenaming(true) }} />
              </h3>
            )}
          </div>
          <Separator />
          <NodeInspectorContent node={node} onClose={onClose} onNodeUpdate={onNodeUpdate} {...rest} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Desktop: right sidebar wrapping NodeInspectorContent.
 */
export function NodeInspectorSidebar(props: NodeInspectorProps) {
  const { node, onClose, onNodeUpdate, ...rest } = props
  const [isRenaming, setIsRenaming] = useState(false)
  const updateNode = usePlanStore((s) => s.updateNode)

  const handleRename = useCallback((newTitle: string) => {
    updateNode(node.id, { title: newTitle })
    onNodeUpdate({ ...node, title: newTitle })
    setIsRenaming(false)
  }, [node, updateNode, onNodeUpdate])

  return (
    <div className="flex flex-col gap-5 border-l bg-card p-5 overflow-auto border-border w-[320px] shrink-0">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-muted-foreground">Node Inspector</h4>
        <Button
          variant="ghost"
          size="icon"
          className="h-[18px] w-[18px] shrink-0 p-0 hover:bg-transparent"
          onClick={onClose}
        >
          <X className="h-[18px] w-[18px] text-muted-foreground" />
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {isRenaming ? (
          <InlineRenameInput
            value={node.title}
            onSave={handleRename}
            onCancel={() => setIsRenaming(false)}
            className="text-xl font-semibold font-serif"
          />
        ) : (
          <h3
            className="font-semibold text-xl text-foreground truncate font-serif group/title cursor-default"
            onDoubleClick={() => setIsRenaming(true)}
          >
            {node.title}
            <Pencil className="h-3 w-3 ml-1.5 inline-block opacity-0 group-hover/title:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer" onClick={(e) => { e.stopPropagation(); setIsRenaming(true) }} />
          </h3>
        )}
        {node.executionId && (
          <div className="flex items-center gap-2 text-xs">
            <div className="h-2 w-2 rounded-full bg-muted" />
            <span className="text-muted-foreground">MacBook Pro</span>
          </div>
        )}
      </div>
      <Separator />
      <NodeInspectorContent node={node} onClose={onClose} onNodeUpdate={onNodeUpdate} {...rest} />
    </div>
  )
}
