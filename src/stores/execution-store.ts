import { create } from "zustand"
import type { TaskExecution, ProviderStatus, PlanNode, ToolTrace, FileChange, UsageMetrics, Project } from "@/types"
import { usePlanStore } from "./plan-store"
import { useProjectStore } from "./project-store"
import { useUsageStore } from "./usage-store"

// Helper: Resolve working directory from project config
// For remote/hpc/cloud environments, a git repository URL is required unless
// a defaultMachineId is set (meaning code lives on that specific machine).
// For local, prefer workingDirectory, fall back to repository.
export function getProjectWorkingDir(
  project: Project | undefined,
  environment: 'local' | 'remote' | 'hpc' | 'cloud' = 'local',
): {
  ok: boolean
  dir?: string
  source?: 'local' | 'repository' | 'remote-path'
  message?: string
} {
  const isRemote = environment !== 'local'

  if (isRemote) {
    // If project has a defaultMachineId + workingDirectory but no repository,
    // the code only exists on that machine — use the working directory as path
    if (project?.defaultMachineId && project?.workingDirectory && !project?.repository) {
      return { ok: true, dir: project.workingDirectory, source: 'remote-path' }
    }
    // Remote environments can use a git repository URL
    if (project?.repository) {
      return { ok: true, dir: project.repository, source: 'repository' }
    }
    // Or a working directory if available (path on remote machine)
    if (project?.workingDirectory) {
      return { ok: true, dir: project.workingDirectory, source: 'remote-path' }
    }
    return {
      ok: false,
      message: 'A working directory or git repository URL is required for remote execution. Add one in project settings.',
    }
  }

  // Local: prefer workingDirectory, fall back to repository
  if (project?.workingDirectory) {
    return { ok: true, dir: project.workingDirectory, source: 'local' }
  }
  if (project?.repository) {
    return { ok: true, dir: project.repository, source: 'repository' }
  }
  return {
    ok: false,
    message: 'No working directory or repository configured. Configure one in project settings.',
  }
}

// Helper: Compute allowed environments for a project
export function getAllowedEnvironments(project: Project | undefined): {
  allowed: Array<'local' | 'remote' | 'hpc' | 'cloud'>
  lockedMachineId?: string
  lockReason?: string
} {
  if (!project) return { allowed: ['local'] }

  // If project has a git URL, any environment can clone it
  if (project.repository) {
    return { allowed: ['local', 'remote', 'hpc', 'cloud'] }
  }

  // If project has defaultMachineId but no repository, locked to that machine
  if (project.defaultMachineId && project.workingDirectory) {
    const env = project.defaultEnvironment || 'remote'
    return {
      allowed: [env],
      lockedMachineId: project.defaultMachineId,
      lockReason: 'This project\'s code only exists on a specific machine',
    }
  }

  // Only workingDirectory, no repository, no defaultMachineId — local only
  if (project.workingDirectory) {
    return { allowed: ['local'] }
  }

  return { allowed: ['local', 'remote', 'hpc', 'cloud'] }
}

// Available machine info from relay server
export interface MachineInfo {
  machineId: string
  name: string
  environmentType: 'local' | 'remote' | 'hpc' | 'cloud'
  hostname?: string
  status: 'online' | 'offline' | 'busy'
  load?: {
    cpuPercent: number
    memoryPercent: number
    activeTasks: number
  }
  providers: Array<{
    type: string
    status: string
  }>
}

// Execution options for dispatch
export interface ExecutionOptions {
  environment?: 'local' | 'remote' | 'hpc' | 'cloud'
  targetMachineId?: string
  preferredProvider?: string
  model?: string
  maxTurns?: number
}

interface ExecutionState {
  // Active executions keyed by nodeId
  executions: Map<string, TaskExecution>

  // Provider status
  providers: ProviderStatus[]
  providersLoaded: boolean

  // Available machines from relay
  machines: MachineInfo[]
  machinesLoaded: boolean

  // Currently selected execution for detail view
  selectedExecutionId: string | null

  // Actions
  startExecution: (nodeId: string, projectId: string, options?: ExecutionOptions) => Promise<void>
  cancelExecution: (nodeId: string) => Promise<void>
  steerExecution: (nodeId: string, message: string, action?: 'guidance' | 'redirect') => Promise<boolean>
  getExecution: (nodeId: string) => TaskExecution | undefined
  isExecuting: (nodeId: string) => boolean
  hasActiveExecution: () => boolean

  // Provider actions
  loadProviders: () => Promise<void>
  redetectProviders: () => Promise<void>
  getAvailableProvider: () => ProviderStatus | null

  // Machine actions
  loadMachines: () => Promise<void>
  getMachinesForEnvironment: (env: 'local' | 'remote' | 'hpc' | 'cloud') => MachineInfo[]

  // Selection
  selectExecution: (nodeId: string | null) => void
}

// Abort controllers for active executions
const abortControllers = new Map<string, AbortController>()

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  executions: new Map(),
  providers: [],
  providersLoaded: false,
  machines: [],
  machinesLoaded: false,
  selectedExecutionId: null,

  startExecution: async (nodeId: string, projectId: string, options?: ExecutionOptions) => {
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

    // Get project for vision doc and working directory
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)

    // Determine environment first (needed for directory resolution)
    const environment = options?.environment ?? project?.defaultEnvironment ?? node.environment ?? 'local'

    // Enforce defaultMachineId constraint: if project has no repository URL
    // and has a defaultMachineId, execution must target that machine
    let effectiveTargetMachineId = options?.targetMachineId
    if (!project?.repository && project?.defaultMachineId) {
      if (effectiveTargetMachineId && effectiveTargetMachineId !== project.defaultMachineId) {
        const execution: TaskExecution = {
          nodeId,
          projectId,
          executionId: `exec-${nodeId}-${Date.now()}`,
          status: "failure",
          streamText: "",
          error: "This project's code only exists on a specific machine. Cannot execute on a different machine.",
          toolTraces: [],
          fileChanges: [],
          startedAt: new Date(),
          completedAt: new Date(),
        }
        set((state) => {
          const newExecutions = new Map(state.executions)
          newExecutions.set(nodeId, execution)
          return { executions: newExecutions }
        })
        return
      }
      effectiveTargetMachineId = project.defaultMachineId
    }

    // Resolve working directory based on environment
    const dirCheck = getProjectWorkingDir(project, environment)
    const resolvedDir = dirCheck.ok ? dirCheck.dir : undefined
    if (!resolvedDir) {
      // Fail early: no working directory configured
      const execution: TaskExecution = {
        nodeId,
        projectId,
        executionId: `exec-${nodeId}-${Date.now()}`,
        status: "failure",
        streamText: "",
        error: dirCheck.message || "No working directory or repository configured.",
        toolTraces: [],
        fileChanges: [],
        startedAt: new Date(),
        completedAt: new Date(),
      }
      set((state) => {
        const newExecutions = new Map(state.executions)
        newExecutions.set(nodeId, execution)
        return { executions: newExecutions }
      })
      return
    }

    // Build dependency outputs from completed dependencies
    const dependencyOutputs = buildDependencyOutputsArray(node.dependencies, planStore.nodes, projectId)

    // Initialize execution state
    const execution: TaskExecution = {
      nodeId,
      projectId,
      executionId: "",
      status: "pending",
      streamText: "",
      toolTraces: [],
      fileChanges: [],
      startedAt: new Date(),
    }

    set((state) => {
      const newExecutions = new Map(state.executions)
      newExecutions.set(nodeId, execution)
      return { executions: newExecutions }
    })

    // Update node status to dispatched and persist the chosen environment
    planStore.updateNode(nodeId, { status: "dispatched", environment })

    try {
      // Use the dispatch/task endpoint for full environment support
      const response = await fetch("/api/dispatch/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId,
          projectId,
          title: node.title,
          description: node.description,
          dependencies: node.dependencies,
          environment,
          verification: node.verification,
          visionDoc: project?.visionDoc,
          dependencyOutputs,
          preferredProvider: options?.preferredProvider,
          targetMachineId: effectiveTargetMachineId,
          model: options?.model,
          maxTurns: options?.maxTurns ?? 50,
          workingDirectory: resolvedDir,
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
        await fetch("/api/dispatch/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId,
            executionId: execution.executionId
          }),
        })
      } catch {
        // Ignore abort errors
      }
    }
  },

  steerExecution: async (nodeId: string, message: string, action: 'guidance' | 'redirect' = 'guidance') => {
    const execution = get().executions.get(nodeId)
    if (!execution || execution.status !== 'running') {
      console.warn("Cannot steer non-running execution:", nodeId)
      return false
    }

    if (!execution.machineId) {
      console.warn("No machine ID for steering:", nodeId)
      return false
    }

    try {
      const response = await fetch("/api/dispatch/steer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: execution.executionId,
          machineId: execution.machineId,
          message,
          action,
        }),
      })

      if (!response.ok) {
        console.error("Failed to steer execution:", response.status)
        return false
      }

      const result = await response.json()
      return result.success
    } catch (error) {
      console.error("Error steering execution:", error)
      return false
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

  loadMachines: async () => {
    try {
      const response = await fetch("/api/relay/machines")
      if (response.ok) {
        const data = await response.json()
        set({
          machines: data.machines || [],
          machinesLoaded: true,
        })
      }
    } catch {
      set({ machinesLoaded: true })
    }
  },

  getMachinesForEnvironment: (env: 'local' | 'remote' | 'hpc' | 'cloud') => {
    return get().machines.filter((m) => m.environmentType === env && m.status !== 'offline')
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

  let currentEvent = ""
  let dataLines: string[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (line.startsWith("event:")) {
        // Flush any pending event before starting a new one
        if (currentEvent && dataLines.length > 0) {
          handleSSEEvent(currentEvent, dataLines.join("\n"), nodeId, set, get, planStore)
          dataLines = []
        }
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5))
      } else if (line === "") {
        // Empty line = end of SSE message, flush the event
        if (currentEvent && dataLines.length > 0) {
          handleSSEEvent(currentEvent, dataLines.join("\n"), nodeId, set, get, planStore)
        }
        currentEvent = ""
        dataLines = []
      }
    }
  }

  // Flush any remaining event
  if (currentEvent && dataLines.length > 0) {
    handleSSEEvent(currentEvent, dataLines.join("\n"), nodeId, set, get, planStore)
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
            exec.machineId = parsed.machineId
            exec.providerId = parsed.providerId
            exec.providerName = parsed.providerName
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

    case "session_init": {
      try {
        const parsed = JSON.parse(data)
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.sessionId = parsed.sessionId
          }
          return { executions: newExecutions }
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

    case "tool_use": {
      try {
        const parsed = JSON.parse(data)
        const trace: ToolTrace = {
          id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          toolName: parsed.toolName,
          toolInput: parsed.toolInput,
          timestamp: new Date(),
        }
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.toolTraces = [...exec.toolTraces, trace]
          }
          return { executions: newExecutions }
        })
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "tool_result": {
      try {
        const parsed = JSON.parse(data)
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec && exec.toolTraces.length > 0) {
            // Update the last tool trace with the result
            const lastTrace = exec.toolTraces[exec.toolTraces.length - 1]
            if (lastTrace.toolName === parsed.toolName) {
              lastTrace.toolResult = parsed.result
              lastTrace.success = parsed.success
            }
          }
          return { executions: newExecutions }
        })
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "file_change": {
      try {
        const parsed = JSON.parse(data)
        const change: FileChange = {
          path: parsed.path,
          action: parsed.action || 'modify',
          linesAdded: parsed.linesAdded,
          linesRemoved: parsed.linesRemoved,
          timestamp: new Date(),
        }
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.fileChanges = [...exec.fileChanges, change]
          }
          return { executions: newExecutions }
        })
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "progress": {
      // Progress updates are informational, could be used for progress bar
      // For now, just log them
      try {
        const parsed = JSON.parse(data)
        console.log(`[execution] Progress for ${nodeId}:`, parsed.message, parsed.percentage)
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "result": {
      try {
        const parsed = JSON.parse(data)
        const isSuccess = parsed.status === "success"
        const execution = get().executions.get(nodeId)

        // Extract metrics from result event
        const metrics: UsageMetrics | undefined = parsed.metrics ? {
          durationMs: parsed.metrics.durationMs,
          inputTokens: parsed.metrics.inputTokens,
          outputTokens: parsed.metrics.outputTokens,
          tokensUsed: parsed.metrics.tokensUsed,
          estimatedCostUsd: parsed.metrics.estimatedCostUsd,
          model: parsed.metrics.model,
          turnsUsed: parsed.metrics.turnsUsed,
        } : undefined

        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.status = isSuccess ? "success" : "failure"
            exec.completedAt = new Date()
            if (!isSuccess && parsed.error) {
              exec.error = parsed.error
            }
            if (parsed.sessionId) {
              exec.sessionId = parsed.sessionId
            }
            if (metrics) {
              exec.metrics = metrics
            }
          }
          return { executions: newExecutions }
        })

        // Accumulate metrics in usage store
        if (metrics) {
          useUsageStore.getState().addTaskMetrics(metrics, isSuccess)
        }

        // Determine final node status based on verification type
        const node = planStore.nodes.find((n) => n.id === nodeId)
        // Use finalStatus from server if provided, otherwise determine locally
        let finalStatus: PlanNode["status"] = parsed.finalStatus

        if (!finalStatus) {
          if (isSuccess) {
            finalStatus = node?.verification === "auto" ? "auto_verified" : "awaiting_judgment"
          } else {
            finalStatus = "awaiting_judgment"
          }
        }

        planStore.updateNode(nodeId, {
          status: finalStatus,
          executionOutput: execution?.streamText || parsed.output,
          executionCompletedAt: new Date(),
        })

        // Refresh file tree cache after task completion
        const projectForRefresh = useProjectStore.getState().projects.find(
          (p) => p.id === execution?.projectId
        )
        if (projectForRefresh?.workingDirectory) {
          fetch(`/api/repo/file-tree?workingDirectory=${encodeURIComponent(projectForRefresh.workingDirectory)}`)
            .then((r) => r.json())
            .then((data) => {
              if (data.files?.length) {
                useProjectStore.getState().updateFileTree(projectForRefresh.id, data.files)
              }
            })
            .catch(() => {})
        }
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "error": {
      try {
        const parsed = JSON.parse(data)
        const errorMessage = typeof parsed === 'string' ? parsed : parsed.error || 'Unknown error'
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.status = "failure"
            exec.error = errorMessage
            exec.completedAt = new Date()
          }
          return { executions: newExecutions }
        })
        planStore.updateNode(nodeId, {
          status: "awaiting_judgment",
          executionError: errorMessage,
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

    case "heartbeat":
    case "done":
      // Heartbeat and done events are informational, no action needed
      break
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

  // Filter to same project to avoid cross-project ID collisions
  const projectNodes = allNodes.filter((n) => n.projectId === node.projectId)
  const pendingDependencies: string[] = []

  for (const depId of node.dependencies) {
    const depNode = projectNodes.find((n) => n.id === depId)
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

// Helper: Build dependency outputs array for dispatch endpoint
function buildDependencyOutputsArray(
  dependencyIds: string[],
  allNodes: PlanNode[],
  projectId?: string
): Array<{ nodeId: string; title: string; output: string }> {
  const outputs: Array<{ nodeId: string; title: string; output: string }> = []
  // Filter to same project to avoid cross-project ID collisions
  const searchNodes = projectId ? allNodes.filter((n) => n.projectId === projectId) : allNodes

  for (const depId of dependencyIds) {
    const depNode = searchNodes.find((n) => n.id === depId)
    if (depNode?.executionOutput) {
      outputs.push({
        nodeId: depNode.id,
        title: depNode.title,
        output: depNode.executionOutput,
      })
    }
  }

  return outputs
}

