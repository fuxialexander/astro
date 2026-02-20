import { create } from "zustand"
import type { PlanNode, PlanEdge } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { layoutGraph } from "@/lib/graph-utils"
import { dataClient } from "@/lib/data-client"
import { apiUrl } from "@/lib/api-url"

const BULK_DELETE_THRESHOLD = 80

export function isLive<T extends { deletedAt?: Date }>(item: T): boolean {
  return item.deletedAt == null
}

/**
 * Fire-and-forget worktree cleanup when a task is completed or pruned.
 */
function cleanupWorktree(executionId: string, nodeId: string) {
  fetch(apiUrl("/api/dispatch/cleanup"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ executionId, nodeId }),
  }).catch((err) => {
    console.warn("[plan-store] Worktree cleanup failed:", err)
  })
}

/**
 * Retry an async operation with exponential backoff.
 */
async function retryAsync(
  fn: () => Promise<void>,
  label: string,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fn()
      if (attempt > 0) {
        console.log(`[plan-store] ${label} succeeded on retry ${attempt}`)
      }
      return
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`[plan-store] ${label} failed after ${maxRetries + 1} attempts:`, err)
        return
      }
      const delay = baseDelayMs * Math.pow(2, attempt)
      console.warn(`[plan-store] ${label} failed (attempt ${attempt + 1}), retrying in ${delay}ms...`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

interface PlanState {
  nodes: PlanNode[]
  edges: PlanEdge[]
  loaded: boolean
  load: () => Promise<void>
  addNode: (node: PlanNode) => void
  updateNode: (id: string, updates: Partial<PlanNode>) => void
  removeNodes: (ids: string[]) => void
  addEdge: (edge: PlanEdge) => void
  removeEdge: (source: string, target: string) => void
  setProjectPlan: (projectId: string, nodes: PlanNode[], edges: PlanEdge[]) => void
  reorganizeProject: (projectId: string) => void
  removeProjectPlan: (projectId: string) => void
}

// Empty seed data — new users start with no plans and create via /projects/new
const SEED_NODES: PlanNode[] = []
const SEED_EDGES: PlanEdge[] = []

async function loadFromIdb(): Promise<{ nodes: PlanNode[]; edges: PlanEdge[] } | null> {
  const savedNodes = await loadState<PlanNode[]>("astro-plan-nodes")
  const savedEdges = await loadState<PlanEdge[]>("astro-plan-edges")
  if (savedNodes && savedEdges) {
    return {
      nodes: savedNodes.map(n => ({
        ...n,
        createdAt: new Date(n.createdAt),
        updatedAt: new Date(n.updatedAt),
        deletedAt: n.deletedAt ? new Date(n.deletedAt) : undefined,
      })),
      edges: savedEdges.map(e => ({
        ...e,
        deletedAt: e.deletedAt ? new Date(e.deletedAt) : undefined,
      })),
    }
  }
  return null
}

function saveToIdb(nodes: PlanNode[], edges: PlanEdge[]) {
  saveState("astro-plan-nodes", nodes)
  saveState("astro-plan-edges", edges)
}

/**
 * Ensure all nodes have positions. Computes layout for projects with missing positions.
 */
function ensurePositions(nodes: PlanNode[], edges: PlanEdge[]): void {
  const needsLayout = nodes.some((n) => !n.position)
  if (!needsLayout) return

  console.log("[plan-store] Nodes missing positions, calculating layout")
  const projectIds = new Set(nodes.map((n) => n.projectId))
  for (const projectId of projectIds) {
    const projectNodes = nodes.filter((n) => n.projectId === projectId)
    const nodeIds = new Set(projectNodes.map((n) => n.id))
    const projectEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    const positions = layoutGraph(projectNodes, projectEdges)
    for (const node of projectNodes) {
      const pos = positions.get(node.id)
      node.position = pos ?? { x: 0, y: 0 }
    }
  }
}

/**
 * Merge IDB-cached nodes into API-loaded nodes.
 * If IDB has nodes for a project that the API doesn't, keep the IDB nodes
 * and push them to the API. This prevents data loss when API writes fail.
 */
function mergeWithIdbCache(
  apiNodes: PlanNode[],
  apiEdges: PlanEdge[],
  idbNodes: PlanNode[],
  idbEdges: PlanEdge[],
): { nodes: PlanNode[]; edges: PlanEdge[]; recoveredProjectIds: string[] } {
  const apiProjectIds = new Set(apiNodes.map((n) => n.projectId))
  const idbProjectIds = new Set(idbNodes.map((n) => n.projectId))

  // Find projects that exist in IDB but not in API
  const recoveredProjectIds: string[] = []
  const extraNodes: PlanNode[] = []
  const extraEdges: PlanEdge[] = []

  for (const projectId of idbProjectIds) {
    if (!apiProjectIds.has(projectId)) {
      const projectNodes = idbNodes.filter((n) => n.projectId === projectId)
      if (projectNodes.length > 0) {
        recoveredProjectIds.push(projectId)
        extraNodes.push(...projectNodes)
        const nodeIds = new Set(projectNodes.map((n) => n.id))
        extraEdges.push(...idbEdges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target)))
      }
    }
  }

  return {
    nodes: [...apiNodes, ...extraNodes],
    edges: [...apiEdges, ...extraEdges],
    recoveredProjectIds,
  }
}

export const usePlanStore = create<PlanState>((set, get) => ({
  nodes: [],
  edges: [],
  loaded: false,

  load: async () => {
    try {
      const { nodes: apiNodes, edges: rawApiEdges } = await dataClient.getAllPlans()
      // Deduplicate edges by source→target on load
      const seen = new Set<string>()
      const apiEdges = rawApiEdges.filter((e) => {
        const key = `${e.source}->${e.target}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Check IDB for plans that didn't make it to Supabase (fire-and-forget failures)
      const cached = await loadFromIdb()
      let nodes = apiNodes
      let edges = apiEdges

      if (cached && cached.nodes.length > 0) {
        const { nodes: merged, edges: mergedEdges, recoveredProjectIds } = mergeWithIdbCache(
          apiNodes, apiEdges, cached.nodes, cached.edges,
        )
        if (recoveredProjectIds.length > 0) {
          console.log(`[plan-store] Recovered ${recoveredProjectIds.length} project(s) from IDB cache:`, recoveredProjectIds)
          nodes = merged
          edges = mergedEdges

          // Push recovered plans to Supabase in the background
          for (const projectId of recoveredProjectIds) {
            const projectNodes = cached.nodes.filter((n) => n.projectId === projectId)
            const projectNodeIds = new Set(projectNodes.map((n) => n.id))
            const projectEdges = cached.edges.filter((e) => projectNodeIds.has(e.source) || projectNodeIds.has(e.target))
            retryAsync(
              () => dataClient.setProjectPlan(projectId, projectNodes, projectEdges),
              `Recover project ${projectId} to Supabase`,
            )
          }
        }
      }

      ensurePositions(nodes, edges)
      set({ nodes, edges, loaded: true })
      saveToIdb(nodes, edges)
    } catch {
      // API unavailable — fall back to IndexedDB cache
      const cached = await loadFromIdb()
      if (cached) {
        ensurePositions(cached.nodes, cached.edges)
        set({ ...cached, loaded: true })
      } else {
        set({ nodes: SEED_NODES, edges: SEED_EDGES, loaded: true })
      }
    }
  },

  addNode: (node) => {
    // Skip if a node with this ID already exists
    if (get().nodes.some((n) => n.id === node.id)) return

    const nextNodes = [...get().nodes, node]
    set({ nodes: nextNodes })
    saveState("astro-plan-nodes", nextNodes)
    dataClient.addNode(node).catch((err) => {
      console.error('[plan-store] Failed to save node to API:', err)
    })
  },

  updateNode: (id, updates) => {
    const nextNodes = get().nodes.map((n) =>
      n.id === id ? { ...n, ...updates, updatedAt: new Date() } : n
    )
    set({ nodes: nextNodes })
    saveState("astro-plan-nodes", nextNodes)
    dataClient.updateNode(id, updates).catch((err) => {
      console.error('[plan-store] Failed to update node in API:', err)
    })

    // Trigger worktree cleanup when task is completed or pruned
    if (updates.status === 'completed' || updates.status === 'pruned') {
      const node = get().nodes.find((n) => n.id === id)
      if (node?.executionId) {
        cleanupWorktree(node.executionId, id)
      }
    }
  },

  removeNodes: (ids) => {
    const idSet = new Set(ids)

    if (ids.length > BULK_DELETE_THRESHOLD) {
      // Hard-delete for bulk operations
      const nextNodes = get().nodes.filter((n) => !idSet.has(n.id))
      const nextEdges = get().edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target))
      set({ nodes: nextNodes, edges: nextEdges })
      saveToIdb(nextNodes, nextEdges)
      for (const id of ids) {
        dataClient.deleteNode(id).catch((err) => {
          console.error('[plan-store] Failed to delete node from API:', err)
        })
      }
    } else {
      // Soft-delete: mark nodes and connected edges as deleted
      const now = new Date()
      const actionId = crypto.randomUUID()
      const nextNodes = get().nodes.map((n) =>
        idSet.has(n.id) ? { ...n, deletedAt: now, deletionActionId: actionId, updatedAt: now } : n
      )
      const nextEdges = get().edges.map((e) =>
        idSet.has(e.source) || idSet.has(e.target) ? { ...e, deletedAt: now, deletionActionId: actionId } : e
      )
      set({ nodes: nextNodes, edges: nextEdges })
      saveToIdb(nextNodes, nextEdges)
      for (const id of ids) {
        dataClient.updateNode(id, { deletedAt: now, deletionActionId: actionId }).catch((err) => {
          console.error('[plan-store] Failed to soft-delete node in API:', err)
        })
      }
    }
  },

  addEdge: (edge) => {
    // Skip if duplicate source→target already exists
    const exists = get().edges.some(
      (e) => e.source === edge.source && e.target === edge.target
    )
    if (exists) return

    const nextEdges = [...get().edges, edge]
    set({ edges: nextEdges })
    saveState("astro-plan-edges", nextEdges)
    // Determine projectId from source node
    const sourceNode = get().nodes.find((n) => n.id === edge.source)
    if (sourceNode) {
      dataClient.addEdge({ ...edge, projectId: sourceNode.projectId }).catch((err) => {
        console.error('[plan-store] Failed to save edge to API:', err)
      })
    }
  },

  removeEdge: (source, target) => {
    const edgeToRemove = get().edges.find((e) => e.source === source && e.target === target)
    if (!edgeToRemove) return

    const nextEdges = get().edges.filter((e) => !(e.source === source && e.target === target))
    set({ edges: nextEdges })
    saveState("astro-plan-edges", nextEdges)
    dataClient.deleteEdge(edgeToRemove.id).catch((err) => {
      console.error('[plan-store] Failed to delete edge from API:', err)
    })
  },

  setProjectPlan: (projectId, newNodes, newEdges) => {
    console.log(`[plan-store] setProjectPlan called: projectId=${projectId}, ${newNodes.length} nodes, ${newEdges.length} edges`)
    const otherNodes = get().nodes.filter((n) => n.projectId !== projectId)
    const otherEdges = get().edges.filter((e) => {
      const nodeIds = new Set(get().nodes.filter((n) => n.projectId === projectId).map((n) => n.id))
      return !nodeIds.has(e.source) && !nodeIds.has(e.target)
    })
    // Deduplicate new edges by source→target
    const seen = new Set<string>()
    const dedupedNewEdges = newEdges.filter((e) => {
      const key = `${e.source}->${e.target}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const nextNodes = [...otherNodes, ...newNodes]
    const nextEdges = [...otherEdges, ...dedupedNewEdges]
    console.log(`[plan-store] Updating store: ${nextNodes.length} total nodes (${otherNodes.length} existing + ${newNodes.length} new)`)
    set({ nodes: nextNodes, edges: nextEdges })
    saveToIdb(nextNodes, nextEdges)
    // Retry API save — this is critical in Supabase mode to prevent data loss on reload
    retryAsync(
      () => dataClient.setProjectPlan(projectId, newNodes, dedupedNewEdges),
      `Save project plan ${projectId}`,
    )
  },

  removeProjectPlan: (projectId) => {
    const allNodes = get().nodes
    const allEdges = get().edges
    const projectNodeIds = new Set(allNodes.filter((n) => n.projectId === projectId).map((n) => n.id))

    const nextNodes = allNodes.filter((n) => n.projectId !== projectId)
    const nextEdges = allEdges.filter((e) => !projectNodeIds.has(e.source) && !projectNodeIds.has(e.target))
    set({ nodes: nextNodes, edges: nextEdges })
    saveToIdb(nextNodes, nextEdges)

    // Delete from API
    for (const id of projectNodeIds) {
      dataClient.deleteNode(id).catch((err) => {
        console.error('[plan-store] Failed to delete node from API:', err)
      })
    }
  },

  reorganizeProject: (projectId) => {
    const allNodes = get().nodes
    const allEdges = get().edges
    const projectNodes = allNodes.filter((n) => n.projectId === projectId && isLive(n))
    const nodeIds = new Set(projectNodes.map((n) => n.id))
    const projectEdges = allEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

    const positions = layoutGraph(projectNodes, projectEdges)

    const nextNodes = allNodes.map((n) => {
      const newPos = positions.get(n.id)
      return newPos ? { ...n, position: newPos, updatedAt: new Date() } : n
    })
    set({ nodes: nextNodes })
    saveState("astro-plan-nodes", nextNodes)

    // Sync position updates to API
    for (const [nodeId, pos] of positions) {
      dataClient.updateNode(nodeId, { position: pos }).catch((err) => {
        console.error(`[plan-store] Failed to update position for node ${nodeId}:`, err)
      })
    }
  },
}))
