/**
 * Plan mutation extraction and application.
 *
 * Parses `astro-updates`, `astro-edges`, and `astro-add-nodes` code blocks
 * from agent chat responses and applies them to the plan store.
 *
 * Shared between chat-panel.tsx (sidebar chat) and plan-generation.tsx (plan activity page).
 */

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
