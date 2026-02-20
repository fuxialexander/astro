/**
 * Unit tests for session-store.ts
 *
 * Tests multi-session management: creation, switching, renaming,
 * deletion, active session tracking, and session title resolution.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock dependencies before importing the store
vi.mock("@/lib/db", () => ({
  loadState: vi.fn().mockResolvedValue(null),
  saveState: vi.fn(),
}))

vi.mock("@/lib/data-client", () => ({
  dataClient: {
    getAllSessions: vi.fn().mockRejectedValue(new Error("no api")),
    createSession: vi.fn().mockResolvedValue(undefined),
    updateSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    addSessionMessage: vi.fn().mockResolvedValue(undefined),
  },
}))

import { useSessionStore, getSessionTitle } from "../session-store"
import type { Session } from "@/types"

// Helper to reset store state between tests
function resetStore() {
  useSessionStore.setState({
    sessions: new Map(),
    loaded: true,
    activeSessionIds: new Map(),
  })
}

// Helper to create a minimal session object for testing getSessionTitle
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session",
    type: "plan-chat",
    status: "active",
    projectId: "proj-1",
    messages: [],
    createdAt: new Date("2026-01-15"),
    updatedAt: new Date("2026-01-15"),
    ...overrides,
  }
}

describe("getSessionTitle", () => {
  it("returns session.title when set", () => {
    const session = makeSession({ title: "My Custom Title" })
    expect(getSessionTitle(session)).toBe("My Custom Title")
  })

  it("falls back to metadata.title for legacy sessions", () => {
    const session = makeSession({ metadata: { title: "Legacy Title" } })
    expect(getSessionTitle(session)).toBe("Legacy Title")
  })

  it("prefers session.title over metadata.title", () => {
    const session = makeSession({
      title: "Direct Title",
      metadata: { title: "Metadata Title" },
    })
    expect(getSessionTitle(session)).toBe("Direct Title")
  })

  it("auto-generates from first user message", () => {
    const session = makeSession({
      messages: [
        { id: "m1", role: "user", content: "Help me refactor the auth module", timestamp: new Date() },
        { id: "m2", role: "assistant", content: "Sure!", timestamp: new Date() },
      ],
    })
    expect(getSessionTitle(session)).toBe("Help me refactor the auth module")
  })

  it("truncates long first user messages", () => {
    const longMessage = "A".repeat(60)
    const session = makeSession({
      messages: [
        { id: "m1", role: "user", content: longMessage, timestamp: new Date() },
      ],
    })
    const title = getSessionTitle(session)
    expect(title).toBe("A".repeat(50) + "...")
  })

  it("falls back to date-based title when no messages", () => {
    const session = makeSession({ createdAt: new Date("2026-01-15") })
    const title = getSessionTitle(session)
    expect(title).toContain("Session")
  })
})

describe("session store - CRUD", () => {
  beforeEach(() => {
    resetStore()
  })

  it("createSession creates a session and stores it", () => {
    const store = useSessionStore.getState()
    const session = store.createSession({
      type: "plan-chat",
      projectId: "proj-1",
    })

    expect(session.id).toBeTruthy()
    expect(session.type).toBe("plan-chat")
    expect(session.projectId).toBe("proj-1")
    expect(session.status).toBe("active")
    expect(session.messages).toEqual([])

    // Verify it's in the store
    const retrieved = useSessionStore.getState().getSession(session.id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe(session.id)
  })

  it("getSessionsForProject returns sessions sorted by creation time", () => {
    const store = useSessionStore.getState()

    // Create sessions with slight time differences
    const s1 = store.createSession({ type: "plan-chat", projectId: "proj-1" })
    const s2 = store.createSession({ type: "plan-chat", projectId: "proj-1" })
    const s3 = store.createSession({ type: "plan-chat", projectId: "proj-2" })

    const proj1Sessions = useSessionStore.getState().getSessionsForProject("proj-1", "plan-chat")
    expect(proj1Sessions).toHaveLength(2)
    expect(proj1Sessions[0].id).toBe(s1.id)
    expect(proj1Sessions[1].id).toBe(s2.id)

    // Different project
    const proj2Sessions = useSessionStore.getState().getSessionsForProject("proj-2")
    expect(proj2Sessions).toHaveLength(1)
    expect(proj2Sessions[0].id).toBe(s3.id)
  })

  it("getSessionsForProject filters by type", () => {
    const store = useSessionStore.getState()
    store.createSession({ type: "plan-chat", projectId: "proj-1" })
    store.createSession({ type: "task-chat", projectId: "proj-1", nodeId: "n1" })

    const planSessions = useSessionStore.getState().getSessionsForProject("proj-1", "plan-chat")
    expect(planSessions).toHaveLength(1)
    expect(planSessions[0].type).toBe("plan-chat")

    const allSessions = useSessionStore.getState().getSessionsForProject("proj-1")
    expect(allSessions).toHaveLength(2)
  })

  it("deleteSession removes a session", () => {
    const store = useSessionStore.getState()
    const session = store.createSession({ type: "plan-chat", projectId: "proj-1" })

    useSessionStore.getState().deleteSession(session.id)

    const retrieved = useSessionStore.getState().getSession(session.id)
    expect(retrieved).toBeUndefined()
  })
})

describe("session store - multi-session history", () => {
  beforeEach(() => {
    resetStore()
  })

  it("createNewSession marks old sessions as completed", () => {
    const store = useSessionStore.getState()

    // Create first session
    const s1 = store.createSession({ type: "plan-chat", projectId: "proj-1" })
    expect(s1.status).toBe("active")

    // Create a NEW session (should complete the old one)
    const s2 = useSessionStore.getState().createNewSession({ type: "plan-chat", projectId: "proj-1" })

    const s1After = useSessionStore.getState().getSession(s1.id)
    expect(s1After?.status).toBe("completed")
    expect(s1After?.completedAt).toBeDefined()

    expect(s2.status).toBe("active")
  })

  it("createNewSession only completes same type/project sessions", () => {
    const store = useSessionStore.getState()

    const planChat = store.createSession({ type: "plan-chat", projectId: "proj-1" })
    const taskChat = store.createSession({ type: "task-chat", projectId: "proj-1", nodeId: "n1" })
    const otherProject = store.createSession({ type: "plan-chat", projectId: "proj-2" })

    // Create new plan-chat for proj-1
    useSessionStore.getState().createNewSession({ type: "plan-chat", projectId: "proj-1" })

    // planChat should be completed
    expect(useSessionStore.getState().getSession(planChat.id)?.status).toBe("completed")

    // Others should remain active
    expect(useSessionStore.getState().getSession(taskChat.id)?.status).toBe("active")
    expect(useSessionStore.getState().getSession(otherProject.id)?.status).toBe("active")
  })

  it("all sessions are preserved and accessible after creating new ones", () => {
    const store = useSessionStore.getState()

    const s1 = store.createSession({ type: "plan-chat", projectId: "proj-1" })
    useSessionStore.getState().addMessage(s1.id, { role: "user", content: "First conversation" })
    useSessionStore.getState().addMessage(s1.id, { role: "assistant", content: "Response 1" })

    const s2 = useSessionStore.getState().createNewSession({ type: "plan-chat", projectId: "proj-1" })
    useSessionStore.getState().addMessage(s2.id, { role: "user", content: "Second conversation" })

    // Both sessions should be accessible
    const sessions = useSessionStore.getState().getSessionsForProject("proj-1", "plan-chat")
    expect(sessions).toHaveLength(2)

    // First session's messages should be preserved
    const first = useSessionStore.getState().getSession(s1.id)
    expect(first?.messages).toHaveLength(2)
    expect(first?.messages[0].content).toBe("First conversation")

    // Second session has its own messages
    const second = useSessionStore.getState().getSession(s2.id)
    expect(second?.messages).toHaveLength(1)
    expect(second?.messages[0].content).toBe("Second conversation")
  })
})

describe("session store - active session tracking", () => {
  beforeEach(() => {
    resetStore()
  })

  it("getActiveSessionId returns undefined when none set", () => {
    const store = useSessionStore.getState()
    expect(store.getActiveSessionId("proj-1", "plan-chat")).toBeUndefined()
  })

  it("setActiveSessionId persists and retrieves", () => {
    const store = useSessionStore.getState()
    store.setActiveSessionId("proj-1", "plan-chat", "session-abc")

    expect(useSessionStore.getState().getActiveSessionId("proj-1", "plan-chat")).toBe("session-abc")
  })

  it("active sessions are scoped per project+type", () => {
    const store = useSessionStore.getState()

    store.setActiveSessionId("proj-1", "plan-chat", "session-1")
    store.setActiveSessionId("proj-1", "task-chat", "session-2")
    store.setActiveSessionId("proj-2", "plan-chat", "session-3")

    expect(useSessionStore.getState().getActiveSessionId("proj-1", "plan-chat")).toBe("session-1")
    expect(useSessionStore.getState().getActiveSessionId("proj-1", "task-chat")).toBe("session-2")
    expect(useSessionStore.getState().getActiveSessionId("proj-2", "plan-chat")).toBe("session-3")
  })

  it("clearActiveSessionId removes the active session", () => {
    const store = useSessionStore.getState()
    store.setActiveSessionId("proj-1", "plan-chat", "session-abc")
    store.clearActiveSessionId("proj-1", "plan-chat")

    expect(useSessionStore.getState().getActiveSessionId("proj-1", "plan-chat")).toBeUndefined()
  })

  it("switching between sessions preserves each session's state", () => {
    const store = useSessionStore.getState()

    // Create two sessions and add messages
    const s1 = store.createSession({ type: "plan-chat", projectId: "proj-1" })
    useSessionStore.getState().addMessage(s1.id, { role: "user", content: "Session 1 msg" })

    const s2 = useSessionStore.getState().createSession({ type: "plan-chat", projectId: "proj-1" })
    useSessionStore.getState().addMessage(s2.id, { role: "user", content: "Session 2 msg" })

    // Set active to s1
    useSessionStore.getState().setActiveSessionId("proj-1", "plan-chat", s1.id)
    expect(useSessionStore.getState().getActiveSessionId("proj-1", "plan-chat")).toBe(s1.id)

    // Switch to s2
    useSessionStore.getState().setActiveSessionId("proj-1", "plan-chat", s2.id)
    expect(useSessionStore.getState().getActiveSessionId("proj-1", "plan-chat")).toBe(s2.id)

    // Both sessions still intact
    expect(useSessionStore.getState().getSession(s1.id)?.messages[0].content).toBe("Session 1 msg")
    expect(useSessionStore.getState().getSession(s2.id)?.messages[0].content).toBe("Session 2 msg")
  })
})

describe("session store - rename and message operations", () => {
  beforeEach(() => {
    resetStore()
  })

  it("renameSession sets the title field", () => {
    const store = useSessionStore.getState()
    const session = store.createSession({ type: "plan-chat", projectId: "proj-1" })

    useSessionStore.getState().renameSession(session.id, "Custom Title")

    const updated = useSessionStore.getState().getSession(session.id)
    expect(updated?.title).toBe("Custom Title")
  })

  it("renamed session title shows in getSessionTitle", () => {
    const store = useSessionStore.getState()
    const session = store.createSession({ type: "plan-chat", projectId: "proj-1" })
    useSessionStore.getState().addMessage(session.id, { role: "user", content: "Some question" })

    // Before rename - should show message preview
    const beforeTitle = getSessionTitle(useSessionStore.getState().getSession(session.id)!)
    expect(beforeTitle).toBe("Some question")

    // After rename - should show custom title
    useSessionStore.getState().renameSession(session.id, "My Research Session")
    const afterTitle = getSessionTitle(useSessionStore.getState().getSession(session.id)!)
    expect(afterTitle).toBe("My Research Session")
  })

  it("addMessage adds messages with auto-generated IDs", () => {
    const store = useSessionStore.getState()
    const session = store.createSession({ type: "plan-chat", projectId: "proj-1" })

    useSessionStore.getState().addMessage(session.id, { role: "user", content: "Hello" })
    useSessionStore.getState().addMessage(session.id, { role: "assistant", content: "Hi!" })

    const updated = useSessionStore.getState().getSession(session.id)
    expect(updated?.messages).toHaveLength(2)
    expect(updated?.messages[0].id).toBeTruthy()
    expect(updated?.messages[0].role).toBe("user")
    expect(updated?.messages[0].content).toBe("Hello")
    expect(updated?.messages[1].role).toBe("assistant")
    expect(updated?.messages[1].content).toBe("Hi!")
  })

  it("appendToLastAssistantMessage streams content", () => {
    const store = useSessionStore.getState()
    const session = store.createSession({ type: "plan-chat", projectId: "proj-1" })

    useSessionStore.getState().addMessage(session.id, { role: "assistant", content: "" })
    useSessionStore.getState().appendToLastAssistantMessage(session.id, "Hello ")
    useSessionStore.getState().appendToLastAssistantMessage(session.id, "world!")

    const updated = useSessionStore.getState().getSession(session.id)
    expect(updated?.messages[0].content).toBe("Hello world!")
  })

  it("appendToLastAssistantMessage ignores if last message is not assistant", () => {
    const store = useSessionStore.getState()
    const session = store.createSession({ type: "plan-chat", projectId: "proj-1" })

    useSessionStore.getState().addMessage(session.id, { role: "user", content: "Hi" })
    useSessionStore.getState().appendToLastAssistantMessage(session.id, "should not work")

    const updated = useSessionStore.getState().getSession(session.id)
    expect(updated?.messages).toHaveLength(1)
    expect(updated?.messages[0].content).toBe("Hi")
  })

  it("setStatus updates session status and sets completedAt for terminal states", () => {
    const store = useSessionStore.getState()
    const session = store.createSession({ type: "plan-chat", projectId: "proj-1" })

    useSessionStore.getState().setStatus(session.id, "completed")

    const updated = useSessionStore.getState().getSession(session.id)
    expect(updated?.status).toBe("completed")
    expect(updated?.completedAt).toBeDefined()
  })

  it("setProviderSessionId links session to provider", () => {
    const store = useSessionStore.getState()
    const session = store.createSession({ type: "plan-chat", projectId: "proj-1" })

    useSessionStore.getState().setProviderSessionId(session.id, "provider-xyz-123")

    const updated = useSessionStore.getState().getSession(session.id)
    expect(updated?.providerSessionId).toBe("provider-xyz-123")
  })
})

describe("session store - node-scoped sessions", () => {
  beforeEach(() => {
    resetStore()
  })

  it("getSessionsForNode returns sessions for a specific node", () => {
    const store = useSessionStore.getState()
    store.createSession({ type: "task-chat", projectId: "proj-1", nodeId: "node-1" })
    store.createSession({ type: "task-chat", projectId: "proj-1", nodeId: "node-2" })
    store.createSession({ type: "execution", projectId: "proj-1", nodeId: "node-1" })

    const node1Sessions = useSessionStore.getState().getSessionsForNode("node-1")
    expect(node1Sessions).toHaveLength(2)

    const node1TaskChats = useSessionStore.getState().getSessionsForNode("node-1", "task-chat")
    expect(node1TaskChats).toHaveLength(1)
  })

  it("clearSessionsForNode removes all sessions for a node", () => {
    const store = useSessionStore.getState()
    const s1 = store.createSession({ type: "task-chat", projectId: "proj-1", nodeId: "node-1" })
    const s2 = store.createSession({ type: "execution", projectId: "proj-1", nodeId: "node-1" })
    const s3 = store.createSession({ type: "task-chat", projectId: "proj-1", nodeId: "node-2" })

    useSessionStore.getState().clearSessionsForNode("node-1")

    expect(useSessionStore.getState().getSession(s1.id)).toBeUndefined()
    expect(useSessionStore.getState().getSession(s2.id)).toBeUndefined()
    expect(useSessionStore.getState().getSession(s3.id)).toBeDefined() // different node
  })
})
