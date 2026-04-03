import type { Project, PlanNode } from "@/types"

/**
 * Categorize projects into "projects with plan nodes" and "recent sessions"
 * based on whether they have any active plan nodes.
 *
 * This replaces the old projectType-based categorization where
 * `'plan'` and `'default'` went to PROJECTS and `'playground'` went to RECENT.
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
    if (projectIdsWithNodes.has(p.id)) {
      projectsWithNodes.push(p)
    } else {
      recentSessions.push(p)
    }
  }

  // Sort recent sessions by updatedAt descending
  recentSessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )

  return { projectsWithNodes, recentSessions }
}
