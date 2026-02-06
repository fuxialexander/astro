import { create } from "zustand"
import type { TaskExecution, ProviderStatus, PlanNode } from "@/types"
import { usePlanStore } from "./plan-store"
import { useProjectStore } from "./project-store"

interface ExecutionState {
  // Active executions keyed by nodeId
  executions: Map<string, TaskExecution>

  // Provider status
  providers: ProviderStatus[]
  providersLoaded: boolean

  // Currently selected execution for detail view
  selectedExecutionId: string | null

  // Actions
  startExecution: (nodeId: string, projectId: string) => Promise<void>
  cancelExecution: (nodeId: string) => Promise<void>
  getExecution: (nodeId: string) => TaskExecution | undefined
  isExecuting: (nodeId: string) => boolean
  hasActiveExecution: () => boolean

  // Provider actions
  loadProviders: () => Promise<void>
  redetectProviders: () => Promise<void>
  getAvailableProvider: () => ProviderStatus | null

  // Selection
  selectExecution: (nodeId: string | null) => void
}

// Abort controllers for active executions
const abortControllers = new Map<string, AbortController>()

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  executions: new Map(),
  providers: [],
  providersLoaded: false,
  selectedExecutionId: null,

  startExecution: async (nodeId: string, projectId: string) => {
    // Get node and project info
    const planStore = usePlanStore.getState()
    const node = planStore.nodes.find((n) => n.id === nodeId)
    if (!node) {
      console.error("Node not found:", nodeId)
      return
    }

    // Check if already executing
    if (get().isExecuting(nodeId)) {
      console.warn("Node already executing:", nodeId)
      return
    }

    // Check dependencies are met
    const canExecute = canExecuteNode(node, planStore.nodes)
    if (!canExecute.ready) {
      console.error("Dependencies not met:", canExecute.reason)
      return
    }

    // Create abort controller
    const abortController = new AbortController()
    abortControllers.set(nodeId, abortController)

    // Get project for vision doc
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)

    // Build dependency outputs from completed dependencies
    const dependencyOutputs = buildDependencyOutputs(node.dependencies, planStore.nodes)

    // Initialize execution state
    const execution: TaskExecution = {
      nodeId,
      projectId,
      executionId: "",
      status: "pending",
      streamText: "",
      startedAt: new Date(),
    }

    set((state) => {
      const newExecutions = new Map(state.executions)
      newExecutions.set(nodeId, execution)
      return { executions: newExecutions }
    })

    // Update node status to dispatched
    planStore.updateNode(nodeId, { status: "dispatched" })

    try {
      const response = await fetch("/api/agent/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId,
          projectId,
          taskTitle: node.title,
          taskDescription: node.description,
          taskType: getTaskType(node),
          visionDoc: project?.visionDoc,
          dependencyOutputs,
          maxTurns: 50,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      // Process SSE stream
      await processExecutionStream(response, nodeId, set, get, planStore)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Cancelled by user
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.status = "cancelled"
            exec.completedAt = new Date()
          }
          return { executions: newExecutions }
        })
        planStore.updateNode(nodeId, { status: "planned" })
      } else {
        // Error occurred
        const message = error instanceof Error ? error.message : "Unknown error"
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.status = "failure"
            exec.error = message
            exec.completedAt = new Date()
          }
          return { executions: newExecutions }
        })
        planStore.updateNode(nodeId, {
          status: "awaiting_judgment",
          executionError: message,
        })
      }
    } finally {
      abortControllers.delete(nodeId)
    }
  },

  cancelExecution: async (nodeId: string) => {
    const controller = abortControllers.get(nodeId)
    if (controller) {
      controller.abort()
    }

    // Also try to abort on server
    const execution = get().executions.get(nodeId)
    if (execution?.executionId) {
      try {
        await fetch("/api/agent/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: execution.executionId }),
        })
      } catch {
        // Ignore abort errors
      }
    }
  },

  getExecution: (nodeId: string) => {
    return get().executions.get(nodeId)
  },

  isExecuting: (nodeId: string) => {
    const exec = get().executions.get(nodeId)
    return exec?.status === "pending" || exec?.status === "running"
  },

  hasActiveExecution: () => {
    for (const exec of get().executions.values()) {
      if (exec.status === "pending" || exec.status === "running") {
        return true
      }
    }
    return false
  },

  loadProviders: async () => {
    try {
      const response = await fetch("/api/agent/providers")
      if (response.ok) {
        const data = await response.json()
        set({
          providers: data.providers || [],
          providersLoaded: true,
        })
      }
    } catch {
      set({ providersLoaded: true })
    }
  },

  redetectProviders: async () => {
    try {
      const response = await fetch("/api/agent/providers/detect", {
        method: "POST",
      })
      if (response.ok) {
        const data = await response.json()
        set({
          providers: data.providers || [],
          providersLoaded: true,
        })
      }
    } catch {
      // Ignore errors
    }
  },

  getAvailableProvider: () => {
    const available = get().providers.find((p) => p.available)
    return available || null
  },

  selectExecution: (nodeId: string | null) => {
    set({ selectedExecutionId: nodeId })
  },
}))

// Helper: Process SSE stream from dispatch endpoint
async function processExecutionStream(
  response: Response,
  nodeId: string,
  set: (fn: (state: ExecutionState) => Partial<ExecutionState>) => void,
  get: () => ExecutionState,
  planStore: ReturnType<typeof usePlanStore.getState>
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
        handleSSEEvent(currentEvent, data, nodeId, set, get, planStore)
        currentEvent = ""
      }
    }
  }
}

// Helper: Handle individual SSE events
function handleSSEEvent(
  event: string,
  data: string,
  nodeId: string,
  set: (fn: (state: ExecutionState) => Partial<ExecutionState>) => void,
  get: () => ExecutionState,
  planStore: ReturnType<typeof usePlanStore.getState>
) {
  switch (event) {
    case "init": {
      try {
        const parsed = JSON.parse(data)
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.executionId = parsed.executionId
            exec.status = "running"
          }
          return { executions: newExecutions }
        })
        planStore.updateNode(nodeId, {
          status: "in_progress",
          executionId: parsed.executionId,
          executionStartedAt: new Date(),
        })
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "text": {
      set((state) => {
        const newExecutions = new Map(state.executions)
        const exec = newExecutions.get(nodeId)
        if (exec) {
          exec.streamText += data
        }
        return { executions: newExecutions }
      })
      break
    }

    case "result": {
      try {
        const parsed = JSON.parse(data)
        const isSuccess = parsed.status === "success"
        const execution = get().executions.get(nodeId)

        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.status = isSuccess ? "success" : "failure"
            exec.completedAt = new Date()
          }
          return { executions: newExecutions }
        })

        // Determine final node status based on verification type
        const node = planStore.nodes.find((n) => n.id === nodeId)
        let finalStatus: PlanNode["status"]

        if (isSuccess) {
          // Check verification type
          finalStatus = node?.verification === "auto" ? "auto_verified" : "awaiting_judgment"
        } else {
          finalStatus = "awaiting_judgment"
        }

        planStore.updateNode(nodeId, {
          status: finalStatus,
          executionOutput: execution?.streamText || parsed.output,
          executionCompletedAt: new Date(),
        })
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "error": {
      try {
        const parsed = JSON.parse(data)
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.status = "failure"
            exec.error = parsed.error
            exec.completedAt = new Date()
          }
          return { executions: newExecutions }
        })
        planStore.updateNode(nodeId, {
          status: "awaiting_judgment",
          executionError: parsed.error,
        })
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "aborted": {
      set((state) => {
        const newExecutions = new Map(state.executions)
        const exec = newExecutions.get(nodeId)
        if (exec) {
          exec.status = "cancelled"
          exec.completedAt = new Date()
        }
        return { executions: newExecutions }
      })
      planStore.updateNode(nodeId, { status: "planned" })
      break
    }
  }
}

// Helper: Check if a node's dependencies are met
interface CanExecuteResult {
  ready: boolean
  reason?: string
  pendingDependencies?: string[]
}

export function canExecuteNode(node: PlanNode, allNodes: PlanNode[]): CanExecuteResult {
  if (node.dependencies.length === 0) {
    return { ready: true }
  }

  const pendingDependencies: string[] = []

  for (const depId of node.dependencies) {
    const depNode = allNodes.find((n) => n.id === depId)
    if (!depNode) {
      return { ready: false, reason: `Dependency ${depId} not found` }
    }

    // Check if dependency is completed (either auto_verified, completed, or awaiting_judgment that was approved)
    const completedStatuses: PlanNode["status"][] = ["completed", "auto_verified"]
    if (!completedStatuses.includes(depNode.status)) {
      pendingDependencies.push(depNode.title)
    }
  }

  if (pendingDependencies.length > 0) {
    return {
      ready: false,
      reason: `Waiting for: ${pendingDependencies.join(", ")}`,
      pendingDependencies,
    }
  }

  return { ready: true }
}

// Helper: Build dependency outputs string from completed dependencies
function buildDependencyOutputs(dependencyIds: string[], allNodes: PlanNode[]): string | undefined {
  const outputs: string[] = []

  for (const depId of dependencyIds) {
    const depNode = allNodes.find((n) => n.id === depId)
    if (depNode?.executionOutput) {
      outputs.push(`### ${depNode.title}\n\n${depNode.executionOutput}`)
    }
  }

  return outputs.length > 0 ? outputs.join("\n\n---\n\n") : undefined
}

// Helper: Map node type to task type
function getTaskType(node: PlanNode): string {
  // Map node types to task types
  switch (node.type) {
    case "task":
      return "code_generation"
    case "milestone":
      return "code_review"
    case "decision":
      return "general"
    case "branch":
      return "code_analysis"
    default:
      return "general"
  }
}
