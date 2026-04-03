/**
 * Transport-agnostic task commands.
 *
 * Handles listing, showing, cancelling, steering, and status updates.
 * Dispatch and chat are streaming operations — transports handle the
 * SSE stream themselves but can use the structured dispatch options
 * from here.
 */

import type {
  CommandClient,
  PlanNodeData,
  TaskListResult,
  TaskDetailResult,
  TaskCancelResult,
  TaskSteerResult,
  TaskStatusUpdateResult,
  TaskListFilters,
} from './types.js'

/** List tasks with optional filters (project, status, date range). */
export async function listTasks(
  client: CommandClient,
  filters?: TaskListFilters,
): Promise<TaskListResult> {
  // Fetch nodes
  let nodes: PlanNodeData[]
  if (filters?.projectId) {
    const result = await client.getPlan(filters.projectId)
    nodes = result.nodes
  } else {
    const result = await client.getFullPlan()
    nodes = result.nodes
  }

  // Filter out deleted
  let filtered = nodes.filter((n) => !n.deletedAt)

  // Apply status filter
  if (filters?.status) {
    filtered = filtered.filter((n) => n.status === filters.status)
  }

  // Apply date filters
  if (filters?.since) {
    const since = filters.since.getTime()
    filtered = filtered.filter(
      (n) => n.updatedAt && new Date(n.updatedAt).getTime() >= since,
    )
  }
  if (filters?.until) {
    const until = filters.until.getTime()
    filtered = filtered.filter(
      (n) => n.updatedAt && new Date(n.updatedAt).getTime() <= until,
    )
  }

  // Sort by updatedAt descending
  filtered.sort((a, b) => {
    const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
    const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
    return db - da
  })

  // Build project name lookup
  const projects = await client.listProjects()
  const projectMap = new Map(projects.map((p) => [p.id, p.name]))

  const tasks = filtered.map((n) => ({
    id: n.id,
    title: n.title,
    status: n.status,
    projectName: projectMap.get(n.projectId) ?? n.projectId,
    projectId: n.projectId,
    updatedAt: n.updatedAt,
    type: n.type,
    priority: n.priority,
    estimate: n.estimate,
  }))

  return { tasks }
}

/** Get detailed info for a single task (by client ID). */
export async function getTask(
  client: CommandClient,
  clientId: string,
): Promise<TaskDetailResult> {
  // Find the plan node across all projects
  const { nodes } = await client.getFullPlan()
  const node = nodes.find((n) => n.id === clientId && !n.deletedAt)

  if (!node) {
    throw new Error(`Task not found: ${clientId}`)
  }

  // Get project name
  const projects = await client.listProjects()
  const project = projects.find((p) => p.id === node.projectId)
  const projectName = project?.name ?? node.projectId

  // Get execution for this node
  const executionMap = await client.getExecutions()
  const execution = executionMap[node.id] ?? null

  // Get file changes if execution exists
  let fileChanges: TaskDetailResult['fileChanges'] = []
  if (execution?.executionId) {
    fileChanges = await client.listFileChanges(execution.executionId)
  }

  return { node, projectName, execution, fileChanges }
}

/** Cancel a running task execution. */
export async function cancelTask(
  client: CommandClient,
  opts: { executionId: string; machineId?: string; nodeId?: string },
): Promise<TaskCancelResult> {
  const result = await client.cancelTask(opts)
  return { executionId: opts.executionId, result }
}

/** Send steering guidance to a running task. */
export async function steerTask(
  client: CommandClient,
  opts: {
    executionId: string
    machineId: string
    message: string
    action?: 'guidance' | 'redirect' | 'pause' | 'resume'
  },
): Promise<TaskSteerResult> {
  const result = await client.steerTask({
    taskId: opts.executionId,
    machineId: opts.machineId,
    message: opts.message,
    action: opts.action,
  })
  return { executionId: opts.executionId, result }
}

/** Update a task node's status. */
export async function updateTaskStatus(
  client: CommandClient,
  nodeId: string,
  status: string,
): Promise<TaskStatusUpdateResult> {
  const result = await client.updatePlanNode(nodeId, { status })
  return { nodeId, status, result }
}
