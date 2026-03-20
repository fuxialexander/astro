import type { Project } from "@/types"

const PROJECT_GROUP_KEY_PREFIX = "project:"

export const PLAYGROUND_PROJECT_GROUP_KEY = `${PROJECT_GROUP_KEY_PREFIX}playground`
export const PLAYGROUND_PROJECT_GROUP_LABEL = "Playground"

export interface ProjectGroupDescriptor {
  key: string
  label: string
  projectId?: string
  defaultCollapsed?: boolean
}

export function getProjectGroupSeedProjects<TProject extends Pick<Project, "id" | "name" | "projectType">>(
  projects: TProject[],
  scopedProjectIds?: Iterable<string>,
): TProject[] {
  if (!scopedProjectIds) return projects

  const allowedIds = new Set(scopedProjectIds)
  return projects.filter((project) => allowedIds.has(project.id))
}

export function getProjectGroupDescriptor(project: Pick<Project, "id" | "name" | "projectType">): ProjectGroupDescriptor {
  if (project.projectType === "playground") {
    return {
      key: PLAYGROUND_PROJECT_GROUP_KEY,
      label: PLAYGROUND_PROJECT_GROUP_LABEL,
      defaultCollapsed: true,
    }
  }

  return {
    key: `${PROJECT_GROUP_KEY_PREFIX}${project.id}`,
    label: project.name,
    projectId: project.id,
  }
}

export function getProjectGroupDescriptorForId(
  projectId: string,
  projectsById: Map<string, Pick<Project, "id" | "name" | "projectType">>,
): ProjectGroupDescriptor {
  const project = projectsById.get(projectId)
  if (!project) {
    return {
      key: `${PROJECT_GROUP_KEY_PREFIX}${projectId}`,
      label: "Unknown Project",
      projectId,
    }
  }

  return getProjectGroupDescriptor(project)
}

export function getProjectIdFromGroupKey(groupKey: string): string | undefined {
  if (groupKey === PLAYGROUND_PROJECT_GROUP_KEY) return undefined
  if (!groupKey.startsWith(PROJECT_GROUP_KEY_PREFIX)) return undefined
  return groupKey.slice(PROJECT_GROUP_KEY_PREFIX.length)
}
