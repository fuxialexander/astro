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
  params: { description: string; visionDoc?: string; projectId: string; model?: string; providerId?: string; workingDirectory?: string; fileTree?: string[]; keyFiles?: { claudeMd?: string; readmeMd?: string; packageInfo?: string }; targetMachineId?: string; gitState?: { currentBranch: string; targetBranch: string; isDirty: boolean; dirtyDetails?: { staged: number; unstaged: number; untracked: number } }; streamId?: string },
  callbacks: {
    onText: (text: string) => void
    onPlanResult: (result: PlanGraphResult) => void
    onError: (error: string) => void
    onDone: () => void
    /** Called when an SSE `id:` field is received — tracks last seq for reconnection */
    onId?: (id: string) => void
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
    let errorMsg = `Server error: ${res.status}`
    try {
      const body = await res.json()
      if (body.error) errorMsg += ` – ${body.error}`
      if (body.details) console.error(`[plan-gen] Validation details:`, body.details)
    } catch { /* non-JSON response */ }
    console.error(`[plan-gen] ${errorMsg}`)
    callbacks.onError(errorMsg)
    return
  }

  console.log(`[plan-gen] SSE stream opened for projectId=${params.projectId}`)

  await parseChatSSE(res, {
    onText: callbacks.onText,
    onId: callbacks.onId,
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
    let errorMsg = `Server error: ${res.status}`
    try { const b = await res.json(); if (b.error) errorMsg += ` – ${b.error}` } catch { /* non-JSON */ }
    callbacks.onError(errorMsg)
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
    /** Called with each SSE seq number — track for disconnect catch-up */
    onSeq?: (seq: number) => void
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
    let errorMsg = `Server error: ${res.status}`
    try { const b = await res.json(); if (b.error) errorMsg += ` – ${b.error}` } catch { /* non-JSON */ }
    callbacks.onError(errorMsg)
    return
  }

  await parseChatSSE(res, {
    onText: callbacks.onText,
    onToolUse: callbacks.onToolUse,
    onToolResult: callbacks.onToolResult,
    onDone: callbacks.onDone,
    onError: callbacks.onError,
    onSeq: callbacks.onSeq,
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
    /** Called with each SSE seq number — track for disconnect catch-up */
    onSeq?: (seq: number) => void
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

  await parseChatSSE(res, {
    onText: callbacks.onText,
    onToolUse: callbacks.onToolUse,
    onToolResult: callbacks.onToolResult,
    onDone: callbacks.onDone,
    onError: callbacks.onError,
    onSeq: callbacks.onSeq,
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
// Templates API
// ============================================================================

import type {
  UseCaseTemplate,
  UseCaseTemplateSummary,
  UseCaseParameter,
  ResolvedParameters,
  TemplateValidationResult,
} from "@astro/core/templates"

export interface TemplateCategory {
  category: string
  count: number
  templates: Array<{
    id: string
    name: string
    icon?: string
  }>
}

export interface TemplatesListResult {
  templates: UseCaseTemplateSummary[]
  count: number
  categories: string[]
}

export interface TemplateDetailsResult {
  template: UseCaseTemplate
  validation: TemplateValidationResult
}

export interface TemplateSchemaResult {
  templateId: string
  templateName: string
  requiredParameters: UseCaseParameter[]
  optionalParameters: UseCaseParameter[]
  parameterGroups: Record<string, UseCaseParameter[]>
}

export interface ParameterValidationError {
  parameterId: string
  message: string
  code: 'MISSING_REQUIRED' | 'INVALID_TYPE' | 'INVALID_VALUE' | 'INVALID_PATTERN' | 'OUT_OF_RANGE'
}

export interface TemplateValidationParams {
  valid: boolean
  errors: ParameterValidationError[]
  resolvedParameters: ResolvedParameters
}

export interface LaunchTemplateParams {
  parameters: Record<string, unknown>
  projectName?: string
  workingDirectory?: string
  targetMachineId?: string
  model?: string
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

export interface LaunchTemplateResult {
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
    workingDirectory?: string
    targetMachineId?: string
    fileTree?: string[]
    keyFiles?: Record<string, string>
    gitState?: Record<string, unknown>
  }
}

export interface PreviewTemplateResult {
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
 * Get all available templates, optionally filtered by category.
 * @param category - Optional category to filter by
 * @returns List of template summaries
 */
export async function getTemplates(category?: string): Promise<TemplatesListResult> {
  const params = new URLSearchParams()
  if (category) {
    params.set('category', category)
  }

  const url = apiUrl(`/api/templates${params.toString() ? `?${params}` : ''}`)
  const response = await fetch(url, {
    headers: await authHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch templates: ${response.status}`)
  }

  return response.json()
}

/**
 * Get all template categories with counts and template lists.
 * @returns List of categories with their templates
 */
export async function getTemplateCategories(): Promise<{ categories: TemplateCategory[] }> {
  const response = await fetch(apiUrl('/api/templates/categories'), {
    headers: await authHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch template categories: ${response.status}`)
  }

  return response.json()
}

/**
 * Get full details for a specific template including parameter schema.
 * @param id - Template ID (will be URL-encoded, e.g., "astro/web-app")
 * @returns Template details with validation result
 */
export async function getTemplate(id: string): Promise<TemplateDetailsResult> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/templates/${encodedId}`), {
    headers: await authHeaders(),
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Template not found: ${id}`)
    }
    throw new Error(`Failed to fetch template: ${response.status}`)
  }

  return response.json()
}

/**
 * Get only the parameter schema for a template (for form generation).
 * @param id - Template ID (will be URL-encoded)
 * @returns Parameter schema with grouped parameters
 */
export async function getTemplateSchema(id: string): Promise<TemplateSchemaResult> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/templates/${encodedId}/schema`), {
    headers: await authHeaders(),
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Template not found: ${id}`)
    }
    throw new Error(`Failed to fetch template schema: ${response.status}`)
  }

  return response.json()
}

/**
 * Validate parameters against a template's schema without launching.
 * Useful for real-time form validation.
 * @param id - Template ID (will be URL-encoded)
 * @param params - Parameters to validate
 * @returns Validation result with resolved parameters
 */
export async function validateTemplateParams(
  id: string,
  params: Record<string, unknown>
): Promise<TemplateValidationParams> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/templates/${encodedId}/validate`), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ parameters: params }),
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Template not found: ${id}`)
    }
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Validation failed: ${response.status}`)
  }

  return response.json()
}

/**
 * Launch a template with provided parameters.
 * Creates a new project and returns configuration for plan generation.
 * @param id - Template ID (will be URL-encoded)
 * @param params - Launch parameters including template parameters and project config
 * @returns Created project and plan generation request
 */
export async function launchTemplate(
  id: string,
  params: LaunchTemplateParams
): Promise<LaunchTemplateResult> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/templates/${encodedId}/launch`), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    if (response.status === 404) {
      throw new Error(`Template not found: ${id}`)
    }
    if (response.status === 400 && errorData.details) {
      throw new Error(`Validation failed: ${JSON.stringify(errorData.details)}`)
    }
    throw new Error(errorData.error || `Failed to launch template: ${response.status}`)
  }

  return response.json()
}

/**
 * Preview what a template launch would produce without creating anything.
 * Returns interpolated prompts and project configuration.
 * @param id - Template ID (will be URL-encoded)
 * @param params - Parameters to preview with
 * @returns Preview of interpolated prompts and configuration
 */
export async function previewTemplate(
  id: string,
  params: Record<string, unknown>
): Promise<PreviewTemplateResult> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/templates/${encodedId}/preview`), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ parameters: params }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    if (response.status === 404) {
      throw new Error(`Template not found: ${id}`)
    }
    if (response.status === 400 && errorData.details) {
      throw new Error(`Validation failed: ${JSON.stringify(errorData.details)}`)
    }
    throw new Error(errorData.error || `Failed to preview template: ${response.status}`)
  }

  return response.json()
}

export interface ApplyTemplateResult {
  projectId: string
  description: string
  visionDoc?: string
  resolvedParameters: ResolvedParameters
  templateUsed: {
    id: string
    name: string
    version: string
  }
  planHints?: unknown
}

/**
 * Apply a template to an existing project.
 * Returns a plan generation request that can be used with /api/agent/generate-plan.
 * @param id - Template ID (will be URL-encoded)
 * @param projectId - ID of the existing project
 * @param params - Template parameters
 * @returns Plan generation request data
 */
export async function applyTemplate(
  id: string,
  projectId: string,
  params: Record<string, unknown>
): Promise<ApplyTemplateResult> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(apiUrl(`/api/templates/${encodedId}/apply`), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ projectId, parameters: params }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    if (response.status === 404) {
      throw new Error(errorData.error || `Template or project not found`)
    }
    if (response.status === 400 && errorData.details) {
      throw new Error(`Validation failed: ${JSON.stringify(errorData.details)}`)
    }
    throw new Error(errorData.error || `Failed to apply template: ${response.status}`)
  }

  return response.json()
}

// ============================================================================
// Custom Template API Functions
// ============================================================================

export interface CustomTemplateInput {
  name: string
  description?: string
  category?: string
  version?: string
  icon?: string
  tags?: string[]
  maturity?: 'stable' | 'beta' | 'experimental'
  enabled?: boolean
  requiredParameters?: Array<{
    id: string
    name: string
    description: string
    type: string
    required: boolean
    default?: unknown
    placeholder?: string
    options?: Array<{ label: string; value: string; description?: string }>
    validation?: { min?: number; max?: number; pattern?: string; message?: string }
    visibleWhen?: { parameterId: string; operator: string; value?: unknown }
    group?: string
    order?: number
  }>
  optionalParameters?: Array<{
    id: string
    name: string
    description: string
    type: string
    required: boolean
    default?: unknown
    placeholder?: string
    options?: Array<{ label: string; value: string; description?: string }>
    validation?: { min?: number; max?: number; pattern?: string; message?: string }
    visibleWhen?: { parameterId: string; operator: string; value?: unknown }
    group?: string
    order?: number
  }>
  prompts: {
    planGeneration: string
    taskExecution?: string
    planRefinement?: string
    sharedContext?: string
  }
  execution?: {
    preferredModel?: string
    maxTurns?: number
    maxBudgetPerTask?: number
    skills?: string[]
    deliveryMode?: string
    skipSafetyCheck?: boolean
    defaultVerification?: string
  }
  parallelization?: {
    maxConcurrentTasks?: number
    autoDispatch?: boolean
    defaultPriority?: string
    retry?: { maxRetries: number; retryDelayMs: number; exponentialBackoff: boolean }
    machineSelectionPolicy?: string
    requiredMachineLabels?: string[]
  }
  planHints?: {
    targetNodeCount?: { min: number; max: number }
    defaultEstimate?: string
    suggestedMilestones?: Array<{ title: string; description: string }>
    commonLabels?: string[]
    preferParallelTasks?: boolean
  }
  sourceProjectId?: string
  teamId?: string
}

export interface CustomTemplateResult {
  template: UseCaseTemplate & {
    isOwner?: boolean
    canEdit?: boolean
  }
  message?: string
}

export interface CustomTemplatesListResult {
  templates: Array<UseCaseTemplate & {
    isOwner: boolean
    canEdit: boolean
  }>
  count: number
}

/**
 * Get all custom templates for the current user (including team templates).
 * @returns List of custom templates with ownership info
 */
export async function getCustomTemplates(): Promise<CustomTemplatesListResult> {
  const response = await fetch(apiUrl('/api/templates/custom'), {
    headers: await authHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch custom templates: ${response.status}`)
  }

  return response.json()
}

/**
 * Get a specific custom template by ID.
 * @param id - Custom template UUID (without 'custom/' prefix)
 * @returns Template details with ownership info
 */
export async function getCustomTemplate(id: string): Promise<CustomTemplateResult> {
  const response = await fetch(apiUrl(`/api/templates/custom/${id}`), {
    headers: await authHeaders(),
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Template not found')
    }
    throw new Error(`Failed to fetch custom template: ${response.status}`)
  }

  return response.json()
}

/**
 * Create a new custom template.
 * @param input - Template data
 * @returns Created template
 */
export async function createCustomTemplate(input: CustomTemplateInput): Promise<CustomTemplateResult> {
  const response = await fetch(apiUrl('/api/templates/custom'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    if (response.status === 400 && errorData.details) {
      throw new Error(`Validation failed: ${JSON.stringify(errorData.details)}`)
    }
    throw new Error(errorData.error || `Failed to create template: ${response.status}`)
  }

  return response.json()
}

/**
 * Update an existing custom template.
 * @param id - Custom template UUID (without 'custom/' prefix)
 * @param input - Partial template data to update
 * @returns Updated template
 */
export async function updateCustomTemplate(
  id: string,
  input: Partial<CustomTemplateInput>
): Promise<CustomTemplateResult> {
  const response = await fetch(apiUrl(`/api/templates/custom/${id}`), {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    if (response.status === 404) {
      throw new Error('Template not found')
    }
    if (response.status === 403) {
      throw new Error('Permission denied')
    }
    if (response.status === 400 && errorData.details) {
      throw new Error(`Validation failed: ${JSON.stringify(errorData.details)}`)
    }
    throw new Error(errorData.error || `Failed to update template: ${response.status}`)
  }

  return response.json()
}

/**
 * Delete a custom template. Only the author can delete.
 * @param id - Custom template UUID (without 'custom/' prefix)
 * @returns Success message
 */
export async function deleteCustomTemplate(id: string): Promise<{ message: string }> {
  const response = await fetch(apiUrl(`/api/templates/custom/${id}`), {
    method: 'DELETE',
    headers: await authHeaders(),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    if (response.status === 404) {
      throw new Error('Template not found')
    }
    if (response.status === 403) {
      throw new Error('Only the template author can delete it')
    }
    throw new Error(errorData.error || `Failed to delete template: ${response.status}`)
  }

  return response.json()
}
