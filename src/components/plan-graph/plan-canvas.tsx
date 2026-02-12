import { useMemo, useCallback, useState, useRef } from "react"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  ConnectionLineType,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { GitBranch, LayoutGrid } from "lucide-react"
import { usePlanStore } from "@/stores/plan-store"
import { useAgentStore } from "@/stores/agent-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import { TaskNode } from "./task-node"
import { TaskCreationForm } from "@/components/task-creation-form"
import { EmptyState } from "@/components/ui/empty-state"
import { calculateChildPosition } from "@/lib/graph-utils"
import type { PlanNode } from "@/types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes = { task: TaskNode as any }

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
}

interface AddChildState {
  parentNodeId: string
  position: { x: number; y: number }
  screenPosition: { x: number; y: number }
}

function PlanCanvasInner({ projectId, onNodeSelect }: PlanCanvasProps) {
  const planNodes = usePlanStore((s) => s.nodes)
  const planEdges = usePlanStore((s) => s.edges)
  const addEdge = usePlanStore((s) => s.addEdge)
  const reorganizeProject = usePlanStore((s) => s.reorganizeProject)
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const isProjectGenerating = useAgentStore((s) => s.sessions.get(projectId)?.status === 'active')
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addChildState, setAddChildState] = useState<AddChildState | null>(null)
  const connectingNodeId = useRef<string | null>(null)
  const justCreatedChild = useRef(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  const { flowToScreenPosition, screenToFlowPosition, fitView: rfFitView } = useReactFlow()

  const projectNodes = useMemo(() => planNodes.filter((n) => n.projectId === projectId && n.type !== "milestone"), [planNodes, projectId])
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

  const rfNodes: Node[] = useMemo(
    () =>
      projectNodes.map((n) => ({
        id: n.id,
        type: "task",
        position: n.position,
        data: {
          title: n.title,
          status: n.status,
          nodeType: n.type,
          priority: n.priority,
          dueDate: n.dueDate,
          executionId: n.executionId,
          prUrl: n.prUrl,
        },
        selected: n.id === selectedId,
      })),
    [projectNodes, selectedId]
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      projectEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        style: { stroke: "var(--border)", strokeWidth: 1.5 },
        animated: e.type === "branch",
      })),
    [projectEdges]
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
    connectingNodeId.current = null
    // Auto-reorganize after adding a link
    reorganizeProject(projectId)
    setTimeout(() => rfFitView({ padding: 0.3, duration: 300 }), 50)
  }, [projectEdges, addEdge, reorganizeProject, projectId, rfFitView])

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
    onNodeSelect?.(null)
  }, [onNodeSelect])

  const handleReorganize = useCallback(() => {
    reorganizeProject(projectId)
    // Fit view after layout with a short delay for React to re-render
    setTimeout(() => rfFitView({ padding: 0.3, duration: 300 }), 50)
  }, [reorganizeProject, projectId, rfFitView])

  const handleTaskCreated = useCallback(() => {
    setAddChildState(null)
    handleReorganize()
  }, [handleReorganize])

  const handleGeneratePlan = useCallback(() => {
    if (project && connectionStatus === "connected") {
      startGeneration(projectId, project.name, project.description || project.name, project.visionDoc)
    }
  }, [startGeneration, projectId, project, connectionStatus])

  // Show empty state when no nodes and not currently generating
  if (projectNodes.length === 0 && !isProjectGenerating) {
    const isConnected = connectionStatus === "connected"
    return (
      <div className="h-full w-full bg-background flex items-center justify-center">
        <EmptyState
          icon={GitBranch}
          title="Structure your plan"
          description={isConnected
            ? "Generate an AI-structured plan that breaks down your goal into tasks with dependencies, verification steps, and execution environments."
            : "Connect to the backend in Settings to enable AI plan generation."
          }
          action={isConnected ? {
            label: "Generate Plan",
            onClick: handleGeneratePlan,
          } : {
            label: "Go to Settings",
            href: "/settings",
          }}
        />
      </div>
    )
  }

  return (
    <div ref={canvasRef} className="relative h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: "var(--border)", strokeWidth: 1.5 }}
        connectionRadius={40}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background gap={20} size={1} color="var(--border)" />
        <Controls
          showInteractive={false}
          className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground"
        />
        {/* Reorganize button positioned above the Controls */}
        <div className="react-flow__panel absolute bottom-[130px] left-2.5 z-10">
          <button
            type="button"
            onClick={handleReorganize}
            title="Reorganize layout"
            className="flex h-[26px] w-[26px] items-center justify-center rounded-sm border border-border bg-card text-foreground shadow-md hover:bg-muted cursor-pointer"
          >
            <LayoutGrid className="h-3 w-3" />
          </button>
        </div>
      </ReactFlow>

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
