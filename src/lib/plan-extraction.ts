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
 * Converts live PlanNode[]/PlanEdge[] into a clean export JSON.
 * Preserves actual node IDs (the real `node-...` client IDs) so the exported
 * JSON matches what `astro-cli plan verify --json` returns, making Copy JSON
 * and Create New Project consistent with the live plan data.
 * Strips internal fields (projectId, position, content, createdAt, updatedAt, execution fields).
 */
export function planNodesToExportJson(
  projectName: string,
  nodes: PlanNode[],
  edges: PlanEdge[],
): PlanExportJson {
  const nodeIdSet = new Set(nodes.map((n) => n.id))

  const exportNodes = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    description: n.description ?? '',
    status: n.status,
    parentId: n.parentId ?? null,
    dependencies: n.dependencies ?? [],
    verification: n.verification ?? 'auto',
    ...(n.startDate ? { startDate: n.startDate } : {}),
    ...(n.endDate ? { endDate: n.endDate } : {}),
    ...(n.priority ? { priority: n.priority } : {}),
    ...(n.estimate ? { estimate: n.estimate } : {}),
    ...(n.dueDate ? { dueDate: n.dueDate } : {}),
    ...(n.milestoneId ? { milestoneId: n.milestoneId } : {}),
  }))

  const exportEdges = edges
    .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
    }))

  return { projectName, nodes: exportNodes, edges: exportEdges }
}
