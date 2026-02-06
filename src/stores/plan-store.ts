import { create } from "zustand"
import type { PlanNode, PlanEdge } from "@/types"
import { loadState, saveState } from "@/lib/db"

interface PlanState {
  nodes: PlanNode[]
  edges: PlanEdge[]
  loaded: boolean
  load: () => Promise<void>
  addNode: (node: PlanNode) => void
  updateNode: (id: string, updates: Partial<PlanNode>) => void
  addEdge: (edge: PlanEdge) => void
  setProjectPlan: (projectId: string, nodes: PlanNode[], edges: PlanEdge[]) => void
}

const MOCK_NODES: PlanNode[] = [
  { id: "n1", projectId: "proj-1", type: "task", title: "Project Setup", description: "Initialize repo, CI/CD, and dev environment", status: "completed", parentId: null, dependencies: [], environment: "local", verification: "auto", position: { x: 40, y: 40 }, priority: "medium", estimate: "S", milestoneId: "n4", createdAt: new Date("2026-01-15"), updatedAt: new Date("2026-01-16") },
  { id: "n2", projectId: "proj-1", type: "task", title: "Authentication", description: "JWT auth with OAuth2 social login", status: "completed", parentId: null, dependencies: ["n1"], environment: "local", verification: "auto", position: { x: 40, y: 140 }, priority: "high", estimate: "M", milestoneId: "n4", labelIds: ["l2"], createdAt: new Date("2026-01-16"), updatedAt: new Date("2026-01-20") },
  { id: "n3", projectId: "proj-1", type: "task", title: "Database Schema", description: "Design and implement core database schema", status: "in_progress", parentId: null, dependencies: ["n2"], environment: "local", verification: "auto", position: { x: 40, y: 240 }, priority: "high", dueDate: "2026-02-07", estimate: "M", milestoneId: "n4", labelIds: ["l2"], createdAt: new Date("2026-01-20"), updatedAt: new Date("2026-02-03") },
  { id: "n4", projectId: "proj-1", type: "milestone", title: "Core Infrastructure", description: "All core backend services running", status: "in_progress", parentId: null, dependencies: ["n3"], verification: "human", position: { x: 40, y: 340 }, startDate: "2026-01-27", endDate: "2026-01-27", createdAt: new Date("2026-01-15"), updatedAt: new Date("2026-02-03") },
  { id: "n5", projectId: "proj-1", type: "task", title: "REST API", description: "RESTful API endpoints for all resources", status: "pruned", parentId: null, dependencies: ["n4"], environment: "local", verification: "auto", position: { x: 300, y: 400 }, priority: "medium", estimate: "L", labelIds: ["l2"], createdAt: new Date("2026-01-25"), updatedAt: new Date("2026-02-01") },
  { id: "n6", projectId: "proj-1", type: "task", title: "GraphQL API", description: "GraphQL schema and resolvers", status: "in_progress", parentId: null, dependencies: ["n4"], environment: "local", verification: "auto", position: { x: 300, y: 470 }, priority: "high", estimate: "M", milestoneId: "n10", labelIds: ["l2"], createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-05") },
  { id: "n7", projectId: "proj-1", type: "task", title: "Navigation UI", description: "App navigation and routing setup", status: "awaiting_judgment", parentId: null, dependencies: ["n4"], environment: "local", verification: "human", position: { x: 300, y: 540 }, priority: "medium", dueDate: "2026-02-10", estimate: "M", milestoneId: "n10", labelIds: ["l1"], createdAt: new Date("2026-02-02"), updatedAt: new Date("2026-02-05") },
  { id: "n8", projectId: "proj-1", type: "task", title: "Dashboard UI", description: "Main dashboard with summary cards", status: "planned", parentId: null, dependencies: ["n6", "n7"], environment: "local", verification: "human", position: { x: 300, y: 610 }, priority: "low", estimate: "L", milestoneId: "n10", labelIds: ["l1"], createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "n9", projectId: "proj-1", type: "task", title: "Charts & Viz", description: "Budget charts and spending visualizations", status: "planned", parentId: null, dependencies: ["n8"], environment: "local", verification: "human", position: { x: 300, y: 680 }, priority: "low", estimate: "M", milestoneId: "n10", labelIds: ["l1"], createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
  { id: "n10", projectId: "proj-1", type: "milestone", title: "Frontend Complete", description: "All frontend screens functional", status: "planned", parentId: null, dependencies: ["n9"], verification: "human", position: { x: 300, y: 750 }, startDate: "2026-02-11", endDate: "2026-02-11", createdAt: new Date("2026-02-03"), updatedAt: new Date("2026-02-03") },
]

const MOCK_EDGES: PlanEdge[] = [
  { id: "e1", source: "n1", target: "n2", type: "dependency" },
  { id: "e2", source: "n2", target: "n3", type: "dependency" },
  { id: "e3", source: "n3", target: "n4", type: "dependency" },
  { id: "e4", source: "n4", target: "n5", type: "branch" },
  { id: "e5", source: "n4", target: "n6", type: "branch" },
  { id: "e6", source: "n4", target: "n7", type: "branch" },
  { id: "e7", source: "n6", target: "n8", type: "dependency" },
  { id: "e8", source: "n7", target: "n8", type: "dependency" },
  { id: "e9", source: "n8", target: "n9", type: "dependency" },
  { id: "e10", source: "n9", target: "n10", type: "dependency" },
]

export const usePlanStore = create<PlanState>((set, get) => ({
  nodes: [],
  edges: [],
  loaded: false,

  load: async () => {
    const savedNodes = await loadState<PlanNode[]>("nexus-plan-nodes")
    const savedEdges = await loadState<PlanEdge[]>("nexus-plan-edges")
    if (savedNodes && savedEdges) {
      set({
        nodes: savedNodes.map(n => ({ ...n, createdAt: new Date(n.createdAt), updatedAt: new Date(n.updatedAt) })),
        edges: savedEdges,
        loaded: true,
      })
    } else {
      set({ nodes: MOCK_NODES, edges: MOCK_EDGES, loaded: true })
      await saveState("nexus-plan-nodes", MOCK_NODES)
      await saveState("nexus-plan-edges", MOCK_EDGES)
    }
  },

  addNode: (node) => {
    const nextNodes = [...get().nodes, node]
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)
  },

  updateNode: (id, updates) => {
    const nextNodes = get().nodes.map((n) =>
      n.id === id ? { ...n, ...updates, updatedAt: new Date() } : n
    )
    set({ nodes: nextNodes })
    saveState("nexus-plan-nodes", nextNodes)
  },

  addEdge: (edge) => {
    const nextEdges = [...get().edges, edge]
    set({ edges: nextEdges })
    saveState("nexus-plan-edges", nextEdges)
  },

  setProjectPlan: (projectId, newNodes, newEdges) => {
    // Replace all nodes/edges for the given project, keep others
    const otherNodes = get().nodes.filter((n) => n.projectId !== projectId)
    const otherEdges = get().edges.filter((e) => {
      const nodeIds = new Set(get().nodes.filter((n) => n.projectId === projectId).map((n) => n.id))
      return !nodeIds.has(e.source) && !nodeIds.has(e.target)
    })
    const nextNodes = [...otherNodes, ...newNodes]
    const nextEdges = [...otherEdges, ...newEdges]
    set({ nodes: nextNodes, edges: nextEdges })
    saveState("nexus-plan-nodes", nextNodes)
    saveState("nexus-plan-edges", nextEdges)
  },
}))
