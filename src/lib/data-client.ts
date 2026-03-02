import type { Project, PlanNode, PlanEdge, UserProfile, ApiKey, Initiative, TaskExecution, Team, TeamMember, NodeComment, EnvironmentConfig } from "@/types"
import type { DisplaySettings, ViewKey } from "@/stores/display-settings-store"
import type { SessionMetrics } from "@/stores/usage-store"
import type { TaskChatMessage, TaskChatSession } from "@/stores/task-chat-store"
import type { Activity } from "@/stores/activity-store"
import type { SkillRow } from "@/stores/skill-store"
import { getAccessToken } from "./supabase-client"
import { snakeToCamel } from "./utils"
import { apiUrl } from "./api-url"

const BASE = "/api/data"

/**
 * Active team ID setter/getter.
 * The team store calls setActiveTeamId() after loading teams.
 * This avoids circular imports between data-client and team-store.
 */
let _activeTeamId: string | undefined
export function setActiveTeamId(teamId: string | undefined) {
  _activeTeamId = teamId
}
function getActiveTeamId(): string | undefined {
  return _activeTeamId
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }
  const teamId = getActiveTeamId()
  if (teamId) {
    headers["X-Team-Id"] = teamId
  }
  return headers
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(apiUrl(url), {
      ...init,
      headers: {
        ...headers,
        ...init?.headers,
      },
      signal: init?.signal ?? controller.signal,
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json() as Promise<T>
  } finally {
    clearTimeout(timeout)
  }
}

async function post(url: string, body: unknown) {
  const headers = await getAuthHeaders()
  return json(url, { method: "POST", headers, body: JSON.stringify(body) })
}

async function patch(url: string, body: unknown) {
  const headers = await getAuthHeaders()
  return json(url, { method: "PATCH", headers, body: JSON.stringify(body) })
}

/**
 * PATCH with undefined→null serialization.
 * JSON.stringify normally strips undefined, but when clearing fields (e.g. resetting
 * executionId to undefined), we need to send null so the server actually clears them.
 * Use this only when the body explicitly contains undefined values that mean "clear".
 */
async function patchWithNulls(url: string, body: unknown) {
  const headers = await getAuthHeaders()
  const serialized = JSON.stringify(body, (_key, value) => value === undefined ? null : value)
  return json(url, { method: "PATCH", headers, body: serialized })
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
  const r = snakeToCamel(row)
  return {
    ...r,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
    labels: (r.labels as Project["labels"]) ?? [],
    source: r.source as Project["source"],
    deliveryMode: (['pr', 'push', 'branch', 'copy', 'direct'].includes(r.deliveryMode as string) ? r.deliveryMode : undefined) as Project["deliveryMode"],
  } as Project
}

function mapInitiative(row: Record<string, unknown>): Initiative {
  const r = snakeToCamel(row)
  return {
    ...r,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  } as Initiative
}

function mapNode(row: Record<string, unknown>): PlanNode {
  const r = snakeToCamel(row)
  return {
    ...r,
    dependencies: (r.dependencies as string[]) ?? [],
    position: r.position as { x: number; y: number },
    labelIds: (r.labelIds as string[]) ?? undefined,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
    executionStartedAt: r.executionStartedAt ? toDate(r.executionStartedAt) : undefined,
    executionCompletedAt: r.executionCompletedAt ? toDate(r.executionCompletedAt) : undefined,
    actualStartDate: r.actualStartDate ? toDate(r.actualStartDate) : undefined,
    actualEndDate: r.actualEndDate ? toDate(r.actualEndDate) : undefined,
    branchName: (r.branchName as string) ?? undefined,
    prUrl: (r.prUrl as string) ?? undefined,
    prNumber: (r.prNumber as number) ?? undefined,
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
  const r = snakeToCamel(row)
  return {
    id: r.id as string,
    provider: r.provider as string,
    name: r.name as string,
    maskedKey: r.maskedKey as string,
    createdAt: toDate(r.createdAt),
  }
}

function mapProfile(row: Record<string, unknown>): UserProfile {
  const r = snakeToCamel(row)
  return {
    id: r.id as string,
    name: (r.name as string) ?? "",
    email: (r.email as string) ?? "",
    avatarUrl: r.avatarUrl as string | undefined,
    bio: (r.bio as string) ?? "",
    domains: (r.domains as UserProfile["domains"]) ?? [],
    experienceLevel: (r.experienceLevel ?? "intermediate") as UserProfile["experienceLevel"],
    preferredMachines: (r.preferredMachines ?? []) as UserProfile["preferredMachines"],
    notificationsEnabled: (r.notificationsEnabled ?? true) as boolean,
    emailNotifications: (r.emailNotifications ?? false) as boolean,
    defaultMachineId: r.defaultMachineId as string | undefined,
    apiKeys: ((r.apiKeys as Record<string, unknown>[]) ?? []).map(mapApiKey),
    sidebarConfig: r.sidebarConfig as UserProfile["sidebarConfig"],
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
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
  const s = snakeToCamel(entry.session)
  return {
    session: {
      nodeId: s.nodeId as string,
      projectId: s.projectId as string,
      sessionId: s.sessionId as string | undefined,
      messages: [],
      createdAt: toDate(s.createdAt),
      updatedAt: toDate(s.updatedAt),
    },
    messages: entry.messages.map(mapChatMessage),
  }
}

function mapSkillRow(row: Record<string, unknown>): SkillRow {
  const r = snakeToCamel(row)
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? '',
    instructions: (r.instructions as string) ?? '',
    source: (r.source as SkillRow['source']) ?? 'builtin',
    enabled: (r.enabled as boolean) ?? true,
    userInvocable: (r.userInvocable as boolean) ?? true,
    pluginId: r.pluginId as string | undefined,
    config: (r.config as Record<string, unknown>) ?? undefined,
    version: (r.version as string) ?? '1.0.0',
    category: (r.category as string) ?? undefined,
    tags: (r.tags as string[]) ?? [],
    allowedTools: (r.allowedTools as string[]) ?? [],
    sourceUrl: (r.sourceUrl as string) ?? undefined,
    createdAt: r.createdAt ? toDate(r.createdAt) : undefined,
    updatedAt: r.updatedAt ? toDate(r.updatedAt) : undefined,
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

  async setProjectPlan(projectId: string, nodes: PlanNode[], edges: PlanEdge[]): Promise<Record<string, number>> {
    const res = await put(`${BASE}/plan/${projectId}`, { nodes, edges }) as { ok: boolean; numbers?: Record<string, number> }
    return res.numbers ?? {}
  },

  async addNode(node: PlanNode): Promise<{ number?: number }> {
    const res = await post(`${BASE}/plan/nodes`, node) as { ok: boolean; number?: number }
    return { number: res.number }
  },

  async updateNode(id: string, patch_: Partial<PlanNode>): Promise<void> {
    // Use patchWithNulls so that undefined fields (e.g. clearing executionId) are sent as null
    await patchWithNulls(`${BASE}/plan/nodes/${id}`, patch_)
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
    console.log('[data-client] getProfile() called')
    try {
      const row = await json<Record<string, unknown> | null>(`${BASE}/profile`)
      console.log('[data-client] getProfile() raw response:', row ? { id: row.id, name: row.name, display_name: row.display_name } : null)
      if (!row) return null
      return mapProfile(row)
    } catch (err) {
      console.error('[data-client] getProfile() error:', (err as Error).message)
      throw err
    }
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
    return rows.map(row => {
      const r = snakeToCamel(row)
      return {
        ...r,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
        completedAt: r.completedAt ? toDate(r.completedAt) : undefined,
        messages: (r.messages as Array<Record<string, unknown>> ?? []).map(m => ({
          ...m,
          timestamp: toDate(m.timestamp),
        })),
        steerMessages: (r.steerMessages as Array<Record<string, unknown>> ?? []).map(m => ({
          ...m,
          timestamp: toDate(m.timestamp),
        })),
        activityEvents: (r.activityEvents as Array<Record<string, unknown>> ?? []).map(e => ({
          ...e,
          timestamp: toDate(e.timestamp),
        })),
        toolTraces: (r.toolTraces as Array<Record<string, unknown>> ?? []).map(t => ({
          ...t,
          timestamp: toDate(t.timestamp),
        })),
        fileChanges: (r.fileChanges as Array<Record<string, unknown>> ?? []).map(f => ({
          ...f,
          timestamp: toDate(f.timestamp),
        })),
      }
    }) as import("@/types").Session[]
  },

  async getSession(sessionId: string): Promise<import("@/types").Session | null> {
    const row = await json<Record<string, unknown> | null>(`${BASE}/sessions/${sessionId}`)
    if (!row) return null
    const r = snakeToCamel(row)
    return {
      ...r,
      createdAt: toDate(r.createdAt),
      updatedAt: toDate(r.updatedAt),
      completedAt: r.completedAt ? toDate(r.completedAt) : undefined,
      messages: (r.messages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      steerMessages: (r.steerMessages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      activityEvents: (r.activityEvents as Array<Record<string, unknown>> ?? []).map(e => ({
        ...e,
        timestamp: toDate(e.timestamp),
      })),
      toolTraces: (r.toolTraces as Array<Record<string, unknown>> ?? []).map(t => ({
        ...t,
        timestamp: toDate(t.timestamp),
      })),
      fileChanges: (r.fileChanges as Array<Record<string, unknown>> ?? []).map(f => ({
        ...f,
        timestamp: toDate(f.timestamp),
      })),
    } as import("@/types").Session
  },

  async createSession(session: import("@/types").Session): Promise<import("@/types").Session> {
    const row = await post(`${BASE}/sessions`, session) as Record<string, unknown>
    const r = snakeToCamel(row)
    return {
      ...r,
      createdAt: toDate(r.createdAt),
      updatedAt: toDate(r.updatedAt),
      completedAt: r.completedAt ? toDate(r.completedAt) : undefined,
      messages: (r.messages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      steerMessages: (r.steerMessages as Array<Record<string, unknown>> ?? []).map(m => ({
        ...m,
        timestamp: toDate(m.timestamp),
      })),
      activityEvents: (r.activityEvents as Array<Record<string, unknown>> ?? []).map(e => ({
        ...e,
        timestamp: toDate(e.timestamp),
      })),
      toolTraces: (r.toolTraces as Array<Record<string, unknown>> ?? []).map(t => ({
        ...t,
        timestamp: toDate(t.timestamp),
      })),
      fileChanges: (r.fileChanges as Array<Record<string, unknown>> ?? []).map(f => ({
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
      const r = snakeToCamel(row)
      result[nodeId] = {
        ...r,
        startedAt: toDate(r.startedAt),
        completedAt: r.completedAt ? toDate(r.completedAt) : undefined,
        toolTraces: (r.toolTraces as Array<Record<string, unknown>> ?? []).map(t => ({
          ...t,
          timestamp: toDate(t.timestamp),
        })),
        fileChanges: (r.fileChanges as Array<Record<string, unknown>> ?? []).map(f => ({
          ...f,
          timestamp: toDate(f.timestamp),
        })),
        activityEvents: (r.activityEvents as Array<Record<string, unknown>> ?? []).map(e => ({
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

  async deleteExecution(nodeId: string): Promise<void> {
    await del(`${BASE}/executions/${nodeId}`)
  },

  // ── Settings ────────────────────────────────────────────────────────
  async getSettings(): Promise<Record<string, string>> {
    return json<Record<string, string>>(`${BASE}/settings`)
  },

  async updateSettings(settings: Record<string, string>): Promise<void> {
    await patch(`${BASE}/settings`, settings)
  },

  // ── Activities ─────────────────────────────────────────────────────
  async listActivities(projectId?: string, limit = 100): Promise<Activity[]> {
    const params = new URLSearchParams()
    if (projectId) params.set('projectId', projectId)
    if (limit !== 100) params.set('limit', String(limit))
    const qs = params.toString()
    const rows = await json<Record<string, unknown>[]>(`${BASE}/activities${qs ? `?${qs}` : ''}`)
    return rows.map((row) => {
      const r = snakeToCamel(row)
      return {
        id: r.id as string,
        projectId: r.projectId as string,
        type: r.type as Activity["type"],
        title: r.title as string,
        description: (r.description as string) ?? undefined,
        nodeId: r.nodeId as string | undefined,
        metadata: (r.metadata as Record<string, unknown>) ?? undefined,
        timestamp: toDate(r.createdAt),
      }
    })
  },

  async createActivity(activity: { id: string; projectId: string; type: string; title: string; description?: string; nodeId?: string; metadata?: Record<string, unknown> }): Promise<void> {
    await post(`${BASE}/activities`, activity)
  },

  async clearProjectActivities(projectId: string): Promise<void> {
    await del(`${BASE}/activities/${projectId}`)
  },

  // ── Teams (uses /api/teams, not /api/data) ─────────────────────────
  async listTeams(): Promise<{ teams: Team[]; teamMembers: Record<string, TeamMember[]> }> {
    // GET /api/teams returns a flat array of teams with memberRole
    const rows = await json<Record<string, unknown>[]>('/api/teams')
    const teams = rows.map(row => {
      const r = snakeToCamel(row)
      return {
        ...r,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
      } as Team
    })
    // Members are loaded separately via getTeamMembers()
    return { teams, teamMembers: {} }
  },

  async createTeam(team: Partial<Team>): Promise<Team> {
    const row = await post('/api/teams', { name: team.name, description: team.description }) as Record<string, unknown>
    const r = snakeToCamel(row)
    return {
      ...r,
      createdAt: toDate(r.createdAt),
      updatedAt: toDate(r.updatedAt),
    } as Team
  },

  async updateTeam(id: string, updates: Partial<Team>): Promise<Team> {
    const row = await patch(`/api/teams/${id}`, updates) as Record<string, unknown>
    const r = snakeToCamel(row)
    return {
      ...r,
      createdAt: toDate(r.createdAt),
      updatedAt: toDate(r.updatedAt),
    } as Team
  },

  async deleteTeam(id: string): Promise<void> {
    await del(`/api/teams/${id}`)
  },

  async getTeamMembers(teamId: string): Promise<Array<TeamMember & { userName?: string; userEmail?: string }>> {
    const data = await json<{ members: Record<string, unknown>[] }>(`/api/teams/${teamId}/members`)
    return data.members.map(m => {
      const r = snakeToCamel(m)
      const user = r.user as Record<string, unknown> | undefined
      return {
        ...r,
        joinedAt: toDate(r.joinedAt),
        userName: user?.name as string | undefined,
        userEmail: user?.email as string | undefined,
      } as TeamMember & { userName?: string; userEmail?: string }
    })
  },

  async sendTeamInvite(teamId: string, email: string, role: TeamMember['role']): Promise<void> {
    await post('/api/teams/invite', { teamId, email, role })
  },

  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await del(`/api/teams/${teamId}/members/${userId}`)
  },

  async updateTeamMemberRole(teamId: string, userId: string, role: TeamMember['role']): Promise<void> {
    await patch(`/api/teams/${teamId}/members/${userId}`, { role })
  },

  async getPendingInvites(teamId: string): Promise<Array<{ id: string; token: string; email: string; role: string; createdAt: Date; expiresAt: Date; inviterName: string }>> {
    const data = await json<{ invites: Record<string, unknown>[] }>(`/api/teams/${teamId}/invites`)
    return data.invites.map(r => {
      const mapped = snakeToCamel(r)
      const inviter = mapped.inviter as Record<string, unknown> | undefined
      return {
        ...mapped,
        createdAt: toDate(mapped.createdAt),
        expiresAt: toDate(mapped.expiresAt),
        inviterName: inviter?.name as string ?? 'Unknown',
      } as { id: string; token: string; email: string; role: string; createdAt: Date; expiresAt: Date; inviterName: string }
    })
  },

  async revokeInvite(inviteId: string): Promise<void> {
    await del(`/api/teams/invites/${inviteId}`)
  },

  // ── Blobs ──────────────────────────────────────────────────────────
  async uploadBlob(data: string, mimeType: string, size: number, filename: string, nodeId?: string, projectId?: string): Promise<string> {
    const result = await post(`${BASE}/blobs`, { data, mimeType, size, filename, nodeId, projectId }) as { id: string }
    return result.id
  },

  getBlobUrl(id: string): string {
    return apiUrl(`${BASE}/blobs/${id}`)
  },

  async deleteBlob(id: string): Promise<void> {
    await del(`${BASE}/blobs/${id}`)
  },

  // ── Comments ───────────────────────────────────────────────────────
  async getComments(nodeId: string, projectId: string): Promise<NodeComment[]> {
    const rows = await json<Record<string, unknown>[]>(`${BASE}/comments?nodeId=${encodeURIComponent(nodeId)}&projectId=${encodeURIComponent(projectId)}`)
    return rows.map(row => {
      const r = snakeToCamel(row)
      return {
        ...r,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
      } as NodeComment
    })
  },

  async createComment(comment: { nodeId: string; projectId: string; authorName: string; authorType?: string; content: string; parentCommentId?: string }): Promise<NodeComment> {
    const row = await post(`${BASE}/comments`, comment) as Record<string, unknown>
    const r = snakeToCamel(row)
    return {
      ...r,
      createdAt: toDate(r.createdAt),
      updatedAt: toDate(r.updatedAt),
    } as NodeComment
  },

  async deleteComment(id: string): Promise<void> {
    await del(`${BASE}/comments/${id}`)
  },

  // ── Environment Configs ────────────────────────────────────────────
  async getEnvironmentConfigs(): Promise<EnvironmentConfig[]> {
    const rows = await json<Record<string, unknown>[]>(`${BASE}/environment-configs`)
    return rows.map((row) => {
      const r = snakeToCamel(row)
      return {
        ...r,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
      } as EnvironmentConfig
    })
  },

  async upsertEnvironmentConfig(config: { backendId: string; machineId?: string; customContext: string; displayName?: string }): Promise<EnvironmentConfig> {
    const row = await post(`${BASE}/environment-configs`, config) as Record<string, unknown>
    const r = snakeToCamel(row)
    return {
      ...r,
      createdAt: toDate(r.createdAt),
      updatedAt: toDate(r.updatedAt),
    } as EnvironmentConfig
  },

  async deleteEnvironmentConfig(id: string): Promise<void> {
    await del(`${BASE}/environment-configs/${id}`)
  },

  // ── Skills (uses /api/skills, not /api/data) ─────────────────────────
  async listSkills(): Promise<SkillRow[]> {
    const data = await json<{ skills: Record<string, unknown>[] }>('/api/skills')
    return (data.skills ?? []).map(mapSkillRow)
  },

  async createSkill(skill: Partial<SkillRow>): Promise<SkillRow> {
    const row = await post('/api/skills', skill) as Record<string, unknown>
    return mapSkillRow(row)
  },

  async updateSkill(id: string, updates: Partial<SkillRow>): Promise<SkillRow> {
    const row = await put(`/api/skills/${id}`, updates) as Record<string, unknown>
    return mapSkillRow(row)
  },

  async deleteSkill(id: string): Promise<void> {
    await del(`/api/skills/${id}`)
  },

  async toggleSkill(id: string): Promise<SkillRow> {
    const row = await put(`/api/skills/${id}/toggle`, {}) as Record<string, unknown>
    return mapSkillRow(row)
  },
}
