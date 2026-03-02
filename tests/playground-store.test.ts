/**
 * Playground Session Tests (execution-store)
 *
 * Tests the startPlaygroundSession, cancelPlaygroundSession, and
 * steerPlaygroundSession methods on the execution store.
 *
 * Run with: npx vitest run tests/playground-store.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import type { TaskExecution } from "../packages/core/src/types"

// ---------------------------------------------------------------------------
// Mocks — must be declared before any store imports
// ---------------------------------------------------------------------------

// Mock dataClient
vi.mock("../src/lib/data-client", () => ({
  dataClient: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    getExecutions: vi.fn().mockResolvedValue({}),
    updateExecution: vi.fn().mockResolvedValue(undefined),
    getProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({ id: "mock-id" }),
    addProject: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn().mockResolvedValue(undefined),
    getNodes: vi.fn().mockResolvedValue([]),
    getEdges: vi.fn().mockResolvedValue([]),
    updateNode: vi.fn().mockResolvedValue(undefined),
    getDisplaySettings: vi.fn().mockResolvedValue({}),
    updateDisplaySettings: vi.fn().mockResolvedValue(undefined),
    getInitiatives: vi.fn().mockResolvedValue([]),
    getUserProfile: vi.fn().mockResolvedValue(null),
    getSidebarItems: vi.fn().mockResolvedValue([]),
    updateSidebarItems: vi.fn().mockResolvedValue(undefined),
    getConnectedAccounts: vi.fn().mockResolvedValue([]),
    getTaskChatSessions: vi.fn().mockResolvedValue([]),
    getActivities: vi.fn().mockResolvedValue([]),
    getUsageMetrics: vi.fn().mockResolvedValue(null),
  },
}))

// Mock api-url
vi.mock("../src/lib/api-url", () => ({
  apiUrl: (path: string) => `http://localhost:3001${path}`,
}))

// Mock supabase-client (getAccessToken)
vi.mock("../src/lib/supabase-client", () => ({
  getAccessToken: vi.fn().mockResolvedValue(null),
}))

// Mock app-mode
vi.mock("../src/lib/app-mode", () => ({
  isLocalMode: vi.fn().mockReturnValue(true),
  isServerMode: vi.fn().mockReturnValue(false),
}))

// Mock sse-parser
vi.mock("../src/lib/sse-parser", () => ({
  parseSSEStream: vi.fn().mockResolvedValue(undefined),
}))

// Mock html-utils
vi.mock("../src/lib/html-utils", () => ({
  stripHtml: vi.fn((s: string) => s),
  extractBlobUrls: vi.fn(() => []),
}))

// Mock plan-extraction
vi.mock("../src/lib/plan-extraction", () => ({
  extractPlanJsonFromText: vi.fn().mockReturnValue(null),
}))

// Mock @astro/core/dispatch
vi.mock("@astro/core/dispatch", () => ({
  resolveWorkingDirectory: vi.fn().mockReturnValue({ ok: true, dir: "/tmp/test" }),
  buildDependencyOutputs: vi.fn().mockReturnValue([]),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

// Mock crypto.randomUUID
const MOCK_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
vi.stubGlobal("crypto", {
  randomUUID: vi.fn().mockReturnValue(MOCK_UUID),
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useExecutionStore — Playground Sessions", () => {
  let useExecutionStore: typeof import("../src/stores/execution-store").useExecutionStore
  let useProjectStore: typeof import("../src/stores/project-store").useProjectStore

  beforeEach(async () => {
    vi.resetModules()
    mockFetch.mockReset()

    const execMod = await import("../src/stores/execution-store")
    useExecutionStore = execMod.useExecutionStore

    const projMod = await import("../src/stores/project-store")
    useProjectStore = projMod.useProjectStore
  })

  // ─── startPlaygroundSession ─────────────────────────────────────────

  describe("startPlaygroundSession", () => {
    it("creates a project via project store", async () => {
      // Mock successful dispatch response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        body: null,
      })

      const addProjectSpy = vi.spyOn(useProjectStore.getState(), "addProject")

      const result = await useExecutionStore.getState().startPlaygroundSession(
        "Test playground task",
        {
          targetMachineId: "machine-1",
          workingDirectory: "/home/user/project",
        }
      )

      expect(result.projectId).toBe(MOCK_UUID)
      expect(result.nodeId).toBe(`playground-${MOCK_UUID}`)

      // Verify project was added with correct fields
      expect(addProjectSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: MOCK_UUID,
          name: "Test playground task",
          description: "Test playground task",
          workingDirectory: "/home/user/project",
          defaultMachineId: "machine-1",
        })
      )
    })

    it("creates an execution entry with pending status", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        body: null,
      })

      const { nodeId } = await useExecutionStore.getState().startPlaygroundSession(
        "My task",
        {
          targetMachineId: "machine-1",
          workingDirectory: "/tmp",
        }
      )

      const execution = useExecutionStore.getState().executions.get(nodeId)
      expect(execution).toBeDefined()
      expect(execution!.status).toBe("pending")
      expect(execution!.projectId).toBe(MOCK_UUID)
      expect(execution!.nodeId).toBe(nodeId)
    })

    it("dispatches to /api/dispatch/task with correct parameters", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        body: null,
      })

      await useExecutionStore.getState().startPlaygroundSession(
        "Build a widget",
        {
          targetMachineId: "machine-99",
          workingDirectory: "/projects/widget",
          model: "opus",
          preferredProvider: "claude-code",
        }
      )

      // Wait for the fire-and-forget dispatch to happen
      await new Promise((r) => setTimeout(r, 50))

      // Find the dispatch call (the POST to /api/dispatch/task)
      const dispatchCall = mockFetch.mock.calls.find(
        ([url]: [string]) => typeof url === "string" && url.includes("/api/dispatch/task")
      )

      expect(dispatchCall).toBeDefined()
      const body = JSON.parse(dispatchCall![1].body)
      expect(body.nodeId).toBe(`playground-${MOCK_UUID}`)
      expect(body.projectId).toBe(MOCK_UUID)
      expect(body.targetMachineId).toBe("machine-99")
      expect(body.model).toBe("opus")
      expect(body.preferredProvider).toBe("claude-code")
      expect(body.workingDirectory).toBe("/projects/widget")
      expect(body.deliveryMode).toBe("direct")
      expect(body.skipSafetyCheck).toBe(true)
      expect(body.force).toBe(true)
      expect(body.maxTurns).toBe(200)
    })

    it("truncates long descriptions for project name (60 chars)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        body: null,
      })

      const longDescription = "A".repeat(100)
      const addProjectSpy = vi.spyOn(useProjectStore.getState(), "addProject")

      await useExecutionStore.getState().startPlaygroundSession(
        longDescription,
        {
          targetMachineId: "m1",
          workingDirectory: "/tmp",
        }
      )

      expect(addProjectSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "A".repeat(60),
        })
      )
    })

    it("uses 'Playground Session' as fallback name for empty description", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        body: null,
      })

      const addProjectSpy = vi.spyOn(useProjectStore.getState(), "addProject")

      await useExecutionStore.getState().startPlaygroundSession(
        "",
        {
          targetMachineId: "m1",
          workingDirectory: "/tmp",
        }
      )

      expect(addProjectSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Playground Session",
        })
      )
    })

    it("sets failure status on server error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal error" }),
        body: null,
      })

      const { nodeId } = await useExecutionStore.getState().startPlaygroundSession(
        "Failing task",
        {
          targetMachineId: "m1",
          workingDirectory: "/tmp",
        }
      )

      // Wait for the fire-and-forget dispatch to process
      await new Promise((r) => setTimeout(r, 100))

      const execution = useExecutionStore.getState().executions.get(nodeId)
      expect(execution).toBeDefined()
      expect(execution!.status).toBe("failure")
      expect(execution!.error).toContain("500")
    })
  })

  // ─── cancelPlaygroundSession ────────────────────────────────────────

  describe("cancelPlaygroundSession", () => {
    it("sets execution status to cancelled", async () => {
      // First start a session
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        body: null,
      })

      const { projectId, nodeId } = await useExecutionStore.getState().startPlaygroundSession(
        "Cancel me",
        {
          targetMachineId: "m1",
          workingDirectory: "/tmp",
        }
      )

      // Now cancel
      await useExecutionStore.getState().cancelPlaygroundSession(projectId)

      const execution = useExecutionStore.getState().executions.get(nodeId)
      expect(execution).toBeDefined()
      expect(execution!.status).toBe("cancelled")
      expect(execution!.completedAt).toBeDefined()
    })

    it("sends cancel API call when executionId is available", async () => {
      // Manually set up an execution with an executionId
      const projectId = "test-project"
      const nodeId = `playground-${projectId}`

      useExecutionStore.setState((state) => {
        const executions = new Map(state.executions)
        executions.set(nodeId, {
          nodeId,
          projectId,
          executionId: "exec-123",
          status: "running",
          streamText: "",
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
          startedAt: new Date(),
        } as unknown as TaskExecution)
        return { executions }
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      await useExecutionStore.getState().cancelPlaygroundSession(projectId)

      // Verify the cancel API was called
      const cancelCall = mockFetch.mock.calls.find(
        ([url]: [string]) => typeof url === "string" && url.includes("/api/dispatch/cancel")
      )

      expect(cancelCall).toBeDefined()
      const body = JSON.parse(cancelCall![1].body)
      expect(body.nodeId).toBe(nodeId)
      expect(body.executionId).toBe("exec-123")
    })

    it("does not call cancel API when no executionId exists", async () => {
      const projectId = "test-project-2"
      const nodeId = `playground-${projectId}`

      useExecutionStore.setState((state) => {
        const executions = new Map(state.executions)
        executions.set(nodeId, {
          nodeId,
          projectId,
          executionId: "",  // no executionId
          status: "pending",
          streamText: "",
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
          startedAt: new Date(),
        } as unknown as TaskExecution)
        return { executions }
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      await useExecutionStore.getState().cancelPlaygroundSession(projectId)

      // Should not have called the cancel API
      const cancelCall = mockFetch.mock.calls.find(
        ([url]: [string]) => typeof url === "string" && url.includes("/api/dispatch/cancel")
      )
      expect(cancelCall).toBeUndefined()
    })
  })

  // ─── steerPlaygroundSession ─────────────────────────────────────────

  describe("steerPlaygroundSession", () => {
    it("sends steer request with correct payload", async () => {
      const projectId = "steer-project"
      const nodeId = `playground-${projectId}`

      useExecutionStore.setState((state) => {
        const executions = new Map(state.executions)
        executions.set(nodeId, {
          nodeId,
          projectId,
          executionId: "exec-steer-1",
          machineId: "machine-42",
          status: "running",
          streamText: "",
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
          startedAt: new Date(),
        } as unknown as TaskExecution)
        return { executions }
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const result = await useExecutionStore.getState().steerPlaygroundSession(
        projectId,
        "Please focus on the tests"
      )

      expect(result).toBe(true)

      const steerCall = mockFetch.mock.calls.find(
        ([url]: [string]) => typeof url === "string" && url.includes("/api/dispatch/steer")
      )

      expect(steerCall).toBeDefined()
      const body = JSON.parse(steerCall![1].body)
      expect(body.taskId).toBe("exec-steer-1")
      expect(body.machineId).toBe("machine-42")
      expect(body.message).toBe("Please focus on the tests")
      expect(body.action).toBe("guidance")
    })

    it("returns false when no executionId exists", async () => {
      const projectId = "no-exec"
      const nodeId = `playground-${projectId}`

      useExecutionStore.setState((state) => {
        const executions = new Map(state.executions)
        executions.set(nodeId, {
          nodeId,
          projectId,
          executionId: "",
          status: "pending",
          streamText: "",
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
          startedAt: new Date(),
        } as unknown as TaskExecution)
        return { executions }
      })

      const result = await useExecutionStore.getState().steerPlaygroundSession(
        projectId,
        "do something"
      )

      expect(result).toBe(false)
    })

    it("returns false when no machineId exists", async () => {
      const projectId = "no-machine"
      const nodeId = `playground-${projectId}`

      useExecutionStore.setState((state) => {
        const executions = new Map(state.executions)
        executions.set(nodeId, {
          nodeId,
          projectId,
          executionId: "exec-1",
          // no machineId
          status: "running",
          streamText: "",
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
          startedAt: new Date(),
        } as unknown as TaskExecution)
        return { executions }
      })

      const result = await useExecutionStore.getState().steerPlaygroundSession(
        projectId,
        "do something"
      )

      expect(result).toBe(false)
    })

    it("returns false when no execution exists at all", async () => {
      const result = await useExecutionStore.getState().steerPlaygroundSession(
        "nonexistent-project",
        "hello"
      )

      expect(result).toBe(false)
    })

    it("returns false on server error", async () => {
      const projectId = "error-project"
      const nodeId = `playground-${projectId}`

      useExecutionStore.setState((state) => {
        const executions = new Map(state.executions)
        executions.set(nodeId, {
          nodeId,
          projectId,
          executionId: "exec-err",
          machineId: "m1",
          status: "running",
          streamText: "",
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
          startedAt: new Date(),
        } as unknown as TaskExecution)
        return { executions }
      })

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      })

      const result = await useExecutionStore.getState().steerPlaygroundSession(
        projectId,
        "please help"
      )

      expect(result).toBe(false)
    })

    it("returns false on network error", async () => {
      const projectId = "network-err"
      const nodeId = `playground-${projectId}`

      useExecutionStore.setState((state) => {
        const executions = new Map(state.executions)
        executions.set(nodeId, {
          nodeId,
          projectId,
          executionId: "exec-net",
          machineId: "m1",
          status: "running",
          streamText: "",
          toolTraces: [],
          fileChanges: [],
          activityEvents: [],
          startedAt: new Date(),
        } as unknown as TaskExecution)
        return { executions }
      })

      mockFetch.mockRejectedValue(new Error("Network failure"))

      const result = await useExecutionStore.getState().steerPlaygroundSession(
        projectId,
        "hello"
      )

      expect(result).toBe(false)
    })
  })

  // ─── Playground project filtering (projects page) ───────────────────

  describe("Playground project filtering", () => {
    it("playground executions use playground-{projectId} as key", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        body: null,
      })

      const { projectId, nodeId } = await useExecutionStore.getState().startPlaygroundSession(
        "Test",
        {
          targetMachineId: "m1",
          workingDirectory: "/tmp",
        }
      )

      expect(nodeId).toBe(`playground-${projectId}`)

      // The executions map should have the entry keyed by nodeId
      const executions = useExecutionStore.getState().executions
      expect(executions.has(`playground-${projectId}`)).toBe(true)
    })

    it("projects page filtering logic correctly identifies playground projects", () => {
      // Simulate the filtering logic from projects.tsx:
      //   allProjectsRaw.filter((p) => !executions.has(`playground-${p.id}`))
      const projects = [
        { id: "proj-1", name: "Real Project" },
        { id: "proj-2", name: "Playground Session" },
        { id: "proj-3", name: "Another Project" },
      ]

      const executions = new Map()
      executions.set("playground-proj-2", { nodeId: "playground-proj-2", status: "running" })

      const filtered = projects.filter((p) => !executions.has(`playground-${p.id}`))

      expect(filtered).toHaveLength(2)
      expect(filtered.map((p) => p.id)).toEqual(["proj-1", "proj-3"])
    })
  })
})
