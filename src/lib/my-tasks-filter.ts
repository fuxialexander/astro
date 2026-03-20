import type { Project } from "@/types"

type TeamScope = string | "all"

export function getMyTasksEffectiveTeamScope(
  workspaceFilter: TeamScope,
  teamFilter: TeamScope,
): TeamScope {
  return workspaceFilter !== "all" ? workspaceFilter : teamFilter
}

export function filterMyTasksProjects(
  projects: Project[],
  workspaceFilter: TeamScope,
  teamFilter: TeamScope,
): Project[] {
  const teamScope = getMyTasksEffectiveTeamScope(workspaceFilter, teamFilter)
  const filtered = projects.filter((project) => project.projectType !== "plan")

  if (teamScope === "all") return filtered

  return filtered.filter((project) => project.teamId === teamScope)
}
