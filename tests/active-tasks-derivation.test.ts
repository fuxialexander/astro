import { describe, expect, it } from "vitest"

import { deriveActiveTasks } from "@/lib/active-tasks"

describe("deriveActiveTasks", () => {
  it("applies the workspace filter to both count and running-project indicators", () => {
    const result = deriveActiveTasks({
      executions: new Map([
        ["plan-proj-a", {
          nodeId: "plan-proj-a",
          projectId: "proj-a",
          executionId: "exec-a",
          status: "running",
          streamText: "",
          startedAt: new Date(),
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
        }],
        ["plan-proj-b", {
          nodeId: "plan-proj-b",
          projectId: "proj-b",
          executionId: "exec-b",
          status: "running",
          streamText: "",
          startedAt: new Date(),
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
        }],
      ]),
      rawNodes: [],
      liveNodes: [],
      nodesLoaded: true,
      projects: [
        { id: "proj-a", name: "A", teamId: "team-a" },
        { id: "proj-b", name: "B", teamId: "team-b" },
      ] as any,
      projectsLoaded: true,
      streamingSessions: new Set(),
      allSessions: new Map(),
      workspaceFilter: "team-a",
    })

    expect(result.activeCount).toBe(1)
    expect([...result.groupedTasks.keys()]).toEqual(["proj-a"])
    expect(result.projectsWithRunning.has("proj-a")).toBe(true)
    expect(result.projectsWithRunning.has("proj-b")).toBe(false)
  })

  it("drops regular executions with no matching node after plan nodes finish loading", () => {
    const result = deriveActiveTasks({
      executions: new Map([
        ["task-1", {
          nodeId: "task-1",
          projectId: "proj-a",
          executionId: "exec-a",
          status: "running",
          streamText: "",
          startedAt: new Date(),
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
        }],
      ]),
      rawNodes: [],
      liveNodes: [],
      nodesLoaded: true,
      projects: [
        { id: "proj-a", name: "A", teamId: "team-a" },
      ] as any,
      projectsLoaded: true,
      streamingSessions: new Set(),
      allSessions: new Map(),
      workspaceFilter: "all",
    })

    expect(result.activeCount).toBe(0)
    expect(result.groupedTasks.size).toBe(0)
  })

  it("counts user-facing chat streams but ignores other streaming session types", () => {
    const result = deriveActiveTasks({
      executions: new Map(),
      rawNodes: [],
      liveNodes: [],
      nodesLoaded: true,
      projects: [
        { id: "proj-a", name: "A", teamId: "team-a" },
      ] as any,
      projectsLoaded: true,
      streamingSessions: new Set(["chat-1", "exec-1"]),
      allSessions: new Map([
        ["chat-1", {
          id: "chat-1",
          projectId: "proj-a",
          type: "project-chat",
          status: "streaming",
          messages: [{ id: "m1", role: "user", content: "hello", timestamp: new Date() }],
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        ["exec-1", {
          id: "exec-1",
          projectId: "proj-a",
          type: "execution",
          status: "streaming",
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
      ]),
      workspaceFilter: "all",
    })

    expect(result.activeCount).toBe(1)
    expect(result.groupedTasks.get("proj-a")).toHaveLength(1)
    expect(result.groupedTasks.get("proj-a")?.[0].nodeId).toBe("chat-chat-1")
  })
})
