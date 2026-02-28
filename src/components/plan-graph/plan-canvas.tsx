import { useMemo, useCallback, useState, useRef, useEffect } from "react"
import { stripHtml } from "@/lib/html-utils"
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
import { LayoutGrid, Trash2, Play, X, CheckSquare, Square, PlayCircle, Plus, Minus, Maximize, Sparkles, ListPlus, Info, Server, FolderOpen, AlertTriangle } from "lucide-react"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useActivityStore } from "@/stores/activity-store"
import { useAgentStore } from "@/stores/agent-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore, canExecuteNode, getProjectWorkingDir } from "@/stores/execution-store"
import { useToastStore } from "@/stores/toast-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { useKeyboardNav } from "@/hooks/use-keyboard-nav"
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store"
import { TaskNode } from "./task-node"
import { DeletableEdge } from "./deletable-edge"
import { TaskCreationForm } from "@/components/task-creation-form"
import { VisionDocDialog } from "@/components/vision-doc-dialog"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { calculateChildPosition, calculateParentPosition } from "@/lib/graph-utils"
import { cn } from "@/lib/utils"
import type { PlanNode } from "@/types"


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes = { task: TaskNode as any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes = { deletable: DeletableEdge as any }

const POPOVER_WIDTH = 180 // Match node width
const POPOVER_HEIGHT = 44   // Match node height
const POPOVER_MARGIN = 12

/** Clamps a screen position so a popover of known size stays within a container. */
function clampPopoverPosition(
  screenPos: { x: number; y: number },
  container: HTMLElement | null,
): { x: number; y: number } {
  if (!container) return screenPos
  const rect = container.getBoundingClientRect()
  const maxX = rect.width - POPOVER_WIDTH - POPOVER_MARGIN
  const maxY = rect.height - POPOVER_HEIGHT - POPOVER_MARGIN
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
  /** Node ID that initiated the drag */
  originNodeId: string
  position: { x: number; y: number }
  screenPosition: { x: number; y: number }
  /**
   * True if connection started from target handle (upward drag = creating parent).
   * When true: new node becomes a parent/dependency of originNodeId
   * When false: new node becomes a child/dependent of originNodeId
   */
  isUpwardDrag?: boolean
}

function PlanCanvasInner({ projectId, onNodeSelect, onDecomposeNode }: PlanCanvasProps) {
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const rawPlanEdges = usePlanStore((s) => s.edges)
  const planEdges = useMemo(() => rawPlanEdges.filter(isLive), [rawPlanEdges])
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
  const updateProject = useProjectStore((s) => s.updateProject)
  const graphDisplaySettings = useDisplaySettingsStore((s) => s.get("plan-graph"))
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  // Load machines on mount (for display name resolution)
  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  // Resolve project machine for read-only display
  const resolvedMachineId = project?.defaultMachineId
  const resolvedMachineName = resolvedMachineId
    ? machines.find((m) => m.machineId === resolvedMachineId)?.name || resolvedMachineId
    : null
  const [pathBrowserOpen, setPathBrowserOpen] = useState(false)
  const [addChildState, setAddChildState] = useState<AddChildState | null>(null)
  const connectingNodeRef = useRef<{ nodeId: string; handleType: "source" | "target" } | null>(null)
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

  // Keyboard navigation
  const setItems = useKeyboardNavStore((s) => s.setItems)
  const clear = useKeyboardNavStore((s) => s.clear)

  const { focusedId } = useKeyboardNav({
    onActivate: (id) => {
      const node = projectNodes.find((n) => n.id === id)
      if (node && onNodeSelect) {
        onNodeSelect(node)
      }
    },
    enabled: true,
  })

  // Update keyboard nav items when nodes change
  useEffect(() => {
    const items = projectNodes.map((n) => ({
      id: n.id,
      type: "node" as const,
    }))
    setItems(items)
  }, [projectNodes, setItems])

  // Clear on unmount
  useEffect(() => {
    return () => clear()
  }, [clear])

  // Sync focused node with selected node visually
  useEffect(() => {
    if (focusedId && focusedId !== selectedId) {
      setSelectedId(focusedId)
    }
  }, [focusedId, selectedId])

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

  const addActivity = useActivityStore((s) => s.addActivity)

  const handleDeleteSelected = useCallback(() => {
    if (checkedIds.size === 0) return
    const ids = Array.from(checkedIds)
    const deletedNodes = projectNodes.filter((n) => checkedIds.has(n.id))
    removeNodes(ids)
    // Track activity
    const titles = deletedNodes.map((n) => n.title)
    addActivity({
      projectId,
      type: ids.length > 1 ? "task.bulk_deleted" : "task.deleted",
      title: ids.length > 1
        ? `Deleted ${titles.length} tasks`
        : `Deleted task: ${titles[0]}`,
    })
    setCheckedIds(new Set())
    setSelectedId(null)
    onNodeSelect?.(null)
    // Re-layout after deletion
    setTimeout(() => {
      reorganizeProject(projectId)
      setTimeout(() => rfFitView({ padding: 0.3, duration: 300 }), 50)
    }, 10)
  }, [checkedIds, removeNodes, projectNodes, addActivity, projectId, onNodeSelect, reorganizeProject, rfFitView])

  const handleExecuteSelected = useCallback(() => {
    if (checkedIds.size === 0) return
    if (!resolvedMachineId) {
      useToastStore.getState().add({
        type: "warning",
        title: "No machine connected",
        description: "Connect a machine in Environments before executing tasks.",
      })
      return
    }
    const dirCheck = getProjectWorkingDir(project)
    if (!dirCheck.ok) {
      setPathBrowserOpen(true)
      return
    }
    const { nodes: allNodes, edges: allEdges } = usePlanStore.getState()
    const nodesToExecute = projectNodes.filter(
      (n) => checkedIds.has(n.id) && canExecuteNode(n, allNodes, allEdges).ready
    )
    for (const node of nodesToExecute) {
      startExecution(node.id, projectId)
    }
    setCheckedIds(new Set())
  }, [checkedIds, projectNodes, startExecution, projectId, project, resolvedMachineId])

  const handleSelectAll = useCallback(() => {
    const allIds = new Set(projectNodes.map((n) => n.id))
    setCheckedIds(allIds)
  }, [projectNodes])

  const handleExecuteAll = useCallback(() => {
    if (!resolvedMachineId) {
      useToastStore.getState().add({
        type: "warning",
        title: "No machine connected",
        description: "Connect a machine in Environments before executing tasks.",
      })
      return
    }
    const dirCheck = getProjectWorkingDir(project)
    if (!dirCheck.ok) {
      setPathBrowserOpen(true)
      return
    }
    executeAllProject(projectId)
  }, [executeAllProject, projectId, project, resolvedMachineId])

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
          description: n.content ? stripHtml(n.content) : (n.description ?? ''),
          status: n.status,
          nodeType: n.type,
          priority: n.priority,
          dueDate: n.dueDate,
          executionId: n.executionId,
          prUrl: n.prUrl,
          mergeQueueStatus: n.mergeQueueStatus,
          autoPr: n.autoPr,
          githubIssueNumber: n.githubIssueNumber,
          githubIssueUrl: n.githubIssueUrl,
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
    // Track both nodeId and handleType to detect drag direction
    // source handle = downward drag (creating child/dependent)
    // target handle = upward drag (creating parent/dependency)
    if (params.nodeId && (params.handleType === "source" || params.handleType === "target")) {
      connectingNodeRef.current = {
        nodeId: params.nodeId,
        handleType: params.handleType,
      }
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
    connectingNodeRef.current = null
    // Auto-reorganize after adding a link (defer to ensure edge is in store)
    setTimeout(() => {
      reorganizeProject(projectId)
      setTimeout(() => rfFitView({ padding: 0.3, duration: 300 }), 50)
    }, 0)
  }, [projectEdges, projectNodes, addEdge, updateNode, reorganizeProject, projectId, rfFitView])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState?: any) => {
    if (!connectingNodeRef.current) return

    const { nodeId, handleType } = connectingNodeRef.current

    // If connection was valid (connected to another handle), onConnect handled it
    if (connectionState?.isValid) {
      connectingNodeRef.current = null
      return
    }

    const originNode = projectNodes.find((n) => n.id === nodeId)
    if (!originNode) {
      connectingNodeRef.current = null
      return
    }

    const { clientX, clientY } = "changedTouches" in event
      ? event.changedTouches[0]
      : event
    const dropPosition = screenToFlowPosition({ x: clientX, y: clientY })

    // Detect drag direction based on which handle initiated the connection:
    // - source handle (bottom) = downward drag = creating a child/dependent task
    // - target handle (top) = upward drag = creating a parent/dependency task
    const isUpwardDrag = handleType === "target"

    // If drop is close to the origin node (click or very short drag), use calculated position
    const dx = dropPosition.x - originNode.position.x
    const dy = dropPosition.y - originNode.position.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    // Use appropriate position calculation based on drag direction:
    // - Upward drag (target handle): calculate parent position (above origin)
    // - Downward drag (source handle): calculate child position (below origin)
    const position = distance < 60
      ? (isUpwardDrag
          ? calculateParentPosition(originNode, projectNodes, projectEdges)
          : calculateChildPosition(originNode, projectNodes, projectEdges))
      : dropPosition

    // Center the popup on the node position
    const nodeScreenPos = flowToScreenPosition(position)
    const centeredScreenPos = {
      x: nodeScreenPos.x - POPOVER_WIDTH / 2,
      y: nodeScreenPos.y - POPOVER_HEIGHT / 2,
    }
    const screenPos = clampPopoverPosition(centeredScreenPos, canvasRef.current)

    justCreatedChild.current = true
    setAddChildState({
      originNodeId: nodeId,
      position,
      screenPosition: screenPos,
      isUpwardDrag,
    })

    connectingNodeRef.current = null
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
    // Defer reorganization to ensure both node and edge have been added to the store
    setTimeout(() => handleReorganize(), 0)
  }, [handleReorganize])

  const [showVisionDialog, setShowVisionDialog] = useState(false)

  const handleGeneratePlan = useCallback(() => {
    if (project && connectionStatus === "connected") {
      // If no vision doc, show dialog first to let user add one
      if (!project.visionDoc?.trim()) {
        setShowVisionDialog(true)
        // Note: User will need to manually trigger generation after saving vision doc
      } else {
        // Build repoContext from stored project data so regeneration preserves machine/directory
        const repoContext = (project.sourceDirectory || project.workingDirectory || project.repository || project.defaultMachineId) ? {
          workingDirectory: project.sourceDirectory || project.workingDirectory || project.repository || '',
          targetMachineId: project.defaultMachineId,
        } : undefined
        startGeneration(projectId, project.name, project.description || project.name, project.visionDoc, repoContext)
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
        const repoContext = (project.sourceDirectory || project.workingDirectory || project.repository || project.defaultMachineId) ? {
          workingDirectory: project.sourceDirectory || project.workingDirectory || project.repository || '',
          targetMachineId: project.defaultMachineId,
        } : undefined
        startGeneration(projectId, project.name, project.description || project.name, project.visionDoc, repoContext)
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
            {!addChildState ? (
              <button
                type="button"
                onClick={() => {
                  setAddChildState({
                    originNodeId: "",
                    position: { x: 40, y: 40 },
                    screenPosition: { x: 0, y: 0 },
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
            ) : (
              <div className="rounded-xl border border-primary/30 bg-card p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <ListPlus className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base font-semibold text-foreground">Create your first task</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Add a title and optional description</div>
                  </div>
                </div>
                <TaskCreationForm
                  mode="dialog"
                  projectId={projectId}
                  parentNodeId=""
                  position={{ x: 40, y: 40 }}
                  defaultShowDescription
                  onCreated={handleTaskCreated}
                  onCancel={() => setAddChildState(null)}
                />
              </div>
            )}
          </div>

          {!isConnected && (
            <div className="flex items-center gap-2 rounded-lg bg-warning/5 border border-warning/20 px-4 py-3 text-sm">
              <Info className="h-4 w-4 text-warning shrink-0" />
              <span className="text-foreground">
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

      </div>
    )
  }

  const { nodes: allPlanNodes, edges: allPlanEdges } = usePlanStore.getState()
  const selectedNodes = projectNodes.filter((n) => checkedIds.has(n.id))
  const readyNodes = selectedNodes.filter((n) => canExecuteNode(n, allPlanNodes, allPlanEdges).ready)
  const blockedCount = selectedNodes.length - readyNodes.length
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
        connectionLineStyle={{
          stroke: "var(--primary)",
          strokeWidth: 3,
          strokeLinecap: "round",
          strokeDasharray: "5,5",
          opacity: 0.8
        }}
        connectionRadius={40}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background gap={40} size={2} color="var(--muted-foreground)" style={{ opacity: 0.15 }} variant={BackgroundVariant.Dots} />

        {/* Status legend — top-left, hidden on mobile (colors are self-explanatory from nodes) */}
        <div className="react-flow__panel absolute top-3 left-3 z-10 hidden md:flex items-center gap-3 rounded-lg border border-border bg-card/85 backdrop-blur-sm px-2.5 py-1.5 shadow-sm text-[10px] font-medium">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-success" />
            <span className="text-muted-foreground">Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-warning" />
            <span className="text-muted-foreground">In Progress</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-warning" />
            <span className="text-muted-foreground">Awaiting</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full border border-muted-foreground/40" />
            <span className="text-muted-foreground">Planned</span>
          </div>
        </div>

        {/* Unified graph controls — zoom in/out hidden on mobile */}
        <div className="react-flow__panel absolute bottom-3 left-2.5 z-10 flex flex-col rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={handleReorganize}
            title="Reorganize layout"
            className="flex h-9 w-9 items-center justify-center text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <div className="hidden md:block h-px bg-border" />
          <button
            type="button"
            onClick={() => rfZoomIn({ duration: 200 })}
            title="Zoom in"
            className="hidden md:flex h-9 w-9 items-center justify-center text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div className="hidden md:block h-px bg-border" />
          <button
            type="button"
            onClick={() => rfZoomOut({ duration: 200 })}
            title="Zoom out"
            className="hidden md:flex h-9 w-9 items-center justify-center text-foreground hover:bg-muted transition-colors cursor-pointer"
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

        {/* Execute All button + machine / work directory — bottom-right */}
        {!selectionActive && projectNodes.length > 0 && (
          <div className="react-flow__panel absolute bottom-3 right-3 z-10 flex flex-col items-end gap-1.5">
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
                  title="Stop queuing new tasks (running tasks will finish)"
                  className="flex h-6 items-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                >
                  <Square className="h-3 w-3" />
                  Stop Queue
                </button>
              </div>
            ) : (
              plannedCount > 0 && (
                <button
                  type="button"
                  onClick={handleExecuteAll}
                  title={`Execute all ${plannedCount} planned tasks in dependency order`}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 text-xs font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer shadow-lg"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  Execute All ({plannedCount})
                </button>
              )
            )}
            {/* Machine + work directory row — hidden on mobile */}
            {resolvedMachineId && (
              <div className="hidden md:flex items-center gap-1.5">
                {resolvedMachineName && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-card/85 backdrop-blur-sm border border-border rounded-lg px-2 py-1.5 shadow-sm">
                    <Server className="h-3 w-3 shrink-0" />
                    {resolvedMachineName}
                  </span>
                )}
                {project?.workingDirectory ? (
                  <button
                    type="button"
                    onClick={() => setPathBrowserOpen(true)}
                    title="Change work directory"
                    className="flex items-center gap-1 rounded-lg bg-card/85 backdrop-blur-sm border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer shadow-sm max-w-[200px]"
                  >
                    <FolderOpen className="h-3 w-3 shrink-0" />
                    <span className="truncate">{project.workingDirectory}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPathBrowserOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[10px] font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer shadow-sm"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Set work directory
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {/* Remote path browser dialog */}
        {resolvedMachineId && (
          <RemotePathBrowser
            open={pathBrowserOpen}
            onOpenChange={setPathBrowserOpen}
            machineId={resolvedMachineId}
            machineName={resolvedMachineName || undefined}
            currentPath={project?.workingDirectory}
            onSelect={(path) => {
              updateProject(projectId, { workingDirectory: path })
              setPathBrowserOpen(false)
            }}
          />
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

          <button
            type="button"
            onClick={handleExecuteSelected}
            disabled={readyNodes.length === 0}
            title={
              blockedCount > 0
                ? `${readyNodes.length} ready, ${blockedCount} blocked by dependencies`
                : `Execute ${readyNodes.length} task${readyNodes.length !== 1 ? "s" : ""}`
            }
            className="flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="h-3.5 w-3.5" />
            Execute{readyNodes.length > 0 ? ` (${readyNodes.length})` : ""}
          </button>

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

      {/* Floating creation form when adding node from graph */}
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
            // Upward drag: new node is a parent/dependency of originNode (pass childNodeId)
            // Downward drag: new node is a child/dependent of originNode (pass parentNodeId)
            parentNodeId={addChildState.isUpwardDrag ? undefined : addChildState.originNodeId || undefined}
            childNodeId={addChildState.isUpwardDrag ? addChildState.originNodeId : undefined}
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
