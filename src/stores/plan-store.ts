import { create } from "zustand"
import type { PlanNode, PlanEdge } from "@/types"
import { layoutGraph } from "@/lib/graph-utils"
import { dataClient } from "@/lib/data-client"
import { apiUrl } from "@/lib/api-url"
import { useToastStore } from "@/stores/toast-store"

const BULK_DELETE_THRESHOLD = 80

export function isLive<T extends { deletedAt?: Date }>(item: T): boolean {
  return item.deletedAt == null
}

const COMPLETED_STATUSES: PlanNode["status"][] = ["completed", "auto_verified"]

/** Pattern for detecting "Push to GitHub" / "Publish to GitHub" task nodes */
const PUSH_TO_GITHUB_RE = /push\s+to\s+github|publish\s+to\s+github/i

/**
 * Recompute milestone node statuses based on their upstream dependencies.
 * Handles cascading: completing milestone A may satisfy milestone B's deps.
 * Also handles reversion: resetting a task reverts auto-completed milestones.
 *
 * Returns an array of { id, status } patches to apply (may be empty).
 */
function computeMilestoneUpdates(
  changedNodeId: string,
  nodes: PlanNode[],
  edges: PlanEdge[],
): Array<{ id: string; status: PlanNode["status"] }> {
  const liveNodes = nodes.filter(isLive)
  const liveEdges = edges.filter(isLive)
  // Work on a mutable status map so cascading updates see prior changes
  const statusMap = new Map(liveNodes.map((n) => [n.id, n.status]))

  const changedNode = liveNodes.find((n) => n.id === changedNodeId)
  if (!changedNode) return []

  const projectMilestones = liveNodes.filter(
    (n) => n.projectId === changedNode.projectId && n.type === "milestone"
  )
  if (projectMilestones.length === 0) return []

  // Build upstream map: milestoneId → [depId, ...]
  // Combines edges pointing TO the milestone with tasks that have milestoneId set.
  // This handles cases where the AI sets milestoneId but doesn't create a task→milestone edge.
  const projectTasks = liveNodes.filter(
    (n) => n.projectId === changedNode.projectId && n.type !== "milestone"
  )
  const upstreamMap = new Map<string, string[]>()
  for (const ms of projectMilestones) {
    const edgeDeps = new Set(liveEdges.filter((e) => e.target === ms.id).map((e) => e.source))
    // Also include tasks whose milestoneId points to this milestone
    for (const t of projectTasks) {
      if (t.milestoneId === ms.id) edgeDeps.add(t.id)
    }
    upstreamMap.set(ms.id, [...edgeDeps])
  }

  // Iterate until stable (handles cascading milestone → milestone deps)
  const updates = new Map<string, PlanNode["status"]>()
  let changed = true
  while (changed) {
    changed = false
    for (const ms of projectMilestones) {
      const deps = upstreamMap.get(ms.id) ?? []
      if (deps.length === 0) continue

      const currentStatus = statusMap.get(ms.id)!
      const allDepsCompleted = deps.every((depId) => {
        const s = statusMap.get(depId)
        return s && COMPLETED_STATUSES.includes(s)
      })

      if (allDepsCompleted && !COMPLETED_STATUSES.includes(currentStatus)) {
        statusMap.set(ms.id, "auto_verified")
        updates.set(ms.id, "auto_verified")
        changed = true
      } else if (!allDepsCompleted && currentStatus === "auto_verified") {
        statusMap.set(ms.id, "planned")
        updates.set(ms.id, "planned")
        changed = true
      }
    }
  }

  return Array.from(updates, ([id, status]) => ({ id, status }))
}

/**
 * Reconcile milestone statuses on load — mutates the nodes array in place.
 * Persists any corrections to the API.
 */
function reconcileMilestones(nodes: PlanNode[], edges: PlanEdge[]): void {
  // Use a synthetic "load" trigger: check all milestones across all projects
  const liveNodes = nodes.filter(isLive)
  const liveEdges = edges.filter(isLive)
  const projectIds = new Set(liveNodes.map((n) => n.projectId))

  for (const projectId of projectIds) {
    const projectNodes = liveNodes.filter((n) => n.projectId === projectId)
    const milestones = projectNodes.filter((n) => n.type === "milestone")
    if (milestones.length === 0) continue

    const nodeIds = new Set(projectNodes.map((n) => n.id))
    const projectEdges = liveEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

    // Use computeMilestoneUpdates with an arbitrary node from this project
    const updates = computeMilestoneUpdates(projectNodes[0].id, projectNodes, projectEdges)
    for (const { id, status } of updates) {
      const node = nodes.find((n) => n.id === id)
      if (node) {
        console.log(`[plan-store] Reconciling milestone "${node.title}" → ${status}`)
        node.status = status
        node.updatedAt = new Date()
        dataClient.updateNode(id, { status }).catch((err) => {
          console.error('[plan-store] Failed to reconcile milestone in API:', err)
        })
      }
    }
  }
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
        if (label.startsWith('Save project plan')) {
          useToastStore.getState().add({
            type: 'error',
            title: 'Plan save failed',
            description: 'Your plan could not be saved to the server. Do not refresh the page — your data is still in memory. Try again or check your connection.',
            duration: 30000, // 30s — critical warning must not auto-dismiss quickly
          })
        }
        throw err
      }
      const delay = baseDelayMs * Math.pow(2, attempt)
      console.warn(`[plan-store] ${label} failed (attempt ${attempt + 1}), retrying in ${delay}ms...`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

/**
 * Track node IDs whose initial POST/PUT save is still in-flight.
 * Position updates for these nodes are deferred until the save completes.
 */
const pendingSaveNodeIds = new Set<string>()

/** Timer for markNodesAsUpdating auto-clear. Stored externally to prevent race conditions. */
let markNodesTimer: number | undefined

interface PlanState {
  nodes: PlanNode[]
  edges: PlanEdge[]
  loaded: boolean
  /** Node IDs recently updated via chat mutations — briefly highlighted in graph */
  recentlyUpdatedNodeIds: Set<string>
  load: () => Promise<void>
  /** Load plan data for a single project (merges into global store) */
  loadForProject: (projectId: string) => Promise<void>
  addNode: (node: PlanNode) => void
  updateNode: (id: string, updates: Partial<PlanNode>) => void
  /** Merge a DB-fetched node into the store. DB wins — no write-back to API. */
  mergeNodeFromDB: (dbNode: PlanNode) => void
  removeNodes: (ids: string[]) => void
  addEdge: (edge: PlanEdge) => void
  removeEdge: (source: string, target: string) => void
  setProjectPlan: (projectId: string, nodes: PlanNode[], edges: PlanEdge[]) => void
  reorganizeProject: (projectId: string) => void
  removeProjectPlan: (projectId: string) => void
  /** Mark node IDs as recently updated (visual pulse). Auto-clears after 2s. */
  markNodesAsUpdating: (nodeIds: string[]) => void
  /** Reset a node for re-execution: close PR, delete branch, clean worktree, reset status */
  resetNode: (nodeId: string, projectId: string) => Promise<{ success: boolean; errors?: string[] }>
  /** Soft-delete all live nodes for a project (for replan). Returns archived node IDs. */
  archiveProjectForReplan: (projectId: string) => string[]
}

// Empty seed data — new users start with no plans and create via /projects/new
const SEED_NODES: PlanNode[] = []
const SEED_EDGES: PlanEdge[] = []

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

export const usePlanStore = create<PlanState>((set, get) => ({
  nodes: [],
  edges: [],
  loaded: false,
  recentlyUpdatedNodeIds: new Set<string>(),

  load: async () => {
    try {
      const { nodes: apiNodes, edges: rawApiEdges } = await dataClient.getAllPlans()
      // Deduplicate edges by source→target on load
      const seen = new Set<string>()
      const edges = rawApiEdges.filter((e) => {
        const key = `${e.source}->${e.target}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Deduplicate nodes: by ID first, then collapse truly identical nodes within
      // the same project. Racing setProjectPlan calls (SSE vs WebSocket) can create
      // nodes with different UUIDs but identical content. We match on
      // projectId + type + title + description (first 500 chars) so that legitimately
      // different tasks with the same title (e.g. "Write tests" for frontend vs backend)
      // are preserved. Among duplicates, prefer the node with a server-assigned number.
      const seenIds = new Set<string>()
      const contentMap = new Map<string, PlanNode>()
      const keepIds = new Set<string>()
      for (const n of apiNodes) {
        if (seenIds.has(n.id)) continue
        seenIds.add(n.id)
        const contentKey = `${n.projectId}::${n.type}::${n.title ?? ''}::${(n.description ?? '').slice(0, 500)}`
        const existing = contentMap.get(contentKey)
        if (existing) {
          // Duplicate content — keep the node with a server-assigned number (lower wins)
          const existingNum = existing.number ?? Infinity
          const currentNum = n.number ?? Infinity
          if (currentNum < existingNum) {
            keepIds.delete(existing.id)
            keepIds.add(n.id)
            contentMap.set(contentKey, n)
          }
          // else: keep existing, skip current
        } else {
          contentMap.set(contentKey, n)
          keepIds.add(n.id)
        }
      }
      const nodes = apiNodes.filter((n) => keepIds.has(n.id))

      // Rebuild node.dependencies from edges (source of truth).
      // The server doesn't persist node.dependencies, so after a page refresh
      // all nodes have dependencies: []. Derive from the edge graph.
      const nodeIdSet = new Set(nodes.map((n) => n.id))
      const depsMap = new Map<string, string[]>()
      for (const e of edges) {
        if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) continue
        let deps = depsMap.get(e.target)
        if (!deps) { deps = []; depsMap.set(e.target, deps) }
        deps.push(e.source)
      }
      for (const node of nodes) {
        node.dependencies = depsMap.get(node.id) ?? []
      }

      ensurePositions(nodes, edges)
      // Reconcile milestone statuses on load (handles stale data)
      reconcileMilestones(nodes, edges)
      set({ nodes, edges, loaded: true })
    } catch {
      // API unavailable — start with empty data
      set({ nodes: SEED_NODES, edges: SEED_EDGES, loaded: true })
    }
  },

  loadForProject: async (projectId: string) => {
    try {
      const { nodes: apiNodes, edges: rawApiEdges } = await dataClient.getAllPlans(projectId)

      // Deduplicate edges
      const seen = new Set<string>()
      const newEdges = rawApiEdges.filter((e) => {
        const key = `${e.source}->${e.target}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Rebuild dependencies from edges
      const nodeIdSet = new Set(apiNodes.map((n) => n.id))
      const depsMap = new Map<string, string[]>()
      for (const e of newEdges) {
        if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) continue
        let deps = depsMap.get(e.target)
        if (!deps) { deps = []; depsMap.set(e.target, deps) }
        deps.push(e.source)
      }
      for (const node of apiNodes) {
        node.dependencies = depsMap.get(node.id) ?? []
      }

      ensurePositions(apiNodes, newEdges)
      reconcileMilestones(apiNodes, newEdges)

      // Merge into existing store: replace data for this project, keep others
      const { nodes: existingNodes, edges: existingEdges } = get()
      const otherNodes = existingNodes.filter((n) => n.projectId !== projectId)
      const nodeProjects = new Map(existingNodes.map((n) => [n.id, n.projectId]))
      const otherEdges = existingEdges.filter((e) => {
        return nodeProjects.get(e.source) !== projectId && nodeProjects.get(e.target) !== projectId
      })

      set({
        nodes: [...otherNodes, ...apiNodes],
        edges: [...otherEdges, ...newEdges],
        loaded: true,
      })
    } catch (err) {
      console.error('[plan-store] loadForProject failed:', err)
      set({ loaded: true })
    }
  },

  addNode: (node) => {
    // Skip if a node with this ID already exists
    if (get().nodes.some((n) => n.id === node.id)) return

    // Number is assigned server-side — add optimistically without number
    const nextNodes = [...get().nodes, node]
    set({ nodes: nextNodes })
    const nodeId = node.id
    pendingSaveNodeIds.add(nodeId)
    dataClient.addNode(node).then((res) => {
      pendingSaveNodeIds.delete(nodeId)
      // Merge server-assigned number into local node
      if (res.number != null) {
        const updated = get().nodes.map((n) =>
          n.id === nodeId ? { ...n, number: res.number! } : n
        )
        set({ nodes: updated })
      }
      // Sync any position computed by reorganizeProject while the save was in-flight
      const saved = get().nodes.find((n) => n.id === nodeId)
      if (saved?.position) {
        dataClient.updateNode(nodeId, { position: saved.position }).catch(() => {})
      }
    }).catch((err) => {
      pendingSaveNodeIds.delete(nodeId)
      console.error('[plan-store] Failed to save node to API:', err)
    })

    // Auto-wire: if a "Push to GitHub" node exists and the new node isn't it,
    // add the new node as a dependency of the Push node (keeps it as the final task).
    if (node.type === 'task' && !PUSH_TO_GITHUB_RE.test(node.title)) {
      const pushNode = get().nodes.find(
        (n) => n.type === 'task' && PUSH_TO_GITHUB_RE.test(n.title) && !n.deletedAt
      )
      if (pushNode) {
        // Add edge: new node → Push node (so Push depends on this node)
        const edgeExists = get().edges.some(
          (e) => e.source === nodeId && e.target === pushNode.id
        )
        if (!edgeExists) {
          const edge: PlanEdge = {
            id: crypto.randomUUID(),
            source: nodeId,
            target: pushNode.id,
            type: 'dependency',
          }
          get().addEdge(edge)
          // No need to update pushNode.dependencies locally — it's rebuilt from edges on load()
        }
      }
    }
  },

  updateNode: (id, updates) => {
    // Skip redundant status-only updates (e.g. duplicate SSE delivery setting same terminal status)
    if (updates.status && Object.keys(updates).length === 1) {
      const existing = get().nodes.find((n) => n.id === id)
      if (existing?.status === updates.status) return
    }

    const nextNodes = get().nodes.map((n) =>
      n.id === id ? { ...n, ...updates, updatedAt: new Date() } : n
    )
    set({ nodes: nextNodes })
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

    // Auto-complete or revert milestone nodes when a dependency's status changes
    if (updates.status !== undefined) {
      const milestoneUpdates = computeMilestoneUpdates(id, get().nodes, get().edges)
      if (milestoneUpdates.length > 0) {
        const updateMap = new Map(milestoneUpdates.map((mu) => [mu.id, mu.status]))
        const now = new Date()
        const muNodes = get().nodes.map((n) => {
          const newStatus = updateMap.get(n.id)
          return newStatus ? { ...n, status: newStatus, updatedAt: now } : n
        })
        set({ nodes: muNodes })
        for (const mu of milestoneUpdates) {
          console.log(`[plan-store] Auto-updating milestone ${mu.id} → ${mu.status}`)
          dataClient.updateNode(mu.id, { status: mu.status }).catch((err) => {
            console.error('[plan-store] Failed to update milestone in API:', err)
          })
        }
      }
    }
  },

  /**
   * Merge a node fetched from DB into the store. DB wins — no write-back
   * to the API (avoids circular persistence). Triggers milestone reconciliation
   * and worktree cleanup same as updateNode.
   */
  mergeNodeFromDB: (dbNode: PlanNode) => {
    const prevNode = get().nodes.find((n) => n.id === dbNode.id)
    // DB-authoritative fields: status, executionId, executionOutput, executionError,
    //   executionStartedAt, executionCompletedAt, title, description, endDate, etc.
    // Locally-computed fields (preserved, not overwritten by DB):
    //   - dependencies: derived from edges in the graph, not stored per-node in DB
    // If future graph-computed fields are added to PlanNode (e.g., children,
    // blockingTasks), they must be destructured out here to avoid DB overwrites.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dependencies: _deps, ...dbFields } = dbNode

    if (!prevNode) {
      // Node not in local store (e.g., created by another client in multi-user).
      // Reload the full project plan to get edges too (adding a node without edges
      // would create a disconnected floating node in the graph view).
      if (dbNode.projectId) {
        dataClient.getProjectPlan(dbNode.projectId).then(({ nodes: freshNodes, edges: freshEdges }) => {
          const existingIds = new Set(get().nodes.map((n) => n.id))
          const newNodes = freshNodes.filter((n) => !existingIds.has(n.id))
          const existingEdgeKeys = new Set(get().edges.map((e) => `${e.source}->${e.target}`))
          const newEdges = freshEdges.filter((e) => !existingEdgeKeys.has(`${e.source}->${e.target}`))
          if (newNodes.length > 0 || newEdges.length > 0) {
            set({
              nodes: [...get().nodes, ...newNodes],
              edges: [...get().edges, ...newEdges],
            })
          }
        }).catch((err) => {
          console.error('[plan-store] Failed to reload project plan for new node:', err)
        })
      }
      return // skip milestone reconciliation — will run on next merge after reload
    } else {
      const nextNodes = get().nodes.map((n) =>
        n.id === dbNode.id ? { ...n, ...dbFields } : n
      )
      set({ nodes: nextNodes })
    }

    // Trigger worktree cleanup when task is completed or pruned
    if (dbNode.status === 'completed' || dbNode.status === 'pruned') {
      if (dbNode.executionId) {
        cleanupWorktree(dbNode.executionId, dbNode.id)
      }
    }

    // Auto-complete or revert milestone nodes
    if (prevNode && prevNode.status !== dbNode.status) {
      const milestoneUpdates = computeMilestoneUpdates(dbNode.id, get().nodes, get().edges)
      if (milestoneUpdates.length > 0) {
        const updateMap = new Map(milestoneUpdates.map((mu) => [mu.id, mu.status]))
        const now = new Date()
        const muNodes = get().nodes.map((n) => {
          const newStatus = updateMap.get(n.id)
          return newStatus ? { ...n, status: newStatus, updatedAt: now } : n
        })
        set({ nodes: muNodes })
        for (const mu of milestoneUpdates) {
          console.log(`[plan-store] Auto-updating milestone ${mu.id} → ${mu.status}`)
          dataClient.updateNode(mu.id, { status: mu.status }).catch((err) => {
            console.error('[plan-store] Failed to update milestone in API:', err)
          })
        }
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
    dataClient.deleteEdge(edgeToRemove.id).catch((err) => {
      console.error('[plan-store] Failed to delete edge from API:', err)
    })
  },

  setProjectPlan: (projectId, newNodes, newEdges) => {
    console.log(`[plan-store] setProjectPlan called: projectId=${projectId}, ${newNodes.length} nodes, ${newEdges.length} edges`)
    // Always replace the project's plan — the agent outputs the complete updated plan each time.
    // Numbers are assigned server-side — add optimistically without numbers
    const otherNodes = get().nodes.filter((n) => n.projectId !== projectId)
    const otherEdges = get().edges.filter((e) => {
      const nodeIds = new Set(get().nodes.filter((n) => n.projectId === projectId).map((n) => n.id))
      return !nodeIds.has(e.source) && !nodeIds.has(e.target)
    })
    // Deduplicate new nodes by id (keep last occurrence — latest data wins)
    const seenNodeIds = new Set<string>()
    const dedupedNewNodes: typeof newNodes = []
    for (let i = newNodes.length - 1; i >= 0; i--) {
      if (!seenNodeIds.has(newNodes[i].id)) {
        seenNodeIds.add(newNodes[i].id)
        dedupedNewNodes.unshift(newNodes[i])
      }
    }
    // Deduplicate new edges by source→target
    const seen = new Set<string>()
    const dedupedNewEdges = newEdges.filter((e) => {
      const key = `${e.source}->${e.target}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const nextNodes = [...otherNodes, ...dedupedNewNodes]
    const nextEdges = [...otherEdges, ...dedupedNewEdges]
    console.log(`[plan-store] Updating store: ${nextNodes.length} total nodes (${otherNodes.length} existing + ${dedupedNewNodes.length} new)`)
    set({ nodes: nextNodes, edges: nextEdges })
    // Mark all new nodes as pending save
    const newNodeIds = new Set(dedupedNewNodes.map((n) => n.id))
    for (const n of dedupedNewNodes) pendingSaveNodeIds.add(n.id)
    // Retry API save to prevent data loss on reload.
    // Read the latest node state at save-time so positions from reorganizeProject are included.
    retryAsync(
      async () => {
        const latestNodes = get().nodes.filter((n) => newNodeIds.has(n.id))
        const numbers = await dataClient.setProjectPlan(projectId, latestNodes, dedupedNewEdges)
        // Merge server-assigned numbers into local nodes
        if (Object.keys(numbers).length > 0) {
          const updated = get().nodes.map((n) => {
            const num = numbers[n.id]
            return num != null ? { ...n, number: num } : n
          })
          set({ nodes: updated })
        }
      },
      `Save project plan ${projectId}`,
      7,    // maxRetries — aggressive: plan save is the critical persistence path
      2000, // baseDelayMs — 2s, 4s, 8s, 16s, 32s, 64s, 128s (~4 min total)
    ).then(() => {
      for (const id of newNodeIds) pendingSaveNodeIds.delete(id)
    }).catch(() => {
      // Keep node IDs in pendingSaveNodeIds so position updates remain deferred
      // until a future save succeeds. The toast already warned the user.
    })
  },

  removeProjectPlan: (projectId) => {
    const allNodes = get().nodes
    const allEdges = get().edges
    const projectNodeIds = new Set(allNodes.filter((n) => n.projectId === projectId).map((n) => n.id))

    const nextNodes = allNodes.filter((n) => n.projectId !== projectId)
    const nextEdges = allEdges.filter((e) => !projectNodeIds.has(e.source) && !projectNodeIds.has(e.target))
    set({ nodes: nextNodes, edges: nextEdges })

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
    // Exclude milestones from layout — they're hidden in the graph view and
    // edge bridging connects tasks through them. Including them would leave gaps.
    const projectNodes = allNodes.filter((n) => n.projectId === projectId && isLive(n) && n.type !== "milestone")
    const nodeIds = new Set(projectNodes.map((n) => n.id))
    // Include bridge edges: if A→M→B where M is a milestone, create A→B
    const allProjectNodeIds = new Set(allNodes.filter((n) => n.projectId === projectId && isLive(n)).map((n) => n.id))
    const allProjectEdges = allEdges.filter((e) => allProjectNodeIds.has(e.source) || allProjectNodeIds.has(e.target))
    const directEdges = allProjectEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    const milestoneIds = new Set(allNodes.filter((n) => n.projectId === projectId && isLive(n) && n.type === "milestone").map((n) => n.id))
    const bridgeEdges: typeof directEdges = []
    if (milestoneIds.size > 0) {
      const inMap = new Map<string, string[]>()
      const outMap = new Map<string, string[]>()
      for (const e of allProjectEdges) {
        if (milestoneIds.has(e.target)) {
          const arr = inMap.get(e.target) ?? []; arr.push(e.source); inMap.set(e.target, arr)
        }
        if (milestoneIds.has(e.source)) {
          const arr = outMap.get(e.source) ?? []; arr.push(e.target); outMap.set(e.source, arr)
        }
      }
      for (const mId of milestoneIds) {
        const sources = (inMap.get(mId) ?? []).filter((s) => nodeIds.has(s))
        const targets = (outMap.get(mId) ?? []).filter((t) => nodeIds.has(t))
        for (const s of sources) {
          for (const t of targets) {
            bridgeEdges.push({ id: `layout-bridge-${s}-${t}`, source: s, target: t, type: "dependency" })
          }
        }
      }
    }
    const seen = new Set<string>()
    const projectEdges = [...directEdges, ...bridgeEdges].filter((e) => {
      const key = `${e.source}->${e.target}`; if (seen.has(key)) return false; seen.add(key); return true
    })

    const positions = layoutGraph(projectNodes, projectEdges)

    const nextNodes = allNodes.map((n) => {
      const newPos = positions.get(n.id)
      return newPos ? { ...n, position: newPos, updatedAt: new Date() } : n
    })
    set({ nodes: nextNodes })

    // Sync position updates to API — skip nodes whose initial save is still in-flight
    for (const [nodeId, pos] of positions) {
      if (pendingSaveNodeIds.has(nodeId)) continue
      dataClient.updateNode(nodeId, { position: pos }).catch((err) => {
        console.error(`[plan-store] Failed to update position for node ${nodeId}:`, err)
      })
    }
  },

  markNodesAsUpdating: (nodeIds: string[]) => {
    if (nodeIds.length === 0) return
    // Clear any pending timer to prevent a stale timeout from clearing
    // a newer batch of IDs prematurely (race condition).
    if (markNodesTimer !== undefined) clearTimeout(markNodesTimer)
    set({ recentlyUpdatedNodeIds: new Set(nodeIds) })
    markNodesTimer = setTimeout(() => {
      markNodesTimer = undefined
      set({ recentlyUpdatedNodeIds: new Set() })
    }, 2000) as unknown as number
  },

  resetNode: async (nodeId, projectId) => {
    // Capture executionId before reset so we can clean up all associated state
    const oldNode = get().nodes.find((n) => n.id === nodeId)
    const oldExecutionId = oldNode?.executionId

    const { resetTask } = await import("@/lib/api-client")
    const result = await resetTask(nodeId, projectId)
    if (result.success) {
      // Clean up all Zustand state for this node across all stores
      const { cleanupNodeZustandState } = await import("@/stores/execution-store")
      await cleanupNodeZustandState(nodeId, oldExecutionId)

      // Optimistically update local state
      const nextNodes = get().nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              status: 'planned' as const,
              prUrl: undefined,
              prNumber: undefined,
              branchName: undefined,
              executionId: undefined,
              executionOutput: undefined,
              executionError: undefined,
              executionStartedAt: undefined,
              executionCompletedAt: undefined,
              updatedAt: new Date(),
            }
          : n,
      )

      // Also revert milestones that depended on this task
      const milestoneUpdates = computeMilestoneUpdates(nodeId, nextNodes, get().edges)
      const finalNodes = milestoneUpdates.length > 0
        ? nextNodes.map((n) => {
            const update = milestoneUpdates.find((u) => u.id === n.id)
            return update ? { ...n, status: update.status, updatedAt: new Date() } : n
          })
        : nextNodes

      set({ nodes: finalNodes })

      // Persist milestone reverts to API
      for (const { id, status } of milestoneUpdates) {
        dataClient.updateNode(id, { status }).catch((err) => {
          console.error('[plan-store] Failed to revert milestone in API:', err)
        })
      }
    }
    return result
  },

  archiveProjectForReplan: (projectId) => {
    const liveNodes = get().nodes.filter((n) => isLive(n) && n.projectId === projectId)
    const nodeIds = liveNodes.map((n) => n.id)
    const idSet = new Set(nodeIds)

    if (nodeIds.length === 0) return []

    const now = new Date()
    const actionId = crypto.randomUUID()
    const nextNodes = get().nodes.map((n) =>
      idSet.has(n.id) ? { ...n, deletedAt: now, deletionActionId: actionId, updatedAt: now } : n
    )
    const nextEdges = get().edges.map((e) =>
      (idSet.has(e.source) || idSet.has(e.target)) && isLive(e)
        ? { ...e, deletedAt: now, deletionActionId: actionId }
        : e
    )
    set({ nodes: nextNodes, edges: nextEdges })

    // Persist soft-deletes asynchronously
    for (const id of nodeIds) {
      dataClient.updateNode(id, { deletedAt: now, deletionActionId: actionId }).catch((err) => {
        console.error('[plan-store] Failed to soft-delete node in API:', err)
      })
    }

    return nodeIds
  },
}))
