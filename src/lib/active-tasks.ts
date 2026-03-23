import type { PlanNode, Project, Session, TaskExecution } from "@/types"

const TERMINAL_ACTIVE_TASK_NODE_STATUSES = new Set([
  "completed",
  "auto_verified",
  "awaiting_judgment",
  "awaiting_approval",
  "pruned",
])

export interface ActiveTaskEntry {
  nodeId: string
  projectId: string
  title: string
  status: "running" | "pending" | "generating"
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
        if (isPlayground) return projectById.get(projectId)?.name || "Playground Session"
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

  for (const sessionId of streamingSessions) {
    const session = allSessions.get(sessionId)
    if (!session?.projectId) continue

    const isTaskChat = session.type === "task-chat"
    if (!isTaskChat && session.type !== "project-chat") continue

    // Use session's nodeId for task-chat to differentiate per-task follow-ups
    const stableNodeId = isTaskChat
      ? (session.nodeId ? `followup-${session.nodeId}` : `playground-${session.projectId}`)
      : `chat-${sessionId}`

    if (addedNodeIds.has(stableNodeId)) continue

    const firstUserMessage = session.titlePreview ?? session.messages.find((message) => message.role === "user")?.content
    const title = session.title
      || (firstUserMessage ? firstUserMessage.slice(0, 50) + (firstUserMessage.length > 50 ? "..." : "") : undefined)
      || projectById.get(session.projectId)?.name
      || "Chat Session"

    // For task-chat, check if the associated task already completed (= follow-up chat)
    const taskNode = isTaskChat && session.nodeId ? rawNodesById.get(session.nodeId) : undefined
    const isFollowUp = taskNode && TERMINAL_ACTIVE_TASK_NODE_STATUSES.has(taskNode.status)
    const displayTitle = isTaskChat
      ? (isFollowUp ? `Follow-up: ${taskNode?.title || title}` : title)
      : `Chat: ${title}`

    pushTask(session.projectId, {
      nodeId: stableNodeId,
      projectId: session.projectId,
      title: displayTitle,
      status: "running",
      startedAt: session.updatedAt,
    })
    markRunning(session.projectId)
  }

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
