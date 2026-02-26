import { create } from "zustand"
import type { TaskExecution, ProviderStatus, PlanNode, PlanEdge, ToolTrace, FileChange, UsageMetrics, Project, ExecutionSummary } from "@/types"
import { parseSSEStream } from "@/lib/sse-parser"
import { usePlanStore, isLive } from "./plan-store"
import { useProjectStore } from "./project-store"
import { useUsageStore } from "./usage-store"
import { getAccessToken } from "@/lib/supabase-client"
import { isServerMode } from "@/lib/app-mode"
import type { ApprovalRequest } from "@/components/approval-card"
import { dataClient } from "@/lib/data-client"
import { stripHtml, extractBlobUrls } from "@/lib/html-utils"
import { apiUrl } from "@/lib/api-url"
import { useTaskChatStore } from "./task-chat-store"
import { resolveWorkingDirectory, buildDependencyOutputs } from "@astro/core/dispatch"
import { extractPlanJsonFromText } from "@/lib/plan-extraction"

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

// Helper: Resolve working directory from project config (delegates to @astro/core)
export function getProjectWorkingDir(
  project: Project | undefined,
): {
  ok: boolean
  dir?: string
  source?: 'local' | 'repository' | 'remote-path'
  message?: string
} {
  return resolveWorkingDirectory(project)
}

// Helper: Check if a project is locked to a specific machine
export function getProjectMachineLock(project: Project | undefined): {
  lockedMachineId?: string
  lockReason?: string
} {
  if (!project) return {}

  // If project has defaultMachineId but no repository, locked to that machine
  if (project.defaultMachineId && project.workingDirectory && !project.repository) {
    return {
      lockedMachineId: project.defaultMachineId,
      lockReason: 'This project\'s code only exists on a specific machine',
    }
  }

  return {}
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
  targetMachineId?: string
  preferredProvider?: string
  /** Selected compute backend (direct, slurm, docker, k8s-exec) */
  computeBackend?: string
  model?: string
  maxTurns?: number
  /** Whether to use git worktree isolation (defaults to true in agent runner) */
  useWorktree?: boolean
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

  // Plan session methods
  startPlanSession: (
    description: string,
    projectName: string,
    options?: {
      targetMachineId?: string
      workingDirectory?: string
      model?: string
      preferredProvider?: string
      visionDoc?: string
      repository?: string
    }
  ) => Promise<{ projectId: string; nodeId: string }>
  cancelPlanSession: (projectId: string) => Promise<void>
  steerPlanSession: (projectId: string, message: string) => Promise<boolean>

  // Playground session methods
  startPlaygroundSession: (
    description: string,
    options: {
      targetMachineId: string
      workingDirectory: string
      model?: string
      preferredProvider?: string
    }
  ) => Promise<{ projectId: string; nodeId: string }>
  cancelPlaygroundSession: (projectId: string) => Promise<void>
  steerPlaygroundSession: (projectId: string, message: string) => Promise<boolean>

  // Persistence
  load: () => Promise<void>
  persist: () => Promise<void>
}

// Abort controllers for active executions
const abortControllers = new Map<string, AbortController>()

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

    // Serial execution constraint for non-git projects (direct delivery mode)
    if (project?.source && !project.source.isGit) {
      const activeForProject = [...get().executions.values()].some(
        (e) => e.projectId === projectId && (e.status === 'pending' || e.status === 'running')
      )
      if (activeForProject) {
        const execution: TaskExecution = {
          nodeId,
          projectId,
          executionId: `exec-${nodeId}-${Date.now()}`,
          status: 'failure',
          streamText: '',
          error: 'Serial execution required: this project has no git history. Only one task can run at a time to prevent file conflicts. Wait for the current task to complete.',
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
    }

    // Machine selection is handled server-side via project.defaultMachineId fallback
    const effectiveTargetMachineId = options?.targetMachineId

    // Resolve working directory
    const dirCheck = getProjectWorkingDir(project)
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
    const dependencyOutputs = buildDependencyOutputs(node.dependencies, liveNodes, projectId)

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

    // Update node status to dispatched
    planStore.updateNode(nodeId, { status: "dispatched" })

    try {
      // Use the dispatch/task endpoint
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/dispatch/task"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          nodeId,
          projectId,
          title: node.title,
          description: node.content ? stripHtml(node.content) : (node.description || node.title),
          dependencies: node.dependencies,
          verification: node.verification,
          visionDoc: project?.visionDoc,
          dependencyOutputs,
          preferredProvider: options?.preferredProvider,
          targetMachineId: effectiveTargetMachineId,
          model: options?.model,
          maxTurns: options?.maxTurns ?? 100,
          workingDirectory: resolvedDir,
          computeBackend: options?.computeBackend,
          deliveryMode: project?.deliveryMode || undefined,
          remoteType: project?.source?.remoteType,
          agentDir: project?.agentDir,
          worktreeStrategy: project?.worktreeStrategy,
          useWorktree: options?.useWorktree,
          imageRefs: node.content ? extractBlobUrls(node.content) : undefined,
          acceptanceCriteria: node.acceptanceCriteria,
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
            newExecutions.set(nodeId, { ...exec, status: "cancelled", completedAt: new Date() })
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
            newExecutions.set(nodeId, { ...exec, status: "failure", error: message, completedAt: new Date() })
          }
          return { executions: newExecutions }
        })
        planStore.updateNode(nodeId, {
          status: "awaiting_judgment",
          executionError: message,
        })

        // Persist failed execution to database
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
        newBatch.set(projectId, { ...batch, active: false })
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

  loadLocalBackends: async () => {
    // Local backend detection is only available in local mode;
    // server mode blocks this endpoint (403) since it exposes server infrastructure
    if (isServerMode()) {
      set({ localBackendsLoaded: true })
      return
    }
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

    const response = await fetch(apiUrl('/api/dispatch/approve'), {
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
        newExecutions.set(nodeId, {
          ...exec,
          streamText: exec.streamText + text,
          activityEvents: [...exec.activityEvents, { type: 'text', content: text, timestamp: new Date() }],
        })
      }
      return { executions: newExecutions }
    })
  },

  addToolTrace: (nodeId: string, trace: ToolTrace) => {
    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec) {
        let planTodos = exec.planTodos
        let planQuestions = exec.planQuestions

        // Extract plan mode data from TodoWrite and AskUserQuestion tools
        if (trace.toolName === 'TodoWrite') {
          const input = trace.toolInput as { todos?: Array<{ content: string; status: string; activeForm: string }> }
          if (input.todos) {
            planTodos = input.todos.map(t => ({
              content: t.content,
              status: t.status as 'pending' | 'in_progress' | 'completed',
              activeForm: t.activeForm,
            }))
          }
        } else if (trace.toolName === 'AskUserQuestion') {
          const input = trace.toolInput as { questions?: Array<{ question: string; options: Array<{ label: string }> }> }
          if (input.questions) {
            planQuestions = [...(exec.planQuestions || [])]
            for (const q of input.questions) {
              planQuestions.push({
                question: q.question,
                options: q.options.map(o => o.label),
              })
            }
          }
        }

        newExecutions.set(nodeId, {
          ...exec,
          toolTraces: [...exec.toolTraces, trace],
          activityEvents: [...exec.activityEvents, {
            type: 'tool_use' as const,
            id: trace.id,
            toolName: trace.toolName,
            toolInput: trace.toolInput,
            timestamp: trace.timestamp,
          }],
          planTodos,
          planQuestions,
        })
      }
      return { executions: newExecutions }
    })
  },

  addFileChange: (nodeId: string, change: FileChange) => {
    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec) {
        newExecutions.set(nodeId, {
          ...exec,
          fileChanges: [...exec.fileChanges, change],
          activityEvents: [...exec.activityEvents, {
            type: 'file_change' as const,
            path: change.path,
            action: change.action,
            diff: change.diff,
            linesAdded: change.linesAdded,
            linesRemoved: change.linesRemoved,
            timestamp: change.timestamp,
          }],
        })
      }
      return { executions: newExecutions }
    })
  },

  updateToolTraceResult: (nodeId: string, toolName: string, result: unknown, success?: boolean, duration?: number) => {
    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec && exec.toolTraces.length > 0) {
        // Search backwards for the last UNPAIRED trace with the matching tool name.
        // This handles parallel/out-of-order tool calls correctly (e.g.,
        // tool_use "Read" → tool_use "Bash" → tool_result "Read").
        const matchingTrace = [...exec.toolTraces].reverse().find(
          t => t.toolName === toolName && !t.toolResult
        ) || exec.toolTraces[exec.toolTraces.length - 1]

        if (matchingTrace.toolName === toolName) {
          const updatedToolTraces = exec.toolTraces.map(t => t === matchingTrace
            ? { ...t, toolResult: result, success, duration }
            : t)
          newExecutions.set(nodeId, {
            ...exec,
            toolTraces: updatedToolTraces,
            activityEvents: [...exec.activityEvents, {
              type: 'tool_result' as const,
              id: matchingTrace.id,
              toolName,
              toolResult: result,
              success,
              duration,
              timestamp: new Date(),
            }],
          })
        }
      }
      return { executions: newExecutions }
    })
  },

  // ─── Plan Session Methods ──────────────────────────────────────────

  startPlanSession: async (description, projectName, options) => {
    // 1. Create project
    const projectId = crypto.randomUUID()
    const displayName = projectName || "New Project"
    useProjectStore.getState().addProject({
      id: projectId,
      name: displayName,
      description,
      visionDoc: options?.visionDoc || "",
      workingDirectory: options?.workingDirectory,
      repository: options?.repository,
      defaultMachineId: options?.targetMachineId,
    } as Project)

    const nodeId = `plan-${projectId}`

    // 2. Create execution entry
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

    // Toast tracking disabled for interactive plans — text streams directly in the plan UI

    // 4. Create abort controller
    const abortController = new AbortController()
    abortControllers.set(nodeId, abortController)

    // 5. Dispatch via POST /api/dispatch/task (fire-and-forget SSE processing)
    // We dispatch the fetch + SSE stream in the background so the caller
    // gets { projectId, nodeId } immediately and can transition the UI.
    getAuthHeaders().then(async (headers) => {
      try {
        const response = await fetch(apiUrl("/api/dispatch/task"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId,
            projectId,
            title: `Interactive planning: ${projectName || description.slice(0, 50)}`,
            description,
            dependencies: [],
            verification: "human",
            visionDoc: options?.visionDoc,
            targetMachineId: options?.targetMachineId,
            model: options?.model,
            preferredProvider: options?.preferredProvider,
            maxTurns: 200,
            workingDirectory: options?.workingDirectory,
            isInteractivePlan: true,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null)
          const detail = errorBody?.error || ""
          throw new Error(`Server error: ${response.status}${detail ? ` - ${detail}` : ''}`)
        }

        // 6. Process SSE stream using existing infrastructure
        const planStore = usePlanStore.getState()
        await parseSSEStream(response, {
          onEvent: ({ event, data }) => {
            handleSSEEvent(event, data, nodeId, set, get, planStore)

            // On result, extract plan JSON
            if (event === "result") {
              try {
                const exec = get().executions.get(nodeId)
                if (exec?.streamText) {
                  const planJson = extractPlanJsonFromText(exec.streamText)
                  if (planJson) {
                    const prefix = projectId.slice(0, 8)
                    const prefixId = (id: string) => id.startsWith(prefix) ? id : `${prefix}-${id}`
                    const now = new Date()

                    const nodes: PlanNode[] = planJson.nodes.map((n: Record<string, unknown>) => ({
                      id: prefixId(n.id as string),
                      projectId,
                      type: (n.type as PlanNode["type"]) || "task",
                      title: (n.title as string) || "",
                      description: (n.description as string) || "",
                      content: n.description ? `<p>${n.description as string}</p>` : '',
                      status: (n.status as PlanNode["status"]) || "planned",
                      parentId: n.parentId ? prefixId(n.parentId as string) : null,
                      dependencies: (n.dependencies as string[] || []).map(prefixId),
                      verification: (n.verification as PlanNode["verification"]) || "human",
                      position: (n.position as { x: number; y: number }) || { x: 40, y: 40 },
                      startDate: n.startDate as string | undefined,
                      endDate: n.endDate as string | undefined,
                      priority: n.priority as PlanNode["priority"],
                      estimate: n.estimate as PlanNode["estimate"],
                      dueDate: n.dueDate as string | undefined,
                      labelIds: n.labelIds as string[] | undefined,
                      milestoneId: n.milestoneId ? prefixId(n.milestoneId as string) : undefined,
                      createdAt: now,
                      updatedAt: now,
                    }))

                    const edges: PlanEdge[] = (planJson.edges || []).map((e: Record<string, unknown>) => ({
                      id: prefixId(e.id as string),
                      source: prefixId(e.source as string),
                      target: prefixId(e.target as string),
                      type: (e.type as PlanEdge["type"]) || "dependency",
                    }))

                    planStore.setProjectPlan(projectId, nodes, edges)
                    planStore.reorganizeProject(projectId)

                    if (planJson.projectName) {
                      useProjectStore.getState().updateProject(projectId, { name: planJson.projectName })
                    }

                    console.log(`[plan-session] Plan extracted: ${nodes.length} nodes, ${edges.length} edges`)
                  }
                }
              } catch (e) {
                console.error("[plan-session] Failed to extract plan:", e)
              }

              // Toast tracking disabled — plan UI handles status directly
            }
          },
        })
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          set((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              newExecutions.set(nodeId, { ...exec, status: "cancelled", completedAt: new Date() })
            }
            return { executions: newExecutions }
          })
        } else {
          const message = error instanceof Error ? error.message : "Unknown error"
          set((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              newExecutions.set(nodeId, { ...exec, status: "failure", error: message, completedAt: new Date() })
            }
            return { executions: newExecutions }
          })
          // Toast tracking disabled — plan UI handles errors via execution store
        }
      } finally {
        abortControllers.delete(nodeId)
      }
    })

    return { projectId, nodeId }
  },

  cancelPlanSession: async (projectId) => {
    const nodeId = `plan-${projectId}`
    const controller = abortControllers.get(nodeId)
    if (controller) {
      controller.abort()
      abortControllers.delete(nodeId)
    }

    // Cancel on server/relay (same as cancelExecution)
    const execution = get().executions.get(nodeId)
    if (execution?.executionId) {
      try {
        const headers = await getAuthHeaders()
        await fetch(apiUrl("/api/dispatch/cancel"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId,
            executionId: execution.executionId,
          }),
        })
      } catch {
        // Ignore cancel errors
      }
    }

    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec) {
        newExecutions.set(nodeId, { ...exec, status: "cancelled", completedAt: new Date() })
      }
      return { executions: newExecutions }
    })

  },

  steerPlanSession: async (projectId, message) => {
    const nodeId = `plan-${projectId}`
    const execution = get().executions.get(nodeId)
    if (!execution?.executionId || !execution.machineId) {
      console.warn("[plan-session] Cannot steer: no executionId or machineId")
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
          action: "guidance",
        }),
      })

      if (!response.ok) {
        console.error("[plan-session] Failed to steer:", response.status)
        return false
      }

      const result = await response.json()
      return result.success
    } catch (error) {
      console.error("[plan-session] Error steering:", error)
      return false
    }
  },

  // ─── Playground Session Methods ──────────────────────────────────────

  startPlaygroundSession: async (description, options) => {
    // 1. Create project for this playground session
    const projectId = crypto.randomUUID()
    const displayName = description.slice(0, 60) || "Playground Session"
    useProjectStore.getState().addProject({
      id: projectId,
      name: displayName,
      description,
      visionDoc: "",
      workingDirectory: options.workingDirectory,
      defaultMachineId: options.targetMachineId,
      projectType: 'playground',
    } as Project)

    const nodeId = `playground-${projectId}`

    // 2. Create execution entry
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

    // 3. Create abort controller
    const abortController = new AbortController()
    abortControllers.set(nodeId, abortController)

    // 4. Dispatch via POST /api/dispatch/task (fire-and-forget SSE processing)
    getAuthHeaders().then(async (headers) => {
      try {
        const response = await fetch(apiUrl("/api/dispatch/task"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId,
            projectId,
            title: `Playground: ${description.slice(0, 80)}`,
            description,
            dependencies: [],
            verification: "human",
            targetMachineId: options.targetMachineId,
            model: options.model,
            preferredProvider: options.preferredProvider,
            maxTurns: 200,
            workingDirectory: options.workingDirectory,
            deliveryMode: "direct",
            skipSafetyCheck: true,
            force: true,
            isInteractivePlan: false,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null)
          const detail = errorBody?.error || ""
          throw new Error(`Server error: ${response.status}${detail ? ` - ${detail}` : ''}`)
        }

        // 5. Process SSE stream
        const planStore = usePlanStore.getState()
        await parseSSEStream(response, {
          onEvent: ({ event, data }) => {
            handleSSEEvent(event, data, nodeId, set, get, planStore)
          },
        })
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          set((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              newExecutions.set(nodeId, { ...exec, status: "cancelled", completedAt: new Date() })
            }
            return { executions: newExecutions }
          })
        } else {
          const message = error instanceof Error ? error.message : "Unknown error"
          set((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              newExecutions.set(nodeId, { ...exec, status: "failure", error: message, completedAt: new Date() })
            }
            return { executions: newExecutions }
          })
        }
      } finally {
        abortControllers.delete(nodeId)
      }
    })

    return { projectId, nodeId }
  },

  cancelPlaygroundSession: async (projectId) => {
    const nodeId = `playground-${projectId}`
    const controller = abortControllers.get(nodeId)
    if (controller) {
      controller.abort()
      abortControllers.delete(nodeId)
    }

    const execution = get().executions.get(nodeId)
    if (execution?.executionId) {
      try {
        const headers = await getAuthHeaders()
        await fetch(apiUrl("/api/dispatch/cancel"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId,
            executionId: execution.executionId,
          }),
        })
      } catch {
        // Ignore cancel errors
      }
    }

    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec) {
        newExecutions.set(nodeId, { ...exec, status: "cancelled", completedAt: new Date() })
      }
      return { executions: newExecutions }
    })
  },

  steerPlaygroundSession: async (projectId, message) => {
    const nodeId = `playground-${projectId}`
    const execution = get().executions.get(nodeId)
    if (!execution?.executionId || !execution.machineId) {
      console.warn("[playground] Cannot steer: no executionId or machineId")
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
          action: "guidance",
        }),
      })

      if (!response.ok) {
        console.error("[playground] Failed to steer:", response.status)
        return false
      }

      const result = await response.json()
      return result.success
    } catch (error) {
      console.error("[playground] Error steering:", error)
      return false
    }
  },

  load: async () => {
    try {
      const executionsRecord = await dataClient.getExecutions()
      // dataClient already deserializes dates, just convert Record to Map
      const executions = new Map<string, TaskExecution>(Object.entries(executionsRecord))
      set({ executions, loaded: true })
      console.log('[execution-store] Loaded executions from API:', executions.size)
    } catch (error) {
      console.error('[execution-store] Failed to load executions:', error)
      set({ loaded: true })
    }
  },

  persist: async () => {
    const { executions } = get()
    try {
      // Sync completed executions to API
      const completedExecutions = Array.from(executions.values())
        .filter((exec) => exec.status === 'success' || exec.status === 'failure' || exec.status === 'cancelled')

      for (const execution of completedExecutions) {
        dataClient.saveExecution(execution).catch((err) => {
          console.warn('[execution-store] Failed to sync execution to API:', err)
        })
      }
      console.log('[execution-store] Persisted', completedExecutions.length, 'executions to API')
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

// ─── Text Batching for Smooth Streaming ────────────────────────────
// Accumulates text chunks in a module-level buffer and flushes to
// Zustand every 50ms (~20fps), preventing per-token re-renders.
const textBatchPending = new Map<string, string>()
const textBatchTimers = new Map<string, ReturnType<typeof setTimeout>>()

function flushTextBatch(
  nodeId: string,
  set: (fn: (state: ExecutionState) => Partial<ExecutionState>) => void,
) {
  const timer = textBatchTimers.get(nodeId)
  if (timer) {
    clearTimeout(timer)
    textBatchTimers.delete(nodeId)
  }

  const text = textBatchPending.get(nodeId)
  textBatchPending.delete(nodeId)

  if (!text) return

  set((state) => {
    const newExecutions = new Map(state.executions)
    const exec = newExecutions.get(nodeId)
    if (exec) {
      // Spread to create a new object reference so Zustand selectors detect the change
      newExecutions.set(nodeId, {
        ...exec,
        streamText: exec.streamText + text,
        activityEvents: [...exec.activityEvents, {
          type: 'text' as const,
          content: text,
          timestamp: new Date(),
        }],
      })
    }
    return { executions: newExecutions }
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
  // Flush pending text before non-text events to preserve timeline ordering
  if (event !== 'text' && event !== 'heartbeat') {
    flushTextBatch(nodeId, set)
  }

  switch (event) {
    case "init": {
      try {
        const parsed = JSON.parse(data)
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            newExecutions.set(nodeId, {
              ...exec,
              executionId: parsed.executionId,
              status: "running",
              machineId: parsed.machineId,
              providerId: parsed.providerId,
              providerName: parsed.providerName,
              ...(parsed.computeBackend ? { computeBackend: parsed.computeBackend } : {}),
            })
          }
          return { executions: newExecutions }
        })
        const now = new Date()
        const node = planStore.nodes.find((n) => n.id === nodeId)
        planStore.updateNode(nodeId, {
          status: "in_progress",
          executionId: parsed.executionId,
          executionStartedAt: now,
          // Update startDate with real execution start time (ISO datetime)
          startDate: now.toISOString(),
          // Set actualStartDate only on first execution attempt (if not already set)
          ...(node && !node.actualStartDate ? { actualStartDate: now } : {}),
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
            newExecutions.set(nodeId, {
              ...exec,
              sessionId: parsed.sessionId,
            })
          }
          return { executions: newExecutions }
        })
      } catch {
        // Ignore parse errors
      }
      break
    }

    case "text": {
      // Batch text chunks — flush every 50ms for smooth ~20fps rendering
      textBatchPending.set(nodeId, (textBatchPending.get(nodeId) || '') + data)

      if (!textBatchTimers.has(nodeId)) {
        textBatchTimers.set(nodeId, setTimeout(() => {
          textBatchTimers.delete(nodeId)
          flushTextBatch(nodeId, set)
        }, 50))
      }
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
            newExecutions.set(nodeId, {
              ...exec,
              toolTraces: [...exec.toolTraces, trace],
              activityEvents: [...exec.activityEvents, {
                type: 'tool_use' as const,
                id: traceId,
                toolName: parsed.toolName,
                toolInput: parsed.toolInput,
                timestamp: now,
              }],
            })
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
            // Find the last UNPAIRED trace with the matching tool name.
            // Searching backwards handles parallel/out-of-order tool calls
            // (e.g., tool_use "Read" → tool_use "Bash" → tool_result "Read").
            const matchingTrace = [...exec.toolTraces].reverse().find(
              t => t.toolName === parsed.toolName && !t.toolResult
            ) || exec.toolTraces[exec.toolTraces.length - 1]

            const updatedToolTraces = matchingTrace.toolName === parsed.toolName
              ? exec.toolTraces.map(t => t === matchingTrace
                  ? { ...t, toolResult: parsed.result, success: parsed.success, duration: parsed.duration }
                  : t)
              : exec.toolTraces

            newExecutions.set(nodeId, {
              ...exec,
              toolTraces: updatedToolTraces,
              activityEvents: [...exec.activityEvents, {
                type: 'tool_result' as const,
                id: matchingTrace.id,
                toolName: parsed.toolName,
                toolResult: parsed.result,
                success: parsed.success,
                duration: parsed.duration,
                timestamp: now,
              }],
            })
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
            newExecutions.set(nodeId, {
              ...exec,
              fileChanges: [...exec.fileChanges, change],
              activityEvents: [...exec.activityEvents, {
                type: 'file_change' as const,
                path: parsed.path,
                action: parsed.action || 'modify',
                diff: parsed.diff,
                linesAdded: parsed.linesAdded,
                linesRemoved: parsed.linesRemoved,
                timestamp: now,
              }],
            })
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
            newExecutions.set(nodeId, {
              ...exec,
              subroutineProgress: {
                name: parsed.name,
                index: parsed.index,
                total: parsed.total,
                status: parsed.status,
              },
            })
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
            newExecutions.set(nodeId, {
              ...exec,
              status: isSuccess ? "success" : "failure",
              completedAt: new Date(),
              ...(!isSuccess && parsed.error ? { error: parsed.error } : {}),
              ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
              ...(metrics ? { metrics } : {}),
              ...(parsed.branchName ? { branchName: parsed.branchName } : {}),
              ...(parsed.prUrl ? { prUrl: parsed.prUrl } : {}),
              ...(parsed.prNumber ? { prNumber: parsed.prNumber } : {}),
            })
          }
          return { executions: newExecutions }
        })

        // Accumulate metrics in usage store
        if (metrics) {
          useUsageStore.getState().addTaskMetrics(metrics, isSuccess)
        }

        // Determine final node status based on verification type (use fresh state, not stale snapshot)
        const node = usePlanStore.getState().nodes.find((n) => n.id === nodeId)
        // Use finalStatus from server if provided, otherwise determine locally
        let finalStatus: PlanNode["status"] = parsed.finalStatus

        if (!finalStatus) {
          if (isSuccess) {
            finalStatus = node?.verification === "auto" ? "auto_verified" : "awaiting_judgment"
          } else {
            finalStatus = "awaiting_judgment"
          }
        }

        const completionTime = new Date()
        planStore.updateNode(nodeId, {
          status: finalStatus,
          executionOutput: execution?.streamText || parsed.output,
          executionCompletedAt: completionTime,
          // Update endDate with real execution completion time (ISO datetime)
          endDate: completionTime.toISOString(),
          // Set actualEndDate to capture final execution completion timestamp
          actualEndDate: completionTime,
          // Persist PR/branch metadata on the plan node
          ...(parsed.branchName && { branchName: parsed.branchName }),
          ...(parsed.prUrl && { prUrl: parsed.prUrl }),
          ...(parsed.prNumber && { prNumber: parsed.prNumber }),
        })

        // Auto-assign defaultMachineId on the project if not set
        if (isSuccess && execution?.machineId && execution?.projectId) {
          const proj = useProjectStore.getState().projects.find((p) => p.id === execution.projectId)
          if (proj && !proj.defaultMachineId) {
            useProjectStore.getState().updateProject(proj.id, { defaultMachineId: execution.machineId })
          }
        }

        // Refresh file tree cache after task completion
        const projectForRefresh = useProjectStore.getState().projects.find(
          (p) => p.id === execution?.projectId
        )
        if (projectForRefresh?.workingDirectory) {
          fetch(apiUrl(`/api/repo/file-tree?workingDirectory=${encodeURIComponent(projectForRefresh.workingDirectory)}`))
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
        // Generate summary for all tasks that enter awaiting_judgment, not just successful ones
        if (execution && (finalStatus === "awaiting_judgment" || (isSuccess && node?.verification !== "auto"))) {
          requestExecutionSummary(nodeId, execution, node)
        }

        // Persist completed execution to database
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
        const errorTime = new Date()
        const execution = get().executions.get(nodeId)
        const node = planStore.nodes.find((n) => n.id === nodeId)

        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            newExecutions.set(nodeId, {
              ...exec,
              status: "failure",
              error: errorMessage,
              completedAt: errorTime,
              activityEvents: [...exec.activityEvents, { type: 'error' as const, error: errorMessage, timestamp: errorTime }],
            })
          }
          return { executions: newExecutions }
        })
        planStore.updateNode(nodeId, {
          status: "awaiting_judgment",
          executionError: errorMessage,
          // Update endDate with real execution error time (ISO datetime)
          endDate: errorTime.toISOString(),
          // Set actualEndDate even on error to track when task stopped
          actualEndDate: errorTime,
        })

        // Fire async summary generation for failed tasks (non-blocking)
        if (execution) {
          requestExecutionSummary(nodeId, execution, node)
        }

        // Persist failed execution to database
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
          newExecutions.set(nodeId, {
            ...exec,
            status: "cancelled",
            completedAt: new Date(),
          })
        }
        return { executions: newExecutions }
      })
      planStore.updateNode(nodeId, { status: "planned" })

      // Persist cancelled execution to database
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
  if (!node || !execution.streamText) {
    console.log(`[execution-store] Skipping summary generation for ${nodeId}: node=${!!node}, streamText=${!!execution.streamText}`)
    return
  }
  console.log(`[execution-store] Requesting summary generation for task: ${node.title} (status: ${execution.status})`)
  try {
    const headers = await getAuthHeaders()
    const response = await fetch(apiUrl("/api/agent/summarize"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        taskTitle: node.title,
        taskDescription: node.content ? stripHtml(node.content) : node.description,
        executionOutput: execution.streamText,
        fileChanges: execution.fileChanges.map((f) => ({ path: f.path, action: f.action })),
        status: execution.status === "success" ? "success" : "failure",
      }),
    })
    console.log(`[execution-store] Summary generation response status: ${response.status}`)
    if (response.ok) {
      const data = await response.json()
      if (data.summary) {
        console.log(`[execution-store] Successfully received summary for ${nodeId}`)
        // Ensure keyFindings is always present (backward compat)
        const raw = data.summary as ExecutionSummary
        const summary: ExecutionSummary = {
          ...raw,
          keyFindings: raw.keyFindings || [],
        }
        // If API didn't return keyFindings, try parsing from stream text
        if (summary.keyFindings.length === 0 && execution.streamText) {
          const parsed = parseExecutiveSummary(execution.streamText)
          if (parsed?.keyFindings) summary.keyFindings = parsed.keyFindings
        }
        useExecutionStore.setState((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            newExecutions.set(nodeId, { ...exec, summary })
          }
          return { executions: newExecutions }
        })
      } else {
        console.warn(`[execution-store] Summary response missing 'summary' field for ${nodeId}`)
        setFallbackSummary(nodeId, execution)
      }
    } else {
      const errorText = await response.text()
      console.error(`[execution-store] Summary generation failed for ${nodeId}:`, errorText)
      setFallbackSummary(nodeId, execution)
    }
  } catch (error) {
    // Non-critical — log but don't fail the execution
    console.error(`[execution-store] Summary generation error for ${nodeId}:`, error)
    setFallbackSummary(nodeId, execution)
  }
}

/**
 * Parse an executive summary from the agent's stream text.
 * Looks for the structured "## Executive Summary" block at the end of output.
 */
function parseExecutiveSummary(streamText: string): Partial<ExecutionSummary> | null {
  const match = streamText.match(/## Executive Summary\s*\n([\s\S]*?)(?:\n```|$)/)
  if (!match) return null

  const block = match[1]
  const statusMatch = block.match(/\*\*Status:\*\*\s*(success|partial|failure)/i)
  const whatMatch = block.match(/\*\*What was done:\*\*\s*(.+)/)
  const followUpLines = block.match(/\*\*Follow-ups:\*\*\s*\n((?:\s*-\s*.+\n?)+)/)

  // Extract bullet points (lines starting with "- " that aren't under Follow-ups)
  const lines = block.split('\n')
  const keyFindings: string[] = []
  let inFollowUps = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('**Follow-ups:**')) { inFollowUps = true; continue }
    if (trimmed.startsWith('**')) { inFollowUps = false; continue }
    if (trimmed.startsWith('- ') && !inFollowUps) {
      keyFindings.push(trimmed.slice(2).trim())
    }
  }

  const followUps: string[] = []
  if (followUpLines) {
    for (const line of followUpLines[1].split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('- ')) followUps.push(trimmed.slice(2).trim())
    }
  }

  if (!statusMatch && !whatMatch && keyFindings.length === 0) return null

  return {
    status: (statusMatch?.[1]?.toLowerCase() as 'success' | 'partial' | 'failure') || undefined,
    workCompleted: whatMatch?.[1]?.trim(),
    keyFindings: keyFindings.length > 0 ? keyFindings : undefined,
    followUps: followUps.length > 0 ? followUps : undefined,
  }
}

/** Set a fallback summary so the UI doesn't show "Generating summary..." forever. */
function setFallbackSummary(nodeId: string, execution: TaskExecution) {
  // Try to parse executive summary from the stream text first
  const parsed = execution.streamText ? parseExecutiveSummary(execution.streamText) : null

  useExecutionStore.setState((state) => {
    const newExecutions = new Map(state.executions)
    const exec = newExecutions.get(nodeId)
    if (exec && !exec.summary) {
      newExecutions.set(nodeId, {
        ...exec,
        summary: {
          workCompleted: parsed?.workCompleted || exec.error || 'Summary generation unavailable. Check execution output for details.',
          keyFindings: parsed?.keyFindings || [],
          filesChanged: exec.fileChanges?.map((f) => f.path) ?? [],
          status: parsed?.status || (execution.status === 'success' ? 'success' : 'failure'),
          followUps: parsed?.followUps || [],
        },
      })
    }
    return { executions: newExecutions }
  })
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
        if (b) newBatch.set(projectId, { ...b, active: false })
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

// Helper: Extract plan JSON from streaming text output
// Looks for JSON in ```json code fences or raw JSON with projectName/nodes/edges


