import type { PlanNode, PlanEdge } from '@/types'
import { usePlanStore } from '@/stores/plan-store'
import { useProjectStore } from '@/stores/project-store'
import { escapeHtml } from '@/lib/html-utils'
import { extractPlanJsonFromText, type PlanJsonResult } from '@astro/core'

// Re-export for backward compatibility
export { extractPlanJsonFromText } from '@astro/core'
export type { PlanJsonResult } from '@astro/core'

/** Extract projectId from a `plan-<projectId>` node ID, or return null. */
export function planNodeIdToProjectId(nodeId: string): string | null {
  return nodeId.startsWith('plan-') ? nodeId.slice(5) : null
}

/**
 * Extracts plan JSON from text and applies it to the plan store.
 * Always replaces the existing plan for the project — the agent is expected
 * to output the complete, updated plan each time.
 *
 * @param projectId - The project ID to associate nodes with
 * @param text - The text containing the plan JSON
 * @param _executionId - Unused, kept for call-site compatibility
 * @param _skipIfExists - Unused, kept for call-site compatibility
 * @param preExtracted - Optional pre-extracted plan JSON (skips extraction from text)
 */
export function applyPlanFromText(
  projectId: string,
  text: string,
  _executionId?: string,
  _skipIfExists?: boolean,
  preExtracted?: PlanJsonResult,
): { applied: boolean; nodeCount: number } {
  const planJson = preExtracted || extractPlanJsonFromText(text)
  if (!planJson) return { applied: false, nodeCount: 0 }

  // Build a reverse map from existing export IDs (n1, m1, etc.) back to real UUIDs.
  // When the agent outputs an updated plan reusing the same short IDs, this preserves
  // the original UUIDs so execution state, status changes, and references survive.
  const idMap = new Map<string, string>()
  const existingNodes = usePlanStore.getState().nodes.filter(n => n.projectId === projectId)
  if (existingNodes.length > 0) {
    let taskCounter = 0
    let milestoneCounter = 0
    for (const node of existingNodes) {
      const shortId = node.type === 'milestone'
        ? `m${++milestoneCounter}`
        : `n${++taskCounter}`
      idMap.set(shortId, node.id)
    }
  }

  const resolveId = (aiId: string): string => {
    let uuid = idMap.get(aiId)
    if (!uuid) {
      uuid = crypto.randomUUID()
      idMap.set(aiId, uuid)
    }
    return uuid
  }

  // Build a lookup of existing nodes by UUID for preserving stable fields
  const existingById = new Map(existingNodes.map(n => [n.id, n]))
  const now = new Date()

  const nodes: PlanNode[] = planJson.nodes.map((n: Record<string, unknown>) => {
    const nodeId = resolveId(n.id as string)
    const existing = existingById.get(nodeId)
    return {
      // Preserve stable fields from existing node (position, content edits, execution state, timestamps)
      ...existing,
      // Apply all fields from the agent's output
      id: nodeId,
      projectId,
      type: (n.type as PlanNode['type']) || 'task',
      title: (n.title as string) || '',
      description: (n.description as string) || '',
      content: n.description ? `<p>${escapeHtml(n.description as string)}</p>` : '',
      status: (n.status as PlanNode['status']) || 'planned',
      parentId: n.parentId ? resolveId(n.parentId as string) : null,
      dependencies: (n.dependencies as string[] || []).map(resolveId),
      verification: (n.verification as PlanNode['verification']) || 'auto',
      position: existing?.position || (n.position as { x: number; y: number }) || { x: 40, y: 40 },
      startDate: n.startDate as string | undefined,
      endDate: n.endDate as string | undefined,
      priority: n.priority as PlanNode['priority'],
      estimate: n.estimate as PlanNode['estimate'],
      dueDate: n.dueDate as string | undefined,
      labelIds: n.labelIds as string[] | undefined,
      milestoneId: n.milestoneId ? resolveId(n.milestoneId as string) : undefined,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
  })

  const edges: PlanEdge[] = (planJson.edges || []).map((e: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    source: resolveId(e.source as string),
    target: resolveId(e.target as string),
    type: (e.type as PlanEdge['type']) || 'dependency',
  }))

  const planStore = usePlanStore.getState()
  planStore.setProjectPlan(projectId, nodes, edges)
  planStore.reorganizeProject(projectId)

  if (planJson.projectName) {
    useProjectStore.getState().updateProject(projectId, { name: planJson.projectName })
  }

  return { applied: true, nodeCount: nodes.length }
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
