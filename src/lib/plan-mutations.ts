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

// Matches ```json fences (the only format we instruct the AI to use)
const JSON_FENCE_RE = /```json\s*\n([\s\S]*?)```/g

// Legacy formats kept for backward compat with older chat history
const LEGACY_BLOCK_RE = /```(?:astro-plan-change|astro-updates|astro-edges|astro-add-nodes)\s*\n([\s\S]*?)```/g

/** Check if a parsed JSON object is a mutation block by its top-level keys */
function isMutationObject(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.updateNodes) || Array.isArray(obj.addNodes) || Array.isArray(obj.updateEdges)
}

/** Collect items from an array into the correct mutation bucket, classifying by shape */
function collectItems(
  arr: unknown[],
  category: "updates" | "edges" | "addNodes",
  nodeUpdates: ParsedNodeUpdate[],
  edgeOps: ParsedEdgeOp[],
  newNodes: ParsedNewNode[],
) {
  for (const item of arr) {
    if (!item || typeof item !== "object") continue
    const obj = item as Record<string, unknown>
    if (category === "updates" && (obj.nodeId || obj.nodeTitle)) {
      nodeUpdates.push(obj as ParsedNodeUpdate)
    } else if (category === "edges" && obj.action && obj.source && obj.target) {
      edgeOps.push(obj as unknown as ParsedEdgeOp)
    } else if (category === "addNodes" && obj.title) {
      newNodes.push(obj as unknown as ParsedNewNode)
    }
  }
}

/** Extract mutations from a parsed JSON object with updateNodes/addNodes/updateEdges keys */
function extractFromMutationObject(
  parsed: Record<string, unknown>,
  nodeUpdates: ParsedNodeUpdate[],
  edgeOps: ParsedEdgeOp[],
  newNodes: ParsedNewNode[],
): boolean {
  let found = false
  if (Array.isArray(parsed.updateNodes)) {
    collectItems(parsed.updateNodes, "updates", nodeUpdates, edgeOps, newNodes)
    found = true
  }
  if (Array.isArray(parsed.updateEdges)) {
    collectItems(parsed.updateEdges, "edges", nodeUpdates, edgeOps, newNodes)
    found = true
  }
  if (Array.isArray(parsed.addNodes)) {
    collectItems(parsed.addNodes, "addNodes", nodeUpdates, edgeOps, newNodes)
    found = true
  }
  return found
}

/**
 * Extract plan mutations from a chat message.
 *
 * Looks for ```json fenced code blocks containing a mutation object with
 * "updateNodes", "addNodes", and/or "updateEdges" top-level keys.
 * The shape of the JSON (not a special fence tag) identifies it as a mutation.
 *
 * Also handles legacy astro-plan-change/astro-updates/astro-edges/astro-add-nodes
 * fences for backward compatibility with older chat history.
 */
export function extractMutations(content: string): { cleanContent: string; mutations: AppliedMutations } {
  const nodeUpdates: ParsedNodeUpdate[] = []
  const edgeOps: ParsedEdgeOp[] = []
  const newNodes: ParsedNewNode[] = []

  // ── Primary: find ```json blocks with mutation shape ──
  let cleanContent = content.replace(JSON_FENCE_RE, (match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim())
      // Object with updateNodes/addNodes/updateEdges keys → mutation block
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (isMutationObject(parsed as Record<string, unknown>)) {
          extractFromMutationObject(parsed as Record<string, unknown>, nodeUpdates, edgeOps, newNodes)
          return ""
        }
      }
    } catch {
      // Not valid JSON — leave as-is
    }
    return match
  })

  // ── Legacy: handle astro-plan-change / astro-updates / etc. from older sessions ──
  if (nodeUpdates.length === 0 && edgeOps.length === 0 && newNodes.length === 0) {
    cleanContent = cleanContent.replace(LEGACY_BLOCK_RE, (match, json: string) => {
      try {
        const parsed = JSON.parse(json.trim())
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (extractFromMutationObject(parsed as Record<string, unknown>, nodeUpdates, edgeOps, newNodes)) {
            return ""
          }
        }
        // Legacy array format (astro-updates was an array of node updates, etc.)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sample = parsed[0] as Record<string, unknown>
          if (sample && typeof sample === "object") {
            if ("action" in sample && "source" in sample) {
              collectItems(parsed, "edges", nodeUpdates, edgeOps, newNodes)
            } else if ("nodeId" in sample || "nodeTitle" in sample) {
              collectItems(parsed, "updates", nodeUpdates, edgeOps, newNodes)
            } else if ("title" in sample && "description" in sample) {
              collectItems(parsed, "addNodes", nodeUpdates, edgeOps, newNodes)
            }
            if (nodeUpdates.length > 0 || edgeOps.length > 0 || newNodes.length > 0) return ""
          }
        }
      } catch {
        // Not valid JSON
      }
      return match
    })
  }

  return { cleanContent: cleanContent.trim(), mutations: { nodeUpdates, edgeOps, newNodes } }
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
      if (key === "nodeId" || key === "nodeTitle") continue
      if (INTERNAL_FIELDS.has(key)) continue
      ;(patch as Record<string, unknown>)[key] = value
      resolvedUpdate[key] = value
    }

    resolvedNodeUpdates.push(resolvedUpdate)

    if (typeof patch.description === 'string' && !patch.content) {
      patch.content = `<p>${escapeHtml(patch.description)}</p>`
    }

    // Reconcile edges when dependencies change (resolve temp IDs from addNodes)
    if (Array.isArray(u.dependencies)) {
      const currentNode = planNodes.find((n) => n.id === resolvedNodeId)
      if (currentNode) {
        const resolvedDeps = (u.dependencies as string[]).map(d => idMap.get(d) ?? d)
        // Update patch with resolved IDs so the node's dependencies field is correct
        patch.dependencies = resolvedDeps
        const newDeps = new Set(resolvedDeps)
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

  // Apply edge operations (resolve temp IDs from addNodes through idMap)
  for (const op of edgeOps) {
    const resolvedSource = idMap.get(op.source) ?? op.source
    const resolvedTarget = idMap.get(op.target) ?? op.target

    if (op.action === "add") {
      addEdge({
        id: `e-${resolvedSource}-${resolvedTarget}`,
        source: resolvedSource,
        target: resolvedTarget,
        type: (op.type as "dependency" | "branch") ?? "dependency",
      })
      // Look up target in both existing planNodes and newly added nodes
      const targetNode = planNodes.find((n) => n.id === resolvedTarget)
        ?? store.nodes.find((n) => n.id === resolvedTarget)
      if (targetNode && !targetNode.dependencies.includes(resolvedSource)) {
        updateNode(resolvedTarget, { dependencies: [...targetNode.dependencies, resolvedSource] })
      }
    } else if (op.action === "remove") {
      removeEdge(resolvedSource, resolvedTarget)
      const targetNode = planNodes.find((n) => n.id === resolvedTarget)
      if (targetNode) {
        updateNode(resolvedTarget, { dependencies: targetNode.dependencies.filter((d) => d !== resolvedSource) })
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
