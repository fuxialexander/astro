/**
 * Transport-agnostic project commands.
 *
 * Each function takes a `CommandClient` and parameters, performs the
 * business logic, and returns a structured result. No formatting, no
 * process.exit, no chalk — just data in, data out.
 */

import type {
  CommandClient,
  ProjectData,
  ProjectListResult,
  ProjectDetailResult,
  ProjectCreateResult,
  ProjectUpdateResult,
  ProjectDeleteResult,
  ProjectStatsResult,
} from './types.js'

/**
 * Resolve a partial project ID to a full project.
 * Searches all projects by prefix match. Throws if 0 or >1 matches.
 */
export async function resolveProject(
  client: CommandClient,
  partialId: string,
): Promise<ProjectData> {
  const projects = await client.listProjects()

  // Exact match first
  const exact = projects.find((p) => p.id === partialId)
  if (exact) return exact

  // Prefix match
  const matches = projects.filter((p) => p.id.startsWith(partialId))
  if (matches.length === 0) {
    throw new Error(`No project found matching "${partialId}"`)
  }
  if (matches.length > 1) {
    const ids = matches.map((p) => `  ${p.id.slice(0, 8)}  ${p.name}`).join('\n')
    throw new Error(`Ambiguous project ID "${partialId}" matches ${matches.length} projects:\n${ids}`)
  }
  return matches[0]
}

/** List all projects. */
export async function listProjects(
  client: CommandClient,
): Promise<ProjectListResult> {
  const projects = await client.listProjects()
  return { projects }
}

/** Get detailed info for a single project (supports partial ID). */
export async function getProject(
  client: CommandClient,
  partialId: string,
): Promise<ProjectDetailResult> {
  const project = await resolveProject(client, partialId)
  return { project }
}

/** Create a new project. */
export async function createProject(
  client: CommandClient,
  opts: { name: string; description?: string; workingDirectory?: string },
): Promise<ProjectCreateResult> {
  const project = await client.createProject({
    name: opts.name,
    description: opts.description,
    workingDirectory: opts.workingDirectory,
  })
  return { project }
}

/** Update a project (supports partial ID). */
export async function updateProject(
  client: CommandClient,
  partialId: string,
  patch: Record<string, unknown>,
): Promise<ProjectUpdateResult> {
  const project = await resolveProject(client, partialId)
  const updatedFields = Object.keys(patch)
  if (updatedFields.length === 0) {
    throw new Error('No update fields provided')
  }
  const updated = await client.updateProject(project.id, patch)
  return { project: updated, updatedFields }
}

/** Delete a project (supports partial ID). */
export async function deleteProject(
  client: CommandClient,
  partialId: string,
): Promise<ProjectDeleteResult> {
  const project = await resolveProject(client, partialId)
  await client.deleteProject(project.id)
  return { id: project.id, name: project.name }
}

/** Compute project statistics (plan counts, execution success rate, costs). */
export async function getProjectStats(
  client: CommandClient,
  partialId: string,
): Promise<ProjectStatsResult> {
  const project = await resolveProject(client, partialId)
  const { nodes, edges } = await client.getPlan(project.id)
  const active = nodes.filter((n) => !n.deletedAt)

  // Status counts
  const statusCounts: Record<string, number> = {}
  for (const n of active) {
    statusCounts[n.status] = (statusCounts[n.status] || 0) + 1
  }

  // Execution stats for this project
  const executionMap = await client.getExecutions()
  const projectExecs = Object.values(executionMap).filter(
    (e) => e.projectId === project.id,
  )
  const successCount = projectExecs.filter((e) => e.status === 'success').length
  const totalTokens = projectExecs.reduce(
    (sum, e) => sum + (e.tokensUsed ?? 0),
    0,
  )
  const totalCost = projectExecs.reduce(
    (sum, e) => sum + (e.estimatedCostUsd ?? 0),
    0,
  )

  return {
    project: { id: project.id, name: project.name, status: project.status },
    plan: {
      totalNodes: active.length,
      totalEdges: edges.length,
      statusCounts,
    },
    executions: {
      total: projectExecs.length,
      successCount,
      successRate:
        projectExecs.length > 0
          ? `${Math.round((successCount / projectExecs.length) * 100)}%`
          : '\u2014',
      totalTokens,
      totalCost,
    },
  }
}
