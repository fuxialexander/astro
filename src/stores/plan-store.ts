import { create } from "zustand"
import type { PlanNode, PlanEdge } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { layoutGraph } from "@/lib/graph-utils"
import { dataClient } from "@/lib/data-client"

interface PlanState {
  nodes: PlanNode[]
  edges: PlanEdge[]
  loaded: boolean
  load: () => Promise<void>
  addNode: (node: PlanNode) => void
  updateNode: (id: string, updates: Partial<PlanNode>) => void
  addEdge: (edge: PlanEdge) => void
  setProjectPlan: (projectId: string, nodes: PlanNode[], edges: PlanEdge[]) => void
  reorganizeProject: (projectId: string) => void
}

// Empty seed data — new users start with no plans and create via /projects/new
const SEED_NODES: PlanNode[] = []
const SEED_EDGES: PlanEdge[] = []

async function loadFromIdb(): Promise<{ nodes: PlanNode[]; edges: PlanEdge[] } | null> {
  const savedNodes = await loadState<PlanNode[]>("nexus-plan-nodes")
  const savedEdges = await loadState<PlanEdge[]>("nexus-plan-edges")
  if (savedNodes && savedEdges) {
    return {
      nodes: savedNodes.map(n => ({ ...n, createdAt: new Date(n.createdAt), updatedAt: new Date(n.updatedAt) })),
      edges: savedEdges,
    }
  }
  return null
}

function saveToIdb(nodes: PlanNode[], edges: PlanEdge[]) {
  saveState("nexus-plan-nodes", nodes)
  saveState("nexus-plan-edges", edges)
}

export const usePlanStore = create<PlanState>((set, get) => ({
  nodes: [],
  edges: [],
  loaded: false,

  load: async () => {
    try {
      const { nodes, edges } = await dataClient.getAllPlans()
      set({ nodes, edges, loaded: true })
      saveToIdb(nodes, edges)
    } catch {
      // API unavailable — fall back to IndexedDB cache
      const cached = await loadFromIdb()
      if (cached) {
        set({ ...cached, loaded: true })
      } else {
        set({ nodes: SEED_NODES, edges: SEED_EDGES, loaded: true })
      }
    }
  },

  addNode: (node) => {
    const nextNodes = [...get().nodes, node]
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)
    dataClient.addNode(node).catch(() => {})
  },

  updateNode: (id, updates) => {
    const nextNodes = get().nodes.map((n) =>
      n.id === id ? { ...n, ...updates, updatedAt: new Date() } : n
    )
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)
    dataClient.updateNode(id, updates).catch(() => {})
  },

  addEdge: (edge) => {
    const nextEdges = [...get().edges, edge]
    set({ edges: nextEdges })
    saveState("nexus-plan-edges", nextEdges)
    // Determine projectId from source node
    const sourceNode = get().nodes.find((n) => n.id === edge.source)
    if (sourceNode) {
      dataClient.addEdge({ ...edge, projectId: sourceNode.projectId }).catch(() => {})
    }
  },

  setProjectPlan: (projectId, newNodes, newEdges) => {
    const otherNodes = get().nodes.filter((n) => n.projectId !== projectId)
    const otherEdges = get().edges.filter((e) => {
      const nodeIds = new Set(get().nodes.filter((n) => n.projectId === projectId).map((n) => n.id))
      return !nodeIds.has(e.source) && !nodeIds.has(e.target)
    })
    const nextNodes = [...otherNodes, ...newNodes]
    const nextEdges = [...otherEdges, ...newEdges]
    set({ nodes: nextNodes, edges: nextEdges })
    saveToIdb(nextNodes, nextEdges)
    dataClient.setProjectPlan(projectId, newNodes, newEdges).catch(() => {})
  },

  reorganizeProject: (projectId) => {
    const allNodes = get().nodes
    const allEdges = get().edges
    const projectNodes = allNodes.filter((n) => n.projectId === projectId)
    const nodeIds = new Set(projectNodes.map((n) => n.id))
    const projectEdges = allEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

    const positions = layoutGraph(projectNodes, projectEdges)

    const nextNodes = allNodes.map((n) => {
      const newPos = positions.get(n.id)
      return newPos ? { ...n, position: newPos, updatedAt: new Date() } : n
    })
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)

    // Sync position updates to API
    for (const [nodeId, pos] of positions) {
      dataClient.updateNode(nodeId, { position: pos }).catch(() => {})
    }
  },
}))
