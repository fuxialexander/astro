import type { PlanNode, PlanEdge } from "@/types"
import { getAccessToken } from "@/lib/supabase-client"

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

async function readSSE(
  response: Response,
  handlers: {
    onText?: (text: string) => void
    onPlanResult?: (result: PlanGraphResult) => void
    onDone?: (sessionId: string) => void
    onError?: (error: string) => void
  },
) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""
  let dataLines: string[] = []

  function flushEvent() {
    if (!currentEvent || dataLines.length === 0) return
    const data = dataLines.join("\n").trim()
    switch (currentEvent) {
      case "text":
        handlers.onText?.(data)
        break
      case "plan_result":
        try {
          handlers.onPlanResult?.(JSON.parse(data))
        } catch {
          handlers.onError?.("Failed to parse plan result")
        }
        break
      case "done":
        try {
          const { sessionId } = JSON.parse(data)
          handlers.onDone?.(sessionId)
        } catch {
          handlers.onDone?.("")
        }
        break
      case "error":
        handlers.onError?.(data)
        break
      case "aborted":
        handlers.onDone?.("")
        break
    }
    currentEvent = ""
    dataLines = []
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (line.startsWith("event:")) {
        flushEvent()
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5))
      } else if (line === "") {
        flushEvent()
      }
    }
  }

  // Flush any remaining event
  flushEvent()
}

export async function generatePlan(
  params: { description: string; visionDoc?: string; projectId: string; model?: string; workingDirectory?: string; fileTree?: string[] },
  callbacks: {
    onText: (text: string) => void
    onPlanResult: (result: PlanGraphResult) => void
    onError: (error: string) => void
    onDone: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/agent/generate-plan", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok) {
    callbacks.onError(`Server error: ${res.status}`)
    return
  }

  await readSSE(res, {
    onText: callbacks.onText,
    onPlanResult: callbacks.onPlanResult,
    onError: callbacks.onError,
    onDone: () => callbacks.onDone(),
  })
}

export async function chatWithAgent(
  params: { message: string; sessionId?: string; projectId: string; visionDoc?: string; model?: string },
  callbacks: {
    onText: (text: string) => void
    onDone: (sessionId: string) => void
    onError: (error: string) => void
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok) {
    callbacks.onError(`Server error: ${res.status}`)
    return
  }

  await readSSE(res, {
    onText: callbacks.onText,
    onDone: callbacks.onDone,
    onError: callbacks.onError,
  })
}

export async function abortAgent(sessionId: string): Promise<void> {
  await fetch("/api/agent/abort", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ sessionId }),
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
  const res = await fetch("/api/agent/task-chat", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok) {
    callbacks.onError(`Server error: ${res.status}`)
    return
  }

  await readSSE(res, {
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
  const response = await fetch("/api/agent/providers", {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch providers: ${response.status}`)
  }
  return response.json()
}

export async function redetectProviders(): Promise<ProviderStatusResult> {
  const response = await fetch("/api/agent/providers/detect", {
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
  const response = await fetch("/api/agent/dispatch", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  })

  if (!response.ok) {
    callbacks.onError?.(`Server error: ${response.status}`)
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError?.("No response body")
    return
  }

  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""
  let dataLines: string[] = []

  function flushEvent() {
    if (!currentEvent || dataLines.length === 0) return
    const data = dataLines.join("\n").trim()

    switch (currentEvent) {
      case "init":
        try {
          callbacks.onInit?.(JSON.parse(data))
        } catch { /* Ignore parse errors for optional callback */ }
        break
      case "text":
        callbacks.onText?.(data)
        break
      case "tool_use":
        try {
          callbacks.onToolUse?.(JSON.parse(data))
        } catch { /* Ignore parse errors for optional callback */ }
        break
      case "tool_result":
        try {
          callbacks.onToolResult?.(JSON.parse(data))
        } catch { /* Ignore parse errors for optional callback */ }
        break
      case "file_change":
        try {
          callbacks.onFileChange?.(JSON.parse(data))
        } catch { /* Ignore parse errors for optional callback */ }
        break
      case "progress":
        try {
          callbacks.onProgress?.(JSON.parse(data))
        } catch { /* Ignore parse errors for optional callback */ }
        break
      case "result":
        try {
          callbacks.onResult?.(JSON.parse(data))
        } catch { /* Ignore parse errors for optional callback */ }
        break
      case "error":
        try {
          const parsed = JSON.parse(data)
          callbacks.onError?.(parsed.error || parsed.message || data)
        } catch {
          callbacks.onError?.(data)
        }
        break
      case "done":
        try {
          callbacks.onDone?.(JSON.parse(data))
        } catch { /* Ignore parse errors for optional callback */ }
        break
      case "aborted":
        callbacks.onDone?.({ executionId: "", nodeId: params.nodeId })
        break
    }
    currentEvent = ""
    dataLines = []
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (line.startsWith("event:")) {
        flushEvent()
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5))
      } else if (line === "") {
        flushEvent()
      }
    }
  }

  // Flush any remaining event
  flushEvent()
}
