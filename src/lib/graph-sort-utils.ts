import type { PlanNode } from "@/types"

/**
 * Topological sort of plan nodes using Kahn's algorithm.
 * Uses node.dependencies to build the dependency graph.
 * Tie-breaks by node.number for stable ordering.
 * Gracefully appends remaining nodes on cycles.
 */
export function topologicalSortNodes(nodes: PlanNode[]): PlanNode[] {
  if (nodes.length === 0) return []

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const nodeIds = new Set(nodes.map((n) => n.id))

  // Build in-degree map (only count dependencies within our node set)
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>() // source -> targets that depend on it
  for (const n of nodes) {
    inDegree.set(n.id, 0)
    dependents.set(n.id, [])
  }

  for (const n of nodes) {
    let deg = 0
    for (const dep of n.dependencies) {
      if (nodeIds.has(dep)) {
        deg++
        dependents.get(dep)!.push(n.id)
      }
    }
    inDegree.set(n.id, deg)
  }

  // Initialize queue with zero-degree nodes, sorted by number for stability
  const queue: string[] = nodes
    .filter((n) => inDegree.get(n.id) === 0)
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
    .map((n) => n.id)

  const sorted: PlanNode[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)

    const node = nodeMap.get(id)
    if (node) sorted.push(node)

    // Collect newly freed nodes and sort by number for stable tie-breaking
    const freed: PlanNode[] = []
    for (const depId of dependents.get(id) || []) {
      if (visited.has(depId)) continue
      const deg = (inDegree.get(depId) || 1) - 1
      inDegree.set(depId, deg)
      if (deg === 0) {
        const depNode = nodeMap.get(depId)
        if (depNode) freed.push(depNode)
      }
    }
    freed.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
    for (const f of freed) queue.push(f.id)
  }

  // Append any remaining nodes (cycles) sorted by number
  const remaining = nodes
    .filter((n) => !visited.has(n.id))
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
  sorted.push(...remaining)

  return sorted
}
