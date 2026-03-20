import { describe, expect, it } from "vitest"

import {
  PLAYGROUND_PROJECT_GROUP_KEY,
  PLAYGROUND_PROJECT_GROUP_LABEL,
  getProjectGroupDescriptor,
  getProjectGroupDescriptorForId,
  getProjectGroupSeedProjects,
  getProjectIdFromGroupKey,
} from "@/lib/project-grouping"

describe("project-grouping", () => {
  it("collapses playground projects into one synthetic group", () => {
    const descriptor = getProjectGroupDescriptor({
      id: "pg-1",
      name: "Scratch pad",
      projectType: "playground",
    })

    expect(descriptor).toEqual({
      key: PLAYGROUND_PROJECT_GROUP_KEY,
      label: PLAYGROUND_PROJECT_GROUP_LABEL,
      defaultCollapsed: true,
    })
  })

  it("keeps regular projects addressable by group key", () => {
    const descriptor = getProjectGroupDescriptor({
      id: "proj-123",
      name: "Roadmap",
      projectType: "default",
    })

    expect(descriptor.label).toBe("Roadmap")
    expect(getProjectIdFromGroupKey(descriptor.key)).toBe("proj-123")
  })

  it("resolves playground labels by project id", () => {
    const projects = new Map([
      ["pg-1", { id: "pg-1", name: "Prompt test", projectType: "playground" as const }],
      ["proj-1", { id: "proj-1", name: "Core app", projectType: "default" as const }],
    ])

    expect(getProjectGroupDescriptorForId("pg-1", projects).label).toBe("Playground")
    expect(getProjectGroupDescriptorForId("proj-1", projects).label).toBe("Core app")
  })

  it("limits seeded project groups to the scoped project ids", () => {
    const projects = [
      { id: "proj-1", name: "Core app", projectType: "default" as const },
      { id: "proj-2", name: "Docs", projectType: "default" as const },
      { id: "pg-1", name: "Playground", projectType: "playground" as const },
    ]

    expect(getProjectGroupSeedProjects(projects, ["proj-2", "missing"])).toEqual([
      { id: "proj-2", name: "Docs", projectType: "default" },
    ])
  })
})
