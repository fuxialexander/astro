import type { PlanNode, PlanEdge } from "@/types"

export const NODE_WIDTH = 164
export const NODE_HEIGHT = 56
const MILESTONE_WIDTH = 240
const MILESTONE_HEIGHT = 36
const VERTICAL_GAP = 60
const HORIZONTAL_GAP = 40
const DEFAULT_NUMBER_SORT = Number.MAX_SAFE_INTEGER

function byExecutionOrder(a: Pick<PlanNode, "number" | "createdAt" | "title" | "id">, b: Pick<PlanNode, "number" | "createdAt" | "title" | "id">): number {
  const numberDiff = (a.number ?? DEFAULT_NUMBER_SORT) - (b.number ?? DEFAULT_NUMBER_SORT)
  if (numberDiff !== 0) return numberDiff

  const createdAtDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  if (createdAtDiff !== 0) return createdAtDiff

  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}

function orderTasksWithinMilestone(
  tasks: PlanNode[],
  edges: PlanEdge[],
): PlanNode[] {
  if (tasks.length <= 1) return tasks

  const taskMap = new Map(tasks.map((task) => [task.id, task]))
  const inDegree = new Map<string, number>()
  const children = new Map<string, Set<string>>()

  for (const task of tasks) {
    inDegree.set(task.id, 0)
    children.set(task.id, new Set())
  }

  const candidateEdges = new Set<string>()

  for (const edge of edges) {
    if (taskMap.has(edge.source) && taskMap.has(edge.target)) {
      candidateEdges.add(`${edge.source}->${edge.target}`)
    }
  }

  for (const task of tasks) {
    for (const dependencyId of task.dependencies) {
      if (taskMap.has(dependencyId)) {
        candidateEdges.add(`${dependencyId}->${task.id}`)
      }
    }
  }

  for (const encodedEdge of candidateEdges) {
    const [sourceId, targetId] = encodedEdge.split("->")
    const childSet = children.get(sourceId)
    if (!childSet || childSet.has(targetId)) continue

    childSet.add(targetId)
    inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1)
  }

  const ready = tasks
    .filter((task) => (inDegree.get(task.id) ?? 0) === 0)
    .sort(byExecutionOrder)
  const ordered: PlanNode[] = []

  while (ready.length > 0) {
    const current = ready.shift()
    if (!current) break

    ordered.push(current)

    for (const childId of children.get(current.id) ?? []) {
      const nextInDegree = (inDegree.get(childId) ?? 0) - 1
      inDegree.set(childId, nextInDegree)

      if (nextInDegree === 0) {
        ready.push(taskMap.get(childId)!)
      }
    }

    ready.sort(byExecutionOrder)
  }

  if (ordered.length === tasks.length) {
    return ordered
  }

  const remaining = tasks
    .filter((task) => !ordered.some((orderedTask) => orderedTask.id === task.id))
    .sort(byExecutionOrder)

  return [...ordered, ...remaining]
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
 * Auto-layout nodes. Dispatches to milestone-column layout when milestones
 * are present, otherwise uses the classic topological layout.
 */
export function layoutGraph(
  nodes: PlanNode[],
  edges: PlanEdge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map()
  const hasMilestones = nodes.some((n) => n.type === "milestone")
  if (hasMilestones) return layoutGraphMilestoneColumns(nodes, edges)
  return layoutGraphTopological(nodes, edges)
}

/**
 * Milestone-column layout: milestones are ranked by topological depth
 * (longest-path from any root in the milestone DAG), so parallel branches
 * share the same rank column and stack vertically instead of being forced
 * side-by-side where edges would cross through intermediate milestones.
 *
 * Within each rank column milestones are sorted by number, and each
 * milestone's tasks stack below it in dependency-aware execution order.
 * Tasks without a milestone go in an "orphan" column on the right.
 */
function layoutGraphMilestoneColumns(
  nodes: PlanNode[],
  edges: PlanEdge[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()

  const milestones = nodes.filter((n) => n.type === "milestone")
  const tasks = nodes.filter((n) => n.type !== "milestone")
  const milestoneSet = new Set(milestones.map((m) => m.id))

  // ── 1. Build milestone-to-milestone DAG and compute topological ranks ──

  // Build a lookup: nodeId → milestoneId (for tasks that belong to a milestone)
  const nodeToMilestone = new Map<string, string>()
  for (const task of tasks) {
    if (task.milestoneId && milestoneSet.has(task.milestoneId)) {
      nodeToMilestone.set(task.id, task.milestoneId)
    }
  }
  // Milestones map to themselves
  for (const m of milestones) {
    nodeToMilestone.set(m.id, m.id)
  }

  // Collect milestone ordering from ALL cross-milestone edges:
  //   - direct milestone→milestone edges
  //   - task(ms-A) → task(ms-B) where ms-A ≠ ms-B
  //   - task(ms-A) → milestone-B
  //   - milestone-A → task(ms-B)
  const msChildren = new Map<string, string[]>()
  const msInDegree = new Map<string, number>()
  const msEdgeSeen = new Set<string>()
  for (const m of milestones) {
    msChildren.set(m.id, [])
    msInDegree.set(m.id, 0)
  }
  for (const e of edges) {
    const srcMs = nodeToMilestone.get(e.source)
    const tgtMs = nodeToMilestone.get(e.target)
    if (srcMs && tgtMs && srcMs !== tgtMs) {
      const key = `${srcMs}->${tgtMs}`
      if (!msEdgeSeen.has(key)) {
        msEdgeSeen.add(key)
        msChildren.get(srcMs)!.push(tgtMs)
        msInDegree.set(tgtMs, (msInDegree.get(tgtMs) ?? 0) + 1)
      }
    }
  }
  // Also infer from task.dependencies (may not have corresponding edge objects)
  for (const task of tasks) {
    const tgtMs = nodeToMilestone.get(task.id)
    if (!tgtMs) continue
    for (const depId of task.dependencies) {
      const srcMs = nodeToMilestone.get(depId)
      if (srcMs && srcMs !== tgtMs) {
        const key = `${srcMs}->${tgtMs}`
        if (!msEdgeSeen.has(key)) {
          msEdgeSeen.add(key)
          msChildren.get(srcMs)!.push(tgtMs)
          msInDegree.set(tgtMs, (msInDegree.get(tgtMs) ?? 0) + 1)
        }
      }
    }
  }

  // Kahn's algorithm — rank = longest path from any root
  const msRank = new Map<string, number>()
  const queue: string[] = []
  for (const m of milestones) {
    if ((msInDegree.get(m.id) ?? 0) === 0) {
      queue.push(m.id)
      msRank.set(m.id, 0)
    }
  }

  let head = 0
  while (head < queue.length) {
    const id = queue[head++]
    const r = msRank.get(id) ?? 0
    for (const child of msChildren.get(id) ?? []) {
      const existing = msRank.get(child)
      if (existing === undefined || r + 1 > existing) {
        msRank.set(child, r + 1)
      }
      const newIn = (msInDegree.get(child) ?? 1) - 1
      msInDegree.set(child, newIn)
      if (newIn === 0) {
        queue.push(child)
      }
    }
  }

  // Handle any unranked milestones (cycles or disconnected)
  for (const m of milestones) {
    if (!msRank.has(m.id)) {
      msRank.set(m.id, 0)
    }
  }

  // Group milestones by rank, sorted by number within each rank
  const rankGroups = new Map<number, PlanNode[]>()
  for (const m of milestones) {
    const r = msRank.get(m.id) ?? 0
    if (!rankGroups.has(r)) rankGroups.set(r, [])
    rankGroups.get(r)!.push(m)
  }
  for (const [, group] of rankGroups) {
    group.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  }

  const sortedRanks = [...rankGroups.keys()].sort((a, b) => a - b)

  // ── 2. Group tasks by milestoneId ──

  const tasksByMilestone = new Map<string, PlanNode[]>()
  const orphanTasks: PlanNode[] = []
  for (const task of tasks) {
    if (task.milestoneId && milestoneSet.has(task.milestoneId)) {
      if (!tasksByMilestone.has(task.milestoneId)) {
        tasksByMilestone.set(task.milestoneId, [])
      }
      tasksByMilestone.get(task.milestoneId)!.push(task)
    } else {
      orphanTasks.push(task)
    }
  }

  // Order tasks within each milestone by dependency flow first, then by execution order.
  for (const [, groupTasks] of tasksByMilestone) {
    const orderedTasks = orderTasksWithinMilestone(groupTasks, edges)
    groupTasks.splice(0, groupTasks.length, ...orderedTasks)
  }

  // ── 3. Layout: each rank is a column (x), milestones stack vertically (y) ──

  const COLUMN_STRIDE = MILESTONE_WIDTH + HORIZONTAL_GAP * 2
  const ROW_HEIGHT = NODE_HEIGHT + VERTICAL_GAP
  const MILESTONE_GROUP_GAP = 40
  const margin = 40
  // Center task nodes under wider milestones
  const taskXOffset = (MILESTONE_WIDTH - NODE_WIDTH) / 2

  let colIndex = 0
  for (const rank of sortedRanks) {
    const group = rankGroups.get(rank)!
    const colX = margin + colIndex * COLUMN_STRIDE
    let cursorY = margin

    for (const milestone of group) {
      const columnTasks = tasksByMilestone.get(milestone.id) ?? []

      // Milestone header
      positions.set(milestone.id, { x: colX, y: cursorY })
      cursorY += MILESTONE_HEIGHT + VERTICAL_GAP

      // Tasks flow downward
      for (const task of columnTasks) {
        positions.set(task.id, {
          x: colX + taskXOffset,
          y: cursorY,
        })
        cursorY += ROW_HEIGHT
      }

      // Gap before next milestone group in the same rank column
      cursorY += MILESTONE_GROUP_GAP
    }

    colIndex++
  }

  // Orphan tasks in a column on the right
  if (orphanTasks.length > 0) {
    orphanTasks.sort(byExecutionOrder)
    const colX = margin + colIndex * COLUMN_STRIDE + taskXOffset
    for (let i = 0; i < orphanTasks.length; i++) {
      positions.set(orphanTasks[i].id, {
        x: colX,
        y: margin + i * ROW_HEIGHT,
      })
    }
  }

  return positions
}

/**
 * Classic topological layout (used when no milestones are present).
 * Uses topological sort to assign ranks, then arranges nodes to prefer
 * vertical distribution for dependent nodes (showing clear sequential flow)
 * while keeping independent nodes horizontal.
 * Isolated nodes (no edges) are packed compactly below the main graph.
 * Returns a map of nodeId → new position.
 */
function layoutGraphTopological(
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

/**
 * Compute optimal source/target handle IDs for an edge based on relative node positions.
 *
 * Returns { sourceHandle, targetHandle } where each is one of:
 *   "right"  / "left"   — horizontal (LR) flow
 *   "bottom" / "top"    — vertical (TB) flow
 *
 * Decision rule:
 *   If the target is primarily below/above the source (|dy| > 1.5·|dx| and |dy| > 30px),
 *   the edge uses vertical handles (bottom→top). Otherwise horizontal (right→left).
 *
 * Visual reference (each box is a node):
 *
 *   Horizontal flow (right→left):          Vertical flow (bottom→top):
 *
 *     ┌─────┐          ┌─────┐              ┌─────┐
 *     │  A  ●──────────●  B  │              │  A  │
 *     └─────┘ right  left └─────┘              └──●──┘  bottom
 *                                                 │
 *                                                 │
 *                                              ┌──●──┐  top
 *                                              │  B  │
 *                                              └─────┘
 */
export function computeEdgeHandles(
  srcPos: { x: number; y: number } | undefined,
  tgtPos: { x: number; y: number } | undefined,
): { sourceHandle: string; targetHandle: string } {
  if (!srcPos || !tgtPos) {
    return { sourceHandle: "right", targetHandle: "left" }
  }

  const dx = tgtPos.x - srcPos.x
  const dy = tgtPos.y - srcPos.y

  // If target is primarily below the source, use vertical handles (bottom→top).
  // For upward back-edges (dy < 0), fall through to horizontal handles (right→left)
  // so bezier curves loop around visually rather than pointing against the flow.
  if (dy > Math.abs(dx) * 1.5 && dy > 30) {
    return {
      sourceHandle: "bottom",
      targetHandle: "top",
    }
  }

  return { sourceHandle: "right", targetHandle: "left" }
}

/**
 * Compute the set of edge IDs that are redundant due to transitivity.
 * An edge (u → v) is redundant if v is reachable from u via at least one
 * other path of length ≥ 2 (i.e. some w exists where u→w and w→*→v).
 *
 * These edges can be hidden in the UI to reduce visual clutter without
 * removing the underlying dependency data.
 */
export function computeRedundantEdgeIds(edges: { id: string; source: string; target: string }[]): Set<string> {
  // Build adjacency list (all edges)
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, [])
    adj.get(e.source)!.push(e.target)
  }

  // BFS reachability from `start`, but skip the direct edge to `skipTarget`
  function reachableWithoutDirect(start: string, skipTarget: string): Set<string> {
    const visited = new Set<string>()
    const queue: string[] = []
    for (const nb of adj.get(start) ?? []) {
      if (nb !== skipTarget && !visited.has(nb)) {
        visited.add(nb)
        queue.push(nb)
      }
    }
    let head = 0
    while (head < queue.length) {
      const cur = queue[head++]
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb)
          queue.push(nb)
        }
      }
    }
    return visited
  }

  const redundant = new Set<string>()
  for (const e of edges) {
    if (reachableWithoutDirect(e.source, e.target).has(e.target)) {
      redundant.add(e.id)
    }
  }
  return redundant
}
