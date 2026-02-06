import { useMemo, useCallback, useState } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { usePlanStore } from "@/stores/plan-store"
import { TaskNode } from "./task-node"
import type { PlanNode } from "@/types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes = { task: TaskNode as any }

interface PlanCanvasProps {
  projectId: string
  onNodeSelect?: (node: PlanNode | null) => void
}

export function PlanCanvas({ projectId, onNodeSelect }: PlanCanvasProps) {
  const planNodes = usePlanStore((s) => s.nodes)
  const planEdges = usePlanStore((s) => s.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const projectNodes = useMemo(() => planNodes.filter((n) => n.projectId === projectId), [planNodes, projectId])
  const projectEdges = useMemo(() => {
    const nodeIds = new Set(projectNodes.map((n) => n.id))
    return planEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
  }, [planEdges, projectNodes])

  const rfNodes: Node[] = useMemo(
    () =>
      projectNodes.map((n) => ({
        id: n.id,
        type: "task",
        position: n.position,
        data: { title: n.title, status: n.status, nodeType: n.type },
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
    onNodeSelect?.(null)
  }, [onNodeSelect])

  return (
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
  )
}
