import type { Project, PlanNode, PlanEdge, UserProfile, ApiKey } from "@/types"
import type { DisplaySettings, ViewKey } from "@/stores/display-settings-store"
import type { SessionMetrics } from "@/stores/usage-store"
import type { TaskChatMessage, TaskChatSession } from "@/stores/task-chat-store"

const BASE = "/api/data"

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

function post(url: string, body: unknown) {
  return json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

function patch(url: string, body: unknown) {
  return json(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

function put(url: string, body: unknown) {
  return json(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

function del(url: string) {
  return json(url, { method: "DELETE" })
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
    type RawSession = Record<string, unknown>
    type RawMessage = Record<string, unknown>
    const data = await json<Record<string, { session: RawSession; messages: RawMessage[] }>>(`${BASE}/chat`)

    const result: Record<string, { session: TaskChatSession; messages: TaskChatMessage[] }> = {}
    for (const [nodeId, entry] of Object.entries(data)) {
      result[nodeId] = {
        session: {
          nodeId: entry.session.nodeId as string ?? entry.session.node_id as string,
          projectId: entry.session.projectId as string ?? entry.session.project_id as string,
          sessionId: (entry.session.sessionId ?? entry.session.session_id) as string | undefined,
          messages: [], // messages stored separately
          createdAt: toDate(entry.session.createdAt ?? entry.session.created_at),
          updatedAt: toDate(entry.session.updatedAt ?? entry.session.updated_at),
        },
        messages: entry.messages.map((m) => ({
          id: m.id as string,
          role: m.role as "user" | "assistant",
          content: m.content as string,
          timestamp: toDate(m.timestamp),
        })),
      }
    }
    return result
  },

  async getChatSession(nodeId: string): Promise<{ session: TaskChatSession; messages: TaskChatMessage[] } | null> {
    type RawResult = { session: Record<string, unknown>; messages: Record<string, unknown>[] } | null
    const data = await json<RawResult>(`${BASE}/chat/${nodeId}`)
    if (!data) return null
    return {
      session: {
        nodeId: data.session.nodeId as string ?? data.session.node_id as string,
        projectId: data.session.projectId as string ?? data.session.project_id as string,
        sessionId: (data.session.sessionId ?? data.session.session_id) as string | undefined,
        messages: [],
        createdAt: toDate(data.session.createdAt ?? data.session.created_at),
        updatedAt: toDate(data.session.updatedAt ?? data.session.updated_at),
      },
      messages: data.messages.map((m) => ({
        id: m.id as string,
        role: m.role as "user" | "assistant",
        content: m.content as string,
        timestamp: toDate(m.timestamp),
      })),
    }
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

  // ── Settings ────────────────────────────────────────────────────────
  async getSettings(): Promise<Record<string, string>> {
    return json<Record<string, string>>(`${BASE}/settings`)
  },

  async updateSettings(settings: Record<string, string>): Promise<void> {
    await patch(`${BASE}/settings`, settings)
  },
}
