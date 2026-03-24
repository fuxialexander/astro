/**
 * Plan store — plan nodes, edges, selected node state.
 *
 * Fetches the plan graph from the backend and provides it to
 * the React Flow visualization.
 */
import { create } from 'zustand'
import { api } from '@desktop/lib/api-client'
import type { PlanNode, PlanEdge } from '@desktop/types'

interface PlanState {
  nodes: PlanNode[]
  edges: PlanEdge[]
  selectedNodeId: string | null
  loading: boolean
  error: string | null

  loadPlan: (projectId: string) => Promise<void>
  setSelectedNode: (nodeId: string | null) => void
  updateNodeStatus: (nodeId: string, status: PlanNode['status']) => void
  getNode: (nodeId: string) => PlanNode | undefined
}

export const usePlanStore = create<PlanState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  loading: false,
  error: null,

  loadPlan: async (projectId: string) => {
    set({ loading: true, error: null })
    try {
      const [nodes, edges] = await Promise.all([
        api.get<PlanNode[]>(`/api/data/plan-nodes?projectId=${projectId}`),
        api.get<PlanEdge[]>(`/api/data/plan-edges?projectId=${projectId}`),
      ])
      set({
        nodes: nodes ?? [],
        edges: edges ?? [],
        loading: false,
      })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load plan',
        loading: false,
      })
    }
  },

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  updateNodeStatus: (nodeId, status) => {
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, status } : n)),
    }))
  },

  getNode: (nodeId) => get().nodes.find((n) => n.id === nodeId),
}))
