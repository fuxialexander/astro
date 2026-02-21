import type { PlanNode, PlanEdge } from "@/types"

export const NODE_WIDTH = 180
export const NODE_HEIGHT = 44
const MILESTONE_WIDTH = 200
// const MILESTONE_HEIGHT = 40
const VERTICAL_GAP = 60
const HORIZONTAL_GAP = 40

/**
 * Check if a proposed position overlaps with any existing node.
 */
function overlapsAny(
  x: number,
  y: number,
  allNodes: PlanNode[],
): boolean {
  return allNodes.some((n) => {
    // Skip nodes without positions
    if (!n.position) return false
    const w = n.type === "milestone" ? 200 : NODE_WIDTH
    const h = n.type === "milestone" ? 40 : NODE_HEIGHT
    return (
      x < n.position.x + w + HORIZONTAL_GAP &&
      x + NODE_WIDTH + HORIZONTAL_GAP > n.position.x &&
      y < n.position.y + h + VERTICAL_GAP / 2 &&
      y + NODE_HEIGHT + VERTICAL_GAP / 2 > n.position.y
    )
  })
}

/**
 * Calculate a position for a new child node below the given parent.
 * Offsets horizontally if siblings already exist at that level,
 * then shifts further right if the position overlaps any existing node.
 */
export function calculateChildPosition(
  parentNode: PlanNode,
  allNodes: PlanNode[],
  allEdges: PlanEdge[]
): { x: number; y: number } {
  // If parent has no position, return default
  if (!parentNode.position) {
    return { x: 0, y: 0 }
  }

  // Find existing children of this parent
  const childIds = new Set(
    allEdges.filter((e) => e.source === parentNode.id).map((e) => e.target)
  )
  const childNodes = allNodes.filter((n) => childIds.has(n.id) && n.position)

  const baseY = parentNode.position.y + NODE_HEIGHT + VERTICAL_GAP

  let x: number
  if (childNodes.length === 0) {
    x = parentNode.position.x
  } else {
    const maxX = Math.max(...childNodes.map((n) => n.position.x))
    x = maxX + NODE_WIDTH + HORIZONTAL_GAP
  }

  // Shift right until clear of all existing nodes (max 20 attempts)
  for (let i = 0; i < 20 && overlapsAny(x, baseY, allNodes); i++) {
    x += NODE_WIDTH + HORIZONTAL_GAP
  }

  return { x, y: baseY }
}

/**
 * Auto-layout a set of nodes and edges as a top-to-bottom hierarchy.
 * Uses topological sort to assign ranks, then arranges nodes to prefer
 * vertical distribution for dependent nodes (showing clear sequential flow)
 * while keeping independent nodes horizontal.
 * Returns a map of nodeId → new position.
 */
export function layoutGraph(
  nodes: PlanNode[],
  edges: PlanEdge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map()

  const nodeIds = new Set(nodes.map((n) => n.id))
  const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

  // Build adjacency lists
  const children = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const n of nodes) {
    children.set(n.id, [])
    inDegree.set(n.id, 0)
  }
  for (const e of validEdges) {
    children.get(e.source)!.push(e.target)
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  }

  // Topological sort to assign ranks (BFS from roots)
  const rank = new Map<string, number>()
  const queue: string[] = []
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      queue.push(n.id)
      rank.set(n.id, 0)
    }
  }

  let head = 0
  while (head < queue.length) {
    const id = queue[head++]
    const r = rank.get(id) ?? 0
    for (const child of children.get(id) ?? []) {
      const existing = rank.get(child)
      // Assign deepest rank (longest path)
      if (existing === undefined || r + 1 > existing) {
        rank.set(child, r + 1)
      }
      const newIn = (inDegree.get(child) ?? 1) - 1
      inDegree.set(child, newIn)
      if (newIn === 0) {
        queue.push(child)
      }
    }
  }

  // Handle any unranked nodes (cycles or disconnected)
  for (const n of nodes) {
    if (!rank.has(n.id)) {
      rank.set(n.id, 0)
    }
  }

  // Group nodes by rank
  const ranks = new Map<number, PlanNode[]>()
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0
    if (!ranks.has(r)) ranks.set(r, [])
    ranks.get(r)!.push(n)
  }

  // Identify dependency chains: nodes that have exactly one child and that child has exactly one parent
  // These form linear chains that should be in the same column
  const chainColumn = new Map<string, number>() // nodeId → column index
  let nextColumn = 0

  // Assign columns to nodes
  const assignedToColumn = new Set<string>()

  // Process ranks top-down to assign columns
  const maxRank = Math.max(...ranks.keys())

  for (let r = 0; r <= maxRank; r++) {
    const row = ranks.get(r) ?? []

    for (const node of row) {
      if (assignedToColumn.has(node.id)) continue

      const nodeInDegree = inDegree.get(node.id) ?? 0

      // If this node has a parent that assigned it a column, use that
      let assignedColumn: number | undefined
      for (const [nodeId, col] of chainColumn) {
        const nodeChildrenList = children.get(nodeId) ?? []
        if (nodeChildrenList.includes(node.id)) {
          // Check if this is a linear chain (parent has only one child, this node has only one parent)
          if (nodeChildrenList.length === 1 && nodeInDegree === 1) {
            assignedColumn = col
            break
          }
        }
      }

      if (assignedColumn === undefined) {
        assignedColumn = nextColumn++
      }

      chainColumn.set(node.id, assignedColumn)
      assignedToColumn.add(node.id)
    }
  }

  // Assign positions based on rank and column
  const positions = new Map<string, { x: number; y: number }>()
  const margin = 40
  const columnWidth = NODE_WIDTH + HORIZONTAL_GAP

  for (let r = 0; r <= maxRank; r++) {
    const row = ranks.get(r)
    if (!row) continue

    const y = margin + r * (NODE_HEIGHT + VERTICAL_GAP)

    // Sort nodes by column for consistent left-to-right ordering
    row.sort((a, b) => {
      const colA = chainColumn.get(a.id) ?? 0
      const colB = chainColumn.get(b.id) ?? 0
      return colA - colB
    })

    for (const n of row) {
      const col = chainColumn.get(n.id) ?? 0
      const x = margin + col * columnWidth
      positions.set(n.id, { x, y })
    }
  }

  // Second pass: center parents above their children
  for (let r = maxRank; r >= 0; r--) {
    const row = ranks.get(r)
    if (!row) continue

    for (const n of row) {
      const childList = children.get(n.id) ?? []
      if (childList.length === 0) continue

      const childPositions = childList
        .map((cid) => positions.get(cid))
        .filter(Boolean) as { x: number; y: number }[]

      if (childPositions.length === 0) continue

      const childWidths = childList.map((cid) => {
        const cn = nodes.find((nd) => nd.id === cid)
        return cn?.type === "milestone" ? MILESTONE_WIDTH : NODE_WIDTH
      })

      // Center of children span
      const leftmost = Math.min(...childPositions.map((p) => p.x))
      const rightmost = Math.max(
        ...childPositions.map((p, i) => p.x + childWidths[i])
      )
      const centerX = (leftmost + rightmost) / 2
      const parentW = n.type === "milestone" ? MILESTONE_WIDTH : NODE_WIDTH
      const pos = positions.get(n.id)
      if (pos) {
        pos.x = centerX - parentW / 2
      }
    }
  }

  // Final pass: fix overlaps within each rank
  for (let r = 0; r <= maxRank; r++) {
    const row = ranks.get(r)
    if (!row || row.length <= 1) continue

    // Sort by current x position
    row.sort((a, b) => (positions.get(a.id)?.x ?? 0) - (positions.get(b.id)?.x ?? 0))

    for (let i = 1; i < row.length; i++) {
      const prev = positions.get(row[i - 1].id)!
      const curr = positions.get(row[i].id)!
      const prevW = row[i - 1].type === "milestone" ? MILESTONE_WIDTH : NODE_WIDTH
      const minX = prev.x + prevW + HORIZONTAL_GAP
      if (curr.x < minX) {
        curr.x = minX
      }
    }
  }

  return positions
}

