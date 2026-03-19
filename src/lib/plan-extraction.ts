import type { PlanNode, PlanEdge } from '@/types'

/** Extract projectId from a `plan-<projectId>` node ID, or return null. */
export function planNodeIdToProjectId(nodeId: string): string | null {
  return nodeId.startsWith('plan-') ? nodeId.slice(5) : null
}

/**
 * Export shape returned by planNodesToExportJson.
 */
export interface PlanExportJson {
  projectName: string
  nodes: Array<{
    id: string
    type: string
    title: string
    description: string
    status: string
    parentId: string | null
    dependencies: string[]
    verification: string
    startDate?: string
    endDate?: string
    priority?: string
    estimate?: string
    dueDate?: string
    milestoneId?: string
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    type: string
  }>
}

/**
 * Converts live PlanNode[]/PlanEdge[] into a clean export JSON
 * with sequential IDs (n1, n2 for tasks; m1, m2 for milestones; e1, e2 for edges).
 * Strips internal fields (projectId, position, content, createdAt, updatedAt, execution fields).
 */
export function planNodesToExportJson(
  projectName: string,
  nodes: PlanNode[],
  edges: PlanEdge[],
): PlanExportJson {
  // Build UUID → sequential ID mapping
  const idMap = new Map<string, string>()
  let taskCounter = 0
  let milestoneCounter = 0

  for (const node of nodes) {
    if (node.type === 'milestone') {
      milestoneCounter++
      idMap.set(node.id, `m${milestoneCounter}`)
    } else {
      taskCounter++
      idMap.set(node.id, `n${taskCounter}`)
    }
  }

  const resolveId = (uuid: string): string => idMap.get(uuid) ?? uuid

  const exportNodes = nodes.map((n) => ({
    id: resolveId(n.id),
    type: n.type,
    title: n.title,
    description: n.description ?? '',
    status: n.status,
    parentId: n.parentId ? resolveId(n.parentId) : null,
    dependencies: (n.dependencies ?? []).map(resolveId),
    verification: n.verification ?? 'auto',
    ...(n.startDate ? { startDate: n.startDate } : {}),
    ...(n.endDate ? { endDate: n.endDate } : {}),
    ...(n.priority ? { priority: n.priority } : {}),
    ...(n.estimate ? { estimate: n.estimate } : {}),
    ...(n.dueDate ? { dueDate: n.dueDate } : {}),
    ...(n.milestoneId ? { milestoneId: resolveId(n.milestoneId) } : {}),
  }))

  let edgeCounter = 0
  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const exportEdges = edges
    .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
    .map((e) => ({
      id: `e${++edgeCounter}`,
      source: resolveId(e.source),
      target: resolveId(e.target),
      type: e.type,
    }))

  return { projectName, nodes: exportNodes, edges: exportEdges }
}
