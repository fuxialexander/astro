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
export function getActiveTeamId(): string | undefined {
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

export async function projectChatWithAgent(
  params: { message: string; sessionId?: string; streamId?: string; projectId: string; visionDoc?: string; model?: string; providerId?: string; planNodes?: ChatPlanNodeContext[]; planEdges?: ChatPlanEdgeContext[]; selectedBackends?: string[]; messages?: Array<{ role: 'user' | 'assistant'; content: string }>; taskType?: 'plan' | 'execution'; imageRefs?: string[] },
  callbacks: {
    onText: (text: string) => void
    onOperational?: (data: { message: string; source: 'astro' | 'git' | 'delivery' }) => void
    onToolUse?: (data: { toolName: string; toolInput: unknown }) => void
    onToolResult?: (data: { toolName: string; success: boolean; result: unknown }) => void
    onDone: (sessionId: string) => void
    onError: (error: string) => void
    /** Called with each SSE seq number — track for disconnect catch-up */
    onSeq?: (seq: number) => void
    /** Called when the done event includes usage metrics */
    onMetrics?: (metrics: { durationMs?: number; inputTokens?: number; outputTokens?: number; totalCost?: number; model?: string; numTurns?: number }) => void
    /** Called when conversation history was compacted before this turn */
    onCompaction?: (data: { originalCount: number; compactedCount: number; summary: string }) => void
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(apiUrl("/api/agent/project-chat"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok) {
    let errorMsg = `Server error: ${res.status}`
    try { const b = await res.json(); if (b.error) errorMsg += ` – ${b.error}` } catch { /* non-JSON */ }
    callbacks.onError(errorMsg)
    return
  }

  let terminated = false
  await parseChatSSE(res, {
    onText: callbacks.onText,
    onOperational: callbacks.onOperational,
    onToolUse: callbacks.onToolUse,
    onToolResult: callbacks.onToolResult,
    onDone: (sessionId) => { terminated = true; callbacks.onDone(sessionId) },
    onError: (error) => { terminated = true; callbacks.onError(error) },
    onSeq: callbacks.onSeq,
    onMetrics: callbacks.onMetrics,
    onCompaction: callbacks.onCompaction,
  })

  // If the stream ended without a done/error event (server crash, network drop),
  // fire onDone so the frontend clears streaming state instead of hanging forever.
  if (!terminated) {
    callbacks.onDone("")
  }
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
  providerId?: string
  selectedBackends?: string[]
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Branch name from the execution (for resumed session context) */
  branchName?: string
  /** PR URL from the execution (for resumed session context) */
  prUrl?: string
  /** Blob IDs for attached images (multimodal chat) */
  imageRefs?: string[]
}

export async function chatWithTask(
  params: TaskChatParams,
  callbacks: {
    onText: (text: string) => void
    onOperational?: (data: { message: string; source: 'astro' | 'git' | 'delivery' }) => void
    onToolUse?: (data: { toolName: string; toolInput: unknown }) => void
    onToolResult?: (data: { toolName: string; success: boolean; result: unknown }) => void
    onDone: (sessionId: string) => void
    onError: (error: string) => void
    /** Called with each SSE seq number — track for disconnect catch-up */
    onSeq?: (seq: number) => void
    /** Called when the done event includes usage metrics */
    onMetrics?: (metrics: { durationMs?: number; inputTokens?: number; outputTokens?: number; totalCost?: number; model?: string; numTurns?: number }) => void
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
    let errorMsg = `Server error: ${res.status}`
    try { const b = await res.json(); if (b.error) errorMsg += ` – ${b.error}` } catch { /* non-JSON */ }
    callbacks.onError(errorMsg)
    return
  }

  let terminated = false
  await parseChatSSE(res, {
    onText: callbacks.onText,
    onOperational: callbacks.onOperational,
    onToolUse: callbacks.onToolUse,
    onToolResult: callbacks.onToolResult,
    onDone: (sessionId) => { terminated = true; callbacks.onDone(sessionId) },
    onError: (error) => { terminated = true; callbacks.onError(error) },
    onSeq: callbacks.onSeq,
    onMetrics: callbacks.onMetrics,
  })

  if (!terminated) {
    callbacks.onDone("")
  }
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

// ── GitHub PR Details API ─────────────────────────────────────────────

export interface PrDiffStats {
  additions: number
  deletions: number
  changedFiles: number
}

export interface PrDetails {
  number: number
  title: string
  body: string | null
  state: string
  branch: string
  baseBranch: string
  htmlUrl: string
  merged: boolean
  mergeable: boolean | null
  mergedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  user: { login: string; avatarUrl: string }
  diffStats: PrDiffStats
  reviewStatus: string
  requestedReviewers: Array<{ login: string; avatarUrl: string }>
  labels: Array<{ name: string; color: string }>
  draft: boolean
}

export interface PrCheckRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  htmlUrl: string
  app: { name: string; slug: string } | null
}

export interface PrChecksResult {
  headSha: string
  totalCount: number
  overallStatus: string
  checks: PrCheckRun[]
}

export interface PrReview {
  id: number
  user: { login: string; avatarUrl: string }
  state: string
  body: string | null
  submittedAt: string | null
  htmlUrl: string
}

export interface PrReviewsResult {
  reviews: PrReview[]
  overallReviewStatus: string
  reviewerCount: number
}

// ── PR action types and functions ────────────────────────────────────

export type PrReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
export type PrMergeMethod = 'squash' | 'merge' | 'rebase'

export interface PrReviewResult {
  success: boolean
  error: string | null
  errorType?: ApiErrorType
  review?: {
    id: number
    state: string
    htmlUrl: string
    submittedAt: string
  }
}

export interface PrMergeResult {
  success: boolean
  error: string | null
  errorType?: ApiErrorType
  merge?: {
    sha: string
    message: string
    merged: boolean
  }
}

export interface PrCommentResult {
  success: boolean
  error: string | null
  errorType?: ApiErrorType
  comment?: {
    id: number
    htmlUrl: string
    createdAt: string
    user?: {
      login: string
      avatarUrl: string
      id: number
    }
  }
}

/**
 * Fetch full PR details: title, body, branch, diff stats, merge status, review state, reviewers.
 */
export async function fetchPrDetails(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrDetails> {
  const response = await fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${prNumber}`), {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to fetch PR details: ${response.status} ${errorText}`)
  }
  return response.json()
}

/**
 * Fetch CI check runs and their statuses for a PR.
 */
export async function fetchPrChecks(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrChecksResult> {
  const response = await fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${prNumber}/checks`), {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to fetch PR checks: ${response.status} ${errorText}`)
  }
  return response.json()
}

/**
 * Fetch review decisions for a PR.
 */
export async function fetchPrReviews(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrReviewsResult> {
  const response = await fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${prNumber}/reviews`), {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to fetch PR reviews: ${response.status} ${errorText}`)
  }
  return response.json()
}

/**
 * Submit a PR review (approve, request changes, or comment).
 * Posts as the authenticated user.
 */
export async function submitPrReview(
  owner: string,
  repo: string,
  prNumber: number,
  event: PrReviewEvent,
  body?: string,
): Promise<PrReviewResult> {
  try {
    const res = await fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${prNumber}/review`), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ event, body }),
    })
    if (!res.ok) {
      return { success: false, error: `Server error: ${res.status}`, errorType: "server" }
    }
    const data = await res.json()
    return {
      success: data.success,
      error: data.error ?? null,
      errorType: data.error ? "github" : undefined,
      review: data.review,
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
 * Merge a PR with the specified method.
 * Uses installation token (higher permissions) when available.
 */
export async function mergePr(
  owner: string,
  repo: string,
  prNumber: number,
  mergeMethod: PrMergeMethod = 'squash',
  commitTitle?: string,
  commitMessage?: string,
): Promise<PrMergeResult> {
  try {
    const res = await fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${prNumber}/merge`), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ mergeMethod, commitTitle, commitMessage }),
    })
    if (!res.ok) {
      return { success: false, error: `Server error: ${res.status}`, errorType: "server" }
    }
    const data = await res.json()
    return {
      success: data.success,
      error: data.error ?? null,
      errorType: data.error ? "github" : undefined,
      merge: data.merge,
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
 * Post a comment on a PR.
 * Posts as the authenticated user.
 */
export async function commentOnPr(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<PrCommentResult> {
  try {
    const res = await fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${prNumber}/comment`), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ body }),
    })
    if (!res.ok) {
      return { success: false, error: `Server error: ${res.status}`, errorType: "server" }
    }
    const data = await res.json()
    return {
      success: data.success,
      error: data.error ?? null,
      errorType: data.error ? "github" : undefined,
      comment: data.comment,
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
 * Mark a draft PR as ready for review.
 */
export async function markPrReady(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ success: boolean; error: string | null; errorType?: ApiErrorType }> {
  try {
    const res = await fetch(apiUrl(`/api/github/pr/${owner}/${repo}/${prNumber}/ready`), {
      method: "PUT",
      headers: await authHeaders(),
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
 * Edit an existing issue/PR comment on GitHub.
 */
export async function editGitHubComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const res = await fetch(apiUrl(`/api/github/comments/${owner}/${repo}/${commentId}`), {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify({ body }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { success: false, error: data.error || `Server error: ${res.status}` }
    }
    return { success: true, error: null }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Delete an issue/PR comment on GitHub.
 */
export async function deleteGitHubComment(
  owner: string,
  repo: string,
  commentId: number,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const res = await fetch(apiUrl(`/api/github/comments/${owner}/${repo}/${commentId}`), {
      method: "DELETE",
      headers: await authHeaders(),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { success: false, error: data.error || `Server error: ${res.status}` }
    }
    return { success: true, error: null }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Manually link a GitHub PR to a plan node.
 */
export async function linkPrToNode(
  nodeId: string,
  projectId: string,
  prNumber: number,
  prUrl: string,
  branchName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(apiUrl("/api/github/pr/link"), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ nodeId, projectId, prNumber, prUrl, branchName }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { success: false, error: data.error || `Server error: ${res.status}` }
    }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Fetch all plan nodes in a project that have PR/branch links.
 */
export async function fetchPrLinks(
  projectId: string,
): Promise<Array<{
  clientId: string
  title: string
  status: string
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  mergeQueueStatus: string | null
}>> {
  const res = await fetch(apiUrl(`/api/github/pr/links/${projectId}`), {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to fetch PR links: ${res.status}`)
  const data = await res.json()
  return data.links
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

/**
 * Bulk reset multiple task nodes for re-execution.
 * Used during replan to reset all archived tasks at once.
 */
export async function bulkResetTasks(
  nodeIds: string[],
  projectId: string,
): Promise<{ success: boolean; errors?: string[] }> {
  const response = await fetch(apiUrl("/api/dispatch/bulk-reset"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ nodeIds, projectId }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Bulk reset failed: ${response.status} ${text}`)
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
  limit = 2000,
): Promise<{ events: StreamingEventRow[]; lastSeq: number }> {
  const allEvents: StreamingEventRow[] = []
  let currentSeq = afterSeq
  const headers = await authHeaders()

  // Paginate until all events are fetched (cap at 50 pages to avoid infinite loops)
  const MAX_PAGES = 50
  for (let page_i = 0; page_i < MAX_PAGES; page_i++) {
    const params = new URLSearchParams({
      executionIds: executionIds.join(','),
      afterSeq: String(currentSeq),
      limit: String(limit),
    })
    const response = await fetch(apiUrl(`/api/events/catch-up?${params}`), {
      headers,
    })
    if (!response.ok) {
      return { events: allEvents, lastSeq: currentSeq }
    }
    const page = await response.json() as { events: StreamingEventRow[]; lastSeq: number; hasMore?: boolean }
    allEvents.push(...page.events)
    currentSeq = page.lastSeq

    if (!page.hasMore || page.events.length === 0) break
  }

  return { events: allEvents, lastSeq: currentSeq }
}

/**
 * Replay caught-up streaming events through chat callbacks.
 * Used after a network disconnect to reconstruct missed chat events.
 * Returns whether a `done` event was found (turn completed server-side)
 * and the highest seq number encountered.
 */
export function replayChatCatchUpEvents(
  events: StreamingEventRow[],
  callbacks: {
    onText?: (text: string) => void
    onToolUse?: (data: { toolName: string; toolInput: unknown }) => void
    onToolResult?: (data: { toolName: string; success: boolean; result: unknown }) => void
    onDone?: (sessionId: string) => void
    onError?: (error: string) => void
  },
): { completed: boolean; lastSeq: number } {
  let completed = false
  let lastSeq = 0
  for (const event of events) {
    const data = event.data as Record<string, unknown>
    lastSeq = event.seq
    switch (event.eventType) {
      case 'text':
        callbacks.onText?.((data.text as string) || '')
        break
      case 'tool_use':
        callbacks.onToolUse?.({
          toolName: (data.toolName as string) || '',
          toolInput: data.toolInput,
        })
        break
      case 'tool_result':
        callbacks.onToolResult?.({
          toolName: (data.toolName as string) || '',
          success: (data.success as boolean) ?? true,
          result: data.result,
        })
        break
      case 'done':
        try {
          callbacks.onDone?.((data.sessionId as string) || '')
        } catch {
          callbacks.onDone?.('')
        }
        completed = true
        break
      case 'error':
        callbacks.onError?.((data.error as string) || (data.message as string) || '')
        break
    }
  }
  return { completed, lastSeq }
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

// ============================================================================
// Examples API
// ============================================================================

import type {
  UseCaseTemplate,
  UseCaseTemplateSummary,
  ResolvedParameters,
  TemplateValidationResult,
} from "@astro/core/templates"

export interface ExampleCategory {
  category: string
  count: number
  templates: Array<{
    id: string
    name: string
    icon?: string
  }>
}

export interface ExamplesListResult {
  templates: UseCaseTemplateSummary[]
  count: number
  categories: string[]
}

export interface ExampleDetailsResult {
  template: UseCaseTemplate
  validation: TemplateValidationResult
}

export interface ParameterValidationError {
  parameterId: string
  message: string
  code: 'MISSING_REQUIRED' | 'INVALID_TYPE' | 'INVALID_VALUE' | 'INVALID_PATTERN' | 'OUT_OF_RANGE'
}

export interface ExampleValidationParams {
  valid: boolean
  errors: ParameterValidationError[]
  resolvedParameters: ResolvedParameters
}

export interface LaunchExampleParams {
  parameters: Record<string, unknown>
  projectName?: string
  workingDirectory?: string
  targetMachineId?: string
  /** Optional vision doc override (e.g. combined skill instructions) */
  visionDoc?: string
  model?: string
  preferredProvider?: string
  fileTree?: string[]
  keyFiles?: {
    claudeMd?: string
    readmeMd?: string
    packageInfo?: string
  }
  gitState?: {
    currentBranch: string
    targetBranch: string
    isDirty: boolean
    dirtyDetails?: {
      staged: number
      unstaged: number
      untracked: number
    }
  }
}

export interface LaunchExampleResult {
  project: {
    id: string
    name: string
    description: string
    [key: string]: unknown
  }
  templateUsed: {
    id: string
    name: string
    version: string
  }
  resolvedParameters: ResolvedParameters
  planHints?: unknown
  executionConfig?: unknown
  parallelizationConfig?: unknown
  planGenerationRequest: {
    projectId: string
    description: string
    visionDoc: string
    model?: string
    preferredProvider?: string
    workingDirectory?: string
    targetMachineId?: string
    fileTree?: string[]
    keyFiles?: Record<string, string>
    gitState?: Record<string, unknown>
  }
}

export interface PreviewExampleResult {
  templateId: string
  templateName: string
  resolvedParameters: ResolvedParameters
  interpolatedPrompts: {
    planGeneration: string
    taskExecution?: string
    planRefinement?: string
    sharedContext?: string
  }
  planHints?: unknown
  executionConfig?: unknown
  parallelizationConfig?: unknown
}

/**
 * Get all available examples, optionally filtered by category.
 * @param category - Optional category to filter by
 * @returns List of example summaries
 */
export async function getExamples(category?: string): Promise<ExamplesListResult> {
  const params = new URLSearchParams()
  if (category) {
    params.set('category', category)
  }

  const url = apiUrl(`/api/examples${params.toString() ? `?${params}` : ''}`)
  const response = await fetch(url, {
    headers: await authHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch examples: ${response.status}`)
  }

  return response.json()
}

/**
 * Get all example categories with counts and example lists.
 * @returns List of categories with their examples
 */
export async function getExampleCategories(): Promise<{ categories: ExampleCategory[] }> {
  const response = await fetch(apiUrl('/api/examples/categories'), {
    headers: await authHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch example categories: ${response.status}`)
  }

  return response.json()
}

/**
 * Get full details for a specific example including parameter schema.
 * @param id - Example ID (will be URL-encoded, e.g., "astro/web-app")
 * @returns Example details with validation result
 */
export async function getExample(id: string): Promise<ExampleDetailsResult> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/examples/${encodedId}`), {
    headers: await authHeaders(),
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Example not found: ${id}`)
    }
    throw new Error(`Failed to fetch example: ${response.status}`)
  }

  return response.json()
}

/**
 * Validate parameters against an example's schema without launching.
 * Useful for real-time form validation.
 * @param id - Example ID (will be URL-encoded)
 * @param params - Parameters to validate
 * @returns Validation result with resolved parameters
 */
export async function validateExampleParams(
  id: string,
  params: Record<string, unknown>
): Promise<ExampleValidationParams> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/examples/${encodedId}/validate`), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ parameters: params }),
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Example not found: ${id}`)
    }
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Validation failed: ${response.status}`)
  }

  return response.json()
}

/**
 * Launch an example with provided parameters.
 * Creates a new project and returns configuration for plan generation.
 * @param id - Example ID (will be URL-encoded)
 * @param params - Launch parameters including example parameters and project config
 * @returns Created project and plan generation request
 */
export async function launchExample(
  id: string,
  params: LaunchExampleParams
): Promise<LaunchExampleResult> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/examples/${encodedId}/launch`), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    if (response.status === 404) {
      throw new Error(`Example not found: ${id}`)
    }
    if (response.status === 400 && errorData.details) {
      throw new Error(`Validation failed: ${JSON.stringify(errorData.details)}`)
    }
    throw new Error(errorData.error || `Failed to launch example: ${response.status}`)
  }

  return response.json()
}

/**
 * Preview what an example launch would produce without creating anything.
 * Returns interpolated prompts and project configuration.
 * @param id - Example ID (will be URL-encoded)
 * @param params - Parameters to preview with
 * @returns Preview of interpolated prompts and configuration
 */
export async function previewExample(
  id: string,
  params: Record<string, unknown>
): Promise<PreviewExampleResult> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/examples/${encodedId}/preview`), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ parameters: params }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    if (response.status === 404) {
      throw new Error(`Example not found: ${id}`)
    }
    if (response.status === 400 && errorData.details) {
      throw new Error(`Validation failed: ${JSON.stringify(errorData.details)}`)
    }
    throw new Error(errorData.error || `Failed to preview example: ${response.status}`)
  }

  return response.json()
}
