import type { PlanNode, PlanEdge } from "@/types"

export const NODE_WIDTH = 180
export const NODE_HEIGHT = 44
const MILESTONE_WIDTH = 200
// const MILESTONE_HEIGHT = 40
const VERTICAL_GAP = 60
const HORIZONTAL_GAP = 40
// Gap between parallel branches (wider for visual separation)
const PARALLEL_BRANCH_GAP = 60

/**
 * Represents a detected parallel branch pattern in the graph.
 */
export interface ParallelBranchGroup {
  /** The node that fans out to multiple branches */
  fanOutNodeId: string
  /** The nodes that are the start of each parallel branch */
  branchStartIds: string[]
  /** The node that all branches merge into (if any) */
  fanInNodeId?: string
  /** All nodes that belong to this parallel group (excluding fan-out/fan-in) */
  branchNodeIds: string[]
}

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
 * Calculate a position for a new parent node above the given child.
 * Offsets horizontally if nodes already exist at that level,
 * then shifts further right if the position overlaps any existing node.
 */
export function calculateParentPosition(
  childNode: PlanNode,
  allNodes: PlanNode[],
  allEdges: PlanEdge[]
): { x: number; y: number } {
  // If child has no position, return default
  if (!childNode.position) {
    return { x: 0, y: 0 }
  }

  // Find existing parents of this child (nodes that point to the child)
  const parentIds = new Set(
    allEdges.filter((e) => e.target === childNode.id).map((e) => e.source)
  )
  const parentNodes = allNodes.filter((n) => parentIds.has(n.id) && n.position)

  // Calculate base Y position (above the child node)
  const baseY = childNode.position.y - NODE_HEIGHT - VERTICAL_GAP

  let x: number
  if (parentNodes.length === 0) {
    // No existing parents, start at the child's x position
    x = childNode.position.x
  } else {
    // Offset to the right of existing parents
    const maxX = Math.max(...parentNodes.map((n) => n.position!.x))
    x = maxX + NODE_WIDTH + HORIZONTAL_GAP
  }

  // Shift right until clear of all existing nodes (max 20 attempts)
  for (let i = 0; i < 20 && overlapsAny(x, baseY, allNodes); i++) {
    x += NODE_WIDTH + HORIZONTAL_GAP
  }

  return { x, y: baseY }
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
 * Detect parallel branch patterns in a plan graph.
 *
 * Identifies fan-out/fan-in patterns where a single node has multiple children
 * that are independent (don't depend on each other), forming parallel branches.
 *
 * @param nodes - All nodes in the graph
 * @param edges - All edges in the graph
 * @returns Array of detected parallel branch groups
 */
export function detectParallelBranches(
  nodes: PlanNode[],
  edges: PlanEdge[]
): ParallelBranchGroup[] {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

  // Build adjacency lists
  const children = new Map<string, string[]>()
  const parents = new Map<string, string[]>()

  for (const n of nodes) {
    children.set(n.id, [])
    parents.set(n.id, [])
  }

  for (const e of validEdges) {
    children.get(e.source)!.push(e.target)
    parents.get(e.target)!.push(e.source)
  }

  const groups: ParallelBranchGroup[] = []

  // Find nodes with multiple children (potential fan-out points)
  for (const n of nodes) {
    const childIds = children.get(n.id) ?? []
    if (childIds.length < 2) continue

    // Check if the children are independent (don't depend on each other)
    const childSet = new Set(childIds)
    let areIndependent = true

    for (const childId of childIds) {
      const childParents = parents.get(childId) ?? []
      // If any child has a parent that is another child, they're not independent
      for (const parentId of childParents) {
        if (parentId !== n.id && childSet.has(parentId)) {
          areIndependent = false
          break
        }
      }
      if (!areIndependent) break
    }

    if (!areIndependent) continue

    // Found a fan-out pattern - now trace each branch
    const branchNodes = new Set<string>()

    // BFS to find all nodes in each branch until they merge
    const queue: string[] = [...childIds]
    const visited = new Set<string>()

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId)) continue
      visited.add(nodeId)

      // Check if this node is a merge point (has multiple parents from the branch)
      const nodeParents = parents.get(nodeId) ?? []
      const branchParents = nodeParents.filter((p) => branchNodes.has(p) || childIds.includes(p))

      if (branchParents.length > 1) {
        // This is a potential merge point - don't add to branch nodes
        continue
      }

      branchNodes.add(nodeId)
      const nodeChildren = children.get(nodeId) ?? []
      queue.push(...nodeChildren)
    }

    // Find merge node - a node that depends on multiple branches
    let fanInNodeId: string | undefined
    for (const nodeId of nodeIds) {
      if (branchNodes.has(nodeId)) continue
      if (childIds.includes(nodeId)) continue

      const nodeParents = parents.get(nodeId) ?? []
      const branchParents = nodeParents.filter((p) => branchNodes.has(p))

      if (branchParents.length > 1) {
        fanInNodeId = nodeId
        break
      }
    }

    groups.push({
      fanOutNodeId: n.id,
      branchStartIds: childIds,
      fanInNodeId,
      branchNodeIds: Array.from(branchNodes),
    })
  }

  return groups
}

/**
 * Calculate which branch group a node belongs to.
 *
 * @param nodeId - The node to check
 * @param branchGroups - Detected parallel branch groups
 * @returns The group and branch index, or undefined if not in a branch
 */
export function getNodeBranchInfo(
  nodeId: string,
  branchGroups: ParallelBranchGroup[]
): { groupIndex: number; branchIndex: number } | undefined {
  for (let gi = 0; gi < branchGroups.length; gi++) {
    const group = branchGroups[gi]

    // Check if node is a branch start
    const branchStartIndex = group.branchStartIds.indexOf(nodeId)
    if (branchStartIndex >= 0) {
      return { groupIndex: gi, branchIndex: branchStartIndex }
    }

    // Check if node is in branch nodes and trace back to branch start
    if (group.branchNodeIds.includes(nodeId)) {
      // Find which branch this node belongs to by tracing back
      // For now, use a simple heuristic: assign based on position in branchNodeIds
      // A more accurate approach would trace the path back to branchStartIds
      return { groupIndex: gi, branchIndex: 0 }
    }
  }
  return undefined
}

/**
 * Auto-layout a set of nodes and edges as a top-to-bottom hierarchy.
 * Uses topological sort to assign ranks, then arranges nodes to prefer
 * vertical distribution for dependent nodes (showing clear sequential flow)
 * while keeping independent nodes horizontal.
 *
 * Enhanced to handle parallel branch patterns (fan-out/fan-in) by:
 * 1. Detecting parallel branch groups
 * 2. Assigning consistent columns to nodes in the same branch
 * 3. Centering fan-out and fan-in nodes above/below their branches
 *
 * Returns a map of nodeId → new position.
 */
export function layoutGraph(
  nodes: PlanNode[],
  edges: PlanEdge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map()

  const nodeIds = new Set(nodes.map((n) => n.id))
  const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

  // Detect parallel branch patterns first
  const parallelGroups = detectParallelBranches(nodes, validEdges)

  // Build adjacency lists
  const children = new Map<string, string[]>()
  const parents = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const n of nodes) {
    children.set(n.id, [])
    parents.set(n.id, [])
    inDegree.set(n.id, 0)
  }
  for (const e of validEdges) {
    children.get(e.source)!.push(e.target)
    parents.get(e.target)!.push(e.source)
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

  // Identify dependency chains and parallel branches for column assignment
  const chainColumn = new Map<string, number>() // nodeId → column index
  let nextColumn = 0

  // Pre-assign columns to parallel branch nodes
  // This ensures nodes in the same branch stay in the same column
  for (const group of parallelGroups) {
    const branchColumnStart = nextColumn

    // Assign each branch start to its own column
    for (let bi = 0; bi < group.branchStartIds.length; bi++) {
      const branchStartId = group.branchStartIds[bi]
      chainColumn.set(branchStartId, branchColumnStart + bi)

      // Trace down the branch and assign all descendant nodes to the same column
      const branchQueue: string[] = [branchStartId]
      const visited = new Set<string>()

      while (branchQueue.length > 0) {
        const nodeId = branchQueue.shift()!
        if (visited.has(nodeId)) continue
        visited.add(nodeId)

        // Only follow children that are in this branch's node set
        for (const childId of children.get(nodeId) ?? []) {
          if (group.branchNodeIds.includes(childId) && !chainColumn.has(childId)) {
            // Check if this child only has one path back to branch start
            const childParentList = parents.get(childId) ?? []
            const branchParents = childParentList.filter((p) =>
              visited.has(p) || p === branchStartId
            )

            if (branchParents.length === 1) {
              chainColumn.set(childId, branchColumnStart + bi)
              branchQueue.push(childId)
            }
          }
        }
      }
    }

    nextColumn = branchColumnStart + group.branchStartIds.length
  }

  // Assign columns to remaining nodes
  const assignedToColumn = new Set<string>(chainColumn.keys())

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
  // Use wider spacing for parallel branches for visual clarity
  const columnWidth = NODE_WIDTH + (parallelGroups.length > 0 ? PARALLEL_BRANCH_GAP : HORIZONTAL_GAP)

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

