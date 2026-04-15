/**
 * Transport-agnostic search and activity commands.
 */

import type {
  CommandClient,
  SearchCommandResult,
  SearchFilters,
  ActivityListResult,
  ActivityListFilters,
} from './types.js'

/** Search across projects, tasks, and executions with optional filters. */
export async function searchAll(
  client: CommandClient,
  query: string,
  filters?: SearchFilters,
): Promise<SearchCommandResult> {
  const results = await client.search(query)

  let { projects, tasks, executions } = results

  // Apply date filters (client-side)
  if (filters?.since) {
    const since = filters.since.getTime()
    projects = projects.filter(
      (p) => p.updatedAt && new Date(p.updatedAt).getTime() >= since,
    )
    tasks = tasks.filter(
      (t) => t.updatedAt && new Date(t.updatedAt).getTime() >= since,
    )
    executions = executions.filter(
      (e) => e.startedAt && new Date(e.startedAt).getTime() >= since,
    )
  }
  if (filters?.until) {
    const until = filters.until.getTime()
    projects = projects.filter(
      (p) => p.updatedAt && new Date(p.updatedAt).getTime() <= until,
    )
    tasks = tasks.filter(
      (t) => t.updatedAt && new Date(t.updatedAt).getTime() <= until,
    )
    executions = executions.filter(
      (e) => e.startedAt && new Date(e.startedAt).getTime() <= until,
    )
  }

  // Apply type filter
  if (filters?.type) {
    if (filters.type !== 'projects') projects = []
    if (filters.type !== 'tasks') tasks = []
    if (filters.type !== 'executions') executions = []
  }

  return {
    query,
    projects,
    tasks,
    executions,
    totalMatches: projects.length + tasks.length + executions.length,
  }
}

/** List recent activity events with optional filters. */
export async function listActivities(
  client: CommandClient,
  filters?: ActivityListFilters,
): Promise<ActivityListResult> {
  let rows = await client.listActivities({
    projectId: filters?.projectId,
    limit: filters?.limit,
  })

  // Client-side filters
  if (filters?.type) {
    rows = rows.filter((r) => r.type === filters.type)
  }
  if (filters?.since) {
    const since = filters.since.getTime()
    rows = rows.filter(
      (r) => r.createdAt && new Date(r.createdAt).getTime() >= since,
    )
  }
  if (filters?.until) {
    const until = filters.until.getTime()
    rows = rows.filter(
      (r) => r.createdAt && new Date(r.createdAt).getTime() <= until,
    )
  }

  const activities = rows.map((r) => ({
    id: r.id,
    time: r.createdAt,
    type: r.type,
    title: r.title,
    projectId: r.projectId,
    nodeId: r.nodeId,
    description: r.description,
    metadata: r.metadata,
  }))

  return { activities }
}
