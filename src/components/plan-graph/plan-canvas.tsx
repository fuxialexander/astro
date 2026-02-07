import { useMemo, useCallback, useState } from "react"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { GitBranch } from "lucide-react"
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
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const isGenerating = useAgentStore((s) => s.isGenerating)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addChildState, setAddChildState] = useState<AddChildState | null>(null)

  const { flowToScreenPosition } = useReactFlow()

  const projectNodes = useMemo(() => planNodes.filter((n) => n.projectId === projectId), [planNodes, projectId])
  const projectEdges = useMemo(() => {
    const nodeIds = new Set(projectNodes.map((n) => n.id))
    return planEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
  }, [planEdges, projectNodes])

  const handleAddChild = useCallback((parentNodeId: string) => {
    const parentNode = projectNodes.find((n) => n.id === parentNodeId)
    if (!parentNode) return

    const position = calculateChildPosition(parentNode, projectNodes, projectEdges)
    const screenPos = flowToScreenPosition(position)

    setAddChildState({
      parentNodeId,
      position,
      screenPosition: screenPos,
    })
  }, [projectNodes, projectEdges, flowToScreenPosition])

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
          onAddChild: handleAddChild,
        },
        selected: n.id === selectedId,
      })),
    [projectNodes, selectedId, handleAddChild]
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

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedId(node.id)
      const planNode = projectNodes.find((n) => n.id === node.id)
      onNodeSelect?.(planNode ?? null)
    },
    [projectNodes, onNodeSelect]
  )

  const handlePaneClick = useCallback(() => {
    setSelectedId(null)
    setAddChildState(null)
    onNodeSelect?.(null)
  }, [onNodeSelect])

  const handleGeneratePlan = useCallback(() => {
    if (project && connectionStatus === "connected") {
      startGeneration(projectId, project.description || project.name, project.visionDoc)
    }
  }, [startGeneration, projectId, project, connectionStatus])

  // Show empty state when no nodes and not currently generating
  if (projectNodes.length === 0 && !isGenerating) {
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
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
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
            onCreated={() => setAddChildState(null)}
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
