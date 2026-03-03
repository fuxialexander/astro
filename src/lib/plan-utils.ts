import type { Edge } from "@/types"

/**
 * Check if a node is isolated (has no dependencies or dependents).
 * A node is isolated when no live edge touches it (as source or target).
 *
 * @param nodeId - The node ID to check
 * @param edges - All edges in the plan
 * @param isLive - Function to check if an edge is live (not soft-deleted)
 * @returns true if the node is isolated, false otherwise
 */
export function isNodeIsolated(
  nodeId: string,
  edges: Edge[],
  isLive: (edge: Edge) => boolean
): boolean {
  const liveEdges = edges.filter(isLive)
  return !liveEdges.some((e) => e.source === nodeId || e.target === nodeId)
}
