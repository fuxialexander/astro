import { describe, expect, it } from "vitest"
import type { PlanEdge, PlanNode } from "@/types"
import { layoutGraph } from "../graph-utils"

function makeTaskNode(id: string, number: number, milestoneId?: string, dependencies: string[] = []): PlanNode {
  return {
    id,
    number,
    projectId: "project-1",
    type: "task",
    title: id,
    description: "",
    status: "planned",
    parentId: null,
    dependencies,
    verification: "auto",
    position: { x: 0, y: 0 },
    milestoneId,
    createdAt: new Date("2026-03-20T12:00:00Z"),
    updatedAt: new Date("2026-03-20T12:00:00Z"),
  }
}

function makeMilestoneNode(id: string, number: number): PlanNode {
  return {
    id,
    number,
    projectId: "project-1",
    type: "milestone",
    title: id,
    description: "",
    status: "planned",
    parentId: null,
    dependencies: [],
    verification: "auto",
    position: { x: 0, y: 0 },
    createdAt: new Date("2026-03-20T12:00:00Z"),
    updatedAt: new Date("2026-03-20T12:00:00Z"),
  }
}

function makeEdge(id: string, source: string, target: string): PlanEdge {
  return {
    id,
    source,
    target,
    type: "dependency",
  }
}

describe("layoutGraph milestone columns", () => {
  it("keeps lower-numbered tasks earlier in a milestone column when there is no dependency", () => {
    const nodes = [
      makeMilestoneNode("ms-1", 1),
      makeTaskNode("task-3", 3, "ms-1"),
      makeTaskNode("task-1", 1, "ms-1"),
      makeTaskNode("task-2", 2, "ms-1"),
    ]

    const positions = layoutGraph(nodes, [])

    expect((positions.get("task-1")?.y ?? 0) < (positions.get("task-2")?.y ?? 0)).toBe(true)
    expect((positions.get("task-2")?.y ?? 0) < (positions.get("task-3")?.y ?? 0)).toBe(true)
  })

  it("places in-milestone dependencies above their dependents", () => {
    const nodes = [
      makeMilestoneNode("ms-1", 1),
      makeTaskNode("task-7", 7, "ms-1", ["task-6"]),
      makeTaskNode("task-6", 6, "ms-1"),
      makeTaskNode("task-8", 8, "ms-1", ["task-7"]),
    ]
    const edges = [
      makeEdge("e-6-7", "task-6", "task-7"),
      makeEdge("e-7-8", "task-7", "task-8"),
    ]

    const positions = layoutGraph(nodes, edges)

    expect((positions.get("task-6")?.y ?? 0) < (positions.get("task-7")?.y ?? 0)).toBe(true)
    expect((positions.get("task-7")?.y ?? 0) < (positions.get("task-8")?.y ?? 0)).toBe(true)
  })
})
