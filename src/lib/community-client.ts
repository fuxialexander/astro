import { getAccessToken } from "./supabase-client"
import { apiUrl } from "./api-url"

// ── Types ─────────────────────────────────────────────────────────────

/** Execution summary statistics */
export interface ExecutionSummary {
  totalTasks?: number
  completed?: number
  failed?: number
  totalCost?: number
  totalTokens?: number
}

/** Customizable field metadata for forking/templating */
export interface CustomizableField {
  nodeId: string
  field: string
  description: string
}

/** Plan data structure (nodes and edges) */
export interface PlanData {
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
}

/** Base shared plan fields */
export interface SharedPlan {
  id: string
  title: string
  description: string | null
  authorId: string | null
  authorName: string | null
  isAnonymous: boolean
  category: string | null
  tags: string[]
  starsCount: number
  forksCount: number
  commentsCount: number
  visibility: 'public' | 'team' | 'unlisted'
  createdAt: Date
  updatedAt: Date
}

/** Shared plan summary for list view */
export interface SharedPlanSummary extends SharedPlan {
  // Author info (joined from userProfiles)
  authorEmail?: string | null
  authorAvatarUrl?: string | null
}

/** Shared plan detail for single-plan view */
export interface SharedPlanDetail extends SharedPlan {
  // Full plan content
  visionDoc: string | null
  planData: PlanData
  templateId: string | null
  templateParameters: Record<string, unknown> | null

  // Customization guide
  customizationNotes: string | null
  customizableFields: CustomizableField[] | null

  // Execution evidence
  executionSummary: ExecutionSummary | null
  executionResults: string | null

  // Metadata
  version: number
  teamId: string | null

  // Author info (joined from userProfiles)
  authorEmail?: string | null
  authorAvatarUrl?: string | null
  authorBio?: string | null
}

/** Request payload for publishing a plan */
export interface PublishPlanRequest {
  title: string
  description?: string
  projectId?: string
  isAnonymous?: boolean
  visionDoc?: string
  planData: PlanData
  templateId?: string
  templateParameters?: Record<string, unknown>
  customizationNotes?: string
  customizableFields?: CustomizableField[]
  executionSummary?: ExecutionSummary
  executionResults?: string
  category?: string
  tags?: string[]
  visibility?: 'public' | 'team' | 'unlisted'
  authorName?: string
}

/** Request payload for updating a published plan */
export interface UpdatePublishedPlanRequest {
  title?: string
  description?: string
  customizationNotes?: string
  customizableFields?: CustomizableField[]
  executionResults?: string
  category?: string
  tags?: string[]
  visibility?: 'public' | 'team' | 'unlisted'
}

/** Comment on a shared plan */
export interface Comment {
  id: string
  planId: string
  authorId: string | null
  authorName: string
  content: string
  parentCommentId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

/** Paginated result wrapper */
export interface PaginatedResult<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

/** Parameters for listing community plans */
export interface ListCommunityPlansParams {
  category?: string
  tags?: string[]
  sort?: 'stars' | 'recent' | 'forks'
  search?: string
  author?: string
  page?: number
  limit?: number
}

/** Fork plan request */
export interface ForkPlanRequest {
  projectName: string
  workDir?: string
}

/** Fork plan response */
export interface ForkPlanResponse {
  projectId: string
  message: string
}

/** Star status response */
export interface StarStatusResponse {
  isStarred: boolean
  starsCount: number
}

/** Category response */
export interface Category {
  name: string
  count: number
}

// ── Helpers ───────────────────────────────────────────────────────────

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
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(error.error || `${res.status} ${res.statusText}`)
    }
    return res.json() as Promise<T>
  } finally {
    clearTimeout(timeout)
  }
}

// Normalize timestamps from API to Date objects
function toDate(v: unknown): Date {
  if (v instanceof Date) return v
  if (typeof v === "string" || typeof v === "number") return new Date(v)
  return new Date()
}

function mapSharedPlanSummary(row: Record<string, unknown>): SharedPlanSummary {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) || null,
    authorId: (row.authorId as string | null) || null,
    authorName: (row.authorName as string | null) || null,
    isAnonymous: row.isAnonymous as boolean,
    category: (row.category as string | null) || null,
    tags: (row.tags as string[]) || [],
    starsCount: (row.starsCount as number) || 0,
    forksCount: (row.forksCount as number) || 0,
    commentsCount: (row.commentsCount as number) || 0,
    visibility: row.visibility as 'public' | 'team' | 'unlisted',
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    authorEmail: (row.authorEmail as string | null) || null,
    authorAvatarUrl: (row.authorAvatarUrl as string | null) || null,
  }
}

function mapSharedPlanDetail(row: Record<string, unknown>): SharedPlanDetail {
  return {
    ...mapSharedPlanSummary(row),
    visionDoc: (row.visionDoc as string | null) || null,
    planData: row.planData as PlanData,
    templateId: (row.templateId as string | null) || null,
    templateParameters: (row.templateParameters as Record<string, unknown> | null) || null,
    customizationNotes: (row.customizationNotes as string | null) || null,
    customizableFields: (row.customizableFields as CustomizableField[] | null) || null,
    executionSummary: (row.executionSummary as ExecutionSummary | null) || null,
    executionResults: (row.executionResults as string | null) || null,
    version: (row.version as number) || 1,
    teamId: (row.teamId as string | null) || null,
    authorBio: (row.authorBio as string | null) || null,
  }
}

function mapComment(row: Record<string, unknown>): Comment {
  return {
    id: row.id as string,
    planId: row.planId as string,
    authorId: (row.authorId as string | null) || null,
    authorName: row.authorName as string,
    content: row.content as string,
    parentCommentId: (row.parentCommentId as string | null) || null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: row.deletedAt ? toDate(row.deletedAt) : null,
  }
}

// ── API Client ────────────────────────────────────────────────────────

/**
 * List community plans with pagination and filtering.
 * GET /api/community/plans
 */
export async function listCommunityPlans(
  params: ListCommunityPlansParams = {}
): Promise<PaginatedResult<SharedPlanSummary>> {
  const query = new URLSearchParams()

  if (params.category) query.set('category', params.category)
  if (params.tags && params.tags.length > 0) query.set('tags', params.tags.join(','))
  if (params.sort) query.set('sort', params.sort)
  if (params.search) query.set('search', params.search)
  if (params.author) query.set('author', params.author)
  if (params.page) query.set('page', params.page.toString())
  if (params.limit) query.set('limit', params.limit.toString())

  const url = `/api/community/plans${query.toString() ? `?${query.toString()}` : ''}`
  const response = await json<{ plans: Record<string, unknown>[]; pagination: PaginatedResult<SharedPlanSummary>['pagination'] }>(url)

  return {
    data: response.plans.map(mapSharedPlanSummary),
    pagination: response.pagination,
  }
}

/**
 * Get a single community plan with full details.
 * GET /api/community/plans/:id
 */
export async function getCommunityPlan(id: string): Promise<SharedPlanDetail> {
  const response = await json<Record<string, unknown>>(`/api/community/plans/${id}`)
  return mapSharedPlanDetail(response)
}

/**
 * Publish a plan to the community marketplace.
 * POST /api/community/plans
 */
export async function publishPlan(data: PublishPlanRequest): Promise<SharedPlanDetail> {
  const response = await json<Record<string, unknown>>(`/api/community/plans`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return mapSharedPlanDetail(response)
}

/**
 * Update a published plan (author only).
 * PUT /api/community/plans/:id
 */
export async function updatePublishedPlan(
  id: string,
  updates: UpdatePublishedPlanRequest
): Promise<SharedPlanDetail> {
  const response = await json<Record<string, unknown>>(`/api/community/plans/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
  return mapSharedPlanDetail(response)
}

/**
 * Delete a published plan (author only, soft delete).
 * DELETE /api/community/plans/:id
 */
export async function deletePublishedPlan(id: string): Promise<{ success: boolean }> {
  return json(`/api/community/plans/${id}`, { method: 'DELETE' })
}

/**
 * Fork a community plan to create a new project.
 * POST /api/community/plans/:id/fork
 */
export async function forkPlan(
  id: string,
  projectName: string,
  workDir?: string
): Promise<ForkPlanResponse> {
  const body: ForkPlanRequest = { projectName }
  if (workDir) body.workDir = workDir

  return json(`/api/community/plans/${id}/fork`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Toggle star status for a plan (star if not starred, unstar if starred).
 * POST /api/community/plans/:id/star
 */
export async function toggleStar(id: string): Promise<StarStatusResponse> {
  return json(`/api/community/plans/${id}/star`, { method: 'POST' })
}

/**
 * Check if the current user has starred a plan.
 * GET /api/community/plans/:id/starred
 */
export async function checkStarred(id: string): Promise<StarStatusResponse> {
  return json(`/api/community/plans/${id}/starred`)
}

/**
 * List comments for a plan (with nested replies).
 * GET /api/community/plans/:planId/comments
 */
export async function listComments(planId: string): Promise<Comment[]> {
  const response = await json<{ comments: Record<string, unknown>[] }>(`/api/community/plans/${planId}/comments`)
  return response.comments.map(mapComment)
}

/**
 * Add a comment to a plan (or reply to an existing comment).
 * POST /api/community/plans/:planId/comments
 */
export async function addComment(
  planId: string,
  content: string,
  parentId?: string
): Promise<Comment> {
  const body: { content: string; parentCommentId?: string } = { content }
  if (parentId) body.parentCommentId = parentId

  const response = await json<Record<string, unknown>>(
    `/api/community/plans/${planId}/comments`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  )
  return mapComment(response)
}

/**
 * Edit a comment (author only).
 * PUT /api/community/comments/:id
 */
export async function editComment(id: string, content: string): Promise<Comment> {
  const response = await json<Record<string, unknown>>(
    `/api/community/comments/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }
  )
  return mapComment(response)
}

/**
 * Delete a comment (author only, soft delete).
 * DELETE /api/community/comments/:id
 */
export async function deleteComment(id: string): Promise<{ success: boolean }> {
  return json(`/api/community/comments/${id}`, { method: 'DELETE' })
}

/**
 * Get trending plans (most starred in last 7 days).
 * GET /api/community/plans/trending
 */
export async function getTrending(): Promise<SharedPlanSummary[]> {
  const response = await json<{ plans: Record<string, unknown>[] }>(`/api/community/plans/trending`)
  return response.plans.map(mapSharedPlanSummary)
}

/**
 * Get available categories with plan counts.
 * GET /api/community/plans/categories
 */
export async function getCategories(): Promise<Category[]> {
  const response = await json<{ categories: Category[] }>(`/api/community/plans/categories`)
  return response.categories
}

/**
 * Get current user's published plans.
 * GET /api/community/my-plans
 */
export async function getMyPlans(): Promise<SharedPlanSummary[]> {
  const response = await json<{ plans: Record<string, unknown>[] }>(`/api/community/my-plans`)
  return response.plans.map(mapSharedPlanSummary)
}
