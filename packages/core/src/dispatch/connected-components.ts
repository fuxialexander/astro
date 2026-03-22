/**
 * Connected Component Analysis for Delivery Branches
 *
 * Computes connected components of the plan graph to determine which tasks
 * share a delivery branch. Each connected component gets its own delivery
 * branch and produces its own PR to the base branch.
 *
 * The graph is treated as undirected for connectivity. Connections include:
 * - Dependency edges (plan_edges type='dependency')
 * - Branch edges (plan_edges type='branch')
 * - Milestone containment (plan_nodes.milestoneId)
 * - node.dependencies[] array (defensive, same ground as edges)
 *
 * Uses Union-Find (disjoint set) for O(n * alpha(n)) performance.
 */

import type { PlanNode, PlanEdge } from '../types.js'

// ============================================================================
// Union-Find Data Structure
// ============================================================================

/**
 * Disjoint-set (Union-Find) with path compression and union by rank.
 */
export class UnionFind {
  private parent: Map<string, string>
  private rank: Map<string, number>

  constructor(ids: string[]) {
    this.parent = new Map()
    this.rank = new Map()
    for (const id of ids) {
      this.parent.set(id, id)
      this.rank.set(id, 0)
    }
  }

  /** Find the root representative of the set containing `x`. */
  find(x: string): string {
    let root = x
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!
    }
    // Path compression
    let current = x
    while (current !== root) {
      const next = this.parent.get(current)!
      this.parent.set(current, root)
      current = next
    }
    return root
  }

  /** Merge the sets containing `a` and `b`. Returns true if they were separate. */
  union(a: string, b: string): boolean {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return false

    const rankA = this.rank.get(rootA) ?? 0
    const rankB = this.rank.get(rootB) ?? 0

    if (rankA < rankB) {
      this.parent.set(rootA, rootB)
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA)
    } else {
      this.parent.set(rootB, rootA)
      this.rank.set(rootA, rankA + 1)
    }
    return true
  }

  /** Check if `a` and `b` are in the same set. */
  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b)
  }

  /** Whether `id` is a known element. */
  has(id: string): boolean {
    return this.parent.has(id)
  }

  /** Get all components as a map of root → member IDs. */
  getComponents(): Map<string, string[]> {
    const components = new Map<string, string[]>()
    for (const id of this.parent.keys()) {
      const root = this.find(id)
      if (!components.has(root)) {
        components.set(root, [])
      }
      components.get(root)!.push(id)
    }
    return components
  }
}

// ============================================================================
// Connected Component Computation
// ============================================================================

/** A connected component of the plan graph. */
export interface PlanComponent {
  /** Stable ID — the root node ID from Union-Find (deterministic for the same graph). */
  id: string
  /** All node IDs in this component (tasks, milestones, branches, etc.). */
  nodeIds: string[]
  /** Only the executable task node IDs (type='task'). */
  taskIds: string[]
  /** Whether this component has exactly one executable task. */
  isSingleton: boolean
}

/**
 * Compute connected components of a plan graph.
 *
 * Filters out pruned nodes before computing connectivity.
 * Milestone nodes participate in connectivity but are not counted as executable tasks.
 *
 * @param nodes - All plan nodes (including milestones, pruned, etc.)
 * @param edges - All plan edges (dependency + branch)
 * @returns Array of connected components, each with node IDs and task IDs
 */
export function computeConnectedComponents(
  nodes: PlanNode[],
  edges: PlanEdge[],
): PlanComponent[] {
  // Filter out pruned nodes and soft-deleted nodes
  const activeNodes = nodes.filter(
    (n) => n.status !== 'pruned' && !n.deletedAt
  )
  if (activeNodes.length === 0) return []

  const nodeIds = activeNodes.map((n) => n.id)
  const nodeIdSet = new Set(nodeIds)
  const uf = new UnionFind(nodeIds)

  // 1. Dependency + branch edges (treat as undirected)
  for (const edge of edges) {
    if (edge.deletedAt) continue
    if (nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)) {
      uf.union(edge.source, edge.target)
    }
  }

  // 2. Milestone containment: task.milestoneId → milestone node
  for (const node of activeNodes) {
    if (node.milestoneId && nodeIdSet.has(node.milestoneId)) {
      uf.union(node.id, node.milestoneId)
    }
  }

  // 3. node.dependencies[] array (defensive — covers same ground as edges
  //    but handles cases where edges table is out of sync)
  for (const node of activeNodes) {
    if (node.dependencies) {
      for (const depId of node.dependencies) {
        if (nodeIdSet.has(depId)) {
          uf.union(node.id, depId)
        }
      }
    }
  }

  // Group by component
  const rawComponents = uf.getComponents()
  const components: PlanComponent[] = []

  for (const [rootId, memberIds] of rawComponents) {
    const taskIds = memberIds.filter((id) => {
      const node = activeNodes.find((n) => n.id === id)
      return node?.type === 'task'
    })

    // Skip components with no executable tasks (e.g., standalone milestones)
    if (taskIds.length === 0) continue

    components.push({
      id: rootId,
      nodeIds: memberIds,
      taskIds,
      isSingleton: taskIds.length === 1,
    })
  }

  // Sort components deterministically by lowest task number, then by first task ID
  components.sort((a, b) => {
    const aMinNumber = Math.min(
      ...a.taskIds.map((id) => nodes.find((n) => n.id === id)?.number ?? Number.MAX_SAFE_INTEGER)
    )
    const bMinNumber = Math.min(
      ...b.taskIds.map((id) => nodes.find((n) => n.id === id)?.number ?? Number.MAX_SAFE_INTEGER)
    )
    if (aMinNumber !== bMinNumber) return aMinNumber - bMinNumber
    return a.taskIds[0].localeCompare(b.taskIds[0])
  })

  return components
}

// ============================================================================
// Structural Change Detection (for Re-planning)
// ============================================================================

/** Describes a delivery branch record (from the database). */
export interface DeliveryBranchRecord {
  id: string
  branchName: string
  nodeIds: string[]
  isSingleton: boolean
  status: 'active' | 'pr_created' | 'merged' | 'obsolete'
}

/** Actions needed to reconcile delivery branches after re-planning. */
export interface DeliveryBranchReconciliation {
  /** Delivery branches that remain unchanged. */
  keep: Array<{
    branch: DeliveryBranchRecord
    /** Updated node IDs (may have gained unexecuted tasks). */
    newNodeIds: string[]
  }>
  /** New components that need fresh delivery branches. */
  create: Array<{
    component: PlanComponent
  }>
  /** Components that require restart (executed tasks split/merged across branches). */
  restart: Array<{
    /** Delivery branches that must be closed. */
    affectedBranches: DeliveryBranchRecord[]
    /** The new component(s) after restructuring. */
    newComponents: PlanComponent[]
    /** Reason for restart. */
    reason: 'split' | 'merge'
  }>
}

/**
 * Check which tasks on a delivery branch have been executed.
 * A task is "executed" if its status is completed, auto_verified, or in_progress.
 */
function getExecutedTaskIds(
  branchNodeIds: string[],
  nodes: PlanNode[],
): string[] {
  const executedStatuses: PlanNode['status'][] = [
    'completed',
    'auto_verified',
    'in_progress',
    'dispatched',
    'awaiting_judgment',
    'awaiting_approval',
  ]
  return branchNodeIds.filter((id) => {
    const node = nodes.find((n) => n.id === id)
    return node && executedStatuses.includes(node.status)
  })
}

/**
 * Detect structural changes between existing delivery branches and new components.
 * Returns a reconciliation plan describing what needs to happen.
 *
 * Rules:
 * - Unexecuted tasks can be freely reassigned between components.
 * - Executed tasks on the same delivery branch cannot be separated (commits co-mingled).
 * - If a new component includes executed tasks from multiple delivery branches → restart (merge).
 * - If executed tasks from one delivery branch end up in different new components → restart (split).
 */
export function detectStructuralChanges(
  nodes: PlanNode[],
  edges: PlanEdge[],
  existingBranches: DeliveryBranchRecord[],
): DeliveryBranchReconciliation {
  const newComponents = computeConnectedComponents(nodes, edges)
  const activeBranches = existingBranches.filter((b) => b.status === 'active' || b.status === 'pr_created')

  const result: DeliveryBranchReconciliation = {
    keep: [],
    create: [],
    restart: [],
  }

  if (activeBranches.length === 0) {
    // No existing branches — all components are new
    for (const comp of newComponents) {
      result.create.push({ component: comp })
    }
    return result
  }

  // Build a map: nodeId → which delivery branch it's on
  const nodeToBranch = new Map<string, DeliveryBranchRecord>()
  for (const branch of activeBranches) {
    for (const nodeId of branch.nodeIds) {
      nodeToBranch.set(nodeId, branch)
    }
  }

  // Build a map: nodeId → which new component it belongs to
  const nodeToComponent = new Map<string, PlanComponent>()
  for (const comp of newComponents) {
    for (const nodeId of comp.nodeIds) {
      nodeToComponent.set(nodeId, comp)
    }
  }

  // Track which branches and components are involved in restarts
  const restartBranches = new Set<string>() // branch IDs
  const restartComponents = new Set<string>() // component IDs

  // Check 1: Do any delivery branches have executed tasks split across different new components?
  for (const branch of activeBranches) {
    const executedIds = getExecutedTaskIds(branch.nodeIds, nodes)
    if (executedIds.length <= 1) continue // Can't split a single executed task

    const componentRoots = new Set<string>()
    for (const id of executedIds) {
      const comp = nodeToComponent.get(id)
      if (comp) componentRoots.add(comp.id)
    }

    if (componentRoots.size > 1) {
      // Executed tasks from this branch are now in different components → restart
      restartBranches.add(branch.id)
      for (const compId of componentRoots) {
        restartComponents.add(compId)
      }
    }
  }

  // Check 2: Do any new components include executed tasks from multiple delivery branches?
  for (const comp of newComponents) {
    const branchesWithExecuted = new Set<string>()
    for (const nodeId of comp.nodeIds) {
      const branch = nodeToBranch.get(nodeId)
      if (!branch) continue
      const executedIds = getExecutedTaskIds([nodeId], nodes)
      if (executedIds.length > 0) {
        branchesWithExecuted.add(branch.id)
      }
    }

    if (branchesWithExecuted.size > 1) {
      // This component merges executed work from multiple branches → restart
      restartComponents.add(comp.id)
      for (const branchId of branchesWithExecuted) {
        restartBranches.add(branchId)
      }
    }
  }

  // Collect restart entries
  if (restartBranches.size > 0 || restartComponents.size > 0) {
    const affectedBranches = activeBranches.filter((b) => restartBranches.has(b.id))
    const affectedComponents = newComponents.filter((c) => restartComponents.has(c.id))

    // Determine reason: "split" if a single branch's executed tasks went to multiple components,
    // "merge" if multiple branches' executed tasks converged into one component.
    const reason = restartBranches.size > 1 ? 'merge' : 'split'
    result.restart.push({
      affectedBranches,
      newComponents: affectedComponents,
      reason,
    })
  }

  // For non-restart components: determine keep vs create.
  // Track which branches have been claimed by a "keep" entry to avoid duplicates.
  const claimedBranches = new Set<string>()

  for (const comp of newComponents) {
    if (restartComponents.has(comp.id)) continue

    // Find which existing branch owns this component's executed tasks
    let ownerBranch: DeliveryBranchRecord | undefined
    for (const nodeId of comp.nodeIds) {
      const branch = nodeToBranch.get(nodeId)
      if (branch && !restartBranches.has(branch.id) && !claimedBranches.has(branch.id)) {
        const executedIds = getExecutedTaskIds([nodeId], nodes)
        if (executedIds.length > 0) {
          ownerBranch = branch
          break
        }
      }
    }

    if (!ownerBranch) {
      // Check if any unclaimed branch (even without executed tasks) owns these nodes
      for (const nodeId of comp.nodeIds) {
        const branch = nodeToBranch.get(nodeId)
        if (branch && !restartBranches.has(branch.id) && !claimedBranches.has(branch.id)) {
          ownerBranch = branch
          break
        }
      }
    }

    if (ownerBranch) {
      claimedBranches.add(ownerBranch.id)
      result.keep.push({
        branch: ownerBranch,
        newNodeIds: comp.nodeIds,
      })
    } else {
      result.create.push({ component: comp })
    }
  }

  return result
}

/**
 * Check if a re-plan requires any delivery branch restarts.
 * Convenience wrapper around detectStructuralChanges.
 */
export function requiresRestart(
  nodes: PlanNode[],
  edges: PlanEdge[],
  existingBranches: DeliveryBranchRecord[],
): boolean {
  const reconciliation = detectStructuralChanges(nodes, edges, existingBranches)
  return reconciliation.restart.length > 0
}
