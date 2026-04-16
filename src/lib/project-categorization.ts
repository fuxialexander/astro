import type { Project, PlanNode } from "@/types"

/**
 * Categorize projects into "projects with plan nodes" and "recent sessions".
 *
 * A project is a SESSION only when it is explicitly `projectType === 'playground'`
 * AND has no active plan nodes. Everything else (manually-created 'default' projects,
 * 'github' projects, or anything that already has nodes) is treated as a PROJECT.
 */
export function categorizeProjects(
  projects: Project[],
  planNodes: PlanNode[],
): { projectsWithNodes: Project[]; recentSessions: Project[] } {
  const projectIdsWithNodes = new Set<string>()
  for (const node of planNodes) {
    if (!node.deletedAt) {
      projectIdsWithNodes.add(node.projectId)
    }
  }

  const projectsWithNodes: Project[] = []
  const recentSessions: Project[] = []

  for (const p of projects) {
    if (p.status !== "active") continue
    const hasNodes = projectIdsWithNodes.has(p.id)
    const isSession = !hasNodes && p.projectType === "playground"
    if (isSession) {
      recentSessions.push(p)
    } else {
      projectsWithNodes.push(p)
    }
  }

  // Sort recent sessions by updatedAt descending
  recentSessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )

  return { projectsWithNodes, recentSessions }
}
