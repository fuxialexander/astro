import { useMemo, useCallback, useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router"
import { stripHtml } from "@/lib/html-utils"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useReactFlow,
  ConnectionLineType,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { LayoutGrid, Trash2, Play, X, CheckSquare, Square, PlayCircle, Plus, Minus, Maximize, ListPlus, Sparkles } from "lucide-react"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useActivityStore } from "@/stores/activity-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore, canExecuteNode } from "@/stores/execution-store"
import { useToastStore } from "@/stores/toast-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { useContentSaveStore } from "@/stores/content-save-store"
import { useKeyboardNav } from "@/hooks/use-keyboard-nav"
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store"
import { TaskNode, AddMilestoneNode } from "./task-node"
import { DeletableEdge } from "./deletable-edge"
import { TaskCreationForm } from "@/components/task-creation-form"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { MachineWorkdirSelector } from "@/components/machine-workdir-selector"
import { calculateChildPosition, calculateParentPosition, computeEdgeHandles, computeRedundantEdgeIds } from "@/lib/graph-utils"
import { cn } from "@/lib/utils"
import type { PlanNode } from "@/types"
import { useFeatureFlag } from "@/hooks/use-feature-flag"
import { getMilestoneColor, STATUS_DOT_COLOR, PRIORITY_PIP_COLOR, GRAPH_EDGE_COLOR } from "@/components/plan-graph/plan-node-shared"


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes = { task: TaskNode as any, addMilestone: AddMilestoneNode as any }
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
  readOnly?: boolean
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
  /** When origin is a milestone, new tasks are pre-assigned to it */
  milestoneId?: string
}

function PlanCanvasInner({ projectId, onNodeSelect, onDecomposeNode, readOnly }: PlanCanvasProps) {
  const navigate = useNavigate()
  const loopNodesEnabled = useFeatureFlag('loop-nodes')
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const rawPlanEdges = usePlanStore((s) => s.edges)
  const planEdges = useMemo(() => rawPlanEdges.filter(isLive), [rawPlanEdges])
  const addNode = usePlanStore((s) => s.addNode)
  const addEdge = usePlanStore((s) => s.addEdge)
  const removeEdge = usePlanStore((s) => s.removeEdge)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const reorganizeProject = usePlanStore((s) => s.reorganizeProject)
  const startExecution = useExecutionStore((s) => s.startExecution)
  const executeAllProject = useExecutionStore((s) => s.executeAllProject)
  const stopBatchExecution = useExecutionStore((s) => s.stopBatchExecution)
  const batchExecution = useExecutionStore((s) => s.batchExecutions.get(projectId))
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const flushPendingSaves = useContentSaveStore((s) => s.flushPendingSaves)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const updateProject = useProjectStore((s) => s.updateProject)
  const graphDisplaySettings = useDisplaySettingsStore((s) => s.get("plan-graph"))
  const globalFastEdit = useDisplaySettingsStore((s) => s.fastEdit)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  // Load machines on mount (for display name resolution)
  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  // Auto-reorganize when the canvas opens (projectId changes or first mount with nodes)
  const handleReorganizeRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (projectNodes.length === 0) return
    const timer = setTimeout(() => handleReorganizeRef.current?.(), 150)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

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
    // Always exclude pruned nodes — they are abandoned, not completed
    let nodes = planNodes.filter((n) => n.projectId === projectId && n.status !== "pruned")
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
    // Identify milestone nodes — task→milestone edges are hidden (visual grouping is enough)
    const milestoneIds = new Set(projectNodes.filter((n) => n.type === 'milestone').map((n) => n.id))
    const allProjectNodeIds = new Set(planNodes.filter((n) => n.projectId === projectId).map((n) => n.id))
    const allProjectEdges = planEdges.filter((e) =>
      allProjectNodeIds.has(e.source) || allProjectNodeIds.has(e.target)
    )

    // Direct edges where both endpoints are visible.
    const directEdges = allProjectEdges.filter((e) =>
      nodeIds.has(e.source) && nodeIds.has(e.target)
    )

    // Bridge edges through hidden nodes only (e.g., nodes filtered out by view).
    // For each hidden node H with edges A→H and H→B where A,B are visible,
    // create a synthetic edge A→B so the dependency chain stays connected.
    const bridgeNodeIds = new Set(
      planNodes
        .filter((n) => n.projectId === projectId && !nodeIds.has(n.id))
        .map((n) => n.id),
    )
    const bridgeEdges: typeof directEdges = []
    if (bridgeNodeIds.size > 0) {
      const inMap = new Map<string, string[]>()
      const outMap = new Map<string, string[]>()
      for (const e of allProjectEdges) {
        if (bridgeNodeIds.has(e.target)) {
          const arr = inMap.get(e.target) ?? []; arr.push(e.source); inMap.set(e.target, arr)
        }
        if (bridgeNodeIds.has(e.source)) {
          const arr = outMap.get(e.source) ?? []; arr.push(e.target); outMap.set(e.source, arr)
        }
      }
      for (const bId of bridgeNodeIds) {
        const sources = (inMap.get(bId) ?? []).filter((s) => nodeIds.has(s))
        const targets = (outMap.get(bId) ?? []).filter((t) => nodeIds.has(t))
        for (const s of sources) {
          for (const t of targets) {
            bridgeEdges.push({
              id: `bridge-${s}-${t}`,
              source: s,
              target: t,
              type: "dependency",
            })
          }
        }
      }
    }

    // Deduplicate by source→target pair (keep first occurrence).
    // Filter out task→milestone membership edges (too noisy — tasks are already
    // visually grouped under their milestone column). Keep milestone→milestone
    // ordering edges and milestone→task prerequisite edges.
    const all = [...directEdges, ...bridgeEdges]
    const seen = new Set<string>()
    return all.filter((e) => {
      if (milestoneIds.has(e.target) && !milestoneIds.has(e.source)) return false
      const key = `${e.source}->${e.target}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [planEdges, planNodes, projectNodes, projectId])

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

  const handleExecuteSelected = useCallback(async () => {
    if (checkedIds.size === 0) return
    if (!resolvedMachineId) {
      useToastStore.getState().add({
        type: "warning",
        title: "No machine connected",
        description: "Connect a machine in Environments before executing tasks.",
      })
      return
    }
    const { nodes: allNodes, edges: allEdges } = usePlanStore.getState()
    const nodesToExecute = projectNodes.filter(
      (n) => checkedIds.has(n.id) && canExecuteNode(n, allNodes, allEdges).ready
    )

    // Flush pending saves for all nodes to execute
    const nodeIds = nodesToExecute.map((n) => n.id)
    try {
      await flushPendingSaves(nodeIds)
    } catch (error) {
      console.error('Failed to save task content before execution:', error)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save changes',
        description: 'Could not save task content before execution. Please try again.',
      })
      return
    }

    for (const node of nodesToExecute) {
      startExecution(node.id, projectId)
    }
    setCheckedIds(new Set())
  }, [checkedIds, projectNodes, startExecution, projectId, resolvedMachineId, flushPendingSaves])

  const handleSelectAll = useCallback(() => {
    const allIds = new Set(projectNodes.map((n) => n.id))
    setCheckedIds(allIds)
  }, [projectNodes])

  const handleExecuteAll = useCallback(async () => {
    if (!resolvedMachineId) {
      useToastStore.getState().add({
        type: "warning",
        title: "No machine connected",
        description: "Connect a machine in Environments before executing tasks.",
      })
      return
    }
    // Flush pending saves for all project nodes before batch execution
    const nodeIds = projectNodes.map((n) => n.id)
    try {
      await flushPendingSaves(nodeIds)
    } catch (error) {
      console.error('Failed to save task content before execution:', error)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save changes',
        description: 'Could not save task content before execution. Please try again.',
      })
      return
    }

    executeAllProject(projectId)
  }, [executeAllProject, projectId, resolvedMachineId, projectNodes, flushPendingSaves])

  const handleStopBatch = useCallback(() => {
    stopBatchExecution(projectId)
  }, [stopBatchExecution, projectId])

  const highlightBy = graphDisplaySettings.groupBy

  const orderedMilestoneIds = useMemo(
    () => projectNodes
      .filter(n => n.type === 'milestone')
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      .map(n => n.id),
    [projectNodes]
  )


  // Compute milestone positions: laid out sequentially in a row above all task nodes.
  const milestonePositions = useMemo(() => {
    const MILESTONE_WIDTH = 200
    const MILESTONE_HEIGHT = 40
    const GAP = 16
    // Base Y: just above the topmost task node
    const taskNodesWithPos = projectNodes.filter(n => n.type !== 'milestone' && n.position)
    const topmostTaskY = taskNodesWithPos.length > 0
      ? Math.min(...taskNodesWithPos.map(t => t.position!.y))
      : 40
    const leftmostTaskX = taskNodesWithPos.length > 0
      ? Math.min(...taskNodesWithPos.map(t => t.position!.x))
      : 40
    const MILESTONE_ROW_Y = topmostTaskY - MILESTONE_HEIGHT - 8
    const positions = new Map<string, { x: number; y: number }>()

    let x = leftmostTaskX
    for (const msId of orderedMilestoneIds) {
      positions.set(msId, { x, y: MILESTONE_ROW_Y })
      x += MILESTONE_WIDTH + GAP
    }

    return positions
  }, [projectNodes, orderedMilestoneIds])

  const handleCreateMilestone = useCallback((title: string) => {
    const now = new Date()
    // Place to the right of the rightmost existing milestone
    const MILESTONE_WIDTH = 240
    const milestoneNodes = projectNodes.filter(n => n.type === 'milestone' && n.position)
    let rightmostX = 40
    for (const m of milestoneNodes) {
      const right = (m.position?.x ?? 0) + MILESTONE_WIDTH
      if (right > rightmostX) rightmostX = right
    }
    addNode({
      id: crypto.randomUUID(),
      projectId,
      type: 'milestone',
      title,
      description: '',
      status: 'planned',
      parentId: null,
      dependencies: [],
      verification: 'human',
      position: { x: rightmostX + 24, y: 40 },
      createdAt: now,
      updatedAt: now,
    })
  }, [addNode, projectId, projectNodes])

  const rfNodes: Node[] = useMemo(() => {
    const taskNodes = projectNodes.map((n) => ({
      id: n.id,
      type: "task",
      position: n.position || { x: 0, y: 0 },
      data: {
        title: n.title,
        number: n.number,
        description: n.content ? stripHtml(n.content) : (n.description ?? ''),
        status: n.status,
        nodeType: (!loopNodesEnabled && n.type === 'loop') ? 'task' : n.type,
        priority: n.priority,
        dueDate: n.dueDate,
        executionId: n.executionId,
        prUrl: n.prUrl,
        mergeQueueStatus: n.mergeQueueStatus,
        autoPr: n.autoPr,
        githubIssueNumber: n.githubIssueNumber,
        githubIssueUrl: n.githubIssueUrl,
        ...(loopNodesEnabled ? {
          loopCurrentIteration: n.loopCurrentIteration,
          loopMaxIterations: n.loopConfig?.maxIterations,
          loopBestMetricValue: n.loopBestMetricValue,
          loopStatus: n.loopStatus,
        } : {}),
        ...(n.type === 'milestone' ? (() => {
          const members = projectNodes.filter(t => t.type !== 'milestone' && t.milestoneId === n.id)
          const done = members.filter(t => t.status === 'completed' || t.status === 'auto_verified').length
          return { milestoneTotal: members.length, milestoneDone: done }
        })() : {}),
        milestoneColor: n.type === 'milestone'
          ? (getMilestoneColor(n.id, orderedMilestoneIds) ?? null)
          : (n.milestoneId ? (getMilestoneColor(n.milestoneId, orderedMilestoneIds) ?? null) : null),
        highlightBy,
        checked: checkedIds.has(n.id),
        selectionActive: selectionActive,
        onDecompose: readOnly ? undefined : onDecomposeNode,
        onToggleSelect: readOnly ? undefined : handleToggleSelect,
        readOnly,
        fastEdit: !readOnly && (globalFastEdit ?? false),
        onFastEdit: !readOnly ? (nodeId: string, title: string) => updateNode(nodeId, { title }) : undefined,
      },
      selected: n.id === selectedId,
    }))

    if (!readOnly) {
      // Add a dashed "add milestone" placeholder to the right of ALL milestones
      const MILESTONE_WIDTH = 240
      const milestoneNodes = projectNodes.filter(n => n.type === 'milestone' && n.position)
      let rightmostX = 0
      for (const m of milestoneNodes) {
        const right = (m.position?.x ?? 0) + MILESTONE_WIDTH
        if (right > rightmostX) rightmostX = right
      }
      const addX = milestoneNodes.length > 0 ? rightmostX + 16 : 40
      const addY = milestoneNodes.length > 0 ? (milestoneNodes[0].position?.y ?? 40) : 40
      taskNodes.push({
        id: '__add_milestone__',
        type: 'addMilestone',
        position: { x: addX, y: addY },
        data: { onCreate: handleCreateMilestone } as unknown as typeof taskNodes[0]['data'],
        selected: false,
      })
    }

    return taskNodes
  }, [projectNodes, orderedMilestoneIds, milestonePositions, selectedId, checkedIds, selectionActive, onDecomposeNode, handleToggleSelect, highlightBy, readOnly, loopNodesEnabled, handleCreateMilestone, globalFastEdit, updateNode])

  // Build a position lookup for edge handle routing
  const nodePositionMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    for (const n of projectNodes) {
      if (n.position) map.set(n.id, n.position)
    }
    return map
  }, [projectNodes])

  const redundantEdgeIds = useMemo(() => computeRedundantEdgeIds(projectEdges), [projectEdges])

  const rfEdges: Edge[] = useMemo(
    () =>
      projectEdges.filter((e) => !redundantEdgeIds.has(e.id)).map((e) => {
          // Edge color: green for completed targets, neutral for everything else.
          // #94A3B8 (slate-400) is visible in both light and dark themes.
          const targetNode = projectNodes.find((n) => n.id === e.target)
          const isCompleted = targetNode && (targetNode.status === "completed" || targetNode.status === "auto_verified")
          const edgeColor = isCompleted ? "#22C55E" : "#94A3B8"

          // Pick optimal handle pair based on relative node positions
          const { sourceHandle, targetHandle } = computeEdgeHandles(
            nodePositionMap.get(e.source),
            nodePositionMap.get(e.target),
          )

          return {
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle,
            targetHandle,
            type: "deletable",
            data: { onDelete: readOnly ? undefined : handleEdgeDelete, readOnly },
            style: {
              stroke: edgeColor,
              strokeWidth: 2.5,
              strokeLinecap: "round" as const,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: edgeColor,
              width: 12,
              height: 12,
            },
          }
        }),
    [projectEdges, projectNodes, nodePositionMap, handleEdgeDelete, readOnly, redundantEdgeIds]
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

    const sourceNode = projectNodes.find((n) => n.id === connection.source)
    const targetNode = projectNodes.find((n) => n.id === connection.target)

    // Milestone → task: assign the task to the milestone instead of creating a dependency edge
    if (sourceNode?.type === 'milestone' && targetNode && targetNode.type !== 'milestone') {
      updateNode(connection.target, { milestoneId: connection.source })
      connectingNodeRef.current = null
      return
    }

    // Task → milestone: assign the task to the milestone
    if (targetNode?.type === 'milestone' && sourceNode && sourceNode.type !== 'milestone') {
      updateNode(connection.source, { milestoneId: connection.target })
      connectingNodeRef.current = null
      return
    }

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
    if (targetNode && !targetNode.dependencies.includes(connection.source)) {
      updateNode(connection.target, { dependencies: [...targetNode.dependencies, connection.source] })
    }
    connectingNodeRef.current = null
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

    // Position the popup at the mouse drop point, offset so it doesn't obscure the cursor
    const canvasRect = canvasRef.current?.getBoundingClientRect()
    const dropScreenPos = {
      x: clientX - (canvasRect?.left ?? 0) - POPOVER_WIDTH / 2,
      y: clientY - (canvasRect?.top ?? 0) - POPOVER_HEIGHT / 2,
    }
    const screenPos = clampPopoverPosition(dropScreenPos, canvasRef.current)

    justCreatedChild.current = true
    setAddChildState({
      originNodeId: nodeId,
      position,
      screenPosition: screenPos,
      isUpwardDrag,
      milestoneId: originNode.type === 'milestone' ? nodeId : undefined,
    })

    connectingNodeRef.current = null
  }, [projectNodes, projectEdges, screenToFlowPosition, flowToScreenPosition])

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedId(node.id)
      // In fast edit mode, clicking activates inline title editing in the node itself;
      // do not navigate to the detail page.
      if (globalFastEdit) return
      const planNode = projectNodes.find((n) => n.id === node.id)
      onNodeSelect?.(planNode ?? null)
    },
    [projectNodes, onNodeSelect, globalFastEdit]
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
  // Keep ref in sync so the on-open effect always calls the latest version
  handleReorganizeRef.current = handleReorganize

  const handleTaskCreated = useCallback(() => {
    setAddChildState(null)
    // Defer reorganization to ensure both node and edge have been added to the store
    setTimeout(() => handleReorganize(), 0)
  }, [handleReorganize])

  // Show empty state when no nodes and not currently generating
  if (projectNodes.length === 0) {
    return (
      <div ref={canvasRef} className="h-full w-full bg-background flex items-center justify-center p-8 relative">
        <div className="flex w-full max-w-[600px] flex-col gap-6">
          {/* Generate with AI */}
          <button
            type="button"
            onClick={() => navigate(`/plan?projectId=${projectId}`)}
            className={cn(
              "flex flex-col gap-3 rounded-xl border p-5 text-left transition-all",
              "border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="text-base font-semibold text-primary">Generate with AI</div>
                <div className="text-xs text-muted-foreground mt-0.5">Describe your goal and let AI create a plan</div>
              </div>
            </div>
          </button>

          {/* Manual task creation */}
          <div className="flex flex-col gap-3">
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
    <div className="relative h-full w-full flex flex-col">
      {/* Legend bar — matches json-render PlanGraph header exactly */}
      <div className="shrink-0 px-3 py-1.5 bg-muted/40 border-b border-border flex items-center gap-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([
          { color: STATUS_DOT_COLOR.in_progress,       label: 'in progress' },
          { color: STATUS_DOT_COLOR.planned,            label: 'planned' },
          { color: STATUS_DOT_COLOR.completed,          label: 'completed' },
          { color: STATUS_DOT_COLOR.awaiting_approval,  label: 'awaiting' },
          { color: STATUS_DOT_COLOR.pruned,             label: 'pruned' },
        ] as const).map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1 shrink-0">
            <span className="h-1.5 w-1.5" style={{ background: color }} />
            <span className="text-[9px] text-muted-foreground/70">{label}</span>
          </span>
        ))}
        <div className="w-px h-3 bg-border shrink-0" />
        {([
          { color: PRIORITY_PIP_COLOR.urgent, label: 'urgent' },
          { color: PRIORITY_PIP_COLOR.high,   label: 'high' },
          { color: PRIORITY_PIP_COLOR.medium, label: 'medium' },
          { color: PRIORITY_PIP_COLOR.low,    label: 'low' },
        ] as const).map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1 shrink-0">
            <span className="h-1.5 w-1.5" style={{ background: color }} />
            <span className="text-[9px] text-muted-foreground/70">{label}</span>
          </span>
        ))}
        <div className="w-px h-3 bg-border shrink-0" />
        <span className="flex items-center gap-1 shrink-0">
          <svg width="18" height="6" className="shrink-0">
            <line x1="0" y1="3" x2="14" y2="3" stroke={GRAPH_EDGE_COLOR} strokeWidth="1.5" opacity="0.7" />
            <polygon points="14,0 18,3 14,6" fill={GRAPH_EDGE_COLOR} opacity="0.7" />
          </svg>
          <span className="text-[9px] text-muted-foreground/70">depends on</span>
        </span>
      </div>

      <div ref={canvasRef} className="relative flex-1">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onConnect={readOnly ? undefined : onConnect}
        onConnectStart={readOnly ? undefined : onConnectStart}
        onConnectEnd={readOnly ? undefined : onConnectEnd}
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
        {!readOnly && !selectionActive && projectNodes.length > 0 && (
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
            <div className="hidden md:flex items-center gap-1.5 bg-card/85 backdrop-blur-sm border border-border rounded-lg px-1.5 py-1 shadow-sm">
              <MachineWorkdirSelector
                machines={machines}
                selectedMachine={machines.find((m) => m.machineId === resolvedMachineId) ?? null}
                onMachineChange={(m) => {
                  if (m) updateProject(projectId, { defaultMachineId: m.machineId })
                }}
                workingDir={project?.workingDirectory ?? ""}
                onWorkingDirChange={(path) => updateProject(projectId, { workingDirectory: path })}
                onBrowse={() => setPathBrowserOpen(true)}
                compact
              />
            </div>
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
      {!readOnly && selectionActive && (
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
      {!readOnly && addChildState && (
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
            // When origin is a milestone, don't set parent/child — only assign milestoneId
            parentNodeId={addChildState.milestoneId ? undefined : (addChildState.isUpwardDrag ? undefined : addChildState.originNodeId || undefined)}
            childNodeId={addChildState.milestoneId ? undefined : (addChildState.isUpwardDrag ? addChildState.originNodeId : undefined)}
            defaultMilestoneId={addChildState.milestoneId}
            position={addChildState.position}
            onCreated={handleTaskCreated}
            onCancel={() => setAddChildState(null)}
          />
        </div>
      )}

      </div>
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
