/**
 * PlanGraph — DAG visualization of plan nodes using React Flow.
 *
 * Fetches plan data from the store, converts to React Flow format,
 * and renders with custom node types. Click a node to select it
 * for detail viewing in the review panel.
 */
import { useEffect, useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from '@xyflow/react'
import type { Node, Edge, NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { usePlanStore } from '@desktop/stores/plan-store'
import { TaskNode } from '@desktop/components/plan/TaskNode'
import { MilestoneNode } from '@desktop/components/plan/MilestoneNode'
import { Loader2, LayoutGrid } from 'lucide-react'

interface PlanGraphProps {
  projectId: string
}

// Register custom node types
const nodeTypes = {
  task: TaskNode,
  milestone: MilestoneNode,
  decision: MilestoneNode,
} as Record<string, unknown>

export function PlanGraph({ projectId }: PlanGraphProps) {
  const planNodes = usePlanStore((s) => s.nodes)
  const planEdges = usePlanStore((s) => s.edges)
  const selectedNodeId = usePlanStore((s) => s.selectedNodeId)
  const loading = usePlanStore((s) => s.loading)
  const error = usePlanStore((s) => s.error)
  const loadPlan = usePlanStore((s) => s.loadPlan)
  const setSelectedNode = usePlanStore((s) => s.setSelectedNode)

  // Load plan on mount / project change
  useEffect(() => {
    loadPlan(projectId)
  }, [projectId, loadPlan])

  // Convert store data → React Flow nodes
  const rfNodes = useMemo<Node[]>(() => {
    return planNodes.map((node) => {
      const nodeType = node.type === 'milestone' || node.type === 'decision'
        ? node.type
        : 'task'

      return {
        id: node.id,
        type: nodeType,
        position: node.position ?? { x: 0, y: 0 },
        data: {
          label: node.title,
          description: node.description,
          status: node.status,
          priority: node.priority,
          estimate: node.estimate,
          nodeType: node.type ?? 'task',
          selected: node.id === selectedNodeId,
        },
      }
    })
  }, [planNodes, selectedNodeId])

  // Convert store data → React Flow edges
  const rfEdges = useMemo<Edge[]>(() => {
    // Find active node IDs for edge animation
    const activeNodeIds = new Set(
      planNodes
        .filter((n) => n.status === 'in_progress' || n.status === 'dispatched')
        .map((n) => n.id),
    )

    return planEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: activeNodeIds.has(edge.source) || activeNodeIds.has(edge.target),
      style: {
        stroke: activeNodeIds.has(edge.source) || activeNodeIds.has(edge.target)
          ? 'var(--primary)'
          : 'var(--border)',
        strokeWidth: 1.5,
      },
    }))
  }, [planEdges, planNodes])

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges)

  // Sync when source data changes
  useEffect(() => { setNodes(rfNodes) }, [rfNodes, setNodes])
  useEffect(() => { setEdges(rfEdges) }, [rfEdges, setEdges])

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelectedNode(node.id === selectedNodeId ? null : node.id)
    },
    [setSelectedNode, selectedNodeId],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <p className="text-sm text-error">{error}</p>
        <button
          onClick={() => loadPlan(projectId)}
          className="text-xs text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (planNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <LayoutGrid className="w-8 h-8 opacity-40" />
        <p className="text-sm">No plan nodes yet</p>
        <p className="text-xs opacity-60">Use the chat to generate a plan</p>
      </div>
    )
  }

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes as any}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border)" />
        <Controls
          showInteractive={false}
          className="!bg-card !border-border !rounded-lg !shadow-sm [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted"
        />
        <MiniMap
          nodeStrokeColor="var(--border)"
          nodeColor="var(--card)"
          maskColor="rgba(0,0,0,0.1)"
          className="!bg-card !border-border !rounded-lg"
        />
      </ReactFlow>
    </div>
  )
}
