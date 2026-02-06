import type { PlanNode, PlanEdge } from "@/types"

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

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    let currentEvent = ""
    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        const data = line.slice(5).trim()
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
      }
    }
  }
}

export async function generatePlan(
  params: { description: string; visionDoc?: string; projectId: string; model?: string },
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  })
}
