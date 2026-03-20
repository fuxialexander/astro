import { describe, expect, it } from "vitest"

import { filterMyTasksProjects, getMyTasksEffectiveTeamScope } from "@/lib/my-tasks-filter"
import type { Project } from "@/types"

describe("my-tasks team scoping", () => {
  const projects = [
    { id: "personal-task", name: "Personal", teamId: "team-personal", projectType: "default" },
    { id: "astro-task", name: "Astro", teamId: "team-astro", projectType: "default" },
    { id: "plan-project", name: "Planner", teamId: "team-astro", projectType: "plan" },
  ] as Project[]

  it("uses the workspace scope when a specific workspace is selected", () => {
    expect(getMyTasksEffectiveTeamScope("team-personal", "team-astro")).toBe("team-personal")
  })

  it("uses the explicit team filter in all-workspaces mode", () => {
    expect(getMyTasksEffectiveTeamScope("all", "team-astro")).toBe("team-astro")
  })

  it("filters projects by the effective team scope and excludes plan sessions", () => {
    expect(filterMyTasksProjects(projects, "all", "team-astro").map((project) => project.id)).toEqual([
      "astro-task",
    ])
  })

  it("keeps the workspace filter authoritative over a contradictory team chip", () => {
    expect(filterMyTasksProjects(projects, "team-personal", "team-astro").map((project) => project.id)).toEqual([
      "personal-task",
    ])
  })
})
