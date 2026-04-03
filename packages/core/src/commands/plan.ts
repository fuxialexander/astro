/**
 * Transport-agnostic plan commands.
 *
 * Includes tree-building logic extracted from the CLI, now reusable
 * by any transport (Telegram, web dashboard, etc.).
 */

import type {
  CommandClient,
  PlanNodeData,
  PlanEdgeData,
  PlanTreeNode,
  PlanTreeResult,
  PlanNodeListResult,
} from './types.js'
import { resolveProject } from './projects.js'

// ── Tree building (pure logic, no I/O) ───────────────────────────────

/**
 * Build a dependency tree from flat nodes and edges.
 * Returns an array of root nodes (nodes with no incoming edges).
 */
export function buildPlanTree(
  nodes: Array<{ id: string; title: string; status: string; type: string }>,
  edges: Array<{ source: string; target: string }>,
): PlanTreeNode[] {
  const adj = new Map<string, string[]>()
  const hasParent = new Set<string>()

  for (const edge of edges) {
    const children = adj.get(edge.source) ?? []
    children.push(edge.target)
    adj.set(edge.source, children)
    hasParent.add(edge.target)
  }

  const lookup = new Map(nodes.map((n) => [n.id, n]))

  function buildSubtree(nodeId: string): PlanTreeNode | null {
    const node = lookup.get(nodeId)
    if (!node) return null
    const childIds = adj.get(nodeId) ?? []
    const children: PlanTreeNode[] = []
    for (const childId of childIds) {
      const child = buildSubtree(childId)
      if (child) children.push(child)
    }
    return { ...node, children }
  }

  const roots: PlanTreeNode[] = []
  for (const node of nodes) {
    if (!hasParent.has(node.id)) {
      const tree = buildSubtree(node.id)
      if (tree) roots.push(tree)
    }
  }

  return roots
}

/**
 * Render a plan tree into ASCII lines (no color/chalk).
 * Returns plain-text lines suitable for any output format.
 * Use the `statusFormatter` callback to inject transport-specific formatting.
 */
export function renderTreeLines(
  roots: PlanTreeNode[],
  opts?: {
    statusFormatter?: (status: string) => string
    typeFormatter?: (type: string) => string
  },
): string[] {
  const lines: string[] = []
  const fmtStatus = opts?.statusFormatter ?? ((s: string) => s)
  const fmtType = opts?.typeFormatter ?? ((t: string) => `[${t}]`)

  function walk(node: PlanTreeNode, prefix: string, isLast: boolean) {
    const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 '
    lines.push(
      `${prefix}${connector}${node.id}: ${node.title} ${fmtType(node.type)} ${fmtStatus(node.status)}`,
    )
    const childPrefix = prefix + (isLast ? '    ' : '\u2502   ')
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], childPrefix, i === node.children.length - 1)
    }
  }

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], '', i === roots.length - 1)
  }

  return lines
}

// ── Commands ──────────────────────────────────────────────────────────

/** List plan nodes for a project (supports partial project ID). */
export async function listPlanNodes(
  client: CommandClient,
  partialProjectId: string,
): Promise<PlanNodeListResult> {
  const project = await resolveProject(client, partialProjectId)
  const { nodes, edges } = await client.getPlan(project.id)
  const active = nodes.filter((n) => !n.deletedAt)
  return { nodes: active, edges }
}

/** Get the plan dependency tree for a project (supports partial project ID). */
export async function getPlanTree(
  client: CommandClient,
  partialProjectId: string,
): Promise<PlanTreeResult> {
  const project = await resolveProject(client, partialProjectId)
  const { nodes, edges } = await client.getPlan(project.id)
  const active = nodes.filter((n) => !n.deletedAt)

  const roots = buildPlanTree(
    active.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      type: n.type,
    })),
    edges,
  )

  return {
    roots,
    totalNodes: active.length,
    totalEdges: edges.length,
  }
}

/** Show detailed info for a single plan node. */
export async function getPlanNode(
  client: CommandClient,
  projectId: string,
  nodeId: string,
): Promise<{ node: PlanNodeData; edges: PlanEdgeData[] }> {
  const { nodes, edges } = await client.getPlan(projectId)
  const node = nodes.find((n) => n.id === nodeId && !n.deletedAt)
  if (!node) {
    throw new Error(`Plan node "${nodeId}" not found in project`)
  }

  // Return edges connected to this node
  const connectedEdges = edges.filter(
    (e) => e.source === nodeId || e.target === nodeId,
  )

  return { node, edges: connectedEdges }
}

/**
 * Validate that given node IDs exist in a project's plan.
 * Returns an array of error messages, or empty array if all valid.
 */
export async function validateNodeIds(
  client: CommandClient,
  projectId: string,
  ids: Array<{ id: string; role: string }>,
): Promise<string[]> {
  if (ids.length === 0) return []

  const { nodes } = await client.getPlan(projectId)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const errors: string[] = []

  for (const { id, role } of ids) {
    if (!nodeMap.has(id)) {
      const available = nodes
        .slice(0, 10)
        .map((n) => `  ${n.id}  (${n.type}) ${n.title}`)
        .join('\n')
      errors.push(
        `${role} "${id}" not found in project. Valid node IDs:\n${available}`,
      )
    }
  }

  return errors
}
