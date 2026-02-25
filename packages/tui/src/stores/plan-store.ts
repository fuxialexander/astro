/**
 * Plan nodes/edges store for the currently selected project.
 */
import { create } from 'zustand'
import type { PlanNode, PlanEdge } from '../client-adapter.js'
import { buildTree, renderTreeLines, type TreeLine, type TreeNode } from '../lib/tree-builder.js'

export interface PlanState {
  projectId: string | null
  nodes: PlanNode[]
  edges: PlanEdge[]
  treeRoots: TreeNode[]
  treeLines: TreeLine[]
  collapsedNodes: Set<string>
  loading: boolean
  error: string | null
}

export interface PlanActions {
  setPlan: (projectId: string, nodes: PlanNode[], edges: PlanEdge[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  toggleCollapse: (nodeId: string) => void
  updateNodeStatus: (nodeId: string, status: string) => void
  clear: () => void
}

export const usePlanStore = create<PlanState & PlanActions>((set, get) => ({
  projectId: null,
  nodes: [],
  edges: [],
  treeRoots: [],
  treeLines: [],
  collapsedNodes: new Set(),
  loading: false,
  error: null,

  setPlan: (projectId, nodes, edges) => {
    const { collapsedNodes } = get()
    const treeRoots = buildTree(nodes, edges)
    const treeLines = renderTreeLines(treeRoots, collapsedNodes)
    set({ projectId, nodes, edges, treeRoots, treeLines, loading: false, error: null })
  },

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),

  toggleCollapse: (nodeId) => {
    const { collapsedNodes, treeRoots } = get()
    const next = new Set(collapsedNodes)
    if (next.has(nodeId)) {
      next.delete(nodeId)
    } else {
      next.add(nodeId)
    }
    const treeLines = renderTreeLines(treeRoots, next)
    set({ collapsedNodes: next, treeLines })
  },

  updateNodeStatus: (nodeId, status) => {
    const { nodes, edges, collapsedNodes } = get()
    const updated = nodes.map((n) => (n.id === nodeId ? { ...n, status } : n))
    const treeRoots = buildTree(updated, edges)
    const treeLines = renderTreeLines(treeRoots, collapsedNodes)
    set({ nodes: updated, treeRoots, treeLines })
  },

  clear: () => set({
    projectId: null,
    nodes: [],
    edges: [],
    treeRoots: [],
    treeLines: [],
    loading: false,
    error: null,
  }),
}))
