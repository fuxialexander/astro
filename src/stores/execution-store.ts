import { create } from "zustand"
import type { TaskExecution, ProviderStatus, PlanNode, PlanEdge, ToolTrace, FileChange, Project, ProjectSource, ExecutionSummary, ReplanContext } from "@/types"
import { usePlanStore, isLive } from "./plan-store"
import { useProjectStore } from "./project-store"
import { useToastStore } from "./toast-store"
import type { ApprovalRequest } from "@/components/approval-card"
import { dataClient } from "@/lib/data-client"
import { stripHtml, extractBlobUrls } from "@/lib/html-utils"
import { apiUrl } from "@/lib/api-url"
import { getColorForName, getProjectIconForName } from "@/lib/color-icon-utils"
import { useTaskChatStore } from "./task-chat-store"
import { useSessionStore } from "./session-store"
import { resolveWorkingDirectory, buildDependencyOutputs } from "@astro/core/dispatch"
import { getSigningPrivateKey, signDispatchIntent, generateNonce, type DispatchSigningPayload } from "@/lib/dispatch-signing"
import { useAuthStore } from "./auth-store"
import { showBatchCompleteNotification } from "@/lib/notifications"
import { deriveDeliveryMode } from "@/lib/project-source"
import { useSettingsStore } from "./settings-store"
import { authHeaders } from "@/lib/auth-headers"
import { useTeamStore } from "./team-store"
import { useRealtimeStore } from "./realtime-store"
import { useWorkspaceFilterStore } from "./workspace-filter-store"

/** Returns true for regular task execution node IDs (not ephemeral playground sessions). */
function isExecutionNodeId(nodeId: string): boolean {
  return !nodeId.startsWith('playground-')
}

// Helper: Create auth headers for API requests
async function getAuthHeaders(): Promise<HeadersInit> {
  return {
    "Content-Type": "application/json",
    ...(await authHeaders()),
  }
}

// Helper: Resolve working directory from project config (delegates to @astro/core)
export function getProjectWorkingDir(
  project: Project | undefined,
) {
  return resolveWorkingDirectory(project)
}

function resolveDispatchMachineId(
  project: Project | undefined,
  requestedMachineId?: string,
): string | undefined {
  return requestedMachineId ?? project?.defaultMachineId
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

// Dispatch field length limits — must match server-side Zod schema in dispatch.ts
const MAX_DESCRIPTION_LENGTH = 200_000
const MAX_VISIONDOC_LENGTH = 100_000
const MAX_DEP_OUTPUT_LENGTH = 100_000

/**
 * Truncate a dispatch field if it exceeds the max length.
 * Shows a warning toast so the user knows content was trimmed.
 */
function truncateDispatchField(value: string, maxLength: number, fieldLabel: string): string {
  if (value.length <= maxLength) return value
  const truncated = value.slice(0, maxLength)
  const droppedChars = value.length - maxLength
  useToastStore.getState().add({
    type: "warning",
    title: `${fieldLabel} truncated`,
    description: `Input was ${value.length.toLocaleString()} characters — trimmed to ${maxLength.toLocaleString()} (${droppedChars.toLocaleString()} characters dropped). Consider splitting into smaller tasks.`,
    duration: 10000,
  })
  return truncated
}

// Helper: Sign a dispatch intent if user has a signing key
async function buildDispatchSignature(
  nodeId: string,
  projectId: string,
  machineId: string | undefined,
): Promise<{ dispatchSignature: string; dispatchSigningPayload: DispatchSigningPayload } | null> {
  try {
    const userId = useAuthStore.getState().user?.id
    if (!userId || !machineId) return null
    const privateKey = await getSigningPrivateKey(userId)
    if (!privateKey) return null
    const payload: DispatchSigningPayload = {
      v: 1,
      nodeId,
      projectId,
      machineId,
      timestamp: new Date().toISOString(),
      nonce: generateNonce(),
    }
    const signature = await signDispatchIntent(privateKey, payload)
    return { dispatchSignature: signature, dispatchSigningPayload: payload }
  } catch {
    // Signing unavailable — send dispatch without signature
    return null
  }
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
  /** Follow-up execution: re-dispatch with delivery pipeline after task completion */
  isFollowUp?: boolean
  /** The follow-up instruction from the user */
  followUpMessage?: string
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

  // @deprecated — local backends now come from machine registry executionStrategies
  localBackends: ComputeBackendInfo[]
  localBackendsLoaded: boolean

  // Currently selected execution for detail view
  selectedExecutionId: string | null

  // Batch execution state per project
  batchExecutions: Map<string, BatchExecution>

  // Projects that should auto-execute after plan generation completes (with provider options)
  autoExecuteProjectIds: Map<string, ExecutionOptions>

  // Projects that already showed the "all tasks complete" toast (avoid duplicates)
  completedProjectIds: Set<string>

  // Projects with active chat mutations — prevents triggerBatchWave from auto-dispatching
  // tasks created/modified via plan chat (avoids YOLO cascading from chat context)
  chatMutationProjectIds: Set<string>

  // Parallel execution: all executions per node (loaded on demand)
  nodeExecutions: Map<string, TaskExecution[]>

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
  executeAllProject: (projectId: string, options?: ExecutionOptions) => boolean
  stopBatchExecution: (projectId: string) => void
  isBatchActive: (projectId: string) => boolean
  getBatchExecution: (projectId: string) => BatchExecution | undefined
  /** Trigger next batch wave dispatch (called from node:status_changed handler) */
  triggerBatchWave: (projectId: string) => void
  /** Mark a project as having active chat mutations (suppresses batch wave cascading) */
  setChatMutationActive: (projectId: string, active: boolean) => void

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

  // Auto-execute actions
  setAutoExecute: (projectId: string, enabled: boolean, options?: ExecutionOptions) => void

  // Approval actions
  addPendingApproval: (approval: ApprovalRequest) => void
  respondToApproval: (approvalId: string, approved: boolean, selectedOption?: string) => Promise<void>
  getPendingApproval: (approvalId: string) => ApprovalRequest | undefined
  getPendingApprovalForNode: (nodeId: string) => ApprovalRequest | undefined

  // Parallel execution actions
  loadNodeExecutions: (nodeId: string) => Promise<TaskExecution[]>
  getNodeExecutions: (nodeId: string) => TaskExecution[]

  // Mutation methods for relay/realtime events
  appendText: (nodeId: string, text: string) => void
  addToolTrace: (nodeId: string, trace: ToolTrace) => void
  addFileChange: (nodeId: string, change: FileChange) => void
  updateToolTraceResult: (nodeId: string, toolName: string, result: unknown, success?: boolean, duration?: number) => void

  // Plan generation methods
  startPlanGeneration: (
    description: string,
    projectName: string,
    options?: {
      targetMachineId?: string
      workingDirectory?: string
      model?: string
      preferredProvider?: string
      visionDoc?: string
      repository?: string
      baseBranch?: string
      githubOwner?: string
      githubRepo?: string
      githubRepoId?: number
      source?: ProjectSource
      deliveryMode?: string
    }
  ) => Promise<{ projectId: string; nodeId: string }>
  cancelPlanGeneration: (projectId: string) => Promise<void>
  /** Remove execution entry and delete the project created by startPlanGeneration. */
  cleanupPlanGeneration: (projectId: string) => void
  steerPlanGeneration: (projectId: string, message: string) => Promise<{ success: boolean; error?: 'no-machine' | 'send-failed' }>

  /** Start a plan session for an existing project (doesn't create a new project) */
  startPlanGenerationForProject: (
    projectId: string,
    description: string,
    options?: {
      targetMachineId?: string
      workingDirectory?: string
      model?: string
      preferredProvider?: string
      visionDoc?: string
      baseBranch?: string
    }
  ) => Promise<{ projectId: string; nodeId: string }>

  /** Start a replan session — regenerates the plan with lessons from prior execution */
  startReplanSession: (
    projectId: string,
    changeDescription: string | undefined,
    lessons: ReplanContext["lessons"],
    previousPlanSummary: string,
    options?: {
      visionDoc?: string
      targetMachineId?: string
      model?: string
      preferredProvider?: string
    }
  ) => Promise<{ projectId: string; nodeId: string }>

  // Playground session methods
  startPlaygroundSession: (
    description: string,
    options: {
      targetMachineId: string
      workingDirectory?: string
      model?: string
      preferredProvider?: string
      resumeSessionId?: string
      forkSession?: boolean
      selectedBackends?: string[]
    }
  ) => Promise<{ projectId: string; nodeId: string }>
  cancelPlaygroundSession: (projectId: string) => Promise<void>
  steerPlaygroundSession: (projectId: string, message: string) => Promise<{ success: boolean; error?: 'no-machine' | 'send-failed' }>

  // Persistence
  load: () => Promise<void>
  /** Load full executions for a single project (includes streamText). Merges into existing state. */
  loadForProject: (projectId: string) => Promise<void>
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
  autoExecuteProjectIds: new Map(),
  completedProjectIds: new Set(),
  chatMutationProjectIds: new Set(),
  nodeExecutions: new Map(),
  pendingApprovals: new Map(),
  loaded: false,

  loadNodeExecutions: async (nodeId: string) => {
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl(`/api/data/executions/${nodeId}/all`), { headers })
      if (!response.ok) return []
      const rows = await response.json() as Array<{
        executionId: string; nodeId: string; projectId: string; userId?: string;
        status: string; error?: string; machineId?: string; sessionId?: string;
        startedAt: string; completedAt?: string; markdownSummary?: string;
        summary?: TaskExecution['summary']; durationMs?: number;
        inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number;
        model?: string; turnsUsed?: number;
      }>
      const executions: TaskExecution[] = rows.map((r) => ({
        nodeId: r.nodeId,
        projectId: r.projectId,
        executionId: r.executionId,
        userId: r.userId,
        status: r.status as TaskExecution['status'],
        streamText: '',
        error: r.error,
        toolTraces: [],
        fileChanges: [],
        activityEvents: [],
        startedAt: new Date(r.startedAt),
        completedAt: r.completedAt ? new Date(r.completedAt) : undefined,
        machineId: r.machineId,
        sessionId: r.sessionId,
        summary: r.summary,
        metrics: r.durationMs != null ? {
          durationMs: r.durationMs,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          estimatedCostUsd: r.estimatedCostUsd,
          model: r.model,
          turnsUsed: r.turnsUsed,
        } : undefined,
      }))
      set((state) => {
        const next = new Map(state.nodeExecutions)
        next.set(nodeId, executions)
        return { nodeExecutions: next }
      })
      return executions
    } catch (err) {
      console.error('[execution-store] Failed to load node executions:', err)
      return []
    }
  },

  getNodeExecutions: (nodeId: string) => {
    return get().nodeExecutions.get(nodeId) ?? []
  },

  startExecution: async (nodeId: string, projectId: string, options?: ExecutionOptions) => {
    // Get node and project info
    const planStore = usePlanStore.getState()
    const node = planStore.nodes.find((n) => n.id === nodeId)
    if (!node) {
      console.error("Node not found:", nodeId)
      return
    }

    // Check if already executing (local execution store)
    if (get().isExecuting(nodeId)) {
      console.warn("Node already executing:", nodeId)
      return
    }

    // Check node status — only 'planned' nodes should be dispatched
    // (prevents double-dispatch when button is clicked twice or batch + manual race)
    // Exception: follow-up dispatches on completed tasks bypass this guard
    if (node.status !== 'planned' && !options?.isFollowUp) {
      console.warn(`Node ${nodeId} status is '${node.status}', not 'planned' — skipping dispatch`)
      return
    }

    // Check dependencies are met (use edges as source of truth)
    // Skip for follow-up dispatches — the task already completed once
    const liveNodes = planStore.nodes.filter(isLive)
    const liveEdges = planStore.edges.filter(isLive)
    if (!options?.isFollowUp) {
      const canExecute = canExecuteNode(node, liveNodes, liveEdges)
      if (!canExecute.ready) {
        console.error("Dependencies not met:", canExecute.reason)
        return
      }
    }

    // Create abort controller
    const abortController = new AbortController()
    abortControllers.set(nodeId, abortController)

    // Get project for vision doc and working directory
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)

    // Serial execution constraint for non-isolated projects (direct delivery mode).
    // Only 'direct' delivery mode requires serial execution — it works in-place
    // without worktree isolation. Other modes ('branch', 'pr', 'push', 'copy')
    // use git worktrees or copies for isolation and support parallel execution.
    // Note: the agent-runner enforces this via a directory lock as a safety net;
    // this frontend check provides early feedback to the user.
    const effectiveDeliveryMode = project?.deliveryMode || (project?.source ? deriveDeliveryMode(project.source) : undefined)
    if (effectiveDeliveryMode === 'direct') {
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
          error: 'Serial execution required: this project uses direct delivery mode (no git isolation). Only one task can run at a time to prevent file conflicts. Wait for the current task to complete.',
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
    const effectiveTargetMachineId = resolveDispatchMachineId(project, options?.targetMachineId)

    // Resolve working directory (may be undefined for auto-workspace)
    const dirCheck = getProjectWorkingDir(project)
    const resolvedDir = dirCheck.ok ? dirCheck.dir : undefined

    // Build dependency outputs from completed dependencies, truncating oversized outputs
    const rawDependencyOutputs = buildDependencyOutputs(node.dependencies, liveNodes, projectId)
    const DEP_TRUNCATION_SUFFIX = '\n\n[Output truncated...]'
    const dependencyOutputs = rawDependencyOutputs.map(dep => {
      if (dep.output.length <= MAX_DEP_OUTPUT_LENGTH) return dep
      return {
        ...dep,
        output: dep.output.slice(0, MAX_DEP_OUTPUT_LENGTH - DEP_TRUNCATION_SUFFIX.length) + DEP_TRUNCATION_SUFFIX,
      }
    })
    const truncatedCount = dependencyOutputs.filter((d, i) => d.output !== rawDependencyOutputs[i].output).length
    if (truncatedCount > 0) {
      useToastStore.getState().add({
        type: "warning",
        title: `${truncatedCount} dependency output${truncatedCount > 1 ? 's' : ''} truncated`,
        description: `Oversized dependency outputs were trimmed to ${MAX_DEP_OUTPUT_LENGTH.toLocaleString()} characters to fit dispatch limits.`,
        duration: 10000,
      })
    }

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
      const signing = await buildDispatchSignature(nodeId, projectId, effectiveTargetMachineId)
      const rawDescription = node.content ? stripHtml(node.content) : (node.description || node.title)

      // Resolve provider and model from settings if not explicitly passed
      const settings = useSettingsStore.getState()
      const effectiveProvider = options?.preferredProvider || settings.defaultProvider || undefined
      const effectiveModel = options?.model || settings.getModelForProvider(effectiveProvider) || undefined

      const response = await fetch(apiUrl("/api/dispatch/task"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          nodeId,
          projectId,
          title: node.title,
          description: truncateDispatchField(rawDescription, MAX_DESCRIPTION_LENGTH, "Task description"),
          dependencies: node.dependencies,
          verification: node.verification,
          visionDoc: project?.visionDoc ? truncateDispatchField(project.visionDoc, MAX_VISIONDOC_LENGTH, "Vision doc") : undefined,
          dependencyOutputs,
          preferredProvider: effectiveProvider,
          targetMachineId: effectiveTargetMachineId,
          model: effectiveModel,
          maxTurns: options?.maxTurns,
          workingDirectory: resolvedDir,
          computeBackend: options?.computeBackend,
          deliveryMode: project?.deliveryMode || (project?.source ? deriveDeliveryMode(project.source) : undefined),
          remoteType: project?.source?.remoteType || undefined,
          agentDir: project?.agentDir || undefined,
          worktreeStrategy: project?.worktreeStrategy || undefined,
          useWorktree: options?.useWorktree,
          imageRefs: node.content ? extractBlobUrls(node.content) : undefined,
          acceptanceCriteria: node.acceptanceCriteria || undefined,
          ...(options?.isFollowUp && { isFollowUp: true, force: true }),
          ...(options?.followUpMessage && { followUpMessage: options.followUpMessage }),
          ...signing,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        const zodDetail = errorBody?.details?.[0]?.message
        const detail = zodDetail ? `${errorBody?.error}: ${zodDetail}` : (errorBody?.error || '')
        throw new Error(`Server error: ${response.status}${detail ? ` - ${detail}` : ''}`)
      }

      // Parse JSON response — events arrive via global SSE bus → realtime-store → useStreamEvents
      const result = await response.json()
      if (result.executionId) {
        set((state) => {
          const newExecutions = new Map(state.executions)
          const exec = newExecutions.get(nodeId)
          if (exec) {
            newExecutions.set(nodeId, { ...exec, executionId: result.executionId, status: 'running' })
          }
          return { executions: newExecutions }
        })

        // Add to dashboard activity feed
        useRealtimeStore.getState().addActivityEntry(
          'dispatch',
          `Task "${node.title}" dispatched`,
          { taskId: result.executionId },
        )

        // Follow-up user messages are persisted server-side as acknowledged
        // steer_message events in streaming_events. The hydration pipeline
        // renders them as chat_user events. No frontend injection needed.
      }
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
      abortControllers.delete(nodeId)
    }

    // Set local status immediately so UI updates
    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec) {
        newExecutions.set(nodeId, { ...exec, status: "cancelled", completedAt: new Date() })
      }
      return { executions: newExecutions }
    })

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
    // Grab execution and node before any cleanup
    const execution = get().executions.get(nodeId)
    const planStore = usePlanStore.getState()
    const node = planStore.nodes.find((n) => n.id === nodeId)
    const projectId = node?.projectId || execution?.projectId

    // Cancel any in-progress execution first
    const controller = abortControllers.get(nodeId)
    if (controller) {
      controller.abort()
      abortControllers.delete(nodeId)
    }

    // Call server to clean up: close PR, delete branch, cleanup worktree, reset node
    try {
      const headers = await getAuthHeaders()
      await fetch(apiUrl("/api/dispatch/reset"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          nodeId,
          projectId,
          machineId: execution?.machineId,
        }),
      })
    } catch {
      // Best effort — continue with local cleanup even if server call fails
    }

    // Clean up all Zustand state for this node across all stores
    const oldExecutionId = execution?.executionId || node?.executionId
    await cleanupNodeZustandState(nodeId, oldExecutionId)

    // Reset PlanNode execution fields, PR fields, and status
    planStore.updateNode(nodeId, {
      executionId: undefined,
      executionOutput: undefined,
      executionError: undefined,
      executionStartedAt: undefined,
      executionCompletedAt: undefined,
      prUrl: undefined,
      prNumber: undefined,
      branchName: undefined,
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

    if (readyNodes.length === 0) return false

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

    // Dispatch ready nodes with a short staggered delay between each to avoid
    // overwhelming the system when many tasks become ready simultaneously
    const STAGGER_DELAY_MS = 10_000
    readyNodes.forEach((node, index) => {
      if (index === 0) {
        get().startExecution(node.id, projectId, options)
      } else {
        setTimeout(() => {
          // Check batch is still active before dispatching
          if (get().batchExecutions.get(projectId)?.active) {
            get().startExecution(node.id, projectId, options)
          }
        }, index * STAGGER_DELAY_MS)
      }
    })

    return true
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

  triggerBatchWave: (projectId: string) => {
    const batch = get().batchExecutions.get(projectId)
    if (batch?.active) {
      // Skip auto-dispatch if a chat mutation is in progress for this project.
      // This prevents tasks created/modified via plan chat from being auto-dispatched
      // while YOLO batch execution is active.
      if (get().chatMutationProjectIds.has(projectId)) {
        console.log(`[execution] Skipping batch wave for ${projectId}: chat mutation in progress`)
        return
      }
      dispatchNextBatchWave(projectId)
    }
  },

  setChatMutationActive: (projectId: string, active: boolean) => {
    set((state) => {
      const next = new Set(state.chatMutationProjectIds)
      if (active) {
        next.add(projectId)
      } else {
        next.delete(projectId)
      }
      return { chatMutationProjectIds: next }
    })
  },

  loadProviders: async () => {
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/agent/providers"), { headers })
      if (response.ok) {
        const data = await response.json()
        // The endpoint returns { machines: [{ providers: [...] }] }, not { providers: [...] }.
        // Aggregate providers from all connected machines, deduplicating by type.
        const seen = new Set<string>()
        const providers: ProviderStatus[] = []
        const machines = (data.machines || []) as Array<{ providers?: Array<{ type: string; status: string; capabilities?: string[] }> }>
        for (const m of machines) {
          for (const p of (m.providers || [])) {
            if (!seen.has(p.type)) {
              seen.add(p.type)
              providers.push({
                id: p.type,
                name: p.type,
                installed: true,
                authStatus: p.status === 'available' ? 'authenticated' : 'unknown',
                available: p.status === 'available',
              })
            }
          }
        }
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
    // No-op: backend detection has moved to agent runners.
    // All backends come from machine registry executionStrategies.
    set({ localBackendsLoaded: true })
  },

  fetchBackendDetail: async () => {
    // Deprecated: use fetchRemoteBackendDetail instead.
    // Kept for backwards compatibility but returns null.
    return null
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

  setAutoExecute: (projectId: string, enabled: boolean, options?: ExecutionOptions) => {
    set((state) => {
      const next = new Map(state.autoExecuteProjectIds)
      if (enabled) next.set(projectId, options ?? {})
      else next.delete(projectId)
      return { autoExecuteProjectIds: next }
    })
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

  startPlanGeneration: async (description, projectName, options) => {
    // 1. Create project
    const projectId = crypto.randomUUID()
    const displayName = projectName || "New Project"
    const wf = useWorkspaceFilterStore.getState().workspaceFilter
    const teamId = wf !== 'all' ? wf : useTeamStore.getState().getPersonalTeamId()
    await useProjectStore.getState().addProject({
      id: projectId,
      name: displayName,
      description,
      status: 'active',
      teamId,
      color: getColorForName(displayName),
      icon: getProjectIconForName(displayName),
      visionDoc: options?.visionDoc || "",
      workingDirectory: options?.workingDirectory,
      repository: options?.repository,
      defaultMachineId: options?.targetMachineId,
      projectType: 'plan',
      // Include GitHub metadata in initial project creation (avoids post-create PATCH race)
      ...(options?.githubOwner ? { githubOwner: options.githubOwner } : {}),
      ...(options?.githubRepo ? { githubRepo: options.githubRepo } : {}),
      ...(options?.githubRepoId ? { githubRepoId: options.githubRepoId } : {}),
      // Use the full detected source when available; fall back to constructing
      // a minimal source from baseBranch for backward compatibility.
      ...(options?.source ? { source: options.source }
        : options?.baseBranch ? {
          source: {
            localPath: options?.workingDirectory || '',
            baseBranch: options.baseBranch,
            isGit: true,
            remoteType: 'none' as const,
          },
        } : {}),
      ...(options?.deliveryMode ? { deliveryMode: options.deliveryMode } : {}),
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
        const effectiveTargetMachineId = options?.targetMachineId
        const signing = await buildDispatchSignature(nodeId, projectId, effectiveTargetMachineId)
        const safeDescription = truncateDispatchField(description, MAX_DESCRIPTION_LENGTH, "Plan description")
        const planSettings = useSettingsStore.getState()
        const planProvider = options?.preferredProvider || planSettings.defaultProvider || undefined
        const planModel = options?.model || planSettings.getModelForProvider(planProvider) || undefined
        const response = await fetch(apiUrl("/api/dispatch/task"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId,
            projectId,
            title: `Interactive planning: ${projectName || description.slice(0, 50)}`,
            description: safeDescription,
            dependencies: [],
            verification: "human",
            visionDoc: options?.visionDoc ? truncateDispatchField(options.visionDoc, MAX_VISIONDOC_LENGTH, "Vision doc") : undefined,
            targetMachineId: effectiveTargetMachineId,
            model: planModel,
            preferredProvider: planProvider,
            workingDirectory: options?.workingDirectory,
            isInteractivePlan: true,
            ...signing,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null)
          const zodDetail = errorBody?.details?.[0]?.message
          const detail = zodDetail ? `${errorBody?.error}: ${zodDetail}` : (errorBody?.error || "")
          throw new Error(`Server error: ${response.status}${detail ? ` - ${detail}` : ''}`)
        }

        // 6. Parse JSON response — events arrive via global SSE bus → realtime-store → useStreamEvents
        const result = await response.json()
        if (result.executionId) {
          set((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              newExecutions.set(nodeId, { ...exec, executionId: result.executionId, status: 'running' })
            }
            return { executions: newExecutions }
          })
          // Persist so execution survives page refresh (approval state depends on hydration)
          get().persist()
        }
      } catch (error) {
        // Only update if entry still exists (cancelPlanGeneration/cleanupPlanGeneration may have already handled it)
        if (!get().executions.has(nodeId)) return
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

  cancelPlanGeneration: async (projectId) => {
    const nodeId = `plan-${projectId}`
    const controller = abortControllers.get(nodeId)
    if (controller) {
      controller.abort()
      abortControllers.delete(nodeId)
    }

    // Set local status IMMEDIATELY so UI updates (don't wait for server)
    set((state) => {
      const newExecutions = new Map(state.executions)
      const exec = newExecutions.get(nodeId)
      if (exec) {
        newExecutions.set(nodeId, { ...exec, status: "cancelled", completedAt: new Date() })
      }
      return { executions: newExecutions }
    })

    get().persist()

    // Cancel on server/relay (fire-and-forget, same as cancelExecution)
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
  },

  /** Remove execution entry and delete the project created by startPlanGeneration. */
  cleanupPlanGeneration: (projectId) => {
    const nodeId = `plan-${projectId}`
    set((state) => {
      const newExecutions = new Map(state.executions)
      newExecutions.delete(nodeId)
      return { executions: newExecutions }
    })
    useProjectStore.getState().deleteProject(projectId)
  },

  steerPlanGeneration: async (projectId, message) => {
    const nodeId = `plan-${projectId}`
    const execution = get().executions.get(nodeId)

    // Attempt to resolve machineId from the realtime store's taskStreams when the
    // execution entry doesn't have one yet (e.g. session_init hasn't arrived).
    let machineId = execution?.machineId
    if (!machineId && execution?.executionId) {
      const { useRealtimeStore } = await import("./realtime-store")
      machineId = useRealtimeStore.getState().taskStreams.get(execution.executionId)?.machineId
    }

    if (!execution?.executionId || !machineId) {
      console.warn("[plan-generation] Cannot steer: no executionId or machineId")
      return { success: false, error: 'no-machine' as const }
    }

    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/dispatch/steer"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          taskId: execution.executionId,
          machineId,
          message,
          action: "guidance",
        }),
      })

      if (!response.ok) {
        console.error("[plan-generation] Failed to steer:", response.status)
        return { success: false, error: 'send-failed' as const }
      }

      const result = await response.json()
      return { success: !!result.success }
    } catch (error) {
      console.error("[plan-generation] Error steering:", error)
      return { success: false, error: 'send-failed' as const }
    }
  },

  // ─── Start Plan Session For Existing Project ──────────────────────────

  startPlanGenerationForProject: async (projectId, description, options) => {
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    const nodeId = `plan-${projectId}`

    // Update project if options provide new values
    const updates: Partial<Project> = {}
    if (options?.workingDirectory && options.workingDirectory !== project.workingDirectory) {
      updates.workingDirectory = options.workingDirectory
    }
    if (options?.targetMachineId && options.targetMachineId !== project.defaultMachineId) {
      updates.defaultMachineId = options.targetMachineId
    }
    if (options?.visionDoc) {
      updates.visionDoc = options.visionDoc
    }
    if (options?.baseBranch) {
      // Only update baseBranch on the existing source — don't overwrite a fully-detected
      // source (with accurate isGit/remoteType/remoteUrl) with a minimal fallback.
      const existingSource = useProjectStore.getState().projects.find((p) => p.id === projectId)?.source
      updates.source = {
        ...(existingSource || project.source || { localPath: project.workingDirectory || '', isGit: true, remoteType: 'none' as const }),
        baseBranch: options.baseBranch,
      }
    }
    if (Object.keys(updates).length > 0) {
      useProjectStore.getState().updateProject(projectId, updates)
    }

    // Create execution entry
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

    // Create abort controller
    const abortController = new AbortController()
    abortControllers.set(nodeId, abortController)

    // Dispatch via POST /api/dispatch/task (fire-and-forget SSE processing)
    getAuthHeaders().then(async (headers) => {
      try {
        const effectiveTargetMachineId = resolveDispatchMachineId(project, options?.targetMachineId)
        const signing = await buildDispatchSignature(nodeId, projectId, effectiveTargetMachineId)
        const safeDescription = truncateDispatchField(description, MAX_DESCRIPTION_LENGTH, "Plan description")
        const addSettings = useSettingsStore.getState()
        const addProvider = options?.preferredProvider || addSettings.defaultProvider || undefined
        const addModel = options?.model || addSettings.getModelForProvider(addProvider) || undefined
        const response = await fetch(apiUrl("/api/dispatch/task"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId,
            projectId,
            title: `Interactive planning: ${description.slice(0, 50)}`,
            description: safeDescription,
            dependencies: [],
            verification: "human",
            visionDoc: options?.visionDoc ? truncateDispatchField(options.visionDoc, MAX_VISIONDOC_LENGTH, "Vision doc") : undefined,
            targetMachineId: effectiveTargetMachineId,
            model: addModel,
            preferredProvider: addProvider,
            workingDirectory: options?.workingDirectory || project.workingDirectory || undefined,
            isInteractivePlan: true,
            ...signing,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null)
          const zodDetail = errorBody?.details?.[0]?.message
          const detail = zodDetail ? `${errorBody?.error}: ${zodDetail}` : (errorBody?.error || "")
          throw new Error(`Server error: ${response.status}${detail ? ` - ${detail}` : ''}`)
        }

        // Parse JSON response — events arrive via global SSE bus → realtime-store → useStreamEvents
        const result = await response.json()
        if (result.executionId) {
          set((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              newExecutions.set(nodeId, { ...exec, executionId: result.executionId, status: 'running' })
            }
            return { executions: newExecutions }
          })
          // Persist so execution survives page refresh
          get().persist()
        }
      } catch (error) {
        if (!get().executions.has(nodeId)) return
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

  // ─── Replan Session ──────────────────────────────────────────────────

  startReplanSession: async (projectId, changeDescription, lessons, previousPlanSummary, options) => {
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    const nodeId = `plan-${projectId}`

    // Cancel any active plan session first
    const existingExec = get().executions.get(nodeId)
    if (existingExec && existingExec.status !== "success" && existingExec.status !== "failure" && existingExec.status !== "cancelled") {
      await get().cancelPlanGeneration(projectId)
    }

    // Build the replan description with context
    const replanContext: ReplanContext = {
      lessons,
      previousPlanSummary,
      changeDescription,
    }

    const description = changeDescription
      ? `Replan: ${changeDescription}`
      : "Regenerate plan based on lessons from previous execution"

    // Create execution entry
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

    // Create abort controller
    const abortController = new AbortController()
    abortControllers.set(nodeId, abortController)

    // Dispatch via POST /api/dispatch/task with replanContext
    getAuthHeaders().then(async (headers) => {
      try {
        const effectiveTargetMachineId = resolveDispatchMachineId(project, options?.targetMachineId)
        const signing = await buildDispatchSignature(nodeId, projectId, effectiveTargetMachineId)
        const replanSettings = useSettingsStore.getState()
        const replanProvider = options?.preferredProvider || replanSettings.defaultProvider || undefined
        const replanModel = options?.model || replanSettings.getModelForProvider(replanProvider) || undefined
        const response = await fetch(apiUrl("/api/dispatch/task"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId,
            projectId,
            title: `Replan: ${(changeDescription || project.name).slice(0, 50)}`,
            description,
            dependencies: [],
            verification: "human",
            visionDoc: options?.visionDoc,
            targetMachineId: effectiveTargetMachineId,
            model: replanModel,
            preferredProvider: replanProvider,
            workingDirectory: project.workingDirectory,
            isInteractivePlan: true,
            replanContext,
            ...signing,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null)
          const detail = errorBody?.error || ""
          throw new Error(`Server error: ${response.status}${detail ? ` - ${detail}` : ''}`)
        }

        // Parse JSON response — events arrive via global SSE bus → realtime-store → useStreamEvents
        const result = await response.json()
        if (result.executionId) {
          set((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              newExecutions.set(nodeId, { ...exec, executionId: result.executionId, status: 'running' })
            }
            return { executions: newExecutions }
          })
        }
      } catch (error) {
        if (!get().executions.has(nodeId)) return
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

  // ─── Playground Session Methods ──────────────────────────────────────

  startPlaygroundSession: async (description, options) => {
    // 1. Create project for this playground session
    const projectId = crypto.randomUUID()
    const displayName = description.slice(0, 60) || "Playground Session"
    // Playground sessions are always personal — not shared with team
    const pgTeamId = useTeamStore.getState().getPersonalTeamId()
    await useProjectStore.getState().addProject({
      id: projectId,
      name: displayName,
      description,
      status: 'active',
      teamId: pgTeamId,
      color: getColorForName(displayName),
      icon: getProjectIconForName(displayName),
      visionDoc: "",
      workingDirectory: options.workingDirectory || '',
      defaultMachineId: options.targetMachineId,
      projectType: 'playground',
      ...(options.selectedBackends?.length && { computeBackends: options.selectedBackends }),
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
        const signing = await buildDispatchSignature(nodeId, projectId, options.targetMachineId)
        const safeDescription = truncateDispatchField(description, MAX_DESCRIPTION_LENGTH, "Playground description")
        const pgSettings = useSettingsStore.getState()
        const pgProvider = options.preferredProvider || pgSettings.defaultProvider || undefined
        const pgModel = options.model || pgSettings.getModelForProvider(pgProvider) || undefined
        const response = await fetch(apiUrl("/api/dispatch/task"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId,
            projectId,
            title: `Playground: ${description.slice(0, 80)}`,
            description: safeDescription,
            dependencies: [],
            verification: "human",
            targetMachineId: options.targetMachineId,
            model: pgModel,
            preferredProvider: pgProvider,
            workingDirectory: options.workingDirectory,
            deliveryMode: "direct",
            skipSafetyCheck: true,
            force: true,
            isInteractivePlan: false,
            ...(options.resumeSessionId && { resumeSessionId: options.resumeSessionId }),
            ...(options.forkSession && { forkSession: options.forkSession }),
            ...signing,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null)
          const zodDetail = errorBody?.details?.[0]?.message
          const detail = zodDetail ? `${errorBody?.error}: ${zodDetail}` : (errorBody?.error || "")
          throw new Error(`Server error: ${response.status}${detail ? ` - ${detail}` : ''}`)
        }

        // 5. Parse JSON response — events arrive via global SSE bus → realtime-store → useStreamEvents
        const result = await response.json()
        if (result.executionId) {
          set((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              newExecutions.set(nodeId, { ...exec, executionId: result.executionId, status: 'running' })
            }
            return { executions: newExecutions }
          })
        }
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

    // Persist cancelled state to DB
    get().persist()
  },

  steerPlaygroundSession: async (projectId, message) => {
    const nodeId = `playground-${projectId}`
    const execution = get().executions.get(nodeId)

    // Attempt to resolve machineId from the realtime store's taskStreams when the
    // execution entry doesn't have one yet (e.g. session_init hasn't arrived).
    let machineId = execution?.machineId
    if (!machineId && execution?.executionId) {
      const { useRealtimeStore } = await import("./realtime-store")
      machineId = useRealtimeStore.getState().taskStreams.get(execution.executionId)?.machineId
    }

    if (!execution?.executionId || !machineId) {
      console.warn("[playground] Cannot steer: no executionId or machineId")
      return { success: false, error: 'no-machine' as const }
    }

    try {
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl("/api/dispatch/steer"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          taskId: execution.executionId,
          machineId,
          message,
          action: "guidance",
        }),
      })

      if (!response.ok) {
        console.error("[playground] Failed to steer:", response.status)
        return { success: false, error: 'send-failed' as const }
      }

      const result = await response.json()
      return { success: !!result.success }
    } catch (error) {
      console.error("[playground] Error steering:", error)
      return { success: false, error: 'send-failed' as const }
    }
  },

  load: async () => {
    // Retry up to 2 times — first attempt can fail with AbortError
    // on page refresh if network/auth state is still settling.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Slim mode: exclude streamText to reduce transfer size.
        // Full data is loaded per-project via loadForProject() when needed.
        const executionsRecord = await dataClient.getExecutions({ slim: true })
        // dataClient already deserializes dates, just convert Record to Map
        const executions = new Map<string, TaskExecution>(Object.entries(executionsRecord))

        // Backfill summaries for completed executions that have streamText but no summary.
        // Note: In slim mode, streamText is empty so this loop is effectively a no-op.
        // It remains for correctness if slim mode is ever disabled.
        for (const [nodeId, exec] of executions) {
          if (!exec.summary && exec.streamText && (exec.status === 'success' || exec.status === 'failure') && isExecutionNodeId(nodeId)) {
            const parsed = parseExecutiveSummary(exec.streamText)
            if (parsed?.status && parsed?.workCompleted) {
              executions.set(nodeId, {
                ...exec,
                summary: {
                  workCompleted: parsed.workCompleted,
                  keyFindings: parsed.keyFindings || [],
                  filesChanged: exec.fileChanges?.map((f) => f.path) ?? [],
                  status: parsed.status,
                  followUps: parsed.followUps || [],
                },
              })
            }
          }
        }

        set({ executions, loaded: true })
        console.log('[execution-store] Loaded executions from API:', executions.size)
        return
      } catch (error) {
        console.warn(`[execution-store] Load attempt ${attempt + 1} failed:`, (error as Error).message)
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        }
      }
    }

    console.error('[execution-store] All load attempts failed')
    set({ loaded: true })
  },

  loadForProject: async (projectId: string) => {
    try {
      // Full load for one project (includes streamText for execution panel + summary backfill)
      const executionsRecord = await dataClient.getExecutions({ projectId })
      const fullExecs = new Map<string, TaskExecution>(Object.entries(executionsRecord))

      // Backfill summaries for completed executions in this project (skip playground sessions)
      for (const [nodeId, exec] of fullExecs) {
        if (!exec.summary && exec.streamText && (exec.status === 'success' || exec.status === 'failure') && isExecutionNodeId(nodeId)) {
          const parsed = parseExecutiveSummary(exec.streamText)
          if (parsed?.status && parsed?.workCompleted) {
            fullExecs.set(nodeId, {
              ...exec,
              summary: {
                workCompleted: parsed.workCompleted,
                keyFindings: parsed.keyFindings || [],
                filesChanged: exec.fileChanges?.map((f) => f.path) ?? [],
                status: parsed.status,
                followUps: parsed.followUps || [],
              },
            })
          }
        }
      }

      // Merge: replace executions for this project, keep others.
      // Preserve in-flight executions (running/pending) whose live streaming
      // buffer would be lost if replaced by the stale DB snapshot.
      const { executions: existing } = get()
      const merged = new Map(existing)
      // Remove old entries for this project (except actively running ones)
      for (const [nodeId, exec] of existing) {
        if (exec.projectId === projectId && exec.status !== 'running' && exec.status !== 'pending') {
          merged.delete(nodeId)
        }
      }
      // Add fresh full data (skip if we preserved a running entry)
      for (const [nodeId, exec] of fullExecs) {
        if (!merged.has(nodeId) || merged.get(nodeId)?.status !== 'running') {
          merged.set(nodeId, exec)
        }
      }
      set({ executions: merged })
    } catch (err) {
      console.error('[execution-store] loadForProject failed:', err)
    }
  },

  persist: async () => {
    const { executions } = get()
    try {
      // Sync all executions with valid executionIds to API
      // (includes running executions so they survive page refresh)
      const persistable = Array.from(executions.values())
        .filter((exec) => exec.executionId)

      for (const execution of persistable) {
        dataClient.saveExecution(execution).catch((err) => {
          console.warn('[execution-store] Failed to sync execution to API:', err)
        })
      }
      console.log('[execution-store] Persisted', persistable.length, 'executions to API')
    } catch (error) {
      console.error('[execution-store] Failed to persist executions:', error)
    }
  },
}))

// ─── Cleanup Utilities ──────────────────────────────────────────────

/**
 * Clean up all Zustand state associated with a node/execution.
 * Called by both resetExecution (execution-store) and resetNode (plan-store).
 */
export async function cleanupNodeZustandState(nodeId: string, executionId?: string) {
  // Clear chat session for this task
  useTaskChatStore.getState().clearSession(nodeId)

  // Clear all sessions (steer + task-chat) for this node from session store
  // Also clear activeSessionIds that point to deleted sessions
  const sessionStore = useSessionStore.getState()
  sessionStore.clearSessionsForNode(nodeId)

  // Clear realtime store state (taskStream, text batches, approvals, safety prompts, attached sessions)
  if (executionId) {
    const { useRealtimeStore, clearRealtimeTextBatch } = await import("./realtime-store")
    clearRealtimeTextBatch(executionId)
    useRealtimeStore.setState((state) => {
      const streams = new Map(state.taskStreams)
      streams.delete(executionId)
      // Remove dynamic approvals for this execution
      const newApprovals = new Map(state.dynamicApprovals)
      for (const [rid, approval] of newApprovals) {
        if (approval.taskId === executionId) newApprovals.delete(rid)
      }
      // Remove safety prompts for this execution
      const newPrompts = new Map(state.safetyPrompts)
      newPrompts.delete(executionId)
      // Remove attached sessions for this execution
      const newAttached = new Map(state.attachedSessions)
      for (const [sid, session] of newAttached) {
        if (session.taskId === executionId) newAttached.delete(sid)
      }
      return { taskStreams: streams, dynamicApprovals: newApprovals, safetyPrompts: newPrompts, attachedSessions: newAttached }
    })

    // Clear observation traces for this execution
    const { useObservationStore } = await import("./observation-store")
    useObservationStore.setState((state) => {
      const traces = new Map(state.traces)
      const loading = new Map(state.loading)
      const errors = new Map(state.errors)
      traces.delete(executionId)
      loading.delete(executionId)
      errors.delete(executionId)
      return { traces, loading, errors }
    })
  }

  // Clear pending approvals for this node
  const execStore = useExecutionStore.getState()
  useExecutionStore.setState((state) => {
    const newApprovals = new Map(state.pendingApprovals)
    for (const [aid, approval] of newApprovals) {
      if (approval.nodeId === nodeId) newApprovals.delete(aid)
    }
    return { pendingApprovals: newApprovals }
  })

  // Clear selectedExecutionId if it points to this node
  if (execStore.selectedExecutionId === nodeId) {
    useExecutionStore.setState({ selectedExecutionId: null })
  }

  // Clear execution from in-memory store
  useExecutionStore.setState((state) => {
    const newExecutions = new Map(state.executions)
    newExecutions.delete(nodeId)
    return { executions: newExecutions }
  })

  // Delete execution record from DB so it doesn't reappear after page refresh
  try {
    const { dataClient } = await import("@/lib/data-client")
    await dataClient.deleteExecution(nodeId)
  } catch {
    // Best effort — server-side reset also handles this
  }
}



/**
 * Fire-and-forget: request AI summary generation for a completed execution.
 * Called from realtime-store when task:result arrives.
 */
export async function requestExecutionSummary(
  nodeId: string,
  execution: TaskExecution,
  node: { title: string; content?: string | null; description?: string | null } | undefined,
) {
  if (!node || !execution.streamText) return
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
    if (response.ok) {
      const data = await response.json()
      if (data.summary) {
        const raw = data.summary as ExecutionSummary
        const summary: ExecutionSummary = {
          ...raw,
          keyFindings: raw.keyFindings || [],
        }
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
        useExecutionStore.getState().persist()
      }
    }
  } catch (error) {
    console.error(`[execution-store] Summary generation error for ${nodeId}:`, error)
  }
}

/**
 * Parse an executive summary from the agent's stream text.
 * Looks for the structured "## Executive Summary" block at the end of output.
 */
export function parseExecutiveSummary(streamText: string): Partial<ExecutionSummary> | null {
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
  // Include awaiting_judgment as "done" for dependency purposes — these tasks
  // have finished execution and shouldn't block downstream work in batch mode.
  const completedStatuses: PlanNode["status"][] = ["completed", "auto_verified", "awaiting_judgment"]

  for (const depId of upstreamIds) {
    const depNode = projectNodes.find((n) => n.id === depId)
    if (!depNode) {
      // Dangling reference (e.g. from corrupted data) — skip rather than blocking execution
      console.warn(`[canExecuteNode] Dependency ${depId} not found for node ${node.id}, skipping`)
      continue
    }

    if (!completedStatuses.includes(depNode.status)) {
      const label = depNode.type === 'milestone' ? `${depNode.title} (milestone)` : depNode.title
      pendingDependencies.push(label)
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
    // Batch is complete when nothing is running and nothing new can start.
    // We check dispatched/in_progress (not planned) because planned nodes
    // may be permanently blocked by pruned dependencies. Including planned
    // in this check would cause the batch to hang forever.
    const ACTIVE = new Set(["dispatched", "in_progress"])
    const nothingActive = projectNodes.every((n) => !ACTIVE.has(n.status))

    if (nothingActive) {
      // Compute batch stats before deactivating
      const dispatched = projectNodes.filter((n) => batch.dispatchedNodeIds.has(n.id))
      const succeeded = dispatched.filter((n) => ["completed", "auto_verified"].includes(n.status)).length
      const failed = dispatched.filter((n) => ["pruned"].includes(n.status) || n.executionError).length

      useExecutionStore.setState((state) => {
        const newBatch = new Map(state.batchExecutions)
        const b = newBatch.get(projectId)
        if (b) newBatch.set(projectId, { ...b, active: false })
        return { batchExecutions: newBatch }
      })

      // Fire completion notification + toast
      const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
      const projectName = project?.name || "Project"
      const stats = { total: dispatched.length, succeeded, failed }

      showBatchCompleteNotification(projectName, stats)
      useToastStore.getState().add({
        type: failed > 0 ? "warning" : "success",
        title: `Execution complete: ${projectName}`,
        description: `${stats.total} tasks — ${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ""}`,
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
