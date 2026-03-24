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

  it("places sequential milestones in separate columns (LR) via cross-milestone task edges", () => {
    // ms-1 has task-4,task-5; ms-2 has task-6,task-7
    // task-5 → ms-2 edge creates a cross-milestone dependency
    const nodes = [
      makeMilestoneNode("ms-1", 1),
      makeMilestoneNode("ms-2", 2),
      makeTaskNode("task-4", 4, "ms-1"),
      makeTaskNode("task-5", 5, "ms-1"),
      makeTaskNode("task-6", 6, "ms-2"),
      makeTaskNode("task-7", 7, "ms-2"),
    ]
    const edges = [
      makeEdge("e-ms1-t4", "ms-1", "task-4"),
      makeEdge("e-t4-t5", "task-4", "task-5"),
      makeEdge("e-t5-ms2", "task-5", "ms-2"),
      makeEdge("e-ms2-t6", "ms-2", "task-6"),
      makeEdge("e-t6-t7", "task-6", "task-7"),
    ]

    const positions = layoutGraph(nodes, edges)

    // ms-1 should be in a different (left) column than ms-2
    const ms1x = positions.get("ms-1")!.x
    const ms2x = positions.get("ms-2")!.x
    expect(ms1x).toBeLessThan(ms2x)
  })

  it("places sequential milestones in separate columns via task dependency arrays", () => {
    // No explicit edge objects, but task-6 has dependency on task-5
    const nodes = [
      makeMilestoneNode("ms-1", 1),
      makeMilestoneNode("ms-2", 2),
      makeTaskNode("task-5", 5, "ms-1"),
      makeTaskNode("task-6", 6, "ms-2", ["task-5"]),
    ]

    const positions = layoutGraph(nodes, [])

    const ms1x = positions.get("ms-1")!.x
    const ms2x = positions.get("ms-2")!.x
    expect(ms1x).toBeLessThan(ms2x)
  })

  it("places parallel milestones in the same column (stacked vertically)", () => {
    // ms-1 and ms-2 have no cross-milestone dependencies — they are parallel
    const nodes = [
      makeMilestoneNode("ms-1", 1),
      makeMilestoneNode("ms-2", 2),
      makeTaskNode("task-1", 1, "ms-1"),
      makeTaskNode("task-2", 2, "ms-2"),
    ]

    const positions = layoutGraph(nodes, [])

    const ms1x = positions.get("ms-1")!.x
    const ms2x = positions.get("ms-2")!.x
    expect(ms1x).toBe(ms2x)
  })
})
