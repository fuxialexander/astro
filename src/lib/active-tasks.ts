import type { PlanNode, Project, Session, SessionStatus, TaskExecution } from "@/types"

const TERMINAL_ACTIVE_TASK_NODE_STATUSES = new Set([
  "completed",
  "auto_verified",
  "awaiting_judgment",
  "awaiting_approval",
  "pruned",
])

const IDLE_RETENTION_MS = 60 * 60 * 1000 // 1 hour

// Session statuses that indicate the chat is finished — don't show in active tasks
const TERMINAL_SESSION_STATUSES = new Set<SessionStatus>(["completed", "cancelled"])

export interface ActiveTaskEntry {
  nodeId: string
  projectId: string
  title: string
  status: "running" | "pending" | "generating" | "idle"
  startedAt?: Date
  executionId?: string
  nodeType?: string
  nodeStatus?: string
  machineId?: string
  providerId?: string
}

interface BatchExecutionLike {
  active: boolean
}

/**
 * Build a stable node ID and display title for a chat session.
 *
 * project-chat sessions use `playground-{projectId}` so that multiple
 * chat sessions within the same project collapse into a single Active Jobs entry.
 * task-chat sessions use `followup-{nodeId}` to differentiate per-task follow-ups.
 */
function chatSessionEntry(
  session: Session,
  rawNodesById: Map<string, PlanNode>,
): { stableNodeId: string; displayTitle: string } | null {
  const isTaskChat = session.type === "task-chat"
  if (!isTaskChat && session.type !== "project-chat") return null

  const stableNodeId = isTaskChat
    ? (session.nodeId ? `followup-${session.nodeId}` : `playground-${session.projectId}`)
    : `playground-${session.projectId}`

  const firstUserMessage = session.titlePreview ?? session.messages.find((m) => m.role === "user")?.content
  const shortTitle = session.title
    || (firstUserMessage ? firstUserMessage.slice(0, 50) + (firstUserMessage.length > 50 ? "..." : "") : undefined)

  const taskNode = isTaskChat && session.nodeId ? rawNodesById.get(session.nodeId) : undefined
  const isFollowUp = taskNode && TERMINAL_ACTIVE_TASK_NODE_STATUSES.has(taskNode.status)
  const displayTitle = isTaskChat
    ? (isFollowUp ? `Follow-up: ${taskNode?.title || shortTitle || "Task"}` : (shortTitle || "Task Chat"))
    : `Playground Chat${shortTitle ? `: ${shortTitle}` : ''}`

  return { stableNodeId, displayTitle }
}

export function deriveActiveTasks(params: {
  executions: Map<string, TaskExecution>
  batchExecutions?: Map<string, BatchExecutionLike>
  rawNodes: PlanNode[]
  liveNodes: PlanNode[]
  nodesLoaded: boolean
  projects: Project[]
  projectsLoaded: boolean
  streamingSessions: Set<string>
  allSessions: Map<string, Session>
  workspaceFilter?: "all" | (string & {})
}): {
  groupedTasks: Map<string, ActiveTaskEntry[]>
  activeCount: number
  projectsWithRunning: Set<string>
} {
  const {
    executions,
    batchExecutions,
    rawNodes,
    liveNodes,
    nodesLoaded,
    projects,
    projectsLoaded,
    streamingSessions,
    allSessions,
    workspaceFilter = "all",
  } = params

  const rawNodesById = new Map(rawNodes.map((node) => [node.id, node]))
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const projectIds = new Set(projects.map((project) => project.id))
  const groupedTasks = new Map<string, ActiveTaskEntry[]>()
  const addedNodeIds = new Set<string>()
  const projectsWithRunning = new Set<string>()

  const includeProject = (projectId: string) => {
    if (workspaceFilter === "all") return true
    return projectById.get(projectId)?.teamId === workspaceFilter
  }

  const pushTask = (projectId: string, task: ActiveTaskEntry) => {
    if (!includeProject(projectId)) return
    const list = groupedTasks.get(projectId) || []
    list.push(task)
    groupedTasks.set(projectId, list)
  }

  const markRunning = (projectId: string) => {
    if (!includeProject(projectId)) return
    projectsWithRunning.add(projectId)
  }

  // Pass 1: Active executions (pending/running from execution store)
  for (const [nodeId, exec] of executions) {
    if (exec.status !== "pending" && exec.status !== "running") continue

    const isPlanSession = nodeId.startsWith("plan-")
    const isPlayground = nodeId.startsWith("playground-")
    const node = (isPlanSession || isPlayground) ? undefined : rawNodesById.get(nodeId)

    if (node && TERMINAL_ACTIVE_TASK_NODE_STATUSES.has(node.status)) continue
    if (!isPlanSession && !isPlayground && !node && nodesLoaded) continue

    const projectId = exec.projectId || node?.projectId
    if (!projectId) continue

    if ((isPlanSession || isPlayground) && projectsLoaded && !projectIds.has(projectId)) continue

    const task: ActiveTaskEntry = {
      nodeId,
      projectId,
      title: (() => {
        if (isPlanSession) return "Interactive Planning"
        if (isPlayground) return "Playground Chat"
        return node?.title || (nodesLoaded ? `Task ${nodeId.slice(0, 8)}` : "Loading…")
      })(),
      status: isPlanSession ? "generating" : (exec.status === "running" ? "running" : "pending"),
      startedAt: exec.startedAt,
      executionId: exec.executionId,
      nodeType: node?.type,
      nodeStatus: node?.status,
      machineId: exec.machineId,
      providerId: exec.providerId,
    }

    pushTask(projectId, task)
    addedNodeIds.add(nodeId)
    markRunning(projectId)
  }

  // Pass 2: Live plan nodes (in_progress/dispatched not covered by executions)
  for (const node of liveNodes) {
    if (node.status !== "in_progress" && node.status !== "dispatched") continue
    if (executions.has(node.id)) continue

    pushTask(node.projectId, {
      nodeId: node.id,
      projectId: node.projectId,
      title: node.title,
      status: node.status === "in_progress" ? "running" : "pending",
      startedAt: node.executionStartedAt ? new Date(node.executionStartedAt) : undefined,
      nodeType: node.type,
      nodeStatus: node.status,
    })
    markRunning(node.projectId)
  }

  // Pass 3: Streaming chat sessions (actively receiving model output)
  for (const sessionId of streamingSessions) {
    const session = allSessions.get(sessionId)
    if (!session?.projectId) continue

    const entry = chatSessionEntry(session, rawNodesById)
    if (!entry) continue
    if (addedNodeIds.has(entry.stableNodeId)) continue

    pushTask(session.projectId, {
      nodeId: entry.stableNodeId,
      projectId: session.projectId,
      title: entry.displayTitle,
      status: "running",
      startedAt: session.updatedAt,
    })
    addedNodeIds.add(entry.stableNodeId)
    markRunning(session.projectId)
  }

  // Pass 4: Recently-active chat sessions (idle — visible for 1 hour after last activity).
  // Sessions that have completed or been cancelled are excluded.
  const now = Date.now()
  for (const session of allSessions.values()) {
    if (!session.projectId) continue
    if (session.type !== "project-chat" && session.type !== "task-chat") continue
    if ((session.messageCount ?? session.messages.length) === 0) continue
    if (TERMINAL_SESSION_STATUSES.has(session.status)) continue

    const idleMs = now - session.updatedAt.getTime()
    if (idleMs > IDLE_RETENTION_MS) continue

    const entry = chatSessionEntry(session, rawNodesById)
    if (!entry) continue
    if (addedNodeIds.has(entry.stableNodeId)) continue

    pushTask(session.projectId, {
      nodeId: entry.stableNodeId,
      projectId: session.projectId,
      title: entry.displayTitle,
      status: "idle",
      startedAt: session.updatedAt,
    })
    addedNodeIds.add(entry.stableNodeId)
  }

  // Pass 5: Batch executions
  for (const [projectId, batch] of batchExecutions ?? new Map()) {
    if (batch.active) markRunning(projectId)
  }

  let activeCount = 0
  for (const tasks of groupedTasks.values()) activeCount += tasks.length

  return { groupedTasks, activeCount, projectsWithRunning }
}

export function getActiveTasksContentState(
  filteredCount: number,
  options: {
    executionsLoaded: boolean
    sessionsLoaded: boolean
  },
): "loading" | "empty" | "list" {
  if (filteredCount > 0) return "list"
  if (!options.executionsLoaded || !options.sessionsLoaded) return "loading"
  return "empty"
}
