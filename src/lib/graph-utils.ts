import type { PlanNode, PlanEdge } from "@/types"

const NODE_WIDTH = 180
const NODE_HEIGHT = 44
const VERTICAL_GAP = 60
const HORIZONTAL_GAP = 40

/**
 * Calculate a position for a new child node below the given parent.
 * Offsets horizontally if siblings already exist at that level.
 */
export function calculateChildPosition(
  parentNode: PlanNode,
  allNodes: PlanNode[],
  allEdges: PlanEdge[]
): { x: number; y: number } {
  // Find existing children of this parent
  const childIds = new Set(
    allEdges.filter((e) => e.source === parentNode.id).map((e) => e.target)
  )
  const childNodes = allNodes.filter((n) => childIds.has(n.id))

  const baseY = parentNode.position.y + NODE_HEIGHT + VERTICAL_GAP

  if (childNodes.length === 0) {
    // Place directly below parent
    return { x: parentNode.position.x, y: baseY }
  }

  // Find rightmost child and place to the right of it
  const maxX = Math.max(...childNodes.map((n) => n.position.x))
  return { x: maxX + NODE_WIDTH + HORIZONTAL_GAP, y: baseY }
}
