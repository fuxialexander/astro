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
  /** Load all plan nodes across all projects (for dashboard). */
  loadNodes: () => Promise<void>
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

  loadNodes: async () => {
    set({ loading: true, error: null })
    try {
      const data = await api.get<PlanNode[]>('/api/data/plan-nodes?slim=1')
      set({ nodes: data ?? [], loading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load nodes',
        loading: false,
      })
    }
  },

  loadPlan: async (projectId: string) => {
    set({ loading: true, error: null })
    try {
      const data = await api.get<{ nodes: PlanNode[]; edges: PlanEdge[] }>(
        `/api/data/plan/${projectId}`,
      )
      set({
        nodes: data?.nodes ?? [],
        edges: data?.edges ?? [],
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
