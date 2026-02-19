import type { Project, PlanNode, PlanEdge, UserProfile, ApiKey, Initiative, TaskExecution } from "@/types"
import type { DisplaySettings, ViewKey } from "@/stores/display-settings-store"
import type { SessionMetrics } from "@/stores/usage-store"
import type { TaskChatMessage, TaskChatSession } from "@/stores/task-chat-store"
import { getAccessToken, shouldUseSupabase } from "./supabase-client"

const BASE = "/api/data"

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }
  return headers
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  // In IndexedDB-only mode, throw immediately to trigger fallback
  if (!shouldUseSupabase()) {
    throw new Error('IndexedDB-only mode: skipping API call')
  }

  const headers = await getAuthHeaders()
  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...init?.headers,
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function post(url: string, body: unknown) {
  const headers = await getAuthHeaders()
  return json(url, { method: "POST", headers, body: JSON.stringify(body) })
}

async function patch(url: string, body: unknown) {
  const headers = await getAuthHeaders()
  return json(url, { method: "PATCH", headers, body: JSON.stringify(body) })
}

async function put(url: string, body: unknown) {
  const headers = await getAuthHeaders()
  return json(url, { method: "PUT", headers, body: JSON.stringify(body) })
}

async function del(url: string) {
  const headers = await getAuthHeaders()
  return json(url, { method: "DELETE", headers })
}

// Drizzle returns timestamps as strings or numbers — normalize to Date
function toDate(v: unknown): Date {
  if (v instanceof Date) return v
  if (typeof v === "string" || typeof v === "number") return new Date(v)
  return new Date()
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    ...row,
    createdAt: toDate(row.createdAt ?? row.created_at),
    updatedAt: toDate(row.updatedAt ?? row.updated_at),
    labels: (row.labels as Project["labels"]) ?? [],
  } as Project
}

function mapInitiative(row: Record<string, unknown>): Initiative {
  return {
    ...row,
    createdAt: toDate(row.createdAt ?? row.created_at),
    updatedAt: toDate(row.updatedAt ?? row.updated_at),
  } as Initiative
}

function mapNode(row: Record<string, unknown>): PlanNode {
  return {
    ...row,
    dependencies: (row.dependencies as string[]) ?? [],
    position: row.position as { x: number; y: number },
    labelIds: (row.labelIds as string[]) ?? undefined,
    createdAt: toDate(row.createdAt ?? row.created_at),
    updatedAt: toDate(row.updatedAt ?? row.updated_at),
    executionStartedAt: row.executionStartedAt ? toDate(row.executionStartedAt) : undefined,
    executionCompletedAt: row.executionCompletedAt ? toDate(row.executionCompletedAt) : undefined,
    branchName: (row.branchName as string) ?? undefined,
    prUrl: (row.prUrl as string) ?? undefined,
    prNumber: (row.prNumber as number) ?? undefined,
  } as PlanNode
}

function mapEdge(row: Record<string, unknown>): PlanEdge {
  return {
    id: row.id as string,
    source: row.source as string,
    target: row.target as string,
    type: (row.type as PlanEdge["type"]) ?? "dependency",
  }
}

function mapApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: row.id as string,
    provider: row.provider as string,
    name: row.name as string,
    maskedKey: (row.maskedKey ?? row.masked_key) as string,
    createdAt: toDate(row.createdAt ?? row.created_at),
  }
}

function mapProfile(row: Record<string, unknown>): UserProfile {
  return {
    id: row.id as string,
    name: (row.name as string) ?? "",
    email: (row.email as string) ?? "",
    avatarUrl: (row.avatarUrl ?? row.avatar_url) as string | undefined,
    bio: (row.bio as string) ?? "",
    domains: (row.domains as UserProfile["domains"]) ?? [],
    experienceLevel: (row.experienceLevel ?? row.experience_level ?? "intermediate") as UserProfile["experienceLevel"],
    preferredEnvironments: (row.preferredEnvironments ?? row.preferred_environments ?? ["local"]) as UserProfile["preferredEnvironments"],
    notificationsEnabled: (row.notificationsEnabled ?? row.notifications_enabled ?? true) as boolean,
    emailNotifications: (row.emailNotifications ?? row.email_notifications ?? false) as boolean,
    apiKeys: ((row.apiKeys ?? row.api_keys) as Record<string, unknown>[] ?? []).map(mapApiKey),
    createdAt: toDate(row.createdAt ?? row.created_at),
    updatedAt: toDate(row.updatedAt ?? row.updated_at),
  }
}

function mapChatMessage(m: Record<string, unknown>): TaskChatMessage {
  return {
    id: m.id as string,
    role: m.role as "user" | "assistant",
    content: m.content as string,
    timestamp: toDate(m.timestamp),
  }
}

function mapChatEntry(entry: { session: Record<string, unknown>; messages: Record<string, unknown>[] }): { session: TaskChatSession; messages: TaskChatMessage[] } {
  return {
    session: {
      nodeId: entry.session.nodeId as string ?? entry.session.node_id as string,
      projectId: entry.session.projectId as string ?? entry.session.project_id as string,
      sessionId: (entry.session.sessionId ?? entry.session.session_id) as string | undefined,
      messages: [],
      createdAt: toDate(entry.session.createdAt ?? entry.session.created_at),
      updatedAt: toDate(entry.session.updatedAt ?? entry.session.updated_at),
    },
    messages: entry.messages.map(mapChatMessage),
  }
}

export const dataClient = {
  // ── Projects ────────────────────────────────────────────────────────
  async listProjects(): Promise<Project[]> {
    const rows = await json<Record<string, unknown>[]>(`${BASE}/projects`)
    return rows.map(mapProject)
  },

  async createProject(project: Project): Promise<Project> {
    const row = await post(`${BASE}/projects`, project) as Record<string, unknown>
    return mapProject(row)
  },

  async getProject(id: string): Promise<Project> {
    const row = await json<Record<string, unknown>>(`${BASE}/projects/${id}`)
    return mapProject(row)
  },

  async updateProject(id: string, patch_: Partial<Project>): Promise<Project> {
    const row = await patch(`${BASE}/projects/${id}`, patch_) as Record<string, unknown>
    return mapProject(row)
  },

  async deleteProject(id: string): Promise<void> {
    await del(`${BASE}/projects/${id}`)
  },

  // ── Initiatives ─────────────────────────────────────────────────────
  async listInitiatives(): Promise<Initiative[]> {
    const rows = await json<Record<string, unknown>[]>(`${BASE}/initiatives`)
    return rows.map(mapInitiative)
  },

  async createInitiative(initiative: Initiative): Promise<Initiative> {
    const row = await post(`${BASE}/initiatives`, initiative) as Record<string, unknown>
    return mapInitiative(row)
  },

  async getInitiative(id: string): Promise<Initiative> {
    const row = await json<Record<string, unknown>>(`${BASE}/initiatives/${id}`)
    return mapInitiative(row)
  },

  async updateInitiative(id: string, patch_: Partial<Initiative>): Promise<Initiative> {
    const row = await patch(`${BASE}/initiatives/${id}`, patch_) as Record<string, unknown>
    return mapInitiative(row)
  },

  async deleteInitiative(id: string): Promise<void> {
    await del(`${BASE}/initiatives/${id}`)
  },

  // ── Plan ────────────────────────────────────────────────────────────
  async getAllPlans(): Promise<{ nodes: PlanNode[]; edges: PlanEdge[] }> {
    const data = await json<{ nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }>(`${BASE}/plan`)
    return { nodes: data.nodes.map(mapNode), edges: data.edges.map(mapEdge) }
  },

  async getProjectPlan(projectId: string): Promise<{ nodes: PlanNode[]; edges: PlanEdge[] }> {
    const data = await json<{ nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }>(`${BASE}/plan/${projectId}`)
    return { nodes: data.nodes.map(mapNode), edges: data.edges.map(mapEdge) }
  },

  async setProjectPlan(projectId: string, nodes: PlanNode[], edges: PlanEdge[]): Promise<void> {
    await put(`${BASE}/plan/${projectId}`, { nodes, edges })
  },

  async addNode(node: PlanNode): Promise<void> {
    await post(`${BASE}/plan/nodes`, node)
  },

  async updateNode(id: string, patch_: Partial<PlanNode>): Promise<void> {
    await patch(`${BASE}/plan/nodes/${id}`, patch_)
  },

  async deleteNode(id: string): Promise<void> {
    await del(`${BASE}/plan/nodes/${id}`)
  },

  async addEdge(edge: PlanEdge & { projectId: string }): Promise<void> {
    await post(`${BASE}/plan/edges`, edge)
  },

  async deleteEdge(id: string): Promise<void> {
    await del(`${BASE}/plan/edges/${id}`)
  },

  // ── Profile ─────────────────────────────────────────────────────────
  async getProfile(): Promise<UserProfile | null> {
    const row = await json<Record<string, unknown> | null>(`${BASE}/profile`)
    if (!row) return null
    return mapProfile(row)
  },

  async updateProfile(profile: Partial<UserProfile> & { apiKeys?: ApiKey[] }): Promise<UserProfile> {
    const row = await put(`${BASE}/profile`, profile) as Record<string, unknown>
    return mapProfile(row)
  },

  // ── Display Settings ────────────────────────────────────────────────
  async getDisplaySettings(): Promise<Record<string, DisplaySettings>> {
    return json<Record<string, DisplaySettings>>(`${BASE}/display-settings`)
  },

  async updateDisplaySetting(view: ViewKey, settings: Partial<DisplaySettings>): Promise<void> {
    await patch(`${BASE}/display-settings/${view}`, settings)
  },

  // ── Usage ───────────────────────────────────────────────────────────
  async getTodayUsage(): Promise<SessionMetrics> {
    return json<SessionMetrics>(`${BASE}/usage/today`)
  },

  async incrementUsage(metrics: Partial<SessionMetrics>): Promise<void> {
    await post(`${BASE}/usage/increment`, metrics)
  },

  // ── Chat ────────────────────────────────────────────────────────────
  async getAllChats(): Promise<Record<string, { session: TaskChatSession; messages: TaskChatMessage[] }>> {
    type RawEntry = { session: Record<string, unknown>; messages: Record<string, unknown>[] }
    const data = await json<Record<string, RawEntry>>(`${BASE}/chat`)

    const result: Record<string, { session: TaskChatSession; messages: TaskChatMessage[] }> = {}
    for (const [nodeId, entry] of Object.entries(data)) {
      result[nodeId] = mapChatEntry(entry)
    }
    return result
  },

  async getChatSession(nodeId: string): Promise<{ session: TaskChatSession; messages: TaskChatMessage[] } | null> {
    type RawEntry = { session: Record<string, unknown>; messages: Record<string, unknown>[] } | null
    const data = await json<RawEntry>(`${BASE}/chat/${nodeId}`)
    if (!data) return null
    return mapChatEntry(data)
  },

  async createChatSession(nodeId: string, projectId: string, sessionId?: string): Promise<void> {
    await post(`${BASE}/chat/${nodeId}/session`, { projectId, sessionId })
  },

  async addChatMessage(nodeId: string, msg: TaskChatMessage): Promise<void> {
    await post(`${BASE}/chat/${nodeId}/messages`, msg)
  },

  async updateChatSessionId(nodeId: string, sessionId: string): Promise<void> {
    await patch(`${BASE}/chat/${nodeId}/session`, { sessionId })
  },

  async deleteChatSession(nodeId: string): Promise<void> {
    await del(`${BASE}/chat/${nodeId}`)
  },

  // ── Sessions ────────────────────────────────────────────────────────
  async getAllSessions(): Promise<import("@/types").Session[]> {
    const rows = await json<Record<string, unknown>[]>(`${BASE}/sessions`)
    return rows.map(row => ({
      ...row,
      createdAt: toDate(row.createdAt ?? row.created_at),
      updatedAt: toDate(row.updatedAt ?? row.updated_at),
      completedAt: row.completedAt ? toDate(row.completedAt) : undefined,
      messages: (row.messages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      steerMessages: (row.steerMessages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      activityEvents: (row.activityEvents as Array<Record<string, unknown>> ?? []).map(e => ({
        ...e,
        timestamp: toDate(e.timestamp),
      })),
      toolTraces: (row.toolTraces as Array<Record<string, unknown>> ?? []).map(t => ({
        ...t,
        timestamp: toDate(t.timestamp),
      })),
      fileChanges: (row.fileChanges as Array<Record<string, unknown>> ?? []).map(f => ({
        ...f,
        timestamp: toDate(f.timestamp),
      })),
    })) as import("@/types").Session[]
  },

  async getSession(sessionId: string): Promise<import("@/types").Session | null> {
    const row = await json<Record<string, unknown> | null>(`${BASE}/sessions/${sessionId}`)
    if (!row) return null
    return {
      ...row,
      createdAt: toDate(row.createdAt ?? row.created_at),
      updatedAt: toDate(row.updatedAt ?? row.updated_at),
      completedAt: row.completedAt ? toDate(row.completedAt) : undefined,
      messages: (row.messages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      steerMessages: (row.steerMessages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      activityEvents: (row.activityEvents as Array<Record<string, unknown>> ?? []).map(e => ({
        ...e,
        timestamp: toDate(e.timestamp),
      })),
      toolTraces: (row.toolTraces as Array<Record<string, unknown>> ?? []).map(t => ({
        ...t,
        timestamp: toDate(t.timestamp),
      })),
      fileChanges: (row.fileChanges as Array<Record<string, unknown>> ?? []).map(f => ({
        ...f,
        timestamp: toDate(f.timestamp),
      })),
    } as import("@/types").Session
  },

  async createSession(session: import("@/types").Session): Promise<import("@/types").Session> {
    const row = await post(`${BASE}/sessions`, session) as Record<string, unknown>
    return {
      ...row,
      createdAt: toDate(row.createdAt ?? row.created_at),
      updatedAt: toDate(row.updatedAt ?? row.updated_at),
      completedAt: row.completedAt ? toDate(row.completedAt) : undefined,
      messages: (row.messages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      steerMessages: (row.steerMessages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      activityEvents: (row.activityEvents as Array<Record<string, unknown>> ?? []).map(e => ({
        ...e,
        timestamp: toDate(e.timestamp),
      })),
      toolTraces: (row.toolTraces as Array<Record<string, unknown>> ?? []).map(t => ({
        ...t,
        timestamp: toDate(t.timestamp),
      })),
      fileChanges: (row.fileChanges as Array<Record<string, unknown>> ?? []).map(f => ({
        ...f,
        timestamp: toDate(f.timestamp),
      })),
    } as import("@/types").Session
  },

  async updateSession(sessionId: string, updates: Partial<import("@/types").Session>): Promise<void> {
    await patch(`${BASE}/sessions/${sessionId}`, updates)
  },

  async deleteSession(sessionId: string): Promise<void> {
    await del(`${BASE}/sessions/${sessionId}`)
  },

  async addSessionMessage(sessionId: string, message: import("@/types").SessionMessage): Promise<void> {
    await post(`${BASE}/sessions/${sessionId}/messages`, message)
  },

  // ── Executions ──────────────────────────────────────────────────────
  async getExecutions(): Promise<Record<string, TaskExecution>> {
    const rows = await json<Record<string, Record<string, unknown>>>(`${BASE}/executions`)
    const result: Record<string, TaskExecution> = {}
    for (const [nodeId, row] of Object.entries(rows)) {
      result[nodeId] = {
        ...row,
        startedAt: toDate(row.startedAt ?? row.started_at),
        completedAt: row.completedAt ? toDate(row.completedAt) : undefined,
        toolTraces: (row.toolTraces as Array<Record<string, unknown>> ?? []).map(t => ({
          ...t,
          timestamp: toDate(t.timestamp),
        })),
        fileChanges: (row.fileChanges as Array<Record<string, unknown>> ?? []).map(f => ({
          ...f,
          timestamp: toDate(f.timestamp),
        })),
        activityEvents: (row.activityEvents as Array<Record<string, unknown>> ?? []).map(e => ({
          ...e,
          timestamp: toDate(e.timestamp),
        })),
      } as TaskExecution
    }
    return result
  },

  async saveExecution(execution: TaskExecution): Promise<void> {
    await post(`${BASE}/executions`, execution)
  },

  // ── Settings ────────────────────────────────────────────────────────
  async getSettings(): Promise<Record<string, string>> {
    return json<Record<string, string>>(`${BASE}/settings`)
  },

  async updateSettings(settings: Record<string, string>): Promise<void> {
    await patch(`${BASE}/settings`, settings)
  },
}
