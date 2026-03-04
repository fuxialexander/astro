import { Hono } from 'hono'
import crypto from 'crypto'
import { db } from '../lib/db/index.js'
import {
  sharedPlans,
  userProfiles,
  planNodes,
  projects,
  sharedPlanStars,
  sharedPlanForks,
  planEdges,
  sharedPlanComments,
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
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }

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

  // Validate visibility enum
  const validVisibilities = ['public', 'team', 'unlisted']
  if (body.visibility && !validVisibilities.includes(body.visibility)) {
    return c.json({ error: `visibility must be one of: ${validVisibilities.join(', ')}` }, 400)
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
    // Try to compute from project's tasks - verify ownership first
    try {
      // Check that the project exists and belongs to the user
      const [project] = await db.select({ ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, body.projectId))
        .limit(1)

      if (project && project.ownerId === user.id) {
        const nodes = await db.select().from(planNodes).where(eq(planNodes.projectId, body.projectId))
        const completed = nodes.filter(n => n.status === 'completed' || n.status === 'auto_verified').length
        const failed = nodes.filter(n => n.executionError).length
        executionSummary = {
          totalTasks: nodes.length,
          completed,
          failed,
        }
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
    // Escape LIKE special characters to prevent wildcard injection
    const escapedSearch = search.replace(/[%_\\]/g, '\\$&')
    conditions.push(or(
      ilike(sharedPlans.title, `%${escapedSearch}%`),
      ilike(sharedPlans.description, `%${escapedSearch}%`)
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

// ── GET /api/community/plans/trending ─────────────────────────────────
// Get trending plans based on recent activity
// Score formula: stars_7d * 2 + forks_7d * 3 + log(total_stars + 1)
// NOTE: Must be registered BEFORE /plans/:id to avoid route shadowing
app.get('/plans/trending', async (c) => {
  const user = c.get('user')! as AuthUser
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  // Build visibility conditions
  const visibilityConditions = or(
    eq(sharedPlans.visibility, 'public'),
    and(eq(sharedPlans.visibility, 'team'), eq(sharedPlans.teamId, user.teamId)),
    and(eq(sharedPlans.visibility, 'unlisted'), eq(sharedPlans.authorId, user.id))
  )!

  // Trending score expression: stars_7d * 2 + forks_7d * 3 + log(total_stars + 1)
  // Extracted so the same expression can be reused in ORDER BY
  const trendingScoreExpr = sql<number>`(
    (
      SELECT COUNT(*)::int
      FROM ${sharedPlanStars}
      WHERE ${sharedPlanStars.planId} = ${sharedPlans.id}
        AND ${sharedPlanStars.createdAt} >= ${sevenDaysAgo}
    ) * 2
    + (
      SELECT COUNT(*)::int
      FROM ${sharedPlanForks}
      WHERE ${sharedPlanForks.sourcePlanId} = ${sharedPlans.id}
        AND ${sharedPlanForks.createdAt} >= ${sevenDaysAgo}
    ) * 3
    + LN(${sharedPlans.starsCount} + 1)
  )`

  // Query trending plans with weighted score
  const trendingPlans = await db.select({
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
    // Include author info
    authorEmail: userProfiles.email,
    authorAvatarUrl: userProfiles.avatarUrl,
    // Calculate stars in last 7 days
    stars7d: sql<number>`(
      SELECT COUNT(*)::int
      FROM ${sharedPlanStars}
      WHERE ${sharedPlanStars.planId} = ${sharedPlans.id}
        AND ${sharedPlanStars.createdAt} >= ${sevenDaysAgo}
    )`,
    // Calculate forks in last 7 days
    forks7d: sql<number>`(
      SELECT COUNT(*)::int
      FROM ${sharedPlanForks}
      WHERE ${sharedPlanForks.sourcePlanId} = ${sharedPlans.id}
        AND ${sharedPlanForks.createdAt} >= ${sevenDaysAgo}
    )`,
    trendingScore: trendingScoreExpr,
  })
    .from(sharedPlans)
    .leftJoin(userProfiles, eq(sharedPlans.authorId, userProfiles.id))
    .where(and(
      isNull(sharedPlans.deletedAt),
      visibilityConditions
    ))
    .orderBy(desc(trendingScoreExpr))
    .limit(20)

  return c.json({ plans: trendingPlans })
})

// ── GET /api/community/plans/categories ───────────────────────────────
// Get distinct categories with counts
// NOTE: Must be registered BEFORE /plans/:id to avoid route shadowing
app.get('/plans/categories', async (c) => {
  const user = c.get('user')! as AuthUser

  // Build visibility conditions
  const visibilityConditions = or(
    eq(sharedPlans.visibility, 'public'),
    and(eq(sharedPlans.visibility, 'team'), eq(sharedPlans.teamId, user.teamId)),
    and(eq(sharedPlans.visibility, 'unlisted'), eq(sharedPlans.authorId, user.id))
  )!

  // Query distinct categories with counts
  const categories = await db.select({
    category: sharedPlans.category,
    count: sql<number>`COUNT(*)::int`,
  })
    .from(sharedPlans)
    .where(and(
      isNull(sharedPlans.deletedAt),
      visibilityConditions,
      sql`${sharedPlans.category} IS NOT NULL`
    ))
    .groupBy(sharedPlans.category)
    .orderBy(sql`count DESC`)

  return c.json({ categories })
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
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }

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

  // Validate visibility enum if provided
  const validVisibilities = ['public', 'team', 'unlisted']
  if (body.visibility !== undefined && !validVisibilities.includes(body.visibility)) {
    return c.json({ error: `visibility must be one of: ${validVisibilities.join(', ')}` }, 400)
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

// ── POST /api/community/plans/:id/fork ───────────────────────────────
// Fork a shared plan into a new project
app.post('/plans/:id/fork', async (c) => {
  const user = c.get('user')! as AuthUser
  const planId = c.req.param('id')

  // Fetch the plan to fork
  const [result] = await db.select({
    id: sharedPlans.id,
    title: sharedPlans.title,
    description: sharedPlans.description,
    authorId: sharedPlans.authorId,
    authorName: sharedPlans.authorName,
    visionDoc: sharedPlans.visionDoc,
    planData: sharedPlans.planData,
    visibility: sharedPlans.visibility,
    teamId: sharedPlans.teamId,
  })
    .from(sharedPlans)
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

  // Generate UUID mapping for nodes and edges
  const uuidMap = new Map<string, string>()

  // First pass: create UUID mappings for all nodes
  for (const node of result.planData.nodes) {
    const oldId = (node as { id: string }).id
    const newId = crypto.randomUUID()
    uuidMap.set(oldId, newId)
  }

  // Remap node IDs and clean execution fields
  const remappedNodes = result.planData.nodes.map((node: Record<string, unknown>) => {
    const oldId = node.id as string
    const newId = uuidMap.get(oldId)!

    // Remove execution-specific fields and IDs
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, executionId, executionOutput, executionError, executionStartedAt, executionCompletedAt, ...rest } = node

    return {
      ...rest,
      id: newId,
      status: 'planned', // Reset status to planned
    }
  })

  // Remap edge IDs and source/target references
  const remappedEdges = result.planData.edges.map((edge: Record<string, unknown>) => {
    const oldSource = edge.source as string
    const oldTarget = edge.target as string

    return {
      ...edge,
      id: crypto.randomUUID(), // Generate new edge ID
      source: uuidMap.get(oldSource) || oldSource,
      target: uuidMap.get(oldTarget) || oldTarget,
    }
  })

  // Create new project with forked plan
  const now = new Date()
  const projectId = crypto.randomUUID()

  const projectData = {
    id: projectId,
    ownerId: user.id,
    teamId: user.teamId,
    name: `${result.title} (Fork)`,
    description: result.description || '',
    visionDoc: result.visionDoc || '',
    status: 'active' as const,
    source: {
      type: 'community-fork' as const,
      planId: result.id,
      planTitle: result.title,
      authorName: result.authorName,
      forkedAt: now.toISOString(),
    },
    createdAt: now,
    updatedAt: now,
  }

  try {
    // Use transaction to ensure all-or-nothing fork operation
    await db.transaction(async (tx) => {
      // Insert project
      await tx.insert(projects).values(projectData)

      // Insert nodes with remapped IDs
      if (remappedNodes.length > 0) {
        const nodeInserts = remappedNodes.map((node: Record<string, unknown>) => ({
          id: crypto.randomUUID(), // DB primary key
          projectId,
          clientId: node.id as string, // The remapped UUID used in the graph
          number: node.number as number | null,
          type: (node.type as string) || 'task',
          title: (node.title as string) || '',
          description: (node.description as string) || '',
          status: 'planned' as const,
          priority: (node.priority as string) || null,
          assignee: (node.assignee as string) || null,
          prompt: (node.prompt as string) || null,
          startDate: (node.startDate as string) || null,
          endDate: (node.endDate as string) || null,
          dueDate: (node.dueDate as string) || null,
          estimate: (node.estimate as string) || null,
          milestoneId: (node.milestoneId as string) || null,
          positionX: ((node.position as { x: number; y: number })?.x) ?? 0,
          positionY: ((node.position as { x: number; y: number })?.y) ?? 0,
          createdAt: now,
          updatedAt: now,
        }))
        await tx.insert(planNodes).values(nodeInserts)
      }

      // Insert edges with remapped IDs
      if (remappedEdges.length > 0) {
        const edgeInserts = remappedEdges.map((edge: Record<string, unknown>) => ({
          id: crypto.randomUUID(),
          projectId,
          clientId: edge.id as string,
          sourceClientId: edge.source as string,
          targetClientId: edge.target as string,
          type: (edge.type as string) || 'dependency',
          createdAt: now,
        }))
        await tx.insert(planEdges).values(edgeInserts)
      }

      // Record fork in shared_plan_forks table
      await tx.insert(sharedPlanForks).values({
        sourcePlanId: result.id,
        forkedBy: user.id,
        projectId,
        createdAt: now,
      })

      // Atomically increment forksCount
      await tx.update(sharedPlans)
        .set({ forksCount: sql`${sharedPlans.forksCount} + 1` })
        .where(eq(sharedPlans.id, result.id))
    })

    return c.json({
      projectId,
      message: 'Plan forked successfully',
    }, 201)
  } catch (err) {
    console.error('[community] Failed to fork plan:', err)
    return c.json({ error: 'Failed to fork plan' }, 500)
  }
})

// ── GET /api/community/plans/:id/export ──────────────────────────────
// Export plan as downloadable .astro.json file
app.get('/plans/:id/export', async (c) => {
  const user = c.get('user')! as AuthUser
  const planId = c.req.param('id')

  // Fetch plan
  const [result] = await db.select({
    id: sharedPlans.id,
    title: sharedPlans.title,
    description: sharedPlans.description,
    authorId: sharedPlans.authorId,
    authorName: sharedPlans.authorName,
    visionDoc: sharedPlans.visionDoc,
    planData: sharedPlans.planData,
    templateId: sharedPlans.templateId,
    templateParameters: sharedPlans.templateParameters,
    category: sharedPlans.category,
    tags: sharedPlans.tags,
    visibility: sharedPlans.visibility,
    teamId: sharedPlans.teamId,
    createdAt: sharedPlans.createdAt,
  })
    .from(sharedPlans)
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

  // Build exportable format
  const exportData = {
    version: '1.0.0',
    type: 'astro-plan-export',
    metadata: {
      title: result.title,
      description: result.description,
      author: result.authorName,
      category: result.category,
      tags: result.tags,
      exportedAt: new Date().toISOString(),
      sourceUrl: `${c.req.url.split('/export')[0]}`,
    },
    visionDoc: result.visionDoc,
    planData: result.planData,
    templateId: result.templateId,
    templateParameters: result.templateParameters,
  }

  // Set Content-Disposition header for download
  const filename = `${result.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.astro.json`
  c.header('Content-Disposition', `attachment; filename="${filename}"`)
  c.header('Content-Type', 'application/json')

  return c.json(exportData)
})

// ── POST /api/community/plans/:id/star ───────────────────────────────
// Toggle star (upvote) for a shared plan
app.post('/plans/:id/star', async (c) => {
  const user = c.get('user')! as AuthUser
  const planId = c.req.param('id')

  // Verify plan exists and is accessible
  const [plan] = await db.select({
    id: sharedPlans.id,
    visibility: sharedPlans.visibility,
    teamId: sharedPlans.teamId,
    authorId: sharedPlans.authorId,
  })
    .from(sharedPlans)
    .where(and(
      eq(sharedPlans.id, planId),
      isNull(sharedPlans.deletedAt)
    ))
    .limit(1)

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404)
  }

  // Check visibility permissions - users can only star plans they have access to
  const canAccess = (
    plan.visibility === 'public' ||
    (plan.visibility === 'team' && plan.teamId === user.teamId) ||
    (plan.visibility === 'unlisted' && plan.authorId === user.id) ||
    plan.authorId === user.id
  )

  if (!canAccess) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Check if user already starred this plan
  const [existingStar] = await db.select()
    .from(sharedPlanStars)
    .where(and(
      eq(sharedPlanStars.userId, user.id),
      eq(sharedPlanStars.planId, planId)
    ))
    .limit(1)

  if (existingStar) {
    // Unstar - delete record and decrement count atomically
    await db.transaction(async (tx) => {
      await tx.delete(sharedPlanStars)
        .where(and(
          eq(sharedPlanStars.userId, user.id),
          eq(sharedPlanStars.planId, planId)
        ))
      await tx.update(sharedPlans)
        .set({ starsCount: sql`GREATEST(0, ${sharedPlans.starsCount} - 1)` })
        .where(eq(sharedPlans.id, planId))
    })

    // Query actual count for accurate response
    const [updated] = await db.select({ starsCount: sharedPlans.starsCount })
      .from(sharedPlans).where(eq(sharedPlans.id, planId)).limit(1)

    return c.json({ starred: false, starsCount: updated?.starsCount ?? 0, message: 'Plan unstarred' })
  } else {
    // Star - insert record and increment count atomically
    await db.transaction(async (tx) => {
      await tx.insert(sharedPlanStars).values({
        userId: user.id,
        planId,
        createdAt: new Date(),
      })
      await tx.update(sharedPlans)
        .set({ starsCount: sql`${sharedPlans.starsCount} + 1` })
        .where(eq(sharedPlans.id, planId))
    })

    // Query actual count for accurate response
    const [updated] = await db.select({ starsCount: sharedPlans.starsCount })
      .from(sharedPlans).where(eq(sharedPlans.id, planId)).limit(1)

    return c.json({ starred: true, starsCount: updated?.starsCount ?? 0, message: 'Plan starred' })
  }
})

// ── GET /api/community/plans/:id/starred ─────────────────────────────
// Check if current user has starred a plan
app.get('/plans/:id/starred', async (c) => {
  const user = c.get('user')! as AuthUser
  const planId = c.req.param('id')

  const [star] = await db.select()
    .from(sharedPlanStars)
    .where(and(
      eq(sharedPlanStars.userId, user.id),
      eq(sharedPlanStars.planId, planId)
    ))
    .limit(1)

  return c.json({ starred: !!star })
})

// ── GET /api/community/my-plans ───────────────────────────────────────
// Get current user's published plans
app.get('/my-plans', async (c) => {
  const user = c.get('user')! as AuthUser

  // Fetch user's published plans (including unlisted, excluding deleted)
  const plans = await db.select({
    id: sharedPlans.id,
    title: sharedPlans.title,
    description: sharedPlans.description,
    category: sharedPlans.category,
    tags: sharedPlans.tags,
    visibility: sharedPlans.visibility,
    starsCount: sharedPlans.starsCount,
    forksCount: sharedPlans.forksCount,
    commentsCount: sharedPlans.commentsCount,
    version: sharedPlans.version,
    createdAt: sharedPlans.createdAt,
    updatedAt: sharedPlans.updatedAt,
  })
    .from(sharedPlans)
    .where(and(
      eq(sharedPlans.authorId, user.id),
      isNull(sharedPlans.deletedAt)
    ))
    .orderBy(desc(sharedPlans.createdAt))

  return c.json({ plans })
})

// ── GET /api/community/plans/:id/comments ────────────────────────────
// List comments with threading (nest replies by parentCommentId)
app.get('/plans/:id/comments', async (c) => {
  const user = c.get('user')! as AuthUser
  const planId = c.req.param('id')

  // Verify plan exists and is accessible
  const [plan] = await db.select({
    id: sharedPlans.id,
    visibility: sharedPlans.visibility,
    teamId: sharedPlans.teamId,
    authorId: sharedPlans.authorId,
  })
    .from(sharedPlans)
    .where(and(
      eq(sharedPlans.id, planId),
      isNull(sharedPlans.deletedAt)
    ))
    .limit(1)

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404)
  }

  // Check visibility permissions
  const canAccess = (
    plan.visibility === 'public' ||
    (plan.visibility === 'team' && plan.teamId === user.teamId) ||
    (plan.visibility === 'unlisted' && plan.authorId === user.id) ||
    plan.authorId === user.id
  )

  if (!canAccess) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Fetch all comments for this plan (excluding soft-deleted)
  const allComments = await db.select({
    id: sharedPlanComments.id,
    planId: sharedPlanComments.planId,
    authorId: sharedPlanComments.authorId,
    authorName: sharedPlanComments.authorName,
    content: sharedPlanComments.content,
    parentCommentId: sharedPlanComments.parentCommentId,
    createdAt: sharedPlanComments.createdAt,
    updatedAt: sharedPlanComments.updatedAt,
    // Include author info
    authorEmail: userProfiles.email,
    authorAvatarUrl: userProfiles.avatarUrl,
  })
    .from(sharedPlanComments)
    .leftJoin(userProfiles, eq(sharedPlanComments.authorId, userProfiles.id))
    .where(and(
      eq(sharedPlanComments.planId, planId),
      isNull(sharedPlanComments.deletedAt)
    ))
    .orderBy(sharedPlanComments.createdAt)

  // Build nested comment structure
  interface CommentWithReplies {
    id: string
    planId: string
    authorId: string | null
    authorName: string
    content: string
    parentCommentId: string | null
    createdAt: Date
    updatedAt: Date
    authorEmail: string | null
    authorAvatarUrl: string | null
    replies: CommentWithReplies[]
  }

  const commentMap = new Map<string, CommentWithReplies>()
  const rootComments: CommentWithReplies[] = []

  // First pass: create all comment objects with empty replies arrays
  for (const comment of allComments) {
    commentMap.set(comment.id, {
      ...comment,
      replies: [],
    })
  }

  // Second pass: nest replies under parent comments
  for (const comment of allComments) {
    const commentWithReplies = commentMap.get(comment.id)!
    if (comment.parentCommentId) {
      // This is a reply - add it to parent's replies array
      const parent = commentMap.get(comment.parentCommentId)
      if (parent) {
        parent.replies.push(commentWithReplies)
      } else {
        // Parent was deleted - treat as root comment
        rootComments.push(commentWithReplies)
      }
    } else {
      // This is a root comment
      rootComments.push(commentWithReplies)
    }
  }

  return c.json({ comments: rootComments })
})

// ── POST /api/community/plans/:id/comments ───────────────────────────
// Add a comment (with optional parentCommentId for replies)
app.post('/plans/:id/comments', async (c) => {
  const user = c.get('user')! as AuthUser
  const planId = c.req.param('id')
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }

  // Validate required fields
  if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
    return c.json({ error: 'Content is required and must be non-empty' }, 400)
  }

  // Verify plan exists and is accessible
  const [plan] = await db.select({
    id: sharedPlans.id,
    visibility: sharedPlans.visibility,
    teamId: sharedPlans.teamId,
    authorId: sharedPlans.authorId,
  })
    .from(sharedPlans)
    .where(and(
      eq(sharedPlans.id, planId),
      isNull(sharedPlans.deletedAt)
    ))
    .limit(1)

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404)
  }

  // Check visibility permissions
  const canAccess = (
    plan.visibility === 'public' ||
    (plan.visibility === 'team' && plan.teamId === user.teamId) ||
    (plan.visibility === 'unlisted' && plan.authorId === user.id) ||
    plan.authorId === user.id
  )

  if (!canAccess) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Verify parent comment exists if provided
  if (body.parentCommentId) {
    const [parentComment] = await db.select({ id: sharedPlanComments.id })
      .from(sharedPlanComments)
      .where(and(
        eq(sharedPlanComments.id, body.parentCommentId),
        eq(sharedPlanComments.planId, planId),
        isNull(sharedPlanComments.deletedAt)
      ))
      .limit(1)

    if (!parentComment) {
      return c.json({ error: 'Parent comment not found' }, 404)
    }
  }

  // Get author name from user profile
  let authorName = 'Anonymous'
  try {
    const [profile] = await db.select({ name: userProfiles.name })
      .from(userProfiles)
      .where(eq(userProfiles.id, user.id))
      .limit(1)
    authorName = profile?.name || authorName
  } catch {
    // Use fallback if profile fetch fails
  }

  // Insert comment and increment count atomically
  const [comment] = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(sharedPlanComments).values({
      planId,
      authorId: user.id,
      authorName,
      content: body.content.trim(),
      parentCommentId: body.parentCommentId || null,
    }).returning()

    await tx.update(sharedPlans)
      .set({ commentsCount: sql`${sharedPlans.commentsCount} + 1` })
      .where(eq(sharedPlans.id, planId))

    return [inserted]
  })

  return c.json(comment, 201)
})

// ── PUT /api/community/comments/:id ───────────────────────────────────
// Edit a comment (author only)
app.put('/comments/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const commentId = c.req.param('id')
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }

  // Validate content
  if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
    return c.json({ error: 'Content is required and must be non-empty' }, 400)
  }

  // Fetch existing comment to check ownership
  const [existing] = await db.select({
    id: sharedPlanComments.id,
    authorId: sharedPlanComments.authorId,
  })
    .from(sharedPlanComments)
    .where(and(
      eq(sharedPlanComments.id, commentId),
      isNull(sharedPlanComments.deletedAt)
    ))
    .limit(1)

  if (!existing) {
    return c.json({ error: 'Comment not found' }, 404)
  }

  if (existing.authorId !== user.id) {
    return c.json({ error: 'Only the author can edit this comment' }, 403)
  }

  // Update comment
  const [updated] = await db.update(sharedPlanComments)
    .set({
      content: body.content.trim(),
      updatedAt: new Date(),
    })
    .where(eq(sharedPlanComments.id, commentId))
    .returning()

  return c.json(updated)
})

// ── DELETE /api/community/comments/:id ────────────────────────────────
// Soft delete a comment (author only)
app.delete('/comments/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const commentId = c.req.param('id')

  // Fetch existing comment to check ownership
  const [existing] = await db.select({
    id: sharedPlanComments.id,
    authorId: sharedPlanComments.authorId,
    planId: sharedPlanComments.planId,
  })
    .from(sharedPlanComments)
    .where(and(
      eq(sharedPlanComments.id, commentId),
      isNull(sharedPlanComments.deletedAt)
    ))
    .limit(1)

  if (!existing) {
    return c.json({ error: 'Comment not found' }, 404)
  }

  if (existing.authorId !== user.id) {
    return c.json({ error: 'Only the author can delete this comment' }, 403)
  }

  // Soft delete and decrement count atomically
  await db.transaction(async (tx) => {
    await tx.update(sharedPlanComments)
      .set({ deletedAt: new Date() })
      .where(eq(sharedPlanComments.id, commentId))

    await tx.update(sharedPlans)
      .set({ commentsCount: sql`GREATEST(0, ${sharedPlans.commentsCount} - 1)` })
      .where(eq(sharedPlans.id, existing.planId))
  })

  return c.json({ success: true })
})

export { app as communityRoute }
