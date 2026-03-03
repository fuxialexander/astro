import type { PlanNode, PlanEdge } from "@/types"
import { getAccessToken } from "@/lib/supabase-client"
import { parseChatSSE } from "@/lib/sse-parser"
import { apiUrl } from "@/lib/api-url"

/**
 * Active team ID setter/getter.
 * The team store calls setActiveTeamId() after loading teams.
 */
let _activeTeamId: string | undefined
export function setActiveTeamId(teamId: string | undefined) {
  _activeTeamId = teamId
}
function getActiveTeamId(): string | undefined {
  return _activeTeamId
}

/**
 * Build headers for authenticated API calls.
 * Includes Supabase access token and team ID when available.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const token = await getAccessToken()
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }
  const teamId = getActiveTeamId()
  if (teamId) {
    headers["X-Team-Id"] = teamId
  }
  return headers
}

interface PlanGraphResult {
  projectName: string
  nodes: Array<{
    id: string
    type: PlanNode["type"]
    title: string
    description: string
    status: PlanNode["status"]
    parentId: string | null
    dependencies: string[]
    verification: PlanNode["verification"]
    position: { x: number; y: number }
    startDate?: string
    endDate?: string
    priority?: string
    estimate?: string
    dueDate?: string
    milestoneId?: string
    labelIds?: string[]
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    type: PlanEdge["type"]
  }>
}

/**
 * Fetch available slash commands from a connected machine.
 */
export async function fetchSlashCommands(
  machineId: string,
  workingDirectory?: string,
): Promise<{ name: string; description: string }[]> {
  try {
    const headers = await authHeaders()
    const params = new URLSearchParams({ machineId })
    if (workingDirectory) params.set("workingDirectory", workingDirectory)
    const res = await fetch(`${apiUrl}/api/relay/slash-commands?${params}`, { headers })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export async function generatePlan(
  params: { description: string; visionDoc?: string; projectId: string; model?: string; providerId?: string; workingDirectory?: string; fileTree?: string[]; keyFiles?: { claudeMd?: string; readmeMd?: string; packageInfo?: string }; targetMachineId?: string; gitState?: { currentBranch: string; targetBranch: string; isDirty: boolean; dirtyDetails?: { staged: number; unstaged: number; untracked: number } } },
  callbacks: {
    onText: (text: string) => void
    onPlanResult: (result: PlanGraphResult) => void
    onError: (error: string) => void
    onDone: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  console.log(`[plan-gen] POST /api/agent/generate-plan projectId=${params.projectId}`)

  const res = await fetch(apiUrl("/api/agent/generate-plan"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok) {
    console.error(`[plan-gen] Server error: ${res.status}`)
    callbacks.onError(`Server error: ${res.status}`)
    return
  }

  console.log(`[plan-gen] SSE stream opened for projectId=${params.projectId}`)

  await parseChatSSE(res, {
    onText: callbacks.onText,
    onPlanResult: (result) => {
      const planResult = result as PlanGraphResult
      console.log(`[plan-gen] plan_result received: ${planResult.nodes.length} nodes, ${planResult.edges.length} edges`)
      callbacks.onPlanResult(planResult)
    },
    onError: (error) => {
      console.error(`[plan-gen] SSE error:`, error)
      callbacks.onError(error)
    },
    onDone: () => {
      console.log(`[plan-gen] SSE stream done for projectId=${params.projectId}`)
      callbacks.onDone()
    },
  })
}

export interface ChatPlanNodeContext {
  id: string
  title: string
  description: string
  status: string
  type: string
  priority?: string
  estimate?: string
  verification?: string
  milestoneId?: string
  dependencies?: string[]
  dueDate?: string
  startDate?: string
  endDate?: string
}

export interface ChatPlanEdgeContext {
  source: string
  target: string
  type: string
}

export async function chatWithAgent(
  params: { message: string; sessionId?: string; streamId?: string; projectId: string; visionDoc?: string; model?: string; providerId?: string; planNodes?: ChatPlanNodeContext[]; planEdges?: ChatPlanEdgeContext[]; messages?: Array<{ role: 'user' | 'assistant'; content: string }> },
  callbacks: {
    onText: (text: string) => void
    onDone: (sessionId: string) => void
    onError: (error: string) => void
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(apiUrl("/api/agent/chat"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok) {
    callbacks.onError(`Server error: ${res.status}`)
    return
  }

  await parseChatSSE(res, {
    onText: callbacks.onText,
    onDone: callbacks.onDone,
    onError: callbacks.onError,
  })
}

export async function planChatWithAgent(
  params: { message: string; sessionId?: string; streamId?: string; projectId: string; visionDoc?: string; model?: string; providerId?: string; planNodes?: ChatPlanNodeContext[]; planEdges?: ChatPlanEdgeContext[]; messages?: Array<{ role: 'user' | 'assistant'; content: string }> },
  callbacks: {
    onText: (text: string) => void
    onToolUse?: (data: { toolName: string; toolInput: unknown }) => void
    onToolResult?: (data: { toolName: string; success: boolean; result: unknown }) => void
    onDone: (sessionId: string) => void
    onError: (error: string) => void
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(apiUrl("/api/agent/plan-chat"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok) {
    callbacks.onError(`Server error: ${res.status}`)
    return
  }

  await parseChatSSE(res, {
    onText: callbacks.onText,
    onToolUse: callbacks.onToolUse,
    onToolResult: callbacks.onToolResult,
    onDone: callbacks.onDone,
    onError: callbacks.onError,
  })
}

export async function abortAgent(sessionId: string): Promise<void> {
  await fetch(apiUrl("/api/agent/abort"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ sessionId }),
  })
}



export interface TaskChatParams {
  message: string
  sessionId?: string
  streamId?: string
  nodeId: string
  projectId: string
  taskTitle: string
  taskDescription: string
  taskOutput?: string
  visionDoc?: string
  model?: string
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Branch name from the execution (for resumed session context) */
  branchName?: string
  /** PR URL from the execution (for resumed session context) */
  prUrl?: string
}

export async function chatWithTask(
  params: TaskChatParams,
  callbacks: {
    onText: (text: string) => void
    onToolUse?: (data: { toolName: string; toolInput: unknown }) => void
    onToolResult?: (data: { toolName: string; success: boolean; result: unknown }) => void
    onDone: (sessionId: string) => void
    onError: (error: string) => void
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(apiUrl("/api/agent/task-chat"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok) {
    callbacks.onError(`Server error: ${res.status}`)
    return
  }

  await parseChatSSE(res, {
    onText: callbacks.onText,
    onToolUse: callbacks.onToolUse,
    onToolResult: callbacks.onToolResult,
    onDone: callbacks.onDone,
    onError: callbacks.onError,
  })
}

/**
 * Generate a concise AI title from a task description.
 * Returns heuristic fallback on network/relay failure.
 */
export async function generateTitle(description: string): Promise<string> {
  try {
    const res = await fetch(apiUrl("/api/agent/generate-title"), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ description }),
    })
    if (!res.ok) return description.trim().slice(0, 80)
    const data = await res.json()
    return data.title || description.trim().slice(0, 80)
  } catch {
    return description.trim().slice(0, 80)
  }
}

// Refinement types
export interface RefinementResult {
  refinedTitle: string
  refinedDescription: string
  clarification?: { question: string; options: string[] }
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Refine a task/project title and description via AI.
 * Returns null on failure.
 */
export async function refineContent(
  title: string,
  description: string,
  context: 'task' | 'project',
  signal?: AbortSignal,
): Promise<RefinementResult | null> {
  try {
    const res = await fetch(apiUrl("/api/agent/refine"), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ title, description, context }),
      signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.refinement || null
  } catch {
    return null
  }
}

/**
 * Suggest labels for a task based on its title and description.
 * Returns empty array on failure.
 */
export async function suggestLabels(title: string, description: string): Promise<string[]> {
  try {
    const res = await fetch(apiUrl("/api/agent/suggest-labels"), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ title, description }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data.labelIds) ? data.labelIds : []
  } catch {
    return []
  }
}

// ── GitHub PR & branch management ───────────────────────────────────

export type ApiErrorType = "network" | "server" | "github"

/**
 * Close a GitHub pull request.
 * @param owner - Repository owner (username or organization)
 * @param repo - Repository name
 * @param prNumber - Pull request number
 * @returns Promise resolving to { success: boolean; error: string | null; errorType?: ApiErrorType }
 */
export async function closePr(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ success: boolean; error: string | null; errorType?: ApiErrorType }> {
  try {
    const res = await fetch(apiUrl("/api/github/close-pr"), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ owner, repo, prNumber }),
    })
    if (!res.ok) {
      return { success: false, error: `Server error: ${res.status}`, errorType: "server" }
    }
    const data = await res.json()
    return {
      success: data.success,
      error: data.error ?? null,
      errorType: data.error ? "github" : undefined,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      errorType: "network",
    }
  }
}

/**
 * Ensure a GitHub branch exists, creating it if necessary.
 * @param owner - Repository owner (username or organization)
 * @param repo - Repository name
 * @param branchName - Name of the branch to ensure exists
 * @param sourceBranch - Optional source branch to create from (defaults to 'main' with fallback to 'master')
 * @returns Promise resolving to { success: boolean; created?: boolean; error: string | null; errorType?: ApiErrorType }
 */
export async function ensureBranch(
  owner: string,
  repo: string,
  branchName: string,
  sourceBranch?: string,
): Promise<{ success: boolean; created?: boolean; error: string | null; errorType?: ApiErrorType }> {
  try {
    const res = await fetch(apiUrl("/api/github/ensure-branch"), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ owner, repo, branchName, sourceBranch }),
    })
    if (!res.ok) {
      return { success: false, error: `Server error: ${res.status}`, errorType: "server" }
    }
    const data = await res.json()
    return {
      success: data.success,
      created: data.created,
      error: data.error ?? null,
      errorType: data.error ? "github" : undefined,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      errorType: "network",
    }
  }
}

// Provider status types
export interface ProviderStatusResult {
  total: number
  available: number
  installed: number
  authenticated: number
  providers: Array<{
    id: string
    name: string
    installed: boolean
    authStatus: "authenticated" | "unauthenticated" | "expired" | "unknown"
    available: boolean
  }>
}

export async function getProviders(): Promise<ProviderStatusResult> {
  const response = await fetch(apiUrl("/api/agent/providers"), {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch providers: ${response.status}`)
  }
  return response.json()
}

export async function redetectProviders(): Promise<ProviderStatusResult> {
  const response = await fetch(apiUrl("/api/agent/providers/detect"), {
    method: "POST",
    headers: await authHeaders(),
  })
  if (!response.ok) {
    throw new Error(`Failed to detect providers: ${response.status}`)
  }
  return response.json()
}

/**
 * Reset a task node for re-execution.
 * Closes PR, deletes branch, cleans worktree, clears node fields.
 */
export async function resetTask(
  nodeId: string,
  projectId: string,
  machineId?: string,
): Promise<{ success: boolean; errors?: string[] }> {
  const response = await fetch(apiUrl("/api/dispatch/reset"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ nodeId, projectId, machineId }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Reset failed: ${response.status} ${text}`)
  }

  return response.json()
}

// ============================================================================
// Streaming Events Catch-Up API
// ============================================================================

export interface StreamingEventRow {
  seq: number
  executionId: string
  eventType: string
  data: unknown
  createdAt: string
}

export async function fetchStreamingEventsCatchUp(
  executionIds: string[],
  afterSeq: number,
  limit = 1000,
): Promise<{ events: StreamingEventRow[]; lastSeq: number }> {
  const params = new URLSearchParams({
    executionIds: executionIds.join(','),
    afterSeq: String(afterSeq),
    limit: String(limit),
  })
  const response = await fetch(apiUrl(`/api/events/catch-up?${params}`), {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to fetch streaming events catch-up: ${response.status} ${response.statusText} - ${errorText}`)
  }
  return response.json()
}

// ============================================================================
// Observations API
// ============================================================================

import type { RawObservation, TraceStats } from "@/types/observations"

export async function fetchTraceObservations(traceId: string): Promise<RawObservation[]> {
  const response = await fetch(apiUrl(`/api/observations/${traceId}`), {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch observations: ${response.status}`)
  }
  const json = await response.json()
  return json.data
}

export async function fetchTraceStats(traceId: string): Promise<TraceStats> {
  const response = await fetch(apiUrl(`/api/observations/stats?executionId=${traceId}`), {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch trace stats: ${response.status}`)
  }
  return response.json()
}

export async function fetchTraceSummary(traceId: string): Promise<string> {
  const response = await fetch(apiUrl(`/api/observations/${traceId}/summary`), {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch trace summary: ${response.status}`)
  }
  return response.text()
}
