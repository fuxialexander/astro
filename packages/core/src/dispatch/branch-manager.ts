/**
 * Branch Manager
 *
 * Handles branch-aware operations in the plan graph:
 * - Detecting branches and their downstream nodes
 * - Pruning branches and cancelling associated tasks
 * - Managing branch state transitions
 */

import type { PlanNode, PlanEdge } from '../types.js'
import type {
  BranchPruneRequest,
  BranchPruneResult,
} from './types.js'

/**
 * Branch information
 */
export interface BranchInfo {
  /** Branch point node ID */
  branchPointId: string
  /** All node IDs on this branch */
  branchNodes: string[]
  /** Direct children of the branch point */
  directChildren: string[]
  /** Active tasks on this branch */
  activeTasks: string[]
  /** Is this branch currently pruned? */
  isPruned: boolean
}

/**
 * Branch manager implementation
 */
export class BranchManager {
  /**
   * Find all branches in a plan graph
   */
  findBranches(nodes: PlanNode[], edges: PlanEdge[]): Map<string, BranchInfo> {
    const branches = new Map<string, BranchInfo>()

    // Find branch points (nodes with multiple outgoing branch edges)
    const outgoingBranches = new Map<string, PlanEdge[]>()

    for (const edge of edges) {
      if (edge.type === 'branch') {
        if (!outgoingBranches.has(edge.source)) {
          outgoingBranches.set(edge.source, [])
        }
        outgoingBranches.get(edge.source)!.push(edge)
      }
    }

    // Build branch info for each branch point
    for (const [branchPointId, branchEdges] of outgoingBranches) {
      if (branchEdges.length < 1) continue

      const directChildren = branchEdges.map((e) => e.target)
      const branchNodes = new Set<string>()
      const activeTasks: string[] = []

      // Find all downstream nodes for each branch
      for (const childId of directChildren) {
        const downstream = this.findDownstreamNodes(childId, edges)
        branchNodes.add(childId)
        for (const nodeId of downstream) {
          branchNodes.add(nodeId)
        }
      }

      // Check for active/pruned status
      let isPruned = false
      for (const nodeId of branchNodes) {
        const node = nodes.find((n) => n.id === nodeId)
        if (node) {
          if (node.status === 'pruned') {
            isPruned = true
          }
          if (node.status === 'dispatched' || node.status === 'in_progress') {
            activeTasks.push(nodeId)
          }
        }
      }

      branches.set(branchPointId, {
        branchPointId,
        branchNodes: Array.from(branchNodes),
        directChildren,
        activeTasks,
        isPruned,
      })
    }

    return branches
  }

  /**
   * Find all downstream nodes from a starting node
   */
  findDownstreamNodes(
    startNodeId: string,
    edges: PlanEdge[],
    visited = new Set<string>()
  ): string[] {
    if (visited.has(startNodeId)) return []
    visited.add(startNodeId)

    const downstream: string[] = []

    for (const edge of edges) {
      if (edge.source === startNodeId) {
        downstream.push(edge.target)
        downstream.push(...this.findDownstreamNodes(edge.target, edges, visited))
      }
    }

    return downstream
  }

  /**
   * Find all nodes on a specific branch (from a branch point)
   */
  findBranchNodes(
    branchPointId: string,
    branchChildId: string,
    edges: PlanEdge[]
  ): string[] {
    const nodes = new Set<string>()
    nodes.add(branchChildId)

    const downstream = this.findDownstreamNodes(branchChildId, edges)
    for (const nodeId of downstream) {
      nodes.add(nodeId)
    }

    return Array.from(nodes)
  }

  /**
   * Find nodes that should be cancelled when pruning a branch
   */
  findNodesToCancel(
    branchNodeIds: string[],
    nodes: PlanNode[]
  ): string[] {
    const toCancel: string[] = []

    for (const nodeId of branchNodeIds) {
      const node = nodes.find((n) => n.id === nodeId)
      if (node) {
        // Cancel if actively executing
        if (node.status === 'dispatched' || node.status === 'in_progress') {
          toCancel.push(nodeId)
        }
      }
    }

    return toCancel
  }

  /**
   * Find nodes that should be marked as pruned
   */
  findNodesToPrune(
    branchNodeIds: string[],
    nodes: PlanNode[]
  ): string[] {
    const toPrune: string[] = []

    for (const nodeId of branchNodeIds) {
      const node = nodes.find((n) => n.id === nodeId)
      if (node) {
        // Prune if not already completed or pruned
        const excludeStatuses: PlanNode['status'][] = ['completed', 'auto_verified', 'pruned']
        if (!excludeStatuses.includes(node.status)) {
          toPrune.push(nodeId)
        }
      }
    }

    return toPrune
  }

  /**
   * Check if a node is on a pruned branch
   */
  isOnPrunedBranch(
    nodeId: string,
    nodes: PlanNode[],
    edges: PlanEdge[]
  ): boolean {
    // Walk up the graph to check for pruned ancestors
    const visited = new Set<string>()
    const toVisit = [nodeId]

    while (toVisit.length > 0) {
      const currentId = toVisit.pop()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      const node = nodes.find((n) => n.id === currentId)
      if (node?.status === 'pruned') {
        return true
      }

      // Add parents to visit
      for (const edge of edges) {
        if (edge.target === currentId) {
          toVisit.push(edge.source)
        }
      }
    }

    return false
  }

  /**
   * Get the branch ID for a node (if on a branch)
   */
  getBranchId(
    nodeId: string,
    edges: PlanEdge[]
  ): string | undefined {
    // Walk up to find the branch point
    const visited = new Set<string>()
    const toVisit = [nodeId]

    while (toVisit.length > 0) {
      const currentId = toVisit.pop()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      for (const edge of edges) {
        if (edge.target === currentId && edge.type === 'branch') {
          return edge.source
        }
        if (edge.target === currentId) {
          toVisit.push(edge.source)
        }
      }
    }

    return undefined
  }

  /**
   * Find sibling branches (other branches from the same branch point)
   */
  findSiblingBranches(
    nodeId: string,
    edges: PlanEdge[]
  ): string[] {
    const branchId = this.getBranchId(nodeId, edges)
    if (!branchId) return []

    // Find all branch edges from this branch point
    const siblings: string[] = []
    for (const edge of edges) {
      if (edge.source === branchId && edge.type === 'branch' && edge.target !== nodeId) {
        siblings.push(edge.target)
      }
    }

    return siblings
  }

  /**
   * Build prune result structure
   */
  buildPruneResult(
    request: BranchPruneRequest,
    branchNodes: string[],
    cancelledTasks: string[],
    error?: string
  ): BranchPruneResult {
    if (error) {
      return {
        success: false,
        prunedNodes: [],
        cancelledTasks: [],
        error,
      }
    }

    return {
      success: true,
      prunedNodes: branchNodes,
      cancelledTasks,
    }
  }

  /**
   * Validate a prune request
   */
  validatePruneRequest(
    request: BranchPruneRequest,
    nodes: PlanNode[],
    edges: PlanEdge[]
  ): { valid: boolean; error?: string } {
    // Check that branch node exists
    const branchNode = nodes.find((n) => n.id === request.branchNodeId)
    if (!branchNode) {
      return { valid: false, error: `Branch node ${request.branchNodeId} not found` }
    }

    // Check that it's actually a branch point
    const hasBranchEdges = edges.some(
      (e) => e.source === request.branchNodeId && e.type === 'branch'
    )
    if (!hasBranchEdges) {
      return { valid: false, error: `Node ${request.branchNodeId} is not a branch point` }
    }

    // Check that the branch isn't already fully pruned
    const branches = this.findBranches(nodes, edges)
    const branchInfo = branches.get(request.branchNodeId)
    if (branchInfo?.isPruned) {
      return { valid: false, error: 'Branch is already pruned' }
    }

    return { valid: true }
  }
}

/**
 * Create a branch manager instance
 */
export function createBranchManager(): BranchManager {
  return new BranchManager()
}
