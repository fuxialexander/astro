import type { PlanNode, PlanEdge } from '@/types'
import { usePlanStore } from '@/stores/plan-store'
import { useProjectStore } from '@/stores/project-store'

/**
 * Module-level Set to track processed executionIds for idempotency.
 * Prevents race conditions when both SSE and WebSocket paths call this
 * function simultaneously for the same execution result.
 *
 * Max size is capped at 1000 entries to prevent unbounded memory growth
 * in long-running tabs. When the limit is reached, the oldest 100 entries
 * are removed (approximated via Set iteration order).
 */
const processedExecutionIds = new Set<string>()
const MAX_PROCESSED_IDS = 1000
const CLEANUP_THRESHOLD = 100

/**
 * Extracts plan JSON from text and applies it to the plan store.
 * Returns whether the plan was applied and how many nodes were created.
 *
 * @param projectId - The project ID to associate nodes with
 * @param text - The text containing the plan JSON
 * @param executionId - Optional execution ID for idempotency (recommended)
 * @param skipIfExists - Deprecated: use executionId instead for proper idempotency
 */
export function applyPlanFromText(
  projectId: string,
  text: string,
  executionId?: string,
  skipIfExists = false,
): { applied: boolean; nodeCount: number } {
  const planJson = extractPlanJsonFromText(text)
  if (!planJson) return { applied: false, nodeCount: 0 }

  // Idempotency check: if executionId is provided, use it as the primary check
  if (executionId) {
    if (processedExecutionIds.has(executionId)) {
      console.log(`[plan-extraction] Skipping — executionId ${executionId} already processed`)
      return { applied: false, nodeCount: 0 }
    }
    // Mark as processed immediately to prevent concurrent calls from proceeding
    processedExecutionIds.add(executionId)

    // Cleanup: remove oldest entries when Set grows beyond max size
    if (processedExecutionIds.size > MAX_PROCESSED_IDS) {
      const entries = Array.from(processedExecutionIds)
      const toKeep = entries.slice(-(MAX_PROCESSED_IDS - CLEANUP_THRESHOLD))
      processedExecutionIds.clear()
      toKeep.forEach(id => processedExecutionIds.add(id))
      console.log(`[plan-extraction] Cleaned up ${entries.length - toKeep.length} old executionIds (${processedExecutionIds.size} remaining)`)
    }
  } else if (skipIfExists) {
    // Fallback: non-atomic check for backward compatibility
    const existing = usePlanStore.getState().nodes.filter(n => n.projectId === projectId)
    if (existing.length > 0) {
      console.log(`[plan-extraction] Skipping — project ${projectId} already has ${existing.length} nodes`)
      return { applied: false, nodeCount: 0 }
    }
  }

  // Map AI-generated short IDs (n1, n2, etc.) to proper UUIDs for consistency
  // with manually created tasks which use crypto.randomUUID()
  const idMap = new Map<string, string>()
  const resolveId = (aiId: string): string => {
    let uuid = idMap.get(aiId)
    if (!uuid) {
      uuid = crypto.randomUUID()
      idMap.set(aiId, uuid)
    }
    return uuid
  }
  const now = new Date()

  const nodes: PlanNode[] = planJson.nodes.map((n: Record<string, unknown>) => ({
    id: resolveId(n.id as string),
    projectId,
    type: (n.type as PlanNode['type']) || 'task',
    title: (n.title as string) || '',
    description: (n.description as string) || '',
    content: n.description ? `<p>${n.description as string}</p>` : '',
    status: (n.status as PlanNode['status']) || 'planned',
    parentId: n.parentId ? resolveId(n.parentId as string) : null,
    dependencies: (n.dependencies as string[] || []).map(resolveId),
    verification: (n.verification as PlanNode['verification']) || 'human',
    position: (n.position as { x: number; y: number }) || { x: 40, y: 40 },
    startDate: n.startDate as string | undefined,
    endDate: n.endDate as string | undefined,
    priority: n.priority as PlanNode['priority'],
    estimate: n.estimate as PlanNode['estimate'],
    dueDate: n.dueDate as string | undefined,
    labelIds: n.labelIds as string[] | undefined,
    milestoneId: n.milestoneId ? resolveId(n.milestoneId as string) : undefined,
    createdAt: now,
    updatedAt: now,
  }))

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

/**
 * Extracts plan JSON (with nodes/edges) from streaming text output.
 * Tries ALL code-fenced JSON blocks (last match first, since the plan is
 * typically the final output), then falls back to raw JSON detection
 * searching backwards from the end of the text.
 */
export function extractPlanJsonFromText(text: string): { projectName?: string; nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null {
  // Collect ALL ```json code fences
  const fenceRegex = /```json\s*\n([\s\S]*?)\n```/g
  const fences: { content: string; index: number }[] = []
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(text)) !== null) {
    fences.push({ content: match[1], index: match.index! })
  }

  console.log(`[plan-extraction] Found ${fences.length} json code fences in text of length ${text.length}`)

  // Try fences in reverse order (last fence first — plan is typically the last output)
  for (let i = fences.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(fences[i].content)
      if (parsed.nodes && Array.isArray(parsed.nodes)) {
        console.log(`[plan-extraction] Matched code fence #${i} (of ${fences.length}): ${parsed.nodes.length} nodes`)
        return parsed
      }
    } catch {
      // Try next fence
    }
  }

  // Fallback: find raw JSON with "nodes" array by searching backwards from end of text.
  // Look for the LAST occurrence of "projectName" to find the plan JSON.
  const lastProjectNameIdx = text.lastIndexOf('"projectName"')
  if (lastProjectNameIdx === -1) {
    console.log(`[plan-extraction] No "projectName" found in text`)
    return null
  }

  // Walk backwards from "projectName" to find the opening brace
  let openBraceIdx = -1
  for (let i = lastProjectNameIdx - 1; i >= 0; i--) {
    if (text[i] === '{') {
      openBraceIdx = i
      break
    }
  }

  if (openBraceIdx === -1) {
    console.log(`[plan-extraction] No opening brace before "projectName"`)
    return null
  }

  // Brace-balance forward from the opening brace to find the complete JSON object
  let depth = 0
  let endIdx = openBraceIdx
  for (let i = openBraceIdx; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        endIdx = i + 1
        break
      }
    }
  }

  try {
    const parsed = JSON.parse(text.slice(openBraceIdx, endIdx))
    if (parsed.nodes && Array.isArray(parsed.nodes)) {
      console.log(`[plan-extraction] Matched raw JSON (last "projectName"): ${parsed.nodes.length} nodes`)
      return parsed
    }
  } catch (e) {
    console.log(`[plan-extraction] Raw JSON parse failed:`, e)
  }

  console.log(`[plan-extraction] No plan JSON found in text of length ${text.length}`)
  return null
}
