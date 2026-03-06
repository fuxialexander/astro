/**
 * Plan mutation extraction and application.
 *
 * Parses `astro-updates`, `astro-edges`, and `astro-add-nodes` code blocks
 * from agent chat responses and applies them to the plan store.
 *
 * Shared between chat-panel.tsx (sidebar chat) and plan-generation.tsx (plan activity page).
 */

import type { PlanNode } from '@/types'
import { usePlanStore } from '@/stores/plan-store'
import { escapeHtml } from '@/lib/html-utils'

// ---- Types ----

export interface ParsedNodeUpdate {
  nodeId?: string
  nodeTitle?: string
  type?: string
  [key: string]: unknown
}

export interface ParsedEdgeOp {
  action: "add" | "remove"
  source: string
  target: string
  type?: string
}

export interface ParsedNewNode {
  id?: string
  title: string
  description: string
  type?: string
  milestoneId?: string
  dependencies?: string[]
  priority?: string
  estimate?: string
  verification?: string
}

export interface AppliedMutations {
  nodeUpdates: ParsedNodeUpdate[]
  edgeOps: ParsedEdgeOp[]
  newNodes: ParsedNewNode[]
}

export interface ResolvedMutations {
  nodeUpdates: Array<{ nodeId: string; [key: string]: unknown }>
  edgeOps: Array<{ action: "add" | "remove"; source: string; target: string; type?: string }>
  newNodes: Array<{ id?: string; title: string; description: string; type?: string; dependencies?: string[]; priority?: string; estimate?: string; verification?: string }>
}

// Fields that are internal and should not be written from chat
const INTERNAL_FIELDS = new Set(["id", "projectId", "createdAt", "updatedAt", "position", "boardOrder", "executionId", "executionOutput", "executionError", "executionStartedAt", "executionCompletedAt", "branchName", "prUrl", "prNumber"])

// ---- Extraction ----

const UPDATE_BLOCK_RE = /```astro-updates\s*\n([\s\S]*?)```/g
const EDGE_BLOCK_RE = /```astro-edges\s*\n([\s\S]*?)```/g
const ADD_NODES_BLOCK_RE = /```astro-add-nodes\s*\n([\s\S]*?)```/g

/** Extract astro-updates, astro-edges, and astro-add-nodes blocks from a message. */
export function extractMutations(content: string): { cleanContent: string; mutations: AppliedMutations } {
  const nodeUpdates: ParsedNodeUpdate[] = []
  const edgeOps: ParsedEdgeOp[] = []
  const newNodes: ParsedNewNode[] = []

  let cleanContent = content.replace(UPDATE_BLOCK_RE, (match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && (item.nodeId || item.nodeTitle)) {
            nodeUpdates.push(item as ParsedNodeUpdate)
          }
        }
      }
    } catch {
      return match // malformed — keep visible
    }
    return ""
  })

  cleanContent = cleanContent.replace(EDGE_BLOCK_RE, (match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && item.action && item.source && item.target) {
            edgeOps.push(item as ParsedEdgeOp)
          }
        }
      }
    } catch {
      return match
    }
    return ""
  })

  cleanContent = cleanContent.replace(ADD_NODES_BLOCK_RE, (match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && item.title) {
            newNodes.push(item as ParsedNewNode)
          }
        }
      }
    } catch {
      return match
    }
    return ""
  }).trim()

  return { cleanContent, mutations: { nodeUpdates, edgeOps, newNodes } }
}

// ---- Application ----

/**
 * Apply mutations to the plan store. Operates directly on the store —
 * no React hooks needed, can be called from any context.
 */
export function applyMutationsToStore(
  projectId: string,
  mutations: AppliedMutations,
): { affectedNodeIds: string[]; resolvedMutations: ResolvedMutations } {
  const store = usePlanStore.getState()
  const { nodes: allNodes, updateNode, addNode, addEdge, removeEdge, reorganizeProject } = store
  const planNodes = allNodes.filter((n) => n.projectId === projectId)

  const { nodeUpdates, edgeOps, newNodes } = mutations
  const affectedNodeIds: string[] = []
  const resolvedNodeUpdates: Array<{ nodeId: string; [key: string]: unknown }> = []

  // Create new nodes (from decomposition)
  const idMap = new Map<string, string>()

  for (const n of newNodes) {
    const realId = crypto.randomUUID()
    affectedNodeIds.push(realId)
    if (n.id) idMap.set(n.id, realId)

    const now = new Date()
    const node: PlanNode = {
      id: realId,
      projectId,
      type: (n.type as PlanNode["type"]) ?? "task",
      title: n.title,
      description: n.description,
      content: n.description ? `<p>${escapeHtml(n.description)}</p>` : '',
      status: "planned",
      parentId: null,
      dependencies: (n.dependencies ?? []).map((d) => idMap.get(d) ?? d),
      verification: (n.verification as PlanNode["verification"]) ?? "auto",
      position: { x: 40, y: 40 },
      priority: (n.priority as PlanNode["priority"]) ?? "medium",
      estimate: (n.estimate as PlanNode["estimate"]) ?? undefined,
      milestoneId: n.milestoneId ?? undefined,
      createdAt: now,
      updatedAt: now,
    }
    addNode(node)

    for (const dep of node.dependencies) {
      addEdge({ id: crypto.randomUUID(), source: dep, target: realId, type: "dependency" })
    }
  }

  if (newNodes.length > 0) {
    reorganizeProject(projectId)
  }

  // Apply node property updates
  for (const u of nodeUpdates) {
    let resolvedNodeId: string | undefined = u.nodeId

    if (!resolvedNodeId && u.nodeTitle) {
      const normalizedTitle = (u.nodeTitle as string).trim().toLowerCase()
      let candidates = planNodes.filter((n) => n.title.trim().toLowerCase() === normalizedTitle)

      if (u.type && candidates.length > 1) {
        candidates = candidates.filter((n) => n.type === u.type)
      }

      if (candidates.length === 0) {
        console.warn(`[plan-mutations] Node update failed: no node found with title "${u.nodeTitle}"${u.type ? ` and type "${u.type}"` : ''}`)
        continue
      } else if (candidates.length > 1) {
        console.warn(`[plan-mutations] Node update ambiguous: multiple nodes found with title "${u.nodeTitle}"${u.type ? ` and type "${u.type}"` : ''}. Specify type to disambiguate.`)
        continue
      }

      resolvedNodeId = candidates[0].id
    }

    if (!resolvedNodeId) {
      console.warn('[plan-mutations] Node update failed: neither nodeId nor nodeTitle provided')
      continue
    }

    affectedNodeIds.push(resolvedNodeId)

    const resolvedUpdate: { nodeId: string; [key: string]: unknown } = { nodeId: resolvedNodeId }
    const patch: Partial<PlanNode> = {}
    for (const [key, value] of Object.entries(u)) {
      if (key === "nodeId" || key === "nodeTitle" || key === "type") continue
      if (INTERNAL_FIELDS.has(key)) continue
      ;(patch as Record<string, unknown>)[key] = value
      resolvedUpdate[key] = value
    }

    resolvedNodeUpdates.push(resolvedUpdate)

    if (typeof patch.description === 'string' && !patch.content) {
      patch.content = `<p>${escapeHtml(patch.description)}</p>`
    }

    // Reconcile edges when dependencies change
    if (Array.isArray(u.dependencies)) {
      const currentNode = planNodes.find((n) => n.id === resolvedNodeId)
      if (currentNode) {
        const newDeps = new Set(u.dependencies as string[])
        const oldDeps = new Set(currentNode.dependencies)
        for (const dep of oldDeps) {
          if (!newDeps.has(dep)) removeEdge(dep, resolvedNodeId)
        }
        for (const dep of newDeps) {
          if (!oldDeps.has(dep)) {
            addEdge({ id: `e-${dep}-${resolvedNodeId}`, source: dep, target: resolvedNodeId, type: "dependency" })
          }
        }
      }
    }

    if (Object.keys(patch).length > 0) {
      updateNode(resolvedNodeId, patch)
    }
  }

  // Apply edge operations
  for (const op of edgeOps) {
    if (op.action === "add") {
      addEdge({
        id: `e-${op.source}-${op.target}`,
        source: op.source,
        target: op.target,
        type: (op.type as "dependency" | "branch") ?? "dependency",
      })
      const targetNode = planNodes.find((n) => n.id === op.target)
      if (targetNode && !targetNode.dependencies.includes(op.source)) {
        updateNode(op.target, { dependencies: [...targetNode.dependencies, op.source] })
      }
    } else if (op.action === "remove") {
      removeEdge(op.source, op.target)
      const targetNode = planNodes.find((n) => n.id === op.target)
      if (targetNode) {
        updateNode(op.target, { dependencies: targetNode.dependencies.filter((d) => d !== op.source) })
      }
    }
  }

  return {
    affectedNodeIds,
    resolvedMutations: {
      nodeUpdates: resolvedNodeUpdates,
      edgeOps,
      newNodes,
    }
  }
}
