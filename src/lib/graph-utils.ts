import type { PlanNode, PlanEdge } from "@/types"

export const NODE_WIDTH = 164
export const NODE_HEIGHT = 56
const MILESTONE_WIDTH = 240
const MILESTONE_HEIGHT = 36
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
    const w = n.type === "milestone" ? MILESTONE_WIDTH : NODE_WIDTH
    const h = n.type === "milestone" ? MILESTONE_HEIGHT : NODE_HEIGHT
    return (
      x < n.position.x + w + HORIZONTAL_GAP &&
      x + NODE_WIDTH + HORIZONTAL_GAP > n.position.x &&
      y < n.position.y + h + VERTICAL_GAP / 2 &&
      y + NODE_HEIGHT + VERTICAL_GAP / 2 > n.position.y
    )
  })
}

/**
 * Calculate a position for a new parent node above the given child.
 * Offsets horizontally if nodes already exist at that level,
 * then shifts further right if the position overlaps any existing node.
 */
export function calculateParentPosition(
  childNode: PlanNode,
  allNodes: PlanNode[],
  allEdges: PlanEdge[]
): { x: number; y: number } {
  if (!childNode.position) return { x: 0, y: 0 }

  // Parent is to the LEFT of the child in LR layout
  const baseX = childNode.position.x - NODE_WIDTH - HORIZONTAL_GAP

  // Find existing parents to avoid y overlap
  const parentIds = new Set(
    allEdges.filter((e) => e.target === childNode.id).map((e) => e.source)
  )
  const parentNodes = allNodes.filter((n) => parentIds.has(n.id) && n.position)

  let y: number
  if (parentNodes.length === 0) {
    y = childNode.position.y
  } else {
    const maxY = Math.max(...parentNodes.map((n) => n.position!.y))
    y = maxY + NODE_HEIGHT + VERTICAL_GAP
  }

  for (let i = 0; i < 20 && overlapsAny(baseX, y, allNodes); i++) {
    y += NODE_HEIGHT + VERTICAL_GAP
  }

  return { x: baseX, y }
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
  if (!parentNode.position) return { x: 0, y: 0 }

  // Child is to the RIGHT of the parent in LR layout
  const baseX = parentNode.position.x + NODE_WIDTH + HORIZONTAL_GAP

  // Find existing children to avoid y overlap
  const childIds = new Set(
    allEdges.filter((e) => e.source === parentNode.id).map((e) => e.target)
  )
  const childNodes = allNodes.filter((n) => childIds.has(n.id) && n.position)

  let y: number
  if (childNodes.length === 0) {
    y = parentNode.position.y
  } else {
    const maxY = Math.max(...childNodes.map((n) => n.position.y))
    y = maxY + NODE_HEIGHT + VERTICAL_GAP
  }

  for (let i = 0; i < 20 && overlapsAny(baseX, y, allNodes); i++) {
    y += NODE_HEIGHT + VERTICAL_GAP
  }

  return { x: baseX, y }
}

/**
 * Auto-layout a set of nodes and edges as a top-to-bottom hierarchy.
 * Uses topological sort to assign ranks, then arranges nodes to prefer
 * vertical distribution for dependent nodes (showing clear sequential flow)
 * while keeping independent nodes horizontal.
 * Isolated nodes (no edges) are packed compactly below the main graph.
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

  // Save original in-degree BEFORE the BFS modifies it — needed for chain detection
  const origInDegree = new Map(inDegree)

  // Identify truly isolated nodes (no incoming or outgoing edges within this graph)
  const isolatedIds = new Set<string>(
    nodes
      .filter((n) => origInDegree.get(n.id) === 0 && (children.get(n.id)?.length ?? 0) === 0)
      .map((n) => n.id)
  )

  // Main nodes: exclude isolated ones from the rank/column layout
  const mainNodes = nodes.filter((n) => !isolatedIds.has(n.id))

  // Topological sort to assign ranks (BFS from roots of mainNodes)
  const rank = new Map<string, number>()
  const queue: string[] = []
  for (const n of mainNodes) {
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
      if (isolatedIds.has(child)) continue
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

  // Handle any unranked non-isolated nodes (cycles or disconnected)
  for (const n of mainNodes) {
    if (!rank.has(n.id)) {
      rank.set(n.id, 0)
    }
  }

  // Group main nodes by rank
  const ranks = new Map<number, PlanNode[]>()
  for (const n of mainNodes) {
    const r = rank.get(n.id) ?? 0
    if (!ranks.has(r)) ranks.set(r, [])
    ranks.get(r)!.push(n)
  }

  // Identify dependency chains: nodes that have exactly one child and that child has exactly
  // one parent — these form linear chains that should be in the same column.
  // IMPORTANT: use origInDegree (before BFS) for correct parent-count detection.
  const chainColumn = new Map<string, number>() // nodeId → column index
  let nextColumn = 0
  const assignedToColumn = new Set<string>()

  const maxRank = mainNodes.length > 0 ? Math.max(...mainNodes.map((n) => rank.get(n.id) ?? 0)) : -1

  // Assign columns top-down: linear chains share a column, branching nodes get new columns
  for (let r = 0; r <= maxRank; r++) {
    const row = ranks.get(r) ?? []

    for (const node of row) {
      if (assignedToColumn.has(node.id)) continue

      // Use ORIGINAL in-degree (not the BFS-modified version which is always 0)
      const nodeOrigInDegree = origInDegree.get(node.id) ?? 0

      // If this node has a parent that assigned it a column, inherit it (linear chain)
      let assignedColumn: number | undefined
      for (const [nodeId, col] of chainColumn) {
        const nodeChildrenList = children.get(nodeId) ?? []
        if (nodeChildrenList.includes(node.id)) {
          // Linear chain: parent has only one child AND this node has only one parent
          if (nodeChildrenList.length === 1 && nodeOrigInDegree === 1) {
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

  // Assign positions based on rank (→ x) and column (→ y), left-to-right execution order
  const positions = new Map<string, { x: number; y: number }>()
  const margin = 40
  const rowHeight = NODE_HEIGHT + VERTICAL_GAP

  for (let r = 0; r <= maxRank; r++) {
    const row = ranks.get(r)
    if (!row) continue

    const x = margin + r * (NODE_WIDTH + HORIZONTAL_GAP)

    // Sort nodes by column for consistent top-to-bottom ordering within a rank
    row.sort((a, b) => {
      const colA = chainColumn.get(a.id) ?? 0
      const colB = chainColumn.get(b.id) ?? 0
      return colA - colB
    })

    for (const n of row) {
      const col = chainColumn.get(n.id) ?? 0
      const y = margin + col * rowHeight
      positions.set(n.id, { x, y })
    }
  }

  // Second pass: center parents vertically relative to their children
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

      // Center of children y-span
      const topmost = Math.min(...childPositions.map((p) => p.y))
      const bottommost = Math.max(...childPositions.map((p) => p.y + NODE_HEIGHT))
      const centerY = (topmost + bottommost) / 2
      const pos = positions.get(n.id)
      if (pos) {
        pos.y = centerY - NODE_HEIGHT / 2
      }
    }
  }

  // Final pass: fix y overlaps within each rank
  for (let r = 0; r <= maxRank; r++) {
    const row = ranks.get(r)
    if (!row || row.length <= 1) continue

    // Sort by current y position
    row.sort((a, b) => (positions.get(a.id)?.y ?? 0) - (positions.get(b.id)?.y ?? 0))

    for (let i = 1; i < row.length; i++) {
      const prev = positions.get(row[i - 1].id)!
      const curr = positions.get(row[i].id)!
      const minY = prev.y + NODE_HEIGHT + VERTICAL_GAP
      if (curr.y < minY) {
        curr.y = minY
      }
    }
  }

  // Place isolated nodes in a compact grid to the right of the main graph
  if (isolatedIds.size > 0) {
    let mainMaxX = 0
    let mainMaxY = 0
    for (const pos of positions.values()) {
      mainMaxX = Math.max(mainMaxX, pos.x + NODE_WIDTH)
      mainMaxY = Math.max(mainMaxY, pos.y + NODE_HEIGHT)
    }

    const ISOLATED_ROWS = Math.min(3, isolatedIds.size)
    const isolatedStartX = mainMaxX > 0 ? mainMaxX + HORIZONTAL_GAP * 2 : margin
    const isolatedStartY = margin

    let idx = 0
    for (const id of isolatedIds) {
      const row = idx % ISOLATED_ROWS
      const col = Math.floor(idx / ISOLATED_ROWS)
      positions.set(id, {
        x: isolatedStartX + col * (NODE_WIDTH + HORIZONTAL_GAP),
        y: isolatedStartY + row * rowHeight,
      })
      idx++
    }
  }

  return positions
}

