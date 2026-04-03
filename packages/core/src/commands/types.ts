/**
 * Transport-agnostic command types.
 *
 * These types define the API client interface and result shapes that
 * command functions use. Both CLI and Telegram (or any other transport)
 * implement `CommandClient` and consume the structured results.
 */

// ── Data types returned by the API ────────────────────────────────────

export interface ProjectData {
  id: string
  name: string
  description: string
  visionDoc: string
  status: string
  workingDirectory: string | null
  repository: string | null
  deliveryMode: string | null
  projectType: string | null
  health: string | null
  progress: number
  startDate: string | null
  targetDate: string | null
  lead: string | null
  defaultEnvironment: string | null
  defaultMachineId: string | null
  labels: Array<{ id: string; name: string; color: string }>
  color: string
  icon: string
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export interface PlanNodeData {
  id: string
  projectId: string
  type: string
  title: string
  description: string
  status: string
  parentId: string | null
  dependencies: string[]
  position: { x: number; y: number }
  startDate: string | null
  endDate: string | null
  dueDate: string | null
  priority: string | null
  estimate: string | null
  executionId: string | null
  executionOutput: string | null
  executionError: string | null
  executionStartedAt: string | null
  executionCompletedAt: string | null
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  mergeQueueStatus: string | null
  autoPr: boolean | null
  deletedAt?: string | null
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export interface PlanEdgeData {
  id: string
  source: string
  target: string
  type: string
  [key: string]: unknown
}

export interface ExecutionData {
  executionId: string
  nodeId?: string
  nodeClientId?: string
  projectId: string
  status: string
  streamText?: string
  error: string | null
  machineId: string | null
  providerId: string | null
  providerName: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  tokensUsed: number | null
  estimatedCostUsd: number | null
  model: string | null
  turnsUsed: number | null
  markdownSummary: string | null
  [key: string]: unknown
}

export interface MachineData {
  id: string
  name: string
  hostname: string
  platform: string
  environmentType: string
  providers: string[]
  providerConfigs?: Array<{
    provider: string
    enabled: boolean
    defaultModel?: string
    settings?: Record<string, unknown>
  }>
  isConnected: boolean
  isRevoked: boolean
  workspaceId: string | null
  metadata: Record<string, string> | null
  registeredAt: string
  lastSeenAt: string
  [key: string]: unknown
}

export interface ActivityEventData {
  id: string
  userId: string
  projectId: string
  type: string
  title: string
  description: string | null
  nodeId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface FileChangeData {
  id: string
  executionId: string
  path: string
  action: string
  linesAdded: number | null
  linesRemoved: number | null
  timestamp: string
}

export interface SearchResultsData {
  projects: ProjectData[]
  tasks: Array<PlanNodeData & { projectName?: string }>
  executions: ExecutionData[]
}

export interface RelayStatusData {
  server?: { running?: boolean; port?: number }
  machines?: { total?: number; connected?: number; available?: number }
  redis?: { connected?: boolean }
  timestamp?: string
}

export interface ClusterData {
  name?: string
  hostname?: string
  gpus?: number
  activeJobs?: number
  status?: string
  [key: string]: unknown
}

// ── Client interface ──────────────────────────────────────────────────

/**
 * Transport-agnostic API client interface.
 *
 * Both the CLI's `AstroClient` and any server-side caller (Telegram bot,
 * webhooks, etc.) implement this interface. Command functions depend only
 * on this contract, never on HTTP details or auth mechanics.
 */
export interface CommandClient {
  // Projects
  listProjects(): Promise<ProjectData[]>
  getProject(id: string): Promise<ProjectData>
  createProject(data: {
    id?: string
    name: string
    description?: string
    workingDirectory?: string
    defaultMachineId?: string
    projectType?: string
    deliveryMode?: string
    [key: string]: unknown
  }): Promise<ProjectData>
  updateProject(id: string, patch: Record<string, unknown>): Promise<ProjectData>
  deleteProject(id: string): Promise<{ ok: boolean }>

  // Plan
  getPlan(projectId: string): Promise<{ nodes: PlanNodeData[]; edges: PlanEdgeData[] }>
  getFullPlan(): Promise<{ nodes: PlanNodeData[]; edges: PlanEdgeData[] }>
  createPlanNode(data: Record<string, unknown>): Promise<PlanNodeData>
  updatePlanNode(nodeId: string, patch: Record<string, unknown>): Promise<PlanNodeData>
  deletePlanNode(nodeId: string): Promise<{ ok: boolean }>
  createPlanEdge(data: { source: string; target: string; type?: string; projectId?: string }): Promise<PlanEdgeData>
  deletePlanEdge(edgeId: string): Promise<{ ok: boolean }>

  // Executions
  getExecutions(): Promise<Record<string, ExecutionData>>
  listFileChanges(executionId: string): Promise<FileChangeData[]>

  // Machines
  listMachines(): Promise<MachineData[]>
  getMachine(id: string): Promise<MachineData>
  revokeMachine(id: string): Promise<{ ok: boolean }>

  // Search
  search(query: string): Promise<SearchResultsData>

  // Activity
  listActivities(opts?: { projectId?: string; limit?: string }): Promise<ActivityEventData[]>

  // Relay / infrastructure
  getRelayStatus(): Promise<RelayStatusData>
  getSlurmClusters(): Promise<ClusterData[]>

  // Task dispatch (returns raw Response for SSE streaming — transports handle differently)
  dispatchTask(opts: {
    nodeId: string
    projectId: string
    force?: boolean
    targetMachineId?: string
    model?: string
    preferredProvider?: string
  }): Promise<Response>

  cancelTask(opts: {
    executionId: string
    machineId?: string
    nodeId?: string
  }): Promise<Record<string, unknown>>

  steerTask(opts: {
    taskId: string
    machineId: string
    message: string
    action?: 'guidance' | 'redirect' | 'pause' | 'resume'
  }): Promise<Record<string, unknown>>
}

// ── Command result types ──────────────────────────────────────────────

export interface ProjectListResult {
  projects: ProjectData[]
}

export interface ProjectDetailResult {
  project: ProjectData
}

export interface ProjectCreateResult {
  project: ProjectData
}

export interface ProjectUpdateResult {
  project: ProjectData
  updatedFields: string[]
}

export interface ProjectDeleteResult {
  id: string
  name: string
}

export interface ProjectStatsResult {
  project: { id: string; name: string; status: string }
  plan: {
    totalNodes: number
    totalEdges: number
    statusCounts: Record<string, number>
  }
  executions: {
    total: number
    successCount: number
    successRate: string
    totalTokens: number
    totalCost: number
  }
}

export interface TaskListResult {
  tasks: Array<{
    id: string
    title: string
    status: string
    projectName: string
    projectId: string
    updatedAt: string
    type: string
    priority: string | null
    estimate: string | null
  }>
}

export interface TaskDetailResult {
  node: PlanNodeData
  projectName: string
  execution: ExecutionData | null
  fileChanges: FileChangeData[]
}

export interface TaskCancelResult {
  executionId: string
  result: Record<string, unknown>
}

export interface TaskSteerResult {
  executionId: string
  result: Record<string, unknown>
}

export interface TaskStatusUpdateResult {
  nodeId: string
  status: string
  result: PlanNodeData
}

/** A single node in a plan dependency tree (recursive) */
export interface PlanTreeNode {
  id: string
  title: string
  status: string
  type: string
  children: PlanTreeNode[]
}

export interface PlanTreeResult {
  roots: PlanTreeNode[]
  totalNodes: number
  totalEdges: number
}

export interface PlanNodeListResult {
  nodes: PlanNodeData[]
  edges: PlanEdgeData[]
}

export interface MachineListResult {
  machines: Array<{
    id: string
    name: string
    hostname: string
    platform: string
    environmentType: string
    providers: string[]
    isConnected: boolean
    lastSeenAt: string
  }>
}

export interface MachineDetailResult {
  machine: MachineData
}

export interface ProviderListResult {
  providers: Array<{
    machine: string
    machineId: string
    provider: string
    enabled: boolean
    model: string
    connected: boolean
  }>
}

export interface RelayStatusResult {
  status: RelayStatusData
}

export interface ClusterListResult {
  clusters: ClusterData[]
}

export interface SearchCommandResult {
  query: string
  projects: ProjectData[]
  tasks: Array<PlanNodeData & { projectName?: string }>
  executions: ExecutionData[]
  totalMatches: number
}

export interface ActivityListResult {
  activities: Array<{
    id: string
    time: string
    type: string
    title: string
    projectId: string
    nodeId: string | null
    description: string | null
    metadata: Record<string, unknown>
  }>
}

// ── Filter / option types ─────────────────────────────────────────────

export interface TaskListFilters {
  projectId?: string
  status?: string
  since?: Date
  until?: Date
}

export interface SearchFilters {
  type?: 'projects' | 'tasks' | 'executions'
  since?: Date
  until?: Date
}

export interface ActivityListFilters {
  projectId?: string
  limit?: string
  type?: string
  since?: Date
  until?: Date
}
