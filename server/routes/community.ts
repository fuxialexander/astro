import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import {
  sharedPlans,
  userProfiles,
  planNodes,
} from '../lib/db/schema.js'
import { eq, and, desc, isNull, ilike, or, sql } from 'drizzle-orm'
import { requireAuth, type AuthUser } from '../middleware/auth.js'

const app = new Hono()

// Apply authentication middleware to all routes
app.use('/*', requireAuth)

// ── POST /api/community/plans ─────────────────────────────────────────
// Publish a plan to the community marketplace
app.post('/plans', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()

  // Validate required fields
  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return c.json({ error: 'Title is required and must be non-empty' }, 400)
  }

  if (!body.planData || typeof body.planData !== 'object') {
    return c.json({ error: 'planData is required and must be an object with nodes and edges' }, 400)
  }

  if (!Array.isArray(body.planData.nodes) || !Array.isArray(body.planData.edges)) {
    return c.json({ error: 'planData must contain nodes and edges arrays' }, 400)
  }

  // Sanitize plan data - remove execution-specific fields and sensitive data
  const sanitizedNodes = body.planData.nodes.map((node: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { executionId, executionOutput, executionError, executionStartedAt, executionCompletedAt, ...rest } = node
    return rest
  })

  const sanitizedPlanData = {
    nodes: sanitizedNodes,
    edges: body.planData.edges,
  }

  // Compute execution summary if provided
  let executionSummary = body.executionSummary
  if (!executionSummary && body.projectId) {
    // Try to compute from project's tasks
    try {
      const nodes = await db.select().from(planNodes).where(eq(planNodes.projectId, body.projectId))
      const completed = nodes.filter(n => n.status === 'completed' || n.status === 'auto_verified').length
      const failed = nodes.filter(n => n.executionError).length
      executionSummary = {
        totalTasks: nodes.length,
        completed,
        failed,
      }
    } catch {
      // Silently skip if project doesn't exist or query fails
    }
  }

  // Get author name from user profile (unless anonymous)
  let authorName = body.authorName || null
  if (!body.isAnonymous) {
    try {
      const [profile] = await db.select({ name: userProfiles.name })
        .from(userProfiles)
        .where(eq(userProfiles.id, user.id))
        .limit(1)
      authorName = profile?.name || null
    } catch {
      // Use fallback if profile fetch fails
    }
  }

  // Insert shared plan
  const [plan] = await db.insert(sharedPlans).values({
    title: body.title.trim(),
    description: body.description || null,
    authorId: body.isAnonymous ? null : user.id,
    authorName,
    isAnonymous: body.isAnonymous || false,
    visionDoc: body.visionDoc || null,
    planData: sanitizedPlanData,
    templateId: body.templateId || null,
    templateParameters: body.templateParameters || null,
    customizationNotes: body.customizationNotes || null,
    customizableFields: body.customizableFields || null,
    executionSummary: executionSummary || null,
    executionResults: body.executionResults || null,
    category: body.category || null,
    tags: body.tags || [],
    visibility: body.visibility || 'public',
    teamId: body.visibility === 'team' ? user.teamId : null,
  }).returning()

  return c.json(plan, 201)
})

// ── GET /api/community/plans ──────────────────────────────────────────
// List/search shared plans with pagination and filters
app.get('/plans', async (c) => {
  const user = c.get('user')! as AuthUser

  // Parse query parameters
  const category = c.req.query('category')
  const tagsParam = c.req.query('tags')
  const sort = c.req.query('sort') || 'stars' // 'stars' | 'recent' | 'forks'
  const search = c.req.query('search')
  const authorId = c.req.query('author')
  const page = parseInt(c.req.query('page') || '1', 10)
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100)
  const offset = (page - 1) * limit

  // Build WHERE conditions
  const conditions = []

  // Only show non-deleted plans
  conditions.push(isNull(sharedPlans.deletedAt))

  // Visibility: public plans, or team plans where user is a member, or user's own unlisted plans
  conditions.push(or(
    eq(sharedPlans.visibility, 'public'),
    and(eq(sharedPlans.visibility, 'team'), eq(sharedPlans.teamId, user.teamId)),
    and(eq(sharedPlans.visibility, 'unlisted'), eq(sharedPlans.authorId, user.id))
  )!)

  if (category) {
    conditions.push(eq(sharedPlans.category, category))
  }

  if (tagsParam) {
    const tags = tagsParam.split(',').map(t => t.trim()).filter(Boolean)
    if (tags.length > 0) {
      // PostgreSQL array overlap operator: tags && ARRAY['tag1', 'tag2']
      conditions.push(sql`${sharedPlans.tags} && ARRAY[${sql.join(tags.map(t => sql`${t}`), sql`, `)}]::text[]`)
    }
  }

  if (search) {
    // Full-text search on title and description
    conditions.push(or(
      ilike(sharedPlans.title, `%${search}%`),
      ilike(sharedPlans.description, `%${search}%`)
    )!)
  }

  if (authorId) {
    conditions.push(eq(sharedPlans.authorId, authorId))
  }

  // Determine sort order
  let orderBy
  switch (sort) {
    case 'recent':
      orderBy = desc(sharedPlans.createdAt)
      break
    case 'forks':
      orderBy = desc(sharedPlans.forksCount)
      break
    case 'stars':
    default:
      orderBy = desc(sharedPlans.starsCount)
      break
  }

  // Execute query with pagination
  const plans = await db.select({
    id: sharedPlans.id,
    title: sharedPlans.title,
    description: sharedPlans.description,
    authorId: sharedPlans.authorId,
    authorName: sharedPlans.authorName,
    isAnonymous: sharedPlans.isAnonymous,
    category: sharedPlans.category,
    tags: sharedPlans.tags,
    starsCount: sharedPlans.starsCount,
    forksCount: sharedPlans.forksCount,
    commentsCount: sharedPlans.commentsCount,
    visibility: sharedPlans.visibility,
    createdAt: sharedPlans.createdAt,
    updatedAt: sharedPlans.updatedAt,
    // Include author info for non-anonymous plans
    authorEmail: userProfiles.email,
    authorAvatarUrl: userProfiles.avatarUrl,
  })
    .from(sharedPlans)
    .leftJoin(userProfiles, eq(sharedPlans.authorId, userProfiles.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)

  // Get total count for pagination
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(sharedPlans)
    .where(and(...conditions))

  return c.json({
    plans,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit),
    },
  })
})

// ── GET /api/community/plans/:id ──────────────────────────────────────
// Get full plan details with author info
app.get('/plans/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const planId = c.req.param('id')

  // Fetch plan with author info
  const [result] = await db.select({
    // Plan fields
    id: sharedPlans.id,
    title: sharedPlans.title,
    description: sharedPlans.description,
    authorId: sharedPlans.authorId,
    authorName: sharedPlans.authorName,
    isAnonymous: sharedPlans.isAnonymous,
    visionDoc: sharedPlans.visionDoc,
    planData: sharedPlans.planData,
    templateId: sharedPlans.templateId,
    templateParameters: sharedPlans.templateParameters,
    customizationNotes: sharedPlans.customizationNotes,
    customizableFields: sharedPlans.customizableFields,
    executionSummary: sharedPlans.executionSummary,
    executionResults: sharedPlans.executionResults,
    category: sharedPlans.category,
    tags: sharedPlans.tags,
    version: sharedPlans.version,
    starsCount: sharedPlans.starsCount,
    forksCount: sharedPlans.forksCount,
    commentsCount: sharedPlans.commentsCount,
    visibility: sharedPlans.visibility,
    teamId: sharedPlans.teamId,
    createdAt: sharedPlans.createdAt,
    updatedAt: sharedPlans.updatedAt,
    // Author fields
    authorEmail: userProfiles.email,
    authorAvatarUrl: userProfiles.avatarUrl,
    authorBio: userProfiles.bio,
  })
    .from(sharedPlans)
    .leftJoin(userProfiles, eq(sharedPlans.authorId, userProfiles.id))
    .where(and(
      eq(sharedPlans.id, planId),
      isNull(sharedPlans.deletedAt)
    ))
    .limit(1)

  if (!result) {
    return c.json({ error: 'Plan not found' }, 404)
  }

  // Check visibility permissions
  const canAccess = (
    result.visibility === 'public' ||
    (result.visibility === 'team' && result.teamId === user.teamId) ||
    (result.visibility === 'unlisted' && result.authorId === user.id) ||
    result.authorId === user.id
  )

  if (!canAccess) {
    return c.json({ error: 'Access denied' }, 403)
  }

  return c.json(result)
})

// ── PUT /api/community/plans/:id ──────────────────────────────────────
// Update plan (author only)
app.put('/plans/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const planId = c.req.param('id')
  const body = await c.req.json()

  // Fetch existing plan to check ownership
  const [existing] = await db.select({ authorId: sharedPlans.authorId })
    .from(sharedPlans)
    .where(and(
      eq(sharedPlans.id, planId),
      isNull(sharedPlans.deletedAt)
    ))
    .limit(1)

  if (!existing) {
    return c.json({ error: 'Plan not found' }, 404)
  }

  if (existing.authorId !== user.id) {
    return c.json({ error: 'Only the author can update this plan' }, 403)
  }

  // Build update object - only allow updating certain fields
  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (body.title) updates.title = body.title.trim()
  if (body.description !== undefined) updates.description = body.description
  if (body.customizationNotes !== undefined) updates.customizationNotes = body.customizationNotes
  if (body.customizableFields !== undefined) updates.customizableFields = body.customizableFields
  if (body.executionResults !== undefined) updates.executionResults = body.executionResults
  if (body.category !== undefined) updates.category = body.category
  if (body.tags !== undefined) updates.tags = body.tags
  if (body.visibility !== undefined) {
    updates.visibility = body.visibility
    updates.teamId = body.visibility === 'team' ? user.teamId : null
  }

  // Update plan
  const [updated] = await db.update(sharedPlans)
    .set(updates)
    .where(eq(sharedPlans.id, planId))
    .returning()

  return c.json(updated)
})

// ── DELETE /api/community/plans/:id ───────────────────────────────────
// Soft delete plan (author only)
app.delete('/plans/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const planId = c.req.param('id')

  // Fetch existing plan to check ownership
  const [existing] = await db.select({ authorId: sharedPlans.authorId })
    .from(sharedPlans)
    .where(and(
      eq(sharedPlans.id, planId),
      isNull(sharedPlans.deletedAt)
    ))
    .limit(1)

  if (!existing) {
    return c.json({ error: 'Plan not found' }, 404)
  }

  if (existing.authorId !== user.id) {
    return c.json({ error: 'Only the author can delete this plan' }, 403)
  }

  // Soft delete by setting deletedAt
  await db.update(sharedPlans)
    .set({ deletedAt: new Date() })
    .where(eq(sharedPlans.id, planId))

  return c.json({ success: true })
})

export { app as communityRoute }
