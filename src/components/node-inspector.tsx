import { useState, useMemo, useCallback } from "react"
import { Link } from "react-router"
import { FileText, XCircle, RotateCcw, X, Plus, ChevronDown, Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { PropertyPicker } from "@/components/property-picker"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ExecutionPanel } from "@/components/execution"
import { refineContent } from "@/lib/api-client"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { statusLabels } from "@/lib/status-config"
import { cn } from "@/lib/utils"
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
  const [isRefining, setIsRefining] = useState(false)

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
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  }, [allNodes, upstreamDeps, node.projectId, node.id])

  const [addDepOpen, setAddDepOpen] = useState(false)
  const [addDepSearch, setAddDepSearch] = useState("")

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

  const [justRefined, setJustRefined] = useState(false)

  const handleRefine = useCallback(async () => {
    setIsRefining(true)
    try {
      const result = await refineContent(node.title, node.description ?? "", "task")
      if (result) {
        handleUpdate({ title: result.refinedTitle, description: result.refinedDescription })
        setJustRefined(true)
        setTimeout(() => setJustRefined(false), 1500)
      }
    } catch { /* refinement is best-effort */ }
    setIsRefining(false)
  }, [node, handleUpdate])

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
                        <span className="text-muted-foreground text-xs min-w-[20px]">#{n.number}</span>
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
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all cursor-pointer"
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
            <span className="text-[13px] font-medium text-info">3:24</span>
          </div>
        )}
      </div>
      <Separator />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-muted-foreground">Description</h4>
        </div>
        <div className="relative">
          <FileCompletionTextarea
            projectId={project.id}
            machineId={project.defaultMachineId}
            workingDirectory={project.workingDirectory}
            fileTree={project.fileTree}
            value={node.description ?? ""}
            onChange={(val) => handleUpdate({ description: val })}
            placeholder="Describe this task... Use @ to reference files"
            rows={4}
            className={cn(
              "w-full resize-none rounded-md border-none bg-transparent px-0 py-0 text-[13px] leading-[1.5] text-muted-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 transition-all",
              isRefining && "opacity-60",
              justRefined && "ring-1 ring-success/30 rounded-md"
            )}
          />
          {isRefining && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/50">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>AI is refining...</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <Separator />

      <div className="flex flex-col gap-2.5">
        {node.executionId ? (
          <>
            <Link
              to={`/project/${project.id}/task/${node.id}?from=${viewMode}`}
              className="flex items-center justify-center gap-2 h-10 rounded-[10px] bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <FileText className="h-4 w-4" />
              View Execution
            </Link>
            <div className="flex gap-0">
              <button
                disabled={isResetting || isRefining}
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
                className="flex flex-1 items-center justify-center gap-2 h-10 rounded-l-[10px] border border-r-0 border-border bg-transparent text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                {isRefining ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className={cn("h-4 w-4", isResetting && "animate-spin")} />
                )}
                {isRefining ? "Refining..." : isResetting ? "Resetting..." : "Re-execute"}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    disabled={isResetting || isRefining}
                    className="flex items-center justify-center h-10 px-2 rounded-r-[10px] border border-border bg-transparent hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleRefine} className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    Refine
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
 * Mobile: full-screen sheet wrapping NodeInspectorContent.
 */
export function NodeInspectorSheet(props: NodeInspectorProps & { open: boolean }) {
  const { open, onClose, node, ...rest } = props
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full p-0">
        <div className="flex flex-col gap-5 p-4 overflow-auto h-full">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-base truncate flex-1">{node.title}</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Separator />
          <NodeInspectorContent node={node} onClose={onClose} {...rest} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Desktop: right sidebar wrapping NodeInspectorContent.
 */
export function NodeInspectorSidebar(props: NodeInspectorProps) {
  const { node, onClose, ...rest } = props
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
        <h3 className="font-semibold text-xl text-foreground truncate font-serif">
          {node.title}
        </h3>
        {node.executionId && (
          <div className="flex items-center gap-2 text-xs">
            <div className="h-2 w-2 rounded-full bg-muted" />
            <span className="text-muted-foreground">MacBook Pro</span>
          </div>
        )}
      </div>
      <Separator />
      <NodeInspectorContent node={node} onClose={onClose} {...rest} />
    </div>
  )
}
