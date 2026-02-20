import type { PlanNode, PlanEdge } from "@/types"
import { getAccessToken } from "@/lib/supabase-client"
import { parseChatSSE, parseExecutionSSE } from "@/lib/sse-parser"
import { apiUrl } from "@/lib/api-url"

/**
 * Build headers for authenticated API calls.
 * Includes Supabase access token when available.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const token = await getAccessToken()
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
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
    environment?: PlanNode["environment"]
    verification: PlanNode["verification"]
    position: { x: number; y: number }
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
    type: PlanEdge["type"]
  }>
}

export async function generatePlan(
  params: { description: string; visionDoc?: string; projectId: string; model?: string; providerId?: string; workingDirectory?: string; fileTree?: string[]; keyFiles?: { claudeMd?: string; readmeMd?: string; packageInfo?: string }; targetMachineId?: string },
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
  environment?: string
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
  params: { message: string; sessionId?: string; projectId: string; visionDoc?: string; model?: string; providerId?: string; planNodes?: ChatPlanNodeContext[]; planEdges?: ChatPlanEdgeContext[]; messages?: Array<{ role: 'user' | 'assistant'; content: string }> },
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

export async function abortAgent(sessionId: string): Promise<void> {
  await fetch(apiUrl("/api/agent/abort"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ sessionId }),
  })
}

/** Compact (summarize) a conversation to reduce context size. */
export async function compactConversation(
  params: {
    messages: Array<{ role: "user" | "assistant"; content: string }>
    projectId: string
    model?: string
    providerId?: string
  },
  callbacks: {
    onText: (text: string) => void
    onDone: (sessionId: string) => void
    onError: (error: string) => void
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(apiUrl("/api/agent/compact"), {
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

export interface TaskChatParams {
  message: string
  sessionId?: string
  nodeId: string
  projectId: string
  taskTitle: string
  taskDescription: string
  taskOutput?: string
  visionDoc?: string
  model?: string
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export async function chatWithTask(
  params: TaskChatParams,
  callbacks: {
    onText: (text: string) => void
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
    onDone: callbacks.onDone,
    onError: callbacks.onError,
  })
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

// Dispatch types
export interface DispatchParams {
  nodeId: string
  projectId: string
  taskTitle: string
  taskDescription: string
  taskType?: string
  visionDoc?: string
  dependencyOutputs?: string
  workingDirectory?: string
  model?: string
  providerId?: string
  maxTurns?: number
}

export interface DispatchCallbacks {
  onInit?: (data: { executionId: string; nodeId: string; providerId: string; providerName: string }) => void
  onText?: (text: string) => void
  onToolUse?: (data: { toolName: string; toolInput: unknown }) => void
  onToolResult?: (data: { toolName: string; success: boolean; result: unknown }) => void
  onFileChange?: (data: { path: string; action: string; diff?: string }) => void
  onProgress?: (data: { message: string; percentage?: number }) => void
  onResult?: (data: {
    executionId: string
    nodeId: string
    status: string
    output: string
    metrics?: Record<string, unknown>
  }) => void
  onError?: (error: string) => void
  onDone?: (data: { executionId: string; nodeId: string; sessionId?: string }) => void
}

export async function dispatchTask(
  params: DispatchParams,
  callbacks: DispatchCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(apiUrl("/api/agent/dispatch"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!response.ok) {
    callbacks.onError?.(`Server error: ${response.status}`)
    return
  }

  await parseExecutionSSE(response, {
    onInit: callbacks.onInit,
    onText: callbacks.onText,
    onToolUse: callbacks.onToolUse,
    onToolResult: callbacks.onToolResult,
    onFileChange: callbacks.onFileChange,
    onProgress: callbacks.onProgress,
    onResult: callbacks.onResult,
    onError: callbacks.onError,
    onDone: callbacks.onDone,
  })
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
