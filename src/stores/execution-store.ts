import { create } from "zustand"
import type { TaskExecution, ProviderStatus, PlanNode, PlanEdge, ToolTrace, FileChange, UsageMetrics, Project, ProjectSource, ExecutionSummary, ReplanContext } from "@/types"
import { parseSSEStream } from "@/lib/sse-parser"
import { fetchStreamingEventsCatchUp, type StreamingEventRow } from "@/lib/api-client"
import { usePlanStore, isLive } from "./plan-store"
import { useProjectStore } from "./project-store"
import { useUsageStore } from "./usage-store"
import { useToastStore } from "./toast-store"
import { getAccessToken } from "@/lib/supabase-client"
import type { ApprovalRequest } from "@/components/approval-card"
import { dataClient } from "@/lib/data-client"
import { stripHtml, extractBlobUrls } from "@/lib/html-utils"
import { apiUrl } from "@/lib/api-url"
import { useTaskChatStore } from "./task-chat-store"
import { useSessionStore } from "./session-store"
import { resolveWorkingDirectory, buildDependencyOutputs } from "@astro/core/dispatch"
import { applyPlanFromText, planNodeIdToProjectId, clearPlanFingerprint } from "@/lib/plan-extraction"
import { getSigningPrivateKey, signDispatchIntent, generateNonce, type DispatchSigningPayload } from "@/lib/dispatch-signing"
import { useAuthStore } from "./auth-store"
import { useSettingsStore } from "./settings-store"
import { showBatchCompleteNotification } from "@/lib/notifications"
import { deriveDeliveryMode } from "@/lib/project-source"
import { useNotificationStore } from "./notification-store"
import { buildClientCompletionMessage } from "@/lib/completion-messages"

// ─── Page Unload Detection ────────────────────────────────────────────
// `document.visibilityState` is unreliable during page refresh — it may
// still be 'visible' when the fetch connection is dropped, causing the
// SSE error handler to falsely mark running tasks as failed.
// `beforeunload` fires deterministically BEFORE fetch connections die,
// so this flag is always set in time.
let isPageUnloading = false
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { isPageUnloading = true })
}

/** True if the page is unloading or the tab is hidden — SSE errors in this state are not real failures. */
function isPageUnloadingOrHidden(): boolean {
  return isPageUnloading || (typeof document !== 'undefined' && document.visibilityState === 'hidden')
}

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

// Dispatch field length limits — must match server-side Zod schema in dispatch.ts
const MAX_DESCRIPTION_LENGTH = 200_000
const MAX_VISIONDOC_LENGTH = 100_000

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

  // Projects that should auto-execute after plan generation completes
  autoExecuteProjectIds: Set<string>

  // Projects that already showed the "all tasks complete" toast (avoid duplicates)
  completedProjectIds: Set<string>

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

  // Auto-execute actions
  setAutoExecute: (projectId: string, enabled: boolean) => void

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
    }
  ) => Promise<{ projectId: string; nodeId: string }>
  cancelPlanGeneration: (projectId: string) => Promise<void>
  /** Remove execution entry and delete the project created by startPlanGeneration. */
  cleanupPlanGeneration: (projectId: string) => void
  steerPlanGeneration: (projectId: string, message: string) => Promise<boolean>

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
      workingDirectory: string
      model?: string
      preferredProvider?: string
      resumeSessionId?: string
      forkSession?: boolean
      selectedBackends?: string[]
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
  autoExecuteProjectIds: new Set(),
  completedProjectIds: new Set(),
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
      const signing = await buildDispatchSignature(nodeId, projectId, effectiveTargetMachineId)
      const rawDescription = node.content ? stripHtml(node.content) : (node.description || node.title)
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
          preferredProvider: options?.preferredProvider,
          targetMachineId: effectiveTargetMachineId,
          model: options?.model,
          maxTurns: options?.maxTurns,
          workingDirectory: resolvedDir,
          computeBackend: options?.computeBackend,
          deliveryMode: project?.deliveryMode || undefined,
          remoteType: project?.source?.remoteType || undefined,
          agentDir: project?.agentDir || undefined,
          worktreeStrategy: project?.worktreeStrategy || undefined,
          useWorktree: options?.useWorktree,
          imageRefs: node.content ? extractBlobUrls(node.content) : undefined,
          acceptanceCriteria: node.acceptanceCriteria || undefined,
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

      // Process SSE stream
      await processExecutionStream(response, nodeId, set, get, planStore, abortController.signal)
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
        // Don't mark as failure if the page is unloading (refresh/navigate away)
        // — the task is still running server-side, catch-up will reconcile on reload.
        // Check `isPageUnloading` first: `beforeunload` fires before fetch connections
        // are dropped, so this flag is reliable. `visibilityState` is a fallback but
        // can still be 'visible' when the fetch errors out during refresh.
        if (isPageUnloadingOrHidden()) {
          console.log('[execution] SSE interrupted by page unload, skipping failure marking')
          return
        }
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

    // Dispatch ready nodes with staggered delay (15s between each) to avoid
    // overwhelming the system when many tasks become ready simultaneously
    const STAGGER_DELAY_MS = 15_000
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

  setAutoExecute: (projectId: string, enabled: boolean) => {
    set((state) => {
      const next = new Set(state.autoExecuteProjectIds)
      if (enabled) next.add(projectId)
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
    clearPlanFingerprint(projectId)
    const displayName = projectName || "New Project"
    await useProjectStore.getState().addProject({
      id: projectId,
      name: displayName,
      description,
      status: 'active',
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
        const signing = await buildDispatchSignature(nodeId, projectId, options?.targetMachineId)
        const safeDescription = truncateDispatchField(description, MAX_DESCRIPTION_LENGTH, "Plan description")
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
            targetMachineId: options?.targetMachineId,
            model: options?.model,
            preferredProvider: options?.preferredProvider,
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

        // 6. Process SSE stream using existing infrastructure (with reconnection)
        const planStore = usePlanStore.getState()
        await processSSEStreamWithReconnect(response, nodeId, set, get, planStore, (event) => {
          // On result, extract plan JSON
          if (event === "result") {
            try {
              const exec = get().executions.get(nodeId)
              if (exec?.streamText) {
                const result = applyPlanFromText(projectId, exec.streamText, exec.executionId || undefined)
                if (result.applied) {
                  console.log(`[plan-generation] Plan extracted: ${result.nodeCount} nodes`)
                } else {
                  console.warn("[plan-generation] Plan extraction returned no result — model output may not contain valid JSON")
                  useToastStore.getState().add({
                    type: "warning",
                    title: "Plan extraction failed",
                    description: "The AI's response didn't contain a valid plan JSON. Try regenerating the plan or refining your description.",
                  })
                }
              }
            } catch (e) {
              console.error("[plan-generation] Failed to extract plan:", e)
              useToastStore.getState().add({
                type: "error",
                title: "Plan extraction error",
                description: e instanceof Error ? e.message : "Unknown error extracting plan",
              })
            }
          }
        }, abortController.signal)
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
          // Don't mark as failure if the page is unloading (refresh/navigate away)
          // — the task is still running server-side, catch-up will reconcile on reload
          if (isPageUnloadingOrHidden()) {
            console.log('[plan-generation] SSE interrupted by page unload, skipping failure marking')
            return
          }
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

  cancelPlanGeneration: async (projectId) => {
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

    get().persist()
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
    if (!execution?.executionId || !execution.machineId) {
      console.warn("[plan-generation] Cannot steer: no executionId or machineId")
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
        console.error("[plan-generation] Failed to steer:", response.status)
        return false
      }

      const result = await response.json()
      return result.success
    } catch (error) {
      console.error("[plan-generation] Error steering:", error)
      return false
    }
  },

  // ─── Start Plan Session For Existing Project ──────────────────────────

  startPlanGenerationForProject: async (projectId, description, options) => {
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    clearPlanFingerprint(projectId)

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
        const signing = await buildDispatchSignature(nodeId, projectId, options?.targetMachineId)
        const safeDescription = truncateDispatchField(description, MAX_DESCRIPTION_LENGTH, "Plan description")
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
            targetMachineId: options?.targetMachineId,
            model: options?.model,
            preferredProvider: options?.preferredProvider,
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

        // Process SSE stream (with reconnection)
        const planStore = usePlanStore.getState()
        await processSSEStreamWithReconnect(response, nodeId, set, get, planStore, (event) => {
          if (event === "result") {
            try {
              const exec = get().executions.get(nodeId)
              if (exec?.streamText) {
                if (!exec.executionId) {
                  console.warn(`[plan-generation-forProject] Skipping plan extraction — executionId missing for node ${nodeId}`)
                } else {
                  const result = applyPlanFromText(projectId, exec.streamText, exec.executionId)
                  if (result.applied) {
                    console.log(`[plan-generation-forProject] Plan extracted: ${result.nodeCount} nodes`)
                  }
                }
              }
            } catch (e) {
              console.error("[plan-generation-forProject] Failed to extract plan:", e)
            }
          }
        }, abortController.signal)
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
          // Don't mark as failure if the page is unloading (refresh/navigate away)
          if (isPageUnloadingOrHidden()) {
            console.log('[plan-generation-forProject] SSE interrupted by page unload, skipping failure marking')
            return
          }
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
    clearPlanFingerprint(projectId)

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
        const signing = await buildDispatchSignature(nodeId, projectId, options?.targetMachineId)
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
            targetMachineId: options?.targetMachineId,
            model: options?.model,
            preferredProvider: options?.preferredProvider,
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

        // Process SSE stream (with reconnection)
        const planStore = usePlanStore.getState()
        await processSSEStreamWithReconnect(response, nodeId, set, get, planStore, (event) => {
          if (event === "result") {
            try {
              const exec = get().executions.get(nodeId)
              if (exec?.streamText) {
                if (!exec.executionId) {
                  console.warn(`[replan] Skipping plan extraction — executionId missing for node ${nodeId}`)
                } else {
                  const result = applyPlanFromText(projectId, exec.streamText, exec.executionId)
                  if (result.applied) {
                    console.log(`[replan] Plan extracted: ${result.nodeCount} nodes`)
                  }
                }
              }
            } catch (e) {
              console.error("[replan] Failed to extract plan:", e)
            }
          }
        }, abortController.signal)
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
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            console.log('[replan] SSE interrupted by page unload, skipping failure marking')
            return
          }
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
    await useProjectStore.getState().addProject({
      id: projectId,
      name: displayName,
      description,
      status: 'active',
      visionDoc: "",
      workingDirectory: options.workingDirectory,
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
            model: options.model,
            preferredProvider: options.preferredProvider,
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

        // 5. Process SSE stream (with reconnection)
        const planStore = usePlanStore.getState()
        await processSSEStreamWithReconnect(response, nodeId, set, get, planStore, undefined, abortController.signal)
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
          // Don't mark as failure if the page is unloading (refresh/navigate away)
          // — the task is still running server-side, catch-up will reconcile on reload
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            console.log('[playground] SSE interrupted by page unload, skipping failure marking')
            return
          }
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

// Helper: Process SSE stream from dispatch endpoint using unified parser
async function processExecutionStream(
  response: Response,
  nodeId: string,
  set: (fn: (state: ExecutionState) => Partial<ExecutionState>) => void,
  get: () => ExecutionState,
  planStore: ReturnType<typeof usePlanStore.getState>,
  signal?: AbortSignal
) {
  await processSSEStreamWithReconnect(response, nodeId, set, get, planStore, undefined, signal)
}

// ─── SSE Reconnection Infrastructure ────────────────────────────────

const MAX_RECONNECT_RETRIES = 5
const RECONNECT_BACKOFF_BASE_MS = 1000
const POLL_INTERVAL_MS = 5000

/** Update connectionState on an execution entry */
function setConnectionState(
  nodeId: string,
  connectionState: 'connected' | 'reconnecting' | 'polling' | undefined,
  set: (fn: (state: ExecutionState) => Partial<ExecutionState>) => void,
) {
  set((state) => {
    const newExecutions = new Map(state.executions)
    const exec = newExecutions.get(nodeId)
    if (exec) {
      newExecutions.set(nodeId, { ...exec, connectionState })
    }
    return { executions: newExecutions }
  })
}

/** Check if caught-up events contain a terminal event (result/done/error/aborted) */
function hasTerminalEvent(events: StreamingEventRow[]): boolean {
  return events.some(e =>
    e.eventType === 'result' ||
    e.eventType === 'done' ||
    e.eventType === 'error' ||
    e.eventType === 'aborted'
  )
}

/** Process caught-up events through handleSSEEvent, same as live stream */
function processCatchUpEvents(
  events: StreamingEventRow[],
  nodeId: string,
  set: (fn: (state: ExecutionState) => Partial<ExecutionState>) => void,
  get: () => ExecutionState,
  planStore: ReturnType<typeof usePlanStore.getState>,
  onResult?: (event: string, data: string) => void,
) {
  for (const row of events) {
    try {
      // Text events are stored as { text: "..." } in the DB but the SSE handler
      // expects a plain string. Extract the text field for text events to match
      // the live SSE format (where data is msg.text, a plain string).
      let data: string
      if (row.eventType === 'text' && typeof row.data === 'object' && row.data !== null && 'text' in row.data) {
        data = (row.data as { text: string }).text
      } else {
        data = typeof row.data === 'string' ? row.data : JSON.stringify(row.data)
      }
      handleSSEEvent(row.eventType, data, nodeId, set, get, planStore)
      onResult?.(row.eventType, data)
    } catch (err) {
      console.error(`[sse-catchup] Failed to process event ${row.eventType} for ${nodeId}:`, err)
    }
  }
}

/**
 * Reusable SSE stream processor with automatic reconnection via catch-up.
 *
 * Flow:
 * 1. Stream SSE normally, tracking lastSeq from `id:` fields
 * 2. On normal completion (result/done): exit cleanly
 * 3. On stream error (network drop):
 *    a. If page hidden (unload): skip
 *    b. Set connectionState: 'reconnecting'
 *    c. Catch up via fetchStreamingEventsCatchUp
 *    d. If caught-up events include terminal event: reconcile and exit
 *    e. If task still running: exponential backoff retry
 *    f. After MAX_RECONNECT_RETRIES: switch to polling mode
 */
async function processSSEStreamWithReconnect(
  response: Response,
  nodeId: string,
  set: (fn: (state: ExecutionState) => Partial<ExecutionState>) => void,
  get: () => ExecutionState,
  planStore: ReturnType<typeof usePlanStore.getState>,
  /** Optional per-event callback for plan/chat sessions that need extra processing */
  onEventCallback?: (event: string, data: string) => void,
  /** Optional AbortSignal to cancel reconnection/polling loops */
  signal?: AbortSignal,
): Promise<void> {
  let lastSeq = 0
  let streamCompleted = false

  // Set initial connection state
  setConnectionState(nodeId, 'connected', set)

  // 1. Stream normally, tracking lastSeq
  try {
    await parseSSEStream(response, {
      onEvent: ({ event, data }) => {
        handleSSEEvent(event, data, nodeId, set, get, planStore)
        onEventCallback?.(event, data)
        // Terminal events mean the stream completed normally
        if (event === 'result' || event === 'done') {
          streamCompleted = true
        }
      },
      onId: (id) => {
        const seq = parseInt(id, 10)
        if (!isNaN(seq) && seq > lastSeq) {
          lastSeq = seq
        }
      },
    })
  } catch (streamError) {
    // Stream errored — fall through to reconnection logic
    if (streamCompleted) return // Already got the result, ignore trailing error
    console.warn(`[sse-reconnect] Stream error for ${nodeId}:`, streamError)
  }

  // 2. If stream completed normally, clear connection state and exit
  if (streamCompleted) {
    setConnectionState(nodeId, undefined, set)
    return
  }

  // 3. Check if we have an executionId to reconnect with
  const execution = get().executions.get(nodeId)
  if (!execution?.executionId) {
    // No executionId means init event never arrived — can't catch up
    console.warn(`[sse-reconnect] No executionId for ${nodeId}, cannot reconnect`)
    return
  }

  // 3a. If page is hidden (unload/navigate away), skip reconnection
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    console.log(`[sse-reconnect] Page hidden, skipping reconnection for ${nodeId}`)
    return
  }

  const executionId = execution.executionId

  // 3b. Start reconnection loop
  console.log(`[sse-reconnect] Starting reconnection for ${nodeId} (executionId: ${executionId}, lastSeq: ${lastSeq})`)
  setConnectionState(nodeId, 'reconnecting', set)

  let retryCount = 0

  while (retryCount < MAX_RECONNECT_RETRIES) {
    // Check if aborted
    if (signal?.aborted) {
      console.log(`[sse-reconnect] Reconnection aborted for ${nodeId}`)
      setConnectionState(nodeId, undefined, set)
      return
    }

    // Check if execution was cancelled/reset while we're reconnecting
    const currentExec = get().executions.get(nodeId)
    if (!currentExec || currentExec.status === 'cancelled') {
      setConnectionState(nodeId, undefined, set)
      return
    }

    try {
      const { events, lastSeq: newLastSeq } = await fetchStreamingEventsCatchUp(
        [executionId],
        lastSeq,
      )

      if (events.length > 0) {
        console.log(`[sse-reconnect] Caught up ${events.length} events for ${nodeId} (seq ${lastSeq} → ${newLastSeq})`)
        processCatchUpEvents(events, nodeId, set, get, planStore, onEventCallback)
        lastSeq = newLastSeq

        // Check if task completed while disconnected
        if (hasTerminalEvent(events)) {
          console.log(`[sse-reconnect] Task completed during disconnect for ${nodeId}`)
          setConnectionState(nodeId, undefined, set)
          return
        }

        // Got non-terminal events — task still running, don't increment retry count
        // (but don't reset to 0 either, to avoid infinite reconnection on flaky streams)
      } else {
        retryCount++
      }
    } catch (catchUpError) {
      console.warn(`[sse-reconnect] Catch-up fetch failed for ${nodeId}:`, catchUpError)
      retryCount++
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    // Use max(retryCount, 1) - 1 to ensure minimum backoff is 1000ms (not 500ms)
    const backoffMs = RECONNECT_BACKOFF_BASE_MS * Math.pow(2, Math.min(Math.max(retryCount, 1) - 1, 4))
    await new Promise((resolve) => setTimeout(resolve, backoffMs))
  }

  // 3f. Switch to polling mode after exhausting retries
  console.log(`[sse-reconnect] Switching to polling mode for ${nodeId}`)
  setConnectionState(nodeId, 'polling', set)

  // Poll until terminal event or execution is removed/cancelled
  const pollLoop = async () => {
    while (true) {
      // Check if aborted
      if (signal?.aborted) {
        console.log(`[sse-reconnect] Polling aborted for ${nodeId}`)
        setConnectionState(nodeId, undefined, set)
        return
      }

      const currentExec = get().executions.get(nodeId)
      if (!currentExec || currentExec.status === 'cancelled' || currentExec.status === 'success' || currentExec.status === 'failure') {
        setConnectionState(nodeId, undefined, set)
        return
      }

      try {
        const { events, lastSeq: newLastSeq } = await fetchStreamingEventsCatchUp(
          [executionId],
          lastSeq,
        )

        if (events.length > 0) {
          processCatchUpEvents(events, nodeId, set, get, planStore, onEventCallback)
          lastSeq = newLastSeq

          if (hasTerminalEvent(events)) {
            console.log(`[sse-reconnect] Task completed via polling for ${nodeId}`)
            setConnectionState(nodeId, undefined, set)
            return
          }
        }
      } catch (pollError) {
        console.warn(`[sse-reconnect] Polling fetch failed for ${nodeId}:`, pollError)
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  await pollLoop()
}

// ─── Text Batching for Smooth Streaming ────────────────────────────
// Accumulates text chunks in a module-level buffer and flushes to
// Zustand every 50ms (~20fps), preventing per-token re-renders.
const textBatchPending = new Map<string, string>()
const textBatchTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

  // Clear module-level text batch buffers (execution-store)
  clearTextBatch(nodeId)

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

/** Clear text-batch state for a given nodeId (used by resetExecution). */
export function clearTextBatch(nodeId: string) {
  const timer = textBatchTimers.get(nodeId)
  if (timer) clearTimeout(timer)
  textBatchTimers.delete(nodeId)
  textBatchPending.delete(nodeId)
}

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

/** Check if a nodeId corresponds to a real plan node (not a synthetic plan/playground session node). */
function isRealPlanNode(nodeId: string): boolean {
  return !nodeId.startsWith('plan-') && !nodeId.startsWith('playground-')
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
        if (isRealPlanNode(nodeId)) {
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
        }

        // Emit system_prompt activity event so the activity feed can render it
        if (parsed.systemPrompt) {
          set((state) => {
            const newExecutions = new Map(state.executions)
            const exec = newExecutions.get(nodeId)
            if (exec) {
              newExecutions.set(nodeId, {
                ...exec,
                activityEvents: [...exec.activityEvents, {
                  type: 'system_prompt' as const,
                  content: parsed.systemPrompt,
                  pathwayType: parsed.pathwayType,
                  timestamp: now,
                }],
              })
            }
            return { executions: newExecutions }
          })
        }

        // Persist running execution to DB so it survives page refresh
        const freshExec = get().executions.get(nodeId)
        if (freshExec?.executionId) {
          dataClient.saveExecution(freshExec).catch((err) => {
            console.warn('[execution-store] Failed to persist running execution:', err)
          })
        }
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

    // plan_result is only emitted for interactive planning sessions (nodeId: 'plan-<projectId>')
    case "plan_result": {
      try {
        const parsed = JSON.parse(data)
        if (parsed.nodes && Array.isArray(parsed.nodes)) {
          const planProjectId = planNodeIdToProjectId(nodeId)
          if (planProjectId) {
            const exec = get().executions.get(nodeId)
            applyPlanFromText(planProjectId, '', exec?.executionId || undefined, false, parsed)

            // Emit plan_result activity event for inline graph rendering
            set((state) => {
              const newExecutions = new Map(state.executions)
              const existingExec = newExecutions.get(nodeId)
              if (existingExec) {
                newExecutions.set(nodeId, {
                  ...existingExec,
                  activityEvents: [...existingExec.activityEvents, {
                    type: 'plan_result' as const,
                    nodes: (parsed.nodes as Array<Record<string, unknown>>).map((n: Record<string, unknown>) => ({
                      id: (n.id as string) || '',
                      title: (n.title as string) || '',
                      type: (n.type as string) || 'task',
                      status: (n.status as string) || undefined,
                    })),
                    edges: ((parsed.edges as Array<Record<string, unknown>>) || []).map((e: Record<string, unknown>) => ({
                      source: (e.source as string) || '',
                      target: (e.target as string) || '',
                    })),
                    projectName: (parsed.projectName as string) || undefined,
                    timestamp: new Date(),
                  }],
                })
              }
              return { executions: newExecutions }
            })
          } else {
            console.warn(`[execution-store] plan_result received for non-plan node ${nodeId} — ignoring`)
          }
        }
      } catch { /* fallback extraction on result event will handle it */ }
      break
    }

    case "result": {
      try {
        const parsed = JSON.parse(data)
        const isSuccess = parsed.status === "success" || parsed.status === "completed"
        const execution = get().executions.get(nodeId)

        // Guard: skip duplicate side-effects if this result was already processed
        // (can happen when SSE reconnection replays caught-up events through handleSSEEvent)
        const alreadyCompleted = execution?.status === 'success' || execution?.status === 'failure' || execution?.status === 'cancelled'

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
              ...(parsed.deliveryStatus ? { deliveryStatus: parsed.deliveryStatus } : {}),
              ...(parsed.deliveryError ? { deliveryError: parsed.deliveryError } : {}),
            })
          }
          return { executions: newExecutions }
        })

        // Skip toasts and metrics accumulation on duplicate result events
        // (SSE reconnection catch-up replays events through handleSSEEvent)
        if (!alreadyCompleted) {
          // Notify when a planning session finishes
          if (nodeId.startsWith('plan-')) {
            const planProjectId = planNodeIdToProjectId(nodeId)
            const planProject = planProjectId ? useProjectStore.getState().projects.find((p) => p.id === planProjectId) : null
            useToastStore.getState().add({
              type: isSuccess ? 'success' : 'error',
              title: isSuccess ? 'Planning complete' : 'Planning failed',
              description: planProject
                ? (isSuccess ? `Plan for "${planProject.name}" is ready.` : `Plan for "${planProject.name}" failed.`)
                : (isSuccess ? 'Plan generation has finished.' : 'Plan generation failed.'),
              duration: 6000,
            })

            // Auto-execute all tasks if YOLO mode was enabled for this project
            if (isSuccess && planProjectId && get().autoExecuteProjectIds.has(planProjectId)) {
              get().setAutoExecute(planProjectId, false) // consume the flag
              // Small delay to let plan nodes settle in the store
              setTimeout(() => {
                console.log(`[execution] YOLO mode: auto-executing all tasks for project ${planProjectId}`)
                get().executeAllProject(planProjectId)
              }, 1000)
            }
          }

          // Accumulate metrics in usage store
          if (metrics) {
            useUsageStore.getState().addTaskMetrics(metrics, isSuccess)
          }

          // Show notification if task used more than 500 turns
          if (metrics?.turnsUsed && metrics.turnsUsed > 500) {
            useToastStore.getState().add({
              type: 'warning',
              title: 'High Turn Count',
              description: `Task used ${metrics.turnsUsed} turns. This may indicate a complex task or potential issue.`,
              duration: 8000,
            })
          }
        }

        // Determine final node status based on verification type (use fresh state, not stale snapshot)
        const node = usePlanStore.getState().nodes.find((n) => n.id === nodeId)
        // Use finalStatus from server if provided, otherwise determine locally
        let finalStatus: PlanNode["status"] = parsed.finalStatus

        if (!finalStatus) {
          const deliveryOk = !parsed.deliveryStatus || parsed.deliveryStatus === 'success' || parsed.deliveryStatus === 'skipped'
          const isPlaygroundTask = nodeId.startsWith('playground-')
          const yoloOn = isPlaygroundTask
            ? useSettingsStore.getState().playgroundYoloMode
            : useSettingsStore.getState().yoloMode
          if (isSuccess) {
            finalStatus = ((node?.verification === "auto" || yoloOn) && (deliveryOk || yoloOn)) ? "auto_verified" : "awaiting_judgment"
          } else {
            finalStatus = "awaiting_judgment"
          }
        }

        // Skip node updates and file tree refresh on duplicate result events
        // (SSE reconnection catch-up would overwrite timestamps with new Date())
        if (!alreadyCompleted) {
          const completionTime = new Date()
          if (isRealPlanNode(nodeId)) {
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
          }
        }

        // Check if all tasks in the project are now complete
        if (isRealPlanNode(nodeId) && execution?.projectId) {
          const pid = execution.projectId
          if (!get().completedProjectIds.has(pid)) {
            const TERMINAL = new Set(['completed', 'auto_verified', 'pruned'])
            const projectNodes = usePlanStore.getState().nodes.filter(
              (n) => n.projectId === pid && n.type === 'task'
            )
            if (projectNodes.length > 0 && projectNodes.every((n) => TERMINAL.has(n.status))) {
              set((state) => {
                const next = new Set(state.completedProjectIds)
                next.add(pid)
                return { completedProjectIds: next }
              })
              const proj = useProjectStore.getState().projects.find((p) => p.id === pid)
              const allSuccess = projectNodes.every((n) => n.status === 'completed' || n.status === 'auto_verified')
              const msg = buildClientCompletionMessage({
                projectName: proj?.name,
                projectBranch: proj?.projectBranch,
                allSuccess,
              })
              useToastStore.getState().add({ ...msg, duration: 8000 })
              useNotificationStore.getState().add({ ...msg, projectId: pid })
            }
          }
        }

        // Auto-assign defaultMachineId on the project if not set
        if (isSuccess && execution?.machineId && execution?.projectId) {
          const proj = useProjectStore.getState().projects.find((p) => p.id === execution.projectId)
          if (proj && !proj.defaultMachineId) {
            useProjectStore.getState().updateProject(proj.id, { defaultMachineId: execution.machineId })
          }
        }

        // Refresh file tree cache after task completion (skip on duplicate replay)
        if (!alreadyCompleted) {
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
        }

        // Batch execution: auto-dispatch next wave of ready nodes
        const execStore = useExecutionStore.getState()
        const projectId = execution?.projectId
        if (projectId && execStore.batchExecutions.get(projectId)?.active) {
          // Use a short delay to let the plan store status update propagate
          setTimeout(() => dispatchNextBatchWave(projectId), 100)
        }

        // Summary generation: use structured summary from agent result if available,
        // otherwise fall back to parsing from stream text, then relay-based /api/agent/summarize.
        // In YOLO mode, always store summaries (needed for batch summary notifications).
        const yoloOn = nodeId.startsWith('playground-')
          ? useSettingsStore.getState().playgroundYoloMode
          : useSettingsStore.getState().yoloMode
        if (execution && (yoloOn || finalStatus === "awaiting_judgment" || (isSuccess && node?.verification !== "auto"))) {
          const freshExec = get().executions.get(nodeId)

          if (parsed.summary?.status && parsed.summary?.workCompleted) {
            // Primary path: structured summary from agent follow-up turn — guaranteed valid JSON
            const summary: ExecutionSummary = {
              workCompleted: parsed.summary.workCompleted,
              executiveSummary: parsed.summary.executiveSummary,
              keyFindings: parsed.summary.keyFindings || [],
              filesChanged: parsed.summary.filesChanged || freshExec?.fileChanges?.map((f: { path: string }) => f.path) || [],
              status: parsed.summary.status,
              followUps: parsed.summary.followUps || [],
            }
            useExecutionStore.setState((state) => {
              const newExecs = new Map(state.executions)
              const ex = newExecs.get(nodeId)
              if (ex) newExecs.set(nodeId, { ...ex, summary })
              return { executions: newExecs }
            })
          } else {
            // Fallback: try parsing from stream text (regex-based)
            const parsedSummary = freshExec?.streamText ? parseExecutiveSummary(freshExec.streamText) : null

            if (parsedSummary?.status && parsedSummary?.workCompleted) {
              const summary: ExecutionSummary = {
                workCompleted: parsedSummary.workCompleted,
                keyFindings: parsedSummary.keyFindings || [],
                filesChanged: freshExec?.fileChanges?.map((f) => f.path) ?? [],
                status: parsedSummary.status,
                followUps: parsedSummary.followUps || [],
              }
              useExecutionStore.setState((state) => {
                const newExecs = new Map(state.executions)
                const ex = newExecs.get(nodeId)
                if (ex) newExecs.set(nodeId, { ...ex, summary })
                return { executions: newExecs }
              })
            } else {
              // Last resort: try relay-based summarization
              requestExecutionSummary(nodeId, freshExec || execution, node)
            }
          }
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

        // Guard: ignore late error events if the result has already been processed
        // (prevents race condition where result + error SSE events arrive close together)
        if (execution && (execution.status === "success" || execution.status === "failure")) {
          console.warn(`[execution-store] Ignoring late error for ${nodeId} (status already ${execution.status})`)
          break
        }

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
        if (isRealPlanNode(nodeId)) {
          planStore.updateNode(nodeId, {
            status: "awaiting_judgment",
            executionError: errorMessage,
            // Update endDate with real execution error time (ISO datetime)
            endDate: errorTime.toISOString(),
            // Set actualEndDate even on error to track when task stopped
            actualEndDate: errorTime,
          })
        }

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
      if (isRealPlanNode(nodeId)) {
        planStore.updateNode(nodeId, { status: "planned" })
      }

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


