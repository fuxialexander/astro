/**
 * Build ASCII dependency tree from plan nodes + edges.
 * Ported from packages/cli/src/commands/plan.ts (buildTree + renderTreeLines).
 */

import type { PlanNode, PlanEdge } from '../client-adapter.js'
import { getStatusSymbol } from './status-colors.js'

export interface TreeNode {
  id: string
  title: string
  status: string
  type: string
  children: TreeNode[]
  collapsed?: boolean
}

export function buildTree(
  nodes: PlanNode[],
  edges: PlanEdge[],
): TreeNode[] {
  const adj = new Map<string, string[]>()
  const hasParent = new Set<string>()

  for (const edge of edges) {
    const children = adj.get(edge.source) ?? []
    children.push(edge.target)
    adj.set(edge.source, children)
    hasParent.add(edge.target)
  }

  const lookup = new Map<string, PlanNode>()
  for (const node of nodes) {
    if (!node.deletedAt) lookup.set(node.id, node)
  }

  function buildSubtree(nodeId: string): TreeNode | null {
    const node = lookup.get(nodeId)
    if (!node) return null
    const childIds = adj.get(nodeId) ?? []
    const children: TreeNode[] = []
    for (const childId of childIds) {
      const child = buildSubtree(childId)
      if (child) children.push(child)
    }
    return {
      id: node.id,
      title: node.title,
      status: node.status,
      type: node.type,
      children,
    }
  }

  const roots: TreeNode[] = []
  for (const node of nodes) {
    if (!node.deletedAt && !hasParent.has(node.id)) {
      const tree = buildSubtree(node.id)
      if (tree) roots.push(tree)
    }
  }

  return roots
}

export interface TreeLine {
  id: string
  text: string
  status: string
  depth: number
  isLeaf: boolean
  nodeTitle: string
}

export function renderTreeLines(
  roots: TreeNode[],
  collapsedSet?: Set<string>,
): TreeLine[] {
  const lines: TreeLine[] = []

  function walk(node: TreeNode, prefix: string, isLast: boolean, depth: number) {
    const connector = depth === 0
      ? (isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ')
      : (isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ')
    const symbol = getStatusSymbol(node.status)
    const collapsed = collapsedSet?.has(node.id) && node.children.length > 0
    const expandIcon = node.children.length > 0
      ? (collapsed ? '\u25B6 ' : '\u25BC ')
      : '  '

    lines.push({
      id: node.id,
      text: `${prefix}${connector}${expandIcon}${symbol} ${node.title} [${node.status}]`,
      status: node.status,
      depth,
      isLeaf: node.children.length === 0,
      nodeTitle: node.title,
    })

    if (collapsed) return

    const childPrefix = prefix + (isLast ? '    ' : '\u2502   ')
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], childPrefix, i === node.children.length - 1, depth + 1)
    }
  }

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], '', i === roots.length - 1, 0)
  }

  return lines
}

/** Flatten a tree for fuzzy search indexing */
export function flattenTree(roots: TreeNode[]): Array<{ id: string; title: string; status: string; type: string }> {
  const result: Array<{ id: string; title: string; status: string; type: string }> = []

  function walk(node: TreeNode) {
    result.push({ id: node.id, title: node.title, status: node.status, type: node.type })
    for (const child of node.children) walk(child)
  }

  for (const root of roots) walk(root)
  return result
}
