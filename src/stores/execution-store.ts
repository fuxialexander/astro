import { create } from "zustand"
import type { TaskExecution, ProviderStatus, PlanNode, PlanEdge, ToolTrace, FileChange, UsageMetrics, Project, ExecutionSummary } from "@/types"
import { parseSSEStream } from "@/lib/sse-parser"
import { usePlanStore, isLive } from "./plan-store"
import { useProjectStore } from "./project-store"
import { useUsageStore } from "./usage-store"
import { getAccessToken, shouldUseSupabase } from "@/lib/supabase-client"
import type { ApprovalRequest } from "@/components/approval-card"
import { loadState, saveState } from "@/lib/db"
import { dataClient } from "@/lib/data-client"
import { apiUrl } from "@/lib/api-url"
import { useTaskChatStore } from "./task-chat-store"

// Helper: Create auth headers for API requests
async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }
  return headers
}

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

  // Local: prefer workingDirectory (resolved local path)
  if (project?.workingDirectory) {
    return { ok: true, dir: project.workingDirectory, source: 'local' }
  }
  // If only a git URL is available, pass it through — the server will clone/resolve it
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

// Compute backend info from agent-runner detection
export interface ComputeBackendInfo {
  id: string
  name: string
  available: boolean
  version?: string
  metadata?: Record<string, unknown>
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
  executionStrategies?: ComputeBackendInfo[]
}

// Execution options for dispatch
export interface ExecutionOptions {
  environment?: 'local' | 'remote' | 'hpc' | 'cloud'
  targetMachineId?: string
  preferredProvider?: string
  /** Selected compute backend (direct, slurm, docker, k8s-exec, skypilot) */
  computeBackend?: string
  model?: string
  maxTurns?: number
}

// Batch execution state for "Execute All" mode
export interface BatchExecution {
  projectId: string
  options: ExecutionOptions
  // Tracks which nodes have been dispatched in this batch
  dispatchedNodeIds: Set<string>
  // Whether the batch is still active (auto-dispatching next waves)
  active: boolean
  startedAt: Date
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

  // Local execution backends (detected on server)
  localBackends: ComputeBackendInfo[]
  localBackendsLoaded: boolean

  // Currently selected execution for detail view
  selectedExecutionId: string | null

  // Batch execution state per project
  batchExecutions: Map<string, BatchExecution>

  // Pending approval requests
  pendingApprovals: Map<string, ApprovalRequest>

  // Load state
  loaded: boolean

  // Actions
  startExecution: (nodeId: string, projectId: string, options?: ExecutionOptions) => Promise<void>
  cancelExecution: (nodeId: string) => Promise<void>
  resetExecution: (nodeId: string) => Promise<void>
  steerExecution: (nodeId: string, message: string, action?: 'guidance' | 'redirect') => Promise<boolean>
  getExecution: (nodeId: string) => TaskExecution | undefined
  isExecuting: (nodeId: string) => boolean
  hasActiveExecution: () => boolean

  // Batch execution actions
  executeAllProject: (projectId: string, options?: ExecutionOptions) => void
  stopBatchExecution: (projectId: string) => void
  isBatchActive: (projectId: string) => boolean
  getBatchExecution: (projectId: string) => BatchExecution | undefined

  // Provider actions
  loadProviders: () => Promise<void>
  redetectProviders: () => Promise<void>
  getAvailableProvider: () => ProviderStatus | null

  // Machine actions
  loadMachines: () => Promise<void>
  getMachinesForEnvironment: (env: 'local' | 'remote' | 'hpc' | 'cloud') => MachineInfo[]

  // Local backend actions
  loadLocalBackends: () => Promise<void>
  fetchBackendDetail: (id: string) => Promise<{ backend: ComputeBackendInfo; contextString: string } | null>
  fetchRemoteBackendDetail: (machineId: string, strategyId: string) => Promise<{ backend: ComputeBackendInfo; contextString: string } | null>

  // Selection
  selectExecution: (nodeId: string | null) => void

  // Approval actions
  addPendingApproval: (approval: ApprovalRequest) => void
  respondToApproval: (approvalId: string, approved: boolean, selectedOption?: string) => Promise<void>
  getPendingApproval: (approvalId: string) => ApprovalRequest | undefined
  getPendingApprovalForNode: (nodeId: string) => ApprovalRequest | undefined

  // Mutation methods for relay/realtime events
  appendText: (nodeId: string, text: string) => void
  addToolTrace: (nodeId: string, trace: ToolTrace) => void
  addFileChange: (nodeId: string, change: FileChange) => void
  updateToolTraceResult: (nodeId: string, toolName: string, result: unknown, success?: boolean, duration?: number) => void

  // Persistence
  load: () => Promise<void>
  persist: () => Promise<void>
}

// Abort controllers for active executions
const abortControllers = new Map<string, AbortController>()

// Max number of completed executions to keep in IndexedDB
const MAX_STORED_EXECUTIONS = 100

// Helper: Serialize execution for storage (convert Map to Record and Date to ISO strings)
function serializeExecutions(executions: Map<string, TaskExecution>): Record<string, SerializedTaskExecution> {
  const record: Record<string, SerializedTaskExecution> = {}
  for (const [nodeId, execution] of executions) {
    // Only persist completed executions (success, failure, cancelled)
    if (execution.status === 'success' || execution.status === 'failure' || execution.status === 'cancelled') {
      record[nodeId] = {
        ...execution,
        startedAt: execution.startedAt.toISOString(),
        completedAt: execution.completedAt?.toISOString(),
        toolTraces: execution.toolTraces.map((t) => ({
          ...t,
          timestamp: t.timestamp.toISOString(),
        })),
        fileChanges: execution.fileChanges.map((f) => ({
          ...f,
          timestamp: f.timestamp.toISOString(),
        })),
        activityEvents: execution.activityEvents.map((e) => ({
          ...e,
          timestamp: e.timestamp.toISOString(),
        })),
      }
    }
  }
  return record
}

// Helper: Deserialize execution from storage (convert Record to Map and ISO strings to Date)
function deserializeExecutions(record: Record<string, SerializedTaskExecution>): Map<string, TaskExecution> {
  const map = new Map<string, TaskExecution>()
  for (const [nodeId, execution] of Object.entries(record)) {
    map.set(nodeId, {
      ...execution,
      startedAt: new Date(execution.startedAt),
      completedAt: execution.completedAt ? new Date(execution.completedAt) : undefined,
      toolTraces: execution.toolTraces.map((t) => ({
        ...t,
        timestamp: new Date(t.timestamp),
      })),
      fileChanges: execution.fileChanges.map((f) => ({
        ...f,
        timestamp: new Date(f.timestamp),
      })),
      activityEvents: execution.activityEvents.map((e) => ({
        ...e,
        timestamp: new Date(e.timestamp),
      })),
    })
  }
  return map
}

// Serialized type with ISO date strings for storage
type SerializedTaskActivityEvent =
  | { type: 'text'; content: string; timestamp: string }
  | { type: 'tool_use'; id: string; toolName: string; toolInput: unknown; timestamp: string }
  | { type: 'tool_result'; id: string; toolName: string; toolResult?: unknown; success?: boolean; duration?: number; timestamp: string }
  | { type: 'steer'; message: string; accepted?: boolean; ackMessage?: string; interrupted?: boolean; timestamp: string }
  | { type: 'chat_user'; message: string; timestamp: string }
  | { type: 'chat_assistant'; content: string; timestamp: string }
  | { type: 'file_change'; path: string; action: string; diff?: string; linesAdded?: number; linesRemoved?: number; timestamp: string }
  | { type: 'error'; error: string; timestamp: string }

interface SerializedTaskExecution extends Omit<TaskExecution, 'startedAt' | 'completedAt' | 'toolTraces' | 'fileChanges' | 'activityEvents'> {
  startedAt: string
  completedAt?: string
  toolTraces: Array<Omit<ToolTrace, 'timestamp'> & { timestamp: string }>
  fileChanges: Array<Omit<FileChange, 'timestamp'> & { timestamp: string }>
  activityEvents: SerializedTaskActivityEvent[]
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  executions: new Map(),
  providers: [],
  providersLoaded: false,
  machines: [],
  machinesLoaded: false,
  localBackends: [],
  localBackendsLoaded: false,
  selectedExecutionId: null,
  batchExecutions: new Map(),
  pendingApprovals: new Map(),
  loaded: false,

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

    // Check dependencies are met (use edges as source of truth)
    const liveNodes = planStore.nodes.filter(isLive)
    const liveEdges = planStore.edges.filter(isLive)
    const canExecute = canExecuteNode(node, liveNodes, liveEdges)
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
          activityEvents: [],
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
        activityEvents: [],
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
    const dependencyOutputs = buildDependencyOutputsArray(node.dependencies, liveNodes, projectId)

    // Initialize execution state
    const execution: TaskExecution = {
      nodeId,
      projectId,
      executionId: "",
      status: "pending",
      streamText: "",
      toolTraces: [],
      fileChanges: [],
      activityEvents: [],
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
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/dispatch/task"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          nodeId,
          projectId,
          title: node.title,
          description: node.description || node.title,
          dependencies: node.dependencies,
          environment,
          verification: node.verification,
          visionDoc: project?.visionDoc,
          dependencyOutputs,
          preferredProvider: options?.preferredProvider,
          targetMachineId: effectiveTargetMachineId,
          model: options?.model,
          maxTurns: options?.maxTurns ?? 100,
          workingDirectory: resolvedDir,
          computeBackend: options?.computeBackend,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        const detail = errorBody?.error || errorBody?.details?.[0]?.message || ''
        throw new Error(`Server error: ${response.status}${detail ? ` - ${detail}` : ''}`)
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

        // Persist failed execution to IndexedDB and Supabase
        get().persist()
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
        const headers = await getAuthHeaders()
        await fetch(apiUrl("/api/dispatch/cancel"), {
          method: "POST",
          headers,
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

  resetExecution: async (nodeId: string) => {
    // Cancel any in-progress execution first
    const controller = abortControllers.get(nodeId)
    if (controller) {
      controller.abort()
      abortControllers.delete(nodeId)
    }

    // Call server to clean up worktree, branch, and session context
    try {
      const headers = await getAuthHeaders()
      await fetch(apiUrl("/api/dispatch/reset"), {
        method: "POST",
        headers,
        body: JSON.stringify({ nodeId }),
      })
    } catch {
      // Best effort — continue with local cleanup even if server call fails
    }

    // Clear chat session for this task
    useTaskChatStore.getState().clearSession(nodeId)

    // Clear execution from in-memory store
    set((state) => {
      const newExecutions = new Map(state.executions)
      newExecutions.delete(nodeId)
      return { executions: newExecutions }
    })

    // Reset PlanNode execution fields and status
    const planStore = usePlanStore.getState()
    planStore.updateNode(nodeId, {
      executionId: undefined,
      executionOutput: undefined,
      executionError: undefined,
      executionStartedAt: undefined,
      executionCompletedAt: undefined,
      status: "planned",
    })

    // Persist the change
    get().persist()
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
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/dispatch/steer"), {
        method: "POST",
        headers,
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

  executeAllProject: (projectId: string, options?: ExecutionOptions) => {
    const planStore = usePlanStore.getState()
    const projectNodes = planStore.nodes.filter(
      (n) => isLive(n) && n.projectId === projectId && n.type !== "milestone"
    )
    const projectEdges = planStore.edges.filter(isLive)

    // Find all nodes that are ready to execute (no unmet dependencies, status is "planned")
    const liveNodes = planStore.nodes.filter(isLive)
    const readyNodes = projectNodes.filter((n) => {
      if (n.status !== "planned") return false
      return canExecuteNode(n, liveNodes, projectEdges).ready
    })

    if (readyNodes.length === 0) return

    // Register batch execution
    const batch: BatchExecution = {
      projectId,
      options: options ?? {},
      dispatchedNodeIds: new Set(readyNodes.map((n) => n.id)),
      active: true,
      startedAt: new Date(),
    }

    set((state) => {
      const newBatch = new Map(state.batchExecutions)
      newBatch.set(projectId, batch)
      return { batchExecutions: newBatch }
    })

    // Dispatch all ready nodes in parallel
    for (const node of readyNodes) {
      get().startExecution(node.id, projectId, options)
    }
  },

  stopBatchExecution: (projectId: string) => {
    set((state) => {
      const newBatch = new Map(state.batchExecutions)
      const batch = newBatch.get(projectId)
      if (batch) {
        batch.active = false
      }
      return { batchExecutions: newBatch }
    })
  },

  isBatchActive: (projectId: string) => {
    return get().batchExecutions.get(projectId)?.active ?? false
  },

  getBatchExecution: (projectId: string) => {
    return get().batchExecutions.get(projectId)
  },

  loadProviders: async () => {
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/agent/providers"), { headers })
      if (response.ok) {
        const data = await response.json()
        const providers: ProviderStatus[] = (data.providers || []).map((p: Record<string, unknown>) => ({
          id: p.id,
          name: p.name,
          installed: p.installed,
          authStatus: p.authStatus,
          available: p.available,
          capabilities: p.capabilities ? {
            availableModels: (p.capabilities as Record<string, unknown>).availableModels,
            defaultModel: (p.capabilities as Record<string, unknown>).defaultModel,
          } : undefined,
        }))
        set({ providers, providersLoaded: true })
      }
    } catch {
      set({ providersLoaded: true })
    }
  },

  redetectProviders: async () => {
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/agent/providers/detect"), {
        method: "POST",
        headers,
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
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/relay/machines"), { headers })
      if (response.ok) {
        const data = await response.json()
        // Map API shape (connectionStatus) to frontend shape (status)
        const machines: MachineInfo[] = (data.machines || []).map((m: Record<string, unknown>) => ({
          machineId: m.machineId,
          name: m.name,
          environmentType: m.environmentType || 'remote',
          hostname: m.hostname,
          status: m.connectionStatus === 'connected' ? 'online'
            : m.connectionStatus === 'disconnected' ? 'offline'
            : 'online',
          load: m.load,
          providers: m.providers,
          executionStrategies: m.executionStrategies,
        }))
        set({ machines, machinesLoaded: true })
      }
    } catch {
      set({ machinesLoaded: true })
    }
  },

  getMachinesForEnvironment: (env: 'local' | 'remote' | 'hpc' | 'cloud') => {
    return get().machines.filter((m) => m.environmentType === env && m.status !== 'offline')
  },

  loadLocalBackends: async () => {
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/backends"), { headers })
      if (response.ok) {
        const data = await response.json() as { backends?: ComputeBackendInfo[] }
        set({ localBackends: data.backends ?? [], localBackendsLoaded: true })
      }
    } catch {
      set({ localBackendsLoaded: true })
    }
  },

  fetchBackendDetail: async (id: string) => {
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl(`/api/backends/${id}`), { headers })
      if (response.ok) {
        const data = await response.json() as { backend: ComputeBackendInfo; contextString: string }
        return data
      }
      return null
    } catch {
      return null
    }
  },

  fetchRemoteBackendDetail: async (machineId: string, strategyId: string) => {
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl(`/api/backends/remote/${machineId}/${strategyId}`), { headers })
      if (response.ok) {
        const data = await response.json() as { backend: ComputeBackendInfo; contextString: string }
        return data
      }
      return null
    } catch {
      return null
    }
  },

  selectExecution: (nodeId: string | null) => {
    set({ selectedExecutionId: nodeId })
  },

  addPendingApproval: (approval: ApprovalRequest) => {
    set((state) => {
      const newApprovals = new Map(state.pendingApprovals)
      newApprovals.set(approval.approvalId, approval)
      return { pendingApprovals: newApprovals }
    })
  },

  respondToApproval: async (approvalId: string, approved: boolean, selectedOption?: string) => {
    const headers = await getAuthHeaders()

    const response = await fetch('/api/dispatch/approve', {
      method: 'POST',
      headers,
      body: JSON.stringify({ approvalId, approved, selectedOption }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to respond to approval')
    }

    // Remove from pending approvals
    set((state) => {
      const newApprovals = new Map(state.pendingApprovals)
      newApprovals.delete(approvalId)
      return { pendingApprovals: newApprovals }
    })
  },

  getPendingApproval: (approvalId: string) => {
    return get().pendingApprovals.get(approvalId)
  },

  getPendingApprovalForNode: (nodeId: string) => {
    const approvals = Array.from(get().pendingApprovals.values())
    return approvals.find((a) => a.nodeId === nodeId)
  },

  appendText: (nodeId: string, text: string) => {
    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec) {
        exec.streamText += text
        exec.activityEvents = [...exec.activityEvents, { type: 'text', content: text, timestamp: new Date() }]
      }
      return { executions: newExecutions }
    })
  },

  addToolTrace: (nodeId: string, trace: ToolTrace) => {
    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec) {
        exec.toolTraces = [...exec.toolTraces, trace]
        exec.activityEvents = [...exec.activityEvents, {
          type: 'tool_use' as const,
          id: trace.id,
          toolName: trace.toolName,
          toolInput: trace.toolInput,
          timestamp: trace.timestamp,
        }]

        // Extract plan mode data from TodoWrite and AskUserQuestion tools
        if (trace.toolName === 'TodoWrite') {
          const input = trace.toolInput as { todos?: Array<{ content: string; status: string; activeForm: string }> }
          if (input.todos) {
            exec.planTodos = input.todos.map(t => ({
              content: t.content,
              status: t.status as 'pending' | 'in_progress' | 'completed',
              activeForm: t.activeForm,
            }))
          }
        } else if (trace.toolName === 'AskUserQuestion') {
          const input = trace.toolInput as { questions?: Array<{ question: string; options: Array<{ label: string }> }> }
          if (input.questions) {
            // Initialize planQuestions if not exists
            if (!exec.planQuestions) {
              exec.planQuestions = []
            }
            // Add each question to the list
            for (const q of input.questions) {
              exec.planQuestions.push({
                question: q.question,
                options: q.options.map(o => o.label),
              })
            }
          }
        }
      }
      return { executions: newExecutions }
    })
  },

  addFileChange: (nodeId: string, change: FileChange) => {
    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec) {
        exec.fileChanges = [...exec.fileChanges, change]
        exec.activityEvents = [...exec.activityEvents, {
          type: 'file_change' as const,
          path: change.path,
          action: change.action,
          diff: change.diff,
          linesAdded: change.linesAdded,
          linesRemoved: change.linesRemoved,
          timestamp: change.timestamp,
        }]
      }
      return { executions: newExecutions }
    })
  },

  updateToolTraceResult: (nodeId: string, toolName: string, result: unknown, success?: boolean, duration?: number) => {
    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec && exec.toolTraces.length > 0) {
        const lastTrace = exec.toolTraces[exec.toolTraces.length - 1]
        if (lastTrace.toolName === toolName) {
          lastTrace.toolResult = result
          lastTrace.success = success
          lastTrace.duration = duration
          exec.activityEvents = [...exec.activityEvents, {
            type: 'tool_result' as const,
            id: lastTrace.id,
            toolName,
            toolResult: result,
            success,
            duration,
            timestamp: new Date(),
          }]
        }
      }
      return { executions: newExecutions }
    })
  },

  load: async () => {
    try {
      // Try loading from Supabase first (if enabled)
      if (shouldUseSupabase()) {
        try {
          const executionsRecord = await dataClient.getExecutions()
          // dataClient already deserializes dates, just convert Record to Map
          const executions = new Map<string, TaskExecution>(Object.entries(executionsRecord))
          set({ executions, loaded: true })
          console.log('[execution-store] Loaded executions from Supabase:', executions.size)
          return
        } catch (err) {
          console.warn('[execution-store] Failed to load from Supabase, falling back to IndexedDB:', err)
        }
      }

      // Fall back to IndexedDB
      const stored = await loadState<Record<string, SerializedTaskExecution>>('astro-executions')
      if (stored) {
        const executions = deserializeExecutions(stored)
        set({ executions, loaded: true })
        console.log('[execution-store] Loaded executions from IndexedDB:', executions.size)
      } else {
        set({ loaded: true })
        console.log('[execution-store] No stored executions found')
      }
    } catch (error) {
      console.error('[execution-store] Failed to load executions:', error)
      set({ loaded: true })
    }
  },

  persist: async () => {
    const { executions } = get()
    try {
      // Serialize and apply cleanup (keep last 100 completed executions)
      const completedExecutions = Array.from(executions.entries())
        .filter(([, exec]) => exec.status === 'success' || exec.status === 'failure' || exec.status === 'cancelled')
        .sort((a, b) => {
          const aTime = a[1].completedAt?.getTime() ?? 0
          const bTime = b[1].completedAt?.getTime() ?? 0
          return bTime - aTime // Most recent first
        })
        .slice(0, MAX_STORED_EXECUTIONS)

      const toStore = new Map(completedExecutions)
      const serialized = serializeExecutions(toStore)

      // Save to IndexedDB
      await saveState('astro-executions', serialized)
      console.log('[execution-store] Persisted', Object.keys(serialized).length, 'executions to IndexedDB')

      // Fire-and-forget: sync to Supabase (if enabled)
      if (shouldUseSupabase()) {
        // Only sync newly completed executions (not already in DB)
        for (const [, execution] of completedExecutions) {
          if (execution.status === 'success' || execution.status === 'failure' || execution.status === 'cancelled') {
            dataClient.saveExecution(execution).catch((err) => {
              console.warn('[execution-store] Failed to sync execution to Supabase:', err)
            })
          }
        }
      }
    } catch (error) {
      console.error('[execution-store] Failed to persist executions:', error)
    }
  },
}))

// Helper: Process SSE stream from dispatch endpoint using unified parser
async function processExecutionStream(
  response: Response,
  nodeId: string,
  set: (fn: (state: ExecutionState) => Partial<ExecutionState>) => void,
  get: () => ExecutionState,
  planStore: ReturnType<typeof usePlanStore.getState>
) {
  await parseSSEStream(response, {
    onEvent: ({ event, data }) => {
      handleSSEEvent(event, data, nodeId, set, get, planStore)
    },
  })
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
            if (parsed.computeBackend) exec.computeBackend = parsed.computeBackend
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
          exec.activityEvents = [...exec.activityEvents, { type: 'text', content: data, timestamp: new Date() }]
        }
        return { executions: newExecutions }
      })
      break
    }

    case "tool_use": {
      try {
        const parsed = JSON.parse(data)
        const now = new Date()
        const traceId = `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const trace: ToolTrace = {
          id: traceId,
          toolName: parsed.toolName,
          toolInput: parsed.toolInput,
          timestamp: now,
        }
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.toolTraces = [...exec.toolTraces, trace]
            exec.activityEvents = [...exec.activityEvents, {
              type: 'tool_use' as const,
              id: traceId,
              toolName: parsed.toolName,
              toolInput: parsed.toolInput,
              timestamp: now,
            }]
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
        const now = new Date()
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
            exec.activityEvents = [...exec.activityEvents, {
              type: 'tool_result' as const,
              id: lastTrace.id,
              toolName: parsed.toolName,
              toolResult: parsed.result,
              success: parsed.success,
              duration: parsed.duration,
              timestamp: now,
            }]
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
        const now = new Date()
        const change: FileChange = {
          path: parsed.path,
          action: parsed.action || 'modify',
          linesAdded: parsed.linesAdded,
          linesRemoved: parsed.linesRemoved,
          diff: parsed.diff,
          timestamp: now,
        }
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.fileChanges = [...exec.fileChanges, change]
            exec.activityEvents = [...exec.activityEvents, {
              type: 'file_change' as const,
              path: parsed.path,
              action: parsed.action || 'modify',
              diff: parsed.diff,
              linesAdded: parsed.linesAdded,
              linesRemoved: parsed.linesRemoved,
              timestamp: now,
            }]
          }
          return { executions: newExecutions }
        })
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "progress": {
      try {
        const parsed = JSON.parse(data)
        console.log(`[execution] Progress for ${nodeId}:`, parsed.message, parsed.percentage)
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "subroutine_progress": {
      try {
        const parsed = JSON.parse(data)
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.subroutineProgress = {
              name: parsed.name,
              index: parsed.index,
              total: parsed.total,
              status: parsed.status,
            }
          }
          return { executions: newExecutions }
        })
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
            // Store PR/branch metadata
            if (parsed.branchName) exec.branchName = parsed.branchName
            if (parsed.prUrl) exec.prUrl = parsed.prUrl
            if (parsed.prNumber) exec.prNumber = parsed.prNumber
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
          // Persist PR/branch metadata on the plan node
          ...(parsed.branchName && { branchName: parsed.branchName }),
          ...(parsed.prUrl && { prUrl: parsed.prUrl }),
          ...(parsed.prNumber && { prNumber: parsed.prNumber }),
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

        // Batch execution: auto-dispatch next wave of ready nodes
        const execStore = useExecutionStore.getState()
        const projectId = execution?.projectId
        if (projectId && execStore.batchExecutions.get(projectId)?.active) {
          // Use a short delay to let the plan store status update propagate
          setTimeout(() => dispatchNextBatchWave(projectId), 100)
        }

        // Fire async summary generation (non-blocking)
        if (isSuccess && execution) {
          requestExecutionSummary(nodeId, execution, node)
        }

        // Persist completed execution to IndexedDB and Supabase
        useExecutionStore.getState().persist()
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
            exec.activityEvents = [...exec.activityEvents, { type: 'error' as const, error: errorMessage, timestamp: new Date() }]
          }
          return { executions: newExecutions }
        })
        planStore.updateNode(nodeId, {
          status: "awaiting_judgment",
          executionError: errorMessage,
        })

        // Persist failed execution to IndexedDB and Supabase
        useExecutionStore.getState().persist()
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

      // Persist cancelled execution to IndexedDB and Supabase
      useExecutionStore.getState().persist()
      break
    }

    case "heartbeat":
    case "done":
      // Heartbeat and done events are informational, no action needed
      break
  }
}

// Helper: Fire-and-forget summary generation after execution completes
async function requestExecutionSummary(
  nodeId: string,
  execution: TaskExecution,
  node: PlanNode | undefined,
) {
  if (!node || !execution.streamText) return
  try {
    const headers = await getAuthHeaders()
    const response = await fetch(apiUrl("/api/agent/summarize"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        taskTitle: node.title,
        taskDescription: node.description,
        executionOutput: execution.streamText,
        fileChanges: execution.fileChanges.map((f) => ({ path: f.path, action: f.action })),
        status: execution.status === "success" ? "success" : "failure",
      }),
    })
    if (response.ok) {
      const data = await response.json()
      if (data.summary) {
        useExecutionStore.setState((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            exec.summary = data.summary as ExecutionSummary
          }
          return { executions: newExecutions }
        })
      }
    }
  } catch {
    // Non-critical — silently ignore summary failures
  }
}

// Helper: Check if a node's dependencies are met
interface CanExecuteResult {
  ready: boolean
  reason?: string
  pendingDependencies?: string[]
}

export function canExecuteNode(node: PlanNode, allNodes: PlanNode[], edges?: PlanEdge[]): CanExecuteResult {
  // Filter to same project to avoid cross-project ID collisions
  const projectNodes = allNodes.filter((n) => n.projectId === node.projectId)

  // Derive upstream dependencies from the edge graph (source of truth) if available,
  // falling back to the node's dependencies array for backwards compatibility.
  let upstreamIds: string[]
  if (edges) {
    const projectNodeIds = new Set(projectNodes.map((n) => n.id))
    upstreamIds = edges
      .filter((e) => e.target === node.id && projectNodeIds.has(e.source))
      .map((e) => e.source)
  } else {
    upstreamIds = node.dependencies
  }

  if (upstreamIds.length === 0) {
    return { ready: true }
  }

  const pendingDependencies: string[] = []
  const completedStatuses: PlanNode["status"][] = ["completed", "auto_verified"]

  for (const depId of upstreamIds) {
    const depNode = projectNodes.find((n) => n.id === depId)
    if (!depNode) {
      // Dangling reference (e.g. from corrupted data) — skip rather than blocking execution
      console.warn(`[canExecuteNode] Dependency ${depId} not found for node ${node.id}, skipping`)
      continue
    }

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

// Helper: Dispatch the next wave of ready nodes for a batch execution
function dispatchNextBatchWave(projectId: string) {
  const execStore = useExecutionStore.getState()
  const batch = execStore.batchExecutions.get(projectId)
  if (!batch?.active) return

  const planStore = usePlanStore.getState()
  const projectNodes = planStore.nodes.filter(
    (n) => isLive(n) && n.projectId === projectId && n.type !== "milestone"
  )

  // Find nodes that are "planned" and now have all dependencies met
  const liveNodes = planStore.nodes.filter(isLive)
  const liveEdges = planStore.edges.filter(isLive)
  const newlyReady = projectNodes.filter((n) => {
    if (n.status !== "planned") return false
    if (batch.dispatchedNodeIds.has(n.id)) return false
    return canExecuteNode(n, liveNodes, liveEdges).ready
  })

  if (newlyReady.length === 0) {
    // Check if all dispatched nodes are done — if so, batch is complete
    const allDone = projectNodes
      .filter((n) => batch.dispatchedNodeIds.has(n.id))
      .every((n) => !["dispatched", "in_progress"].includes(n.status))

    const noPlannedLeft = projectNodes.every((n) => n.status !== "planned")

    if (allDone || noPlannedLeft) {
      useExecutionStore.setState((state) => {
        const newBatch = new Map(state.batchExecutions)
        const b = newBatch.get(projectId)
        if (b) b.active = false
        return { batchExecutions: newBatch }
      })
    }
    return
  }

  // Mark newly ready nodes as dispatched in the batch
  useExecutionStore.setState((state) => {
    const newBatch = new Map(state.batchExecutions)
    const b = newBatch.get(projectId)
    if (b) {
      for (const n of newlyReady) b.dispatchedNodeIds.add(n.id)
    }
    return { batchExecutions: newBatch }
  })

  // Dispatch all newly ready nodes
  for (const node of newlyReady) {
    execStore.startExecution(node.id, projectId, batch.options)
  }
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

