import { useMemo, useCallback, useState, useRef, useEffect } from "react"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useReactFlow,
  ConnectionLineType,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { LayoutGrid, Trash2, Play, X, CheckSquare, ChevronDown, Laptop, Globe, Server, Cloud, CheckCircle2, Square, PlayCircle, Plus, Minus, Maximize, Sparkles, ListPlus, Info } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePlanStore } from "@/stores/plan-store"
import { useAgentStore } from "@/stores/agent-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore, canExecuteNode } from "@/stores/execution-store"
import { shouldUseSupabase } from "@/lib/supabase-client"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { TaskNode } from "./task-node"
import { DeletableEdge } from "./deletable-edge"
import { TaskCreationForm } from "@/components/task-creation-form"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { calculateChildPosition } from "@/lib/graph-utils"
import { cn } from "@/lib/utils"
import type { PlanNode } from "@/types"

const environmentConfig = {
  local: { icon: Laptop, label: "Local" },
  remote: { icon: Globe, label: "Remote" },
  hpc: { icon: Server, label: "HPC" },
  cloud: { icon: Cloud, label: "Cloud" },
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes = { task: TaskNode as any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes = { deletable: DeletableEdge as any }

const POPOVER_WIDTH = 320
const POPOVER_HEIGHT_EST = 180
const POPOVER_MARGIN = 12

/** Clamps a screen position so a popover of known size stays within a container. */
function clampPopoverPosition(
  screenPos: { x: number; y: number },
  container: HTMLElement | null,
): { x: number; y: number } {
  if (!container) return screenPos
  const rect = container.getBoundingClientRect()
  const maxX = rect.width - POPOVER_WIDTH - POPOVER_MARGIN
  const maxY = rect.height - POPOVER_HEIGHT_EST - POPOVER_MARGIN
  return {
    x: Math.max(POPOVER_MARGIN, Math.min(screenPos.x, maxX)),
    y: Math.max(POPOVER_MARGIN, Math.min(screenPos.y, maxY)),
  }
}

interface PlanCanvasProps {
  projectId: string
  onNodeSelect?: (node: PlanNode | null) => void
  onDecomposeNode?: (nodeId: string) => void
}

interface AddChildState {
  parentNodeId: string
  position: { x: number; y: number }
  screenPosition: { x: number; y: number }
}

function PlanCanvasInner({ projectId, onNodeSelect, onDecomposeNode }: PlanCanvasProps) {
  const planNodes = usePlanStore((s) => s.nodes)
  const planEdges = usePlanStore((s) => s.edges)
  const addEdge = usePlanStore((s) => s.addEdge)
  const removeEdge = usePlanStore((s) => s.removeEdge)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const reorganizeProject = usePlanStore((s) => s.reorganizeProject)
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const startExecution = useExecutionStore((s) => s.startExecution)
  const executeAllProject = useExecutionStore((s) => s.executeAllProject)
  const stopBatchExecution = useExecutionStore((s) => s.stopBatchExecution)
  const batchExecution = useExecutionStore((s) => s.batchExecutions.get(projectId))
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const isProjectGenerating = useAgentStore((s) => s.sessions.get(projectId)?.status === 'active')
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const graphDisplaySettings = useDisplaySettingsStore((s) => s.get("plan-graph"))
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const isMultiTenant = shouldUseSupabase()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(
    project?.defaultMachineId || null
  )

  // Sync selected machine when project defaults change
  useEffect(() => {
    if (project?.defaultMachineId && !selectedMachineId) {
      setSelectedMachineId(project.defaultMachineId)
    }
  }, [project?.defaultMachineId, selectedMachineId])

  // Load machines on mount
  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  const onlineMachines = machines.filter((m) => m.status !== 'offline')
  const selectedMachine = selectedMachineId ? machines.find((m) => m.machineId === selectedMachineId) ?? null : null
  const selectedEnvironment: 'local' | 'remote' | 'hpc' | 'cloud' = selectedMachine?.environmentType || 'local'
  const [addChildState, setAddChildState] = useState<AddChildState | null>(null)
  const connectingNodeId = useRef<string | null>(null)
  const justCreatedChild = useRef(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  const selectionActive = checkedIds.size > 0

  const { flowToScreenPosition, screenToFlowPosition, fitView: rfFitView, zoomIn: rfZoomIn, zoomOut: rfZoomOut } = useReactFlow()

  const projectNodes = useMemo(() => {
    let nodes = planNodes.filter((n) => n.projectId === projectId && n.type !== "milestone")
    if (!graphDisplaySettings.showCompleted) {
      nodes = nodes.filter((n) => n.status !== "completed" && n.status !== "auto_verified")
    }
    return nodes
  }, [planNodes, projectId, graphDisplaySettings.showCompleted])
  const projectEdges = useMemo(() => {
    const nodeIds = new Set(projectNodes.map((n) => n.id))
    const filtered = planEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    // Deduplicate by source→target pair (keep first occurrence)
    const seen = new Set<string>()
    return filtered.filter((e) => {
      const key = `${e.source}->${e.target}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [planEdges, projectNodes])

  const updateNode = usePlanStore((s) => s.updateNode)

  const handleEdgeDelete = useCallback((source: string, target: string) => {
    removeEdge(source, target)
    // Sync: remove source from target node's dependencies array
    const targetNode = planNodes.find((n) => n.id === target)
    if (targetNode) {
      updateNode(target, { dependencies: targetNode.dependencies.filter((d) => d !== source) })
    }
  }, [removeEdge, planNodes, updateNode])

  const handleToggleSelect = useCallback((nodeId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const handleClearSelection = useCallback(() => {
    setCheckedIds(new Set())
  }, [])

  const handleDeleteSelected = useCallback(() => {
    if (checkedIds.size === 0) return
    removeNodes(Array.from(checkedIds))
    setCheckedIds(new Set())
    setSelectedId(null)
    onNodeSelect?.(null)
    // Re-layout after deletion
    setTimeout(() => {
      reorganizeProject(projectId)
      setTimeout(() => rfFitView({ padding: 0.3, duration: 300 }), 50)
    }, 10)
  }, [checkedIds, removeNodes, onNodeSelect, reorganizeProject, projectId, rfFitView])

  const handleExecuteSelected = useCallback(() => {
    if (checkedIds.size === 0) return
    const { nodes: allNodes, edges: allEdges } = usePlanStore.getState()
    const nodesToExecute = projectNodes.filter(
      (n) => checkedIds.has(n.id) && canExecuteNode(n, allNodes, allEdges).ready
    )
    for (const node of nodesToExecute) {
      startExecution(node.id, projectId, {
        environment: selectedEnvironment,
        targetMachineId: selectedMachineId || undefined,
      })
    }
    setCheckedIds(new Set())
  }, [checkedIds, projectNodes, startExecution, projectId, selectedEnvironment, selectedMachineId])

  const handleSelectAll = useCallback(() => {
    const allIds = new Set(projectNodes.map((n) => n.id))
    setCheckedIds(allIds)
  }, [projectNodes])

  const handleExecuteAll = useCallback(() => {
    executeAllProject(projectId, {
      environment: selectedEnvironment,
      targetMachineId: selectedMachineId || undefined,
    })
  }, [executeAllProject, projectId, selectedEnvironment, selectedMachineId])

  const handleStopBatch = useCallback(() => {
    stopBatchExecution(projectId)
  }, [stopBatchExecution, projectId])

  const highlightBy = graphDisplaySettings.groupBy

  const rfNodes: Node[] = useMemo(
    () =>
      projectNodes.map((n) => ({
        id: n.id,
        type: "task",
        position: n.position || { x: 0, y: 0 }, // Defensive: ensure position is always defined
        data: {
          title: n.title,
          status: n.status,
          nodeType: n.type,
          priority: n.priority,
          dueDate: n.dueDate,
          executionId: n.executionId,
          prUrl: n.prUrl,
          highlightBy,
          checked: checkedIds.has(n.id),
          selectionActive: selectionActive,
          onDecompose: onDecomposeNode,
          onToggleSelect: handleToggleSelect,
        },
        selected: n.id === selectedId,
      })),
    [projectNodes, selectedId, checkedIds, selectionActive, onDecomposeNode, handleToggleSelect, highlightBy]
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      projectEdges.map((e) => {
        // Determine edge color based on target node status
        const targetNode = projectNodes.find((n) => n.id === e.target)
        const edgeColor = (() => {
          if (!targetNode) return "#94A3B8" // slate-400 - visible on both themes
          const status = targetNode.status
          if (status === "completed" || status === "auto_verified") return "#22C55E" // green-500
          if (status === "in_progress" || status === "dispatched") return "#F97316" // orange-500
          return "#94A3B8" // slate-400 - visible default
        })()

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "deletable",
          data: { onDelete: handleEdgeDelete },
          style: {
            stroke: edgeColor,
            strokeWidth: 2.5,
            strokeLinecap: "round" as const,
          },
          animated: e.type === "branch",
        }
      }),
    [projectEdges, projectNodes, handleEdgeDelete]
  )

  // Connection handlers for mindmap-like drag interactions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onConnectStart = useCallback((_: any, params: any) => {
    if (params.handleType === "source") {
      connectingNodeId.current = params.nodeId
    }
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    if (connection.source === connection.target) return
    const exists = projectEdges.some(
      (e) => e.source === connection.source && e.target === connection.target
    )
    if (exists) return

    addEdge({
      id: crypto.randomUUID(),
      source: connection.source,
      target: connection.target,
      type: "dependency",
    })
    // Sync: add source to target node's dependencies array
    const targetNode = projectNodes.find((n) => n.id === connection.target)
    if (targetNode && !targetNode.dependencies.includes(connection.source)) {
      updateNode(connection.target, { dependencies: [...targetNode.dependencies, connection.source] })
    }
    connectingNodeId.current = null
    // Auto-reorganize after adding a link
    reorganizeProject(projectId)
    setTimeout(() => rfFitView({ padding: 0.3, duration: 300 }), 50)
  }, [projectEdges, projectNodes, addEdge, updateNode, reorganizeProject, projectId, rfFitView])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState?: any) => {
    if (!connectingNodeId.current) return

    // If connection was valid (connected to another handle), onConnect handled it
    if (connectionState?.isValid) {
      connectingNodeId.current = null
      return
    }

    const parentNode = projectNodes.find((n) => n.id === connectingNodeId.current)
    if (!parentNode) {
      connectingNodeId.current = null
      return
    }

    const { clientX, clientY } = "changedTouches" in event
      ? event.changedTouches[0]
      : event
    const dropPosition = screenToFlowPosition({ x: clientX, y: clientY })

    // If drop is close to the source node (click or very short drag), use calculated child position
    const dx = dropPosition.x - parentNode.position.x
    const dy = dropPosition.y - parentNode.position.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    const position = distance < 60
      ? calculateChildPosition(parentNode, projectNodes, projectEdges)
      : dropPosition

    const screenPos = clampPopoverPosition(
      flowToScreenPosition(position),
      canvasRef.current,
    )
    justCreatedChild.current = true
    setAddChildState({
      parentNodeId: connectingNodeId.current,
      position,
      screenPosition: screenPos,
    })

    connectingNodeId.current = null
  }, [projectNodes, projectEdges, screenToFlowPosition, flowToScreenPosition])

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedId(node.id)
      const planNode = projectNodes.find((n) => n.id === node.id)
      onNodeSelect?.(planNode ?? null)
    },
    [projectNodes, onNodeSelect]
  )

  const handlePaneClick = useCallback(() => {
    // Skip clearing if a connection just created a child form
    if (justCreatedChild.current) {
      justCreatedChild.current = false
      return
    }
    setSelectedId(null)
    setAddChildState(null)
    // Clear selection when clicking on empty canvas (unless shift-held via checkbox)
    if (checkedIds.size > 0) {
      setCheckedIds(new Set())
    }
    onNodeSelect?.(null)
  }, [onNodeSelect, checkedIds])

  const handleReorganize = useCallback(() => {
    reorganizeProject(projectId)
    // Fit view after layout with a short delay for React to re-render
    setTimeout(() => rfFitView({ padding: 0.3, duration: 300 }), 50)
  }, [reorganizeProject, projectId, rfFitView])

  const handleTaskCreated = useCallback(() => {
    setAddChildState(null)
    handleReorganize()
  }, [handleReorganize])

  const [showVisionDialog, setShowVisionDialog] = useState(false)

  const handleGeneratePlan = useCallback(() => {
    if (project && connectionStatus === "connected") {
      // If no vision doc, show dialog first to let user add one
      if (!project.visionDoc?.trim()) {
        setShowVisionDialog(true)
        // Note: User will need to manually trigger generation after saving vision doc
      } else {
        startGeneration(projectId, project.name, project.description || project.name, project.visionDoc)
      }
    }
  }, [startGeneration, projectId, project, connectionStatus])

  // Auto-trigger generation when vision dialog closes and vision doc exists
  useEffect(() => {
    if (!showVisionDialog && project?.visionDoc?.trim() && connectionStatus === "connected") {
      const hasNoNodes = projectNodes.length === 0
      const justClosedDialog = !showVisionDialog
      // Only auto-generate if we just closed the dialog and have no nodes yet
      if (hasNoNodes && justClosedDialog) {
        startGeneration(projectId, project.name, project.description || project.name, project.visionDoc)
      }
    }
  }, [showVisionDialog, project, connectionStatus, projectNodes.length, startGeneration, projectId])

  // Show empty state when no nodes and not currently generating
  if (projectNodes.length === 0 && !isProjectGenerating) {
    const isConnected = connectionStatus === "connected"

    return (
      <div ref={canvasRef} className="h-full w-full bg-background flex items-center justify-center p-8 relative">
        <div className="flex w-full max-w-[600px] flex-col gap-6">
          {/* Planning options */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4" />
              <span>Choose how to plan:</span>
            </div>

            {/* Option 1: AI Generate Plan */}
            <button
              onClick={handleGeneratePlan}
              disabled={!isConnected}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-5 text-left transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                "border-primary/20 bg-primary/[0.03] hover:bg-primary/[0.05] hover:border-primary/30"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="text-base font-semibold text-foreground">Generate plan with AI</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Let AI generate a structured plan with tasks and dependencies</div>
                </div>
              </div>
            </button>

            {/* Option 2: Manual Add Task */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                // Calculate center of viewport for form positioning
                const container = canvasRef.current
                const centerX = container ? container.clientWidth / 2 - POPOVER_WIDTH / 2 : 300
                const centerY = container ? container.clientHeight / 2 - POPOVER_HEIGHT_EST / 2 : 200
                setAddChildState({
                  parentNodeId: "", // Root level task
                  position: { x: centerX, y: centerY },
                  screenPosition: { x: centerX, y: centerY },
                })
              }}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-5 text-left transition-all",
                "border-border bg-card hover:border-foreground/20"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                  <ListPlus className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <div className="text-base font-semibold text-foreground">Add your first task</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Start planning manually with individual tasks</div>
                </div>
              </div>
            </button>
          </div>

          {!isConnected && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-4 py-3 text-sm">
              <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-amber-900 dark:text-amber-100">
                Connect to backend in <a href="/settings" className="underline font-medium">Settings</a> to enable AI plan generation
              </span>
            </div>
          )}

          {/* Vision Doc Dialog */}
          {project && (
            <VisionDocDialog
              open={showVisionDialog}
              onOpenChange={setShowVisionDialog}
              project={project}
            />
          )}
        </div>

        {/* Floating creation form when adding first task */}
        {addChildState && (
          <div
            className="absolute z-50"
            style={{
              left: `${addChildState.screenPosition.x}px`,
              top: `${addChildState.screenPosition.y}px`,
            }}
          >
            <TaskCreationForm
              mode="popover"
              projectId={projectId}
              parentNodeId={addChildState.parentNodeId}
              position={addChildState.position}
              onCreated={handleTaskCreated}
              onCancel={() => setAddChildState(null)}
            />
          </div>
        )}
      </div>
    )
  }

  const { nodes: allPlanNodes, edges: allPlanEdges } = usePlanStore.getState()
  const selectedNodes = projectNodes.filter((n) => checkedIds.has(n.id))
  const readyNodes = selectedNodes.filter((n) => canExecuteNode(n, allPlanNodes, allPlanEdges).ready)
  const blockedCount = selectedNodes.length - readyNodes.length
  const SelectedMachineIcon = selectedMachine
    ? environmentConfig[selectedMachine.environmentType]?.icon || Server
    : Laptop
  // Batch execution stats
  const isBatchActive = batchExecution?.active ?? false
  const plannedCount = projectNodes.filter((n) => n.status === "planned").length
  const executingCount = projectNodes.filter((n) => n.status === "dispatched" || n.status === "in_progress").length

  return (
    <div ref={canvasRef} className="relative h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: "hsl(var(--primary))", strokeWidth: 2.5, strokeLinecap: "round" }}
        connectionRadius={40}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background gap={40} size={2} color="hsl(var(--muted-foreground))" style={{ opacity: 0.15 }} variant={BackgroundVariant.Dots} />

        {/* Status legend */}
        <div className="react-flow__panel absolute bottom-3 left-14 z-10 flex items-center gap-3 rounded-lg border border-border bg-card/85 backdrop-blur-sm px-2.5 py-1.5 shadow-sm text-[10px] font-medium">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-orange-500" />
            <span className="text-muted-foreground">In Progress</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">Awaiting</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full border border-muted-foreground/40" />
            <span className="text-muted-foreground">Planned</span>
          </div>
        </div>

        {/* Unified graph controls */}
        <div className="react-flow__panel absolute bottom-3 left-2.5 z-10 flex flex-col rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={handleReorganize}
            title="Reorganize layout"
            className="flex h-9 w-9 items-center justify-center text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <div className="h-px bg-border" />
          <button
            type="button"
            onClick={() => rfZoomIn({ duration: 200 })}
            title="Zoom in"
            className="flex h-9 w-9 items-center justify-center text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div className="h-px bg-border" />
          <button
            type="button"
            onClick={() => rfZoomOut({ duration: 200 })}
            title="Zoom out"
            className="flex h-9 w-9 items-center justify-center text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Minus className="h-4 w-4" />
          </button>
          <div className="h-px bg-border" />
          <button
            type="button"
            onClick={() => rfFitView({ padding: 0.3, duration: 300 })}
            title="Fit to view"
            className="flex h-9 w-9 items-center justify-center text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Maximize className="h-4 w-4" />
          </button>
        </div>

        {/* Execute All button — bottom-right */}
        {!selectionActive && projectNodes.length > 0 && (
          <div className="react-flow__panel absolute bottom-3 right-3 z-10">
            {isBatchActive ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                <div className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </div>
                <span className="text-xs font-medium text-foreground">
                  Executing{executingCount > 0 ? ` (${executingCount} running` : ""}
                  {plannedCount > 0 ? `, ${plannedCount} queued)` : executingCount > 0 ? ")" : "..."}
                </span>
                <button
                  type="button"
                  onClick={handleStopBatch}
                  title="Stop auto-dispatching new tasks"
                  className="flex h-6 items-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                >
                  <Square className="h-3 w-3" />
                  Stop
                </button>
              </div>
            ) : (
              plannedCount > 0 && (
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={handleExecuteAll}
                    title={`Execute all ${plannedCount} planned tasks in dependency order`}
                    className="flex h-8 items-center gap-1.5 rounded-l-lg border border-r-0 border-primary/30 bg-primary/5 px-3 text-xs font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer shadow-lg"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    Execute All ({plannedCount})
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-8 items-center gap-1 rounded-r-lg border border-primary/30 bg-primary/5 px-2 text-xs text-primary hover:bg-primary/10 transition-colors cursor-pointer shadow-lg"
                      >
                        <SelectedMachineIcon className="h-3 w-3" />
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Machine</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {!isMultiTenant && (
                        <DropdownMenuItem
                          onClick={() => setSelectedMachineId(null)}
                          className="gap-2"
                        >
                          <Laptop className="h-4 w-4" />
                          <div className="flex flex-col">
                            <span>Local</span>
                            <span className="text-[10px] text-muted-foreground">Run on this machine</span>
                          </div>
                          {!selectedMachineId && (
                            <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                          )}
                        </DropdownMenuItem>
                      )}
                      {!isMultiTenant && onlineMachines.length > 0 && <DropdownMenuSeparator />}
                      {onlineMachines.map((machine) => {
                        const envConfig = environmentConfig[machine.environmentType]
                        const Icon = envConfig?.icon || Server
                        return (
                          <DropdownMenuItem
                            key={machine.machineId}
                            onClick={() => setSelectedMachineId(machine.machineId)}
                            className="gap-2"
                          >
                            <Icon className="h-4 w-4" />
                            <div className="flex flex-col">
                              <span className="truncate max-w-[140px]">{machine.name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {machine.hostname || machine.environmentType}
                              </span>
                            </div>
                            {selectedMachineId === machine.machineId && (
                              <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                            )}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            )}
          </div>
        )}
      </ReactFlow>

      {/* Bulk actions toolbar — appears when nodes are selected */}
      {selectionActive && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 shadow-lg">
          <span className="text-xs font-medium text-muted-foreground mr-1">
            {checkedIds.size} selected
          </span>
          <button
            type="button"
            onClick={handleSelectAll}
            title="Select all"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            All
          </button>
          <div className="h-4 w-px bg-border" />

          {/* Split execute button: [Execute | Environment ▾] */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={handleExecuteSelected}
              disabled={readyNodes.length === 0}
              title={
                blockedCount > 0
                  ? `${readyNodes.length} ready, ${blockedCount} blocked by dependencies`
                  : `Execute ${readyNodes.length} task${readyNodes.length !== 1 ? "s" : ""}`
              }
              className="flex h-7 items-center gap-1 rounded-l-md border border-r-0 border-primary/30 bg-primary/5 px-2.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="h-3.5 w-3.5" />
              Execute{readyNodes.length > 0 ? ` (${readyNodes.length})` : ""}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 items-center gap-1 rounded-r-md border border-primary/30 bg-primary/5 px-1.5 text-xs text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                >
                  <SelectedMachineIcon className="h-3 w-3" />
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Machine</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!isMultiTenant && (
                  <DropdownMenuItem
                    onClick={() => setSelectedMachineId(null)}
                    className="gap-2"
                  >
                    <Laptop className="h-4 w-4" />
                    <div className="flex flex-col">
                      <span>Local</span>
                      <span className="text-[10px] text-muted-foreground">Run on this machine</span>
                    </div>
                    {!selectedMachineId && (
                      <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                )}
                {!isMultiTenant && onlineMachines.length > 0 && <DropdownMenuSeparator />}
                {onlineMachines.map((machine) => {
                  const envConfig = environmentConfig[machine.environmentType]
                  const Icon = envConfig?.icon || Server
                  return (
                    <DropdownMenuItem
                      key={machine.machineId}
                      onClick={() => setSelectedMachineId(machine.machineId)}
                      className="gap-2"
                    >
                      <Icon className="h-4 w-4" />
                      <div className="flex flex-col">
                        <span className="truncate max-w-[140px]">{machine.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {machine.hostname || machine.environmentType}
                        </span>
                      </div>
                      {selectedMachineId === machine.machineId && (
                        <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                      )}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="h-4 w-px bg-border" />
          <button
            type="button"
            onClick={handleDeleteSelected}
            title={`Delete ${checkedIds.size} node${checkedIds.size > 1 ? "s" : ""}`}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
          <div className="h-4 w-px bg-border" />
          <button
            type="button"
            onClick={handleClearSelection}
            title="Clear selection"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Floating creation form when adding child from graph */}
      {addChildState && (
        <div
          className="absolute z-50"
          style={{
            left: `${addChildState.screenPosition.x}px`,
            top: `${addChildState.screenPosition.y}px`,
          }}
        >
          <TaskCreationForm
            mode="popover"
            projectId={projectId}
            parentNodeId={addChildState.parentNodeId}
            position={addChildState.position}
            onCreated={handleTaskCreated}
            onCancel={() => setAddChildState(null)}
          />
        </div>
      )}
    </div>
  )
}

export function PlanCanvas(props: PlanCanvasProps) {
  return (
    <ReactFlowProvider>
      <PlanCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
