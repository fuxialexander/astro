import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import {
  projects,
  initiatives,
  planNodes,
  planEdges,
  userProfiles,
  displaySettings,
  usageMetrics,
  sessions,
  taskChatSessions,
  taskChatMessages,
  taskExecutions,
} from '../lib/db/schema.js'
import { eq, and, or, sql } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth.js'
import { logAuditEvent, AuditActions, ResourceTypes } from '../middleware/audit.js'

const app = new Hono()

// Apply authentication middleware to all routes
app.use('/*', requireAuth)

// ── Projects ──────────────────────────────────────────────────────────

app.get('/projects', async (c) => {
  const rows = await db.select().from(projects).where(eq(projects.ownerId, c.get('user')!.id))
  return c.json(rows)
})

app.post('/projects', async (c) => {
  const body = await c.req.json()
  const now = new Date()

  // Generate UUID if not provided
  const projectId = body.id || crypto.randomUUID()

  const row = {
    id: projectId,
    ownerId: c.get('user')!.id,
    name: body.name,
    description: body.description ?? '',
    visionDoc: body.visionDoc ?? '',
    status: body.status ?? 'active',
    startDate: body.startDate ?? null,
    targetDate: body.targetDate ?? null,
    lead: body.lead ?? null,
    health: body.health ?? null,
    initiativeId: body.initiativeId ?? null,
    progress: body.progress ?? 0,
    labels: body.labels ?? [],
    color: body.color ?? '#3b82f6',
    icon: body.icon ?? '📋',
    workingDirectory: body.workingDirectory ?? null,
    createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number') ? new Date(body.createdAt) : now,
    updatedAt: (typeof body.updatedAt === 'string' || typeof body.updatedAt === 'number') ? new Date(body.updatedAt) : now,
  }
  await db.insert(projects).values(row).onConflictDoUpdate({
    target: projects.id,
    set: { ...row, id: undefined } as typeof row,
  })
  const [created] = await db.select().from(projects).where(eq(projects.id, projectId))

  // Audit log project creation (only on new projects, not updates)
  if (body.id === undefined || !body.createdAt) {
    await logAuditEvent({
      userId: c.get('user')!.id,
      action: AuditActions.PROJECT_CREATE,
      resourceType: ResourceTypes.PROJECT,
      resourceId: projectId,
      details: {
        projectName: body.name,
        status: body.status,
      },
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    })
  }

  return c.json(created, 201)
})

app.get('/projects/:id', async (c) => {
  const userId = c.get('user')!.id
  const projectId = c.req.param('id')
  const [row] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), eq(projects.ownerId, userId))
  )
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

app.patch('/projects/:id', async (c) => {
  const userId = c.get('user')!.id
  const id = c.req.param('id')

  // Verify ownership first
  const [existing] = await db.select().from(projects).where(
    and(eq(projects.id, id), eq(projects.ownerId, userId))
  )
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.visionDoc !== undefined) patch.visionDoc = body.visionDoc
  if (body.status !== undefined) patch.status = body.status
  if (body.startDate !== undefined) patch.startDate = body.startDate || null
  if (body.targetDate !== undefined) patch.targetDate = body.targetDate || null
  if (body.lead !== undefined) patch.lead = body.lead || null
  if (body.health !== undefined) patch.health = body.health || null
  if (body.initiativeId !== undefined) patch.initiativeId = body.initiativeId || null
  if (body.progress !== undefined) patch.progress = body.progress
  if (body.labels !== undefined) patch.labels = body.labels
  if (body.color !== undefined) patch.color = body.color
  if (body.icon !== undefined) patch.icon = body.icon
  if (body.workingDirectory !== undefined) patch.workingDirectory = body.workingDirectory || null
  if (body.repository !== undefined) patch.repository = body.repository || null
  if (body.defaultEnvironment !== undefined) patch.defaultEnvironment = body.defaultEnvironment || null
  if (body.defaultMachineId !== undefined) patch.defaultMachineId = body.defaultMachineId || null

  await db.update(projects).set(patch).where(
    and(eq(projects.id, id), eq(projects.ownerId, userId))
  )
  const [updated] = await db.select().from(projects).where(eq(projects.id, id))
  return c.json(updated)
})

app.delete('/projects/:id', async (c) => {
  const userId = c.get('user')!.id
  const projectId = c.req.param('id')

  // Verify ownership before deletion
  const [existing] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), eq(projects.ownerId, userId))
  )
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Audit log project deletion
  await logAuditEvent({
    userId,
    action: AuditActions.PROJECT_DELETE,
    resourceType: ResourceTypes.PROJECT,
    resourceId: projectId,
    details: {
      projectName: existing.name,
      status: existing.status,
    },
    ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  })

  await db.delete(projects).where(
    and(eq(projects.id, projectId), eq(projects.ownerId, userId))
  )
  return c.json({ ok: true })
})

// ── Initiatives ───────────────────────────────────────────────────────

app.get('/initiatives', async (c) => {
  const rows = await db.select().from(initiatives).where(eq(initiatives.ownerId, c.get('user')!.id))
  return c.json(rows)
})

app.post('/initiatives', async (c) => {
  const body = await c.req.json()
  const now = new Date()

  const initiativeId = body.id || crypto.randomUUID()

  const row = {
    id: initiativeId,
    ownerId: c.get('user')!.id,
    name: body.name,
    description: body.description ?? '',
    goal: body.goal ?? null,
    status: body.status ?? 'active',
    startDate: body.startDate ?? null,
    targetDate: body.targetDate ?? null,
    lead: body.lead ?? null,
    color: body.color ?? '#3b82f6',
    icon: body.icon ?? '🎯',
    createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number') ? new Date(body.createdAt) : now,
    updatedAt: (typeof body.updatedAt === 'string' || typeof body.updatedAt === 'number') ? new Date(body.updatedAt) : now,
  }
  await db.insert(initiatives).values(row).onConflictDoUpdate({
    target: initiatives.id,
    set: { ...row, id: undefined } as typeof row,
  })
  const [created] = await db.select().from(initiatives).where(eq(initiatives.id, initiativeId))
  return c.json(created, 201)
})

app.get('/initiatives/:id', async (c) => {
  const userId = c.get('user')!.id
  const initiativeId = c.req.param('id')
  const [row] = await db.select().from(initiatives).where(
    and(eq(initiatives.id, initiativeId), eq(initiatives.ownerId, userId))
  )
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

app.patch('/initiatives/:id', async (c) => {
  const userId = c.get('user')!.id
  const id = c.req.param('id')

  const [existing] = await db.select().from(initiatives).where(
    and(eq(initiatives.id, id), eq(initiatives.ownerId, userId))
  )
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.goal !== undefined) patch.goal = body.goal || null
  if (body.status !== undefined) patch.status = body.status
  if (body.startDate !== undefined) patch.startDate = body.startDate || null
  if (body.targetDate !== undefined) patch.targetDate = body.targetDate || null
  if (body.lead !== undefined) patch.lead = body.lead || null
  if (body.color !== undefined) patch.color = body.color
  if (body.icon !== undefined) patch.icon = body.icon

  await db.update(initiatives).set(patch).where(
    and(eq(initiatives.id, id), eq(initiatives.ownerId, userId))
  )
  const [updated] = await db.select().from(initiatives).where(eq(initiatives.id, id))
  return c.json(updated)
})

app.delete('/initiatives/:id', async (c) => {
  const userId = c.get('user')!.id
  const initiativeId = c.req.param('id')

  const [existing] = await db.select().from(initiatives).where(
    and(eq(initiatives.id, initiativeId), eq(initiatives.ownerId, userId))
  )
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Unassign projects from this initiative
  await db.update(projects)
    .set({ initiativeId: null })
    .where(eq(projects.initiativeId, initiativeId))

  await db.delete(initiatives).where(
    and(eq(initiatives.id, initiativeId), eq(initiatives.ownerId, userId))
  )
  return c.json({ ok: true })
})

// ── Plan (nodes + edges) ──────────────────────────────────────────────

app.get('/plan', async (c) => {
  const userId = c.get('user')!.id

  // Get user's projects
  const userProjects = await db.select().from(projects).where(eq(projects.ownerId, userId))
  const projectIds = new Set(userProjects.map(p => p.id))

  // Get all nodes for user's projects
  const rawNodes = await db.select().from(planNodes)
  const nodes = rawNodes
    .filter(n => projectIds.has(n.projectId))
    .map(n => ({
      id: n.clientId, // Use clientId as frontend ID
      projectId: n.projectId,
      type: n.type,
      title: n.title,
      description: n.description,
      status: n.status,
      parentId: n.parentId,
      dependencies: [], // Will be populated below
      environment: n.environment,
      verification: n.verification,
      position: { x: n.positionX, y: n.positionY },
      startDate: n.startDate,
      endDate: n.endDate,
      priority: n.priority,
      estimate: n.estimate,
      dueDate: n.dueDate,
      milestoneId: n.milestoneId,
      labelIds: n.labelIds,
      executionId: n.executionId,
      executionOutput: n.executionOutput,
      executionError: n.executionError,
      executionStartedAt: n.executionStartedAt,
      executionCompletedAt: n.executionCompletedAt,
      branchName: n.branchName,
      prUrl: n.prUrl,
      prNumber: n.prNumber,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }))

  const rawEdges = await db.select().from(planEdges)
  const edges = rawEdges
    .filter(e => projectIds.has(e.projectId))
    .map(e => ({
      id: e.clientId,
      source: e.sourceClientId,
      target: e.targetClientId,
      type: e.type,
    }))

  return c.json({ nodes, edges })
})

app.get('/plan/:projectId', async (c) => {
  const userId = c.get('user')!.id
  const projectId = c.req.param('projectId')

  // Verify project ownership
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), eq(projects.ownerId, userId))
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const rawNodes = await db.select().from(planNodes).where(eq(planNodes.projectId, projectId))
  const nodes = rawNodes.map(n => ({
    id: n.clientId, // Use clientId as frontend ID
    projectId: n.projectId,
    type: n.type,
    title: n.title,
    description: n.description,
    status: n.status,
    parentId: n.parentId,
    dependencies: [], // Will be populated from planNodeDependencies if needed
    environment: n.environment,
    verification: n.verification,
    position: { x: n.positionX, y: n.positionY },
    startDate: n.startDate,
    endDate: n.endDate,
    priority: n.priority,
    estimate: n.estimate,
    dueDate: n.dueDate,
    milestoneId: n.milestoneId,
    labelIds: n.labelIds,
    executionId: n.executionId,
    executionOutput: n.executionOutput,
    executionError: n.executionError,
    executionStartedAt: n.executionStartedAt,
    executionCompletedAt: n.executionCompletedAt,
    branchName: n.branchName,
    prUrl: n.prUrl,
    prNumber: n.prNumber,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }))

  const rawEdges = await db.select().from(planEdges).where(eq(planEdges.projectId, projectId))
  const edges = rawEdges.map(e => ({
    id: e.clientId,
    source: e.sourceClientId,
    target: e.targetClientId,
    type: e.type,
  }))

  return c.json({ nodes, edges })
})

app.put('/plan/:projectId', async (c) => {
  const userId = c.get('user')!.id
  const projectId = c.req.param('projectId')

  // Verify project ownership
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), eq(projects.ownerId, userId))
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const body = await c.req.json()
  const { nodes: newNodes, edges: newEdges } = body as {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }

  // Transaction: delete existing, insert new
  await db.transaction(async (tx) => {
    await tx.delete(planEdges).where(eq(planEdges.projectId, projectId))
    await tx.delete(planNodes).where(eq(planNodes.projectId, projectId))

    for (const n of newNodes) {
      const position = n.position as { x: number; y: number } | undefined
      const row = {
        clientId: n.id as string, // Use client ID for compatibility
        projectId,
        type: n.type as string,
        title: n.title as string,
        description: (n.description as string) ?? '',
        status: (n.status as string) ?? 'planned',
        parentId: (n.parentId as string) ?? null,
        environment: (n.environment as string) ?? null,
        verification: (n.verification as string) ?? 'auto',
        positionX: position?.x ?? 0,
        positionY: position?.y ?? 0,
        startDate: (n.startDate as string) ?? null,
        endDate: (n.endDate as string) ?? null,
        priority: (n.priority as string) ?? null,
        labelIds: (n.labelIds as string[]) ?? [],
        dueDate: (n.dueDate as string) ?? null,
        estimate: (n.estimate as string) ?? null,
        milestoneId: (n.milestoneId as string) ?? null,
        executionId: (n.executionId as string) ?? null,
        executionOutput: (n.executionOutput as string) ?? null,
        executionError: (n.executionError as string) ?? null,
        executionStartedAt: (typeof n.executionStartedAt === 'string' || typeof n.executionStartedAt === 'number') ? new Date(n.executionStartedAt as string | number) : null,
        executionCompletedAt: (typeof n.executionCompletedAt === 'string' || typeof n.executionCompletedAt === 'number') ? new Date(n.executionCompletedAt as string | number) : null,
        branchName: (n.branchName as string) ?? null,
        prUrl: (n.prUrl as string) ?? null,
        prNumber: (n.prNumber as number) ?? null,
        createdAt: (typeof n.createdAt === 'string' || typeof n.createdAt === 'number') ? new Date(n.createdAt as string | number) : new Date(),
        updatedAt: (typeof n.updatedAt === 'string' || typeof n.updatedAt === 'number') ? new Date(n.updatedAt as string | number) : new Date(),
      }
      await tx.insert(planNodes).values(row)
    }

    for (const e of newEdges) {
      await tx.insert(planEdges).values({
        clientId: e.id as string,
        projectId,
        sourceClientId: e.source as string,
        targetClientId: e.target as string,
        type: (e.type as string) ?? 'dependency',
      })
    }
  })

  return c.json({ ok: true })
})

app.post('/plan/nodes', async (c) => {
  const userId = c.get('user')!.id
  const body = await c.req.json()

  // Verify project ownership
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, body.projectId), eq(projects.ownerId, userId))
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const now = new Date()
  const position = body.position as { x: number; y: number } | undefined
  await db.insert(planNodes).values({
    clientId: body.id,
    projectId: body.projectId,
    type: body.type,
    title: body.title,
    description: body.description ?? '',
    status: body.status ?? 'planned',
    parentId: body.parentId ?? null,
    environment: body.environment ?? null,
    verification: body.verification ?? 'auto',
    positionX: position?.x ?? 0,
    positionY: position?.y ?? 0,
    startDate: body.startDate ?? null,
    endDate: body.endDate ?? null,
    priority: body.priority ?? null,
    labelIds: body.labelIds ?? [],
    dueDate: body.dueDate ?? null,
    estimate: body.estimate ?? null,
    milestoneId: body.milestoneId ?? null,
    executionId: body.executionId ?? null,
    executionOutput: body.executionOutput ?? null,
    executionError: body.executionError ?? null,
    executionStartedAt: (typeof body.executionStartedAt === 'string' || typeof body.executionStartedAt === 'number') ? new Date(body.executionStartedAt) : null,
    executionCompletedAt: (typeof body.executionCompletedAt === 'string' || typeof body.executionCompletedAt === 'number') ? new Date(body.executionCompletedAt) : null,
    branchName: body.branchName ?? null,
    prUrl: body.prUrl ?? null,
    prNumber: body.prNumber ?? null,
    createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number') ? new Date(body.createdAt) : now,
    updatedAt: (typeof body.updatedAt === 'string' || typeof body.updatedAt === 'number') ? new Date(body.updatedAt) : now,
  })
  return c.json({ ok: true }, 201)
})

app.patch('/plan/nodes/:id', async (c) => {
  const userId = c.get('user')!.id
  const id = c.req.param('id')

  // Get the node to verify project ownership
  const [node] = await db.select().from(planNodes).where(eq(planNodes.clientId, id))
  if (!node) return c.json({ error: 'Node not found' }, 404)

  // Verify project ownership
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, node.projectId), eq(projects.ownerId, userId))
  )
  if (!project) return c.json({ error: 'Not authorized' }, 403)

  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (body.title !== undefined) patch.title = body.title
  if (body.description !== undefined) patch.description = body.description
  if (body.status !== undefined) patch.status = body.status
  if (body.parentId !== undefined) patch.parentId = body.parentId
  if (body.environment !== undefined) patch.environment = body.environment
  if (body.verification !== undefined) patch.verification = body.verification
  if (body.position !== undefined) {
    const pos = body.position as { x: number; y: number }
    patch.positionX = pos.x
    patch.positionY = pos.y
  }
  if (body.startDate !== undefined) patch.startDate = body.startDate || null
  if (body.endDate !== undefined) patch.endDate = body.endDate || null
  if (body.priority !== undefined) patch.priority = body.priority || null
  if (body.labelIds !== undefined) patch.labelIds = body.labelIds
  if (body.dueDate !== undefined) patch.dueDate = body.dueDate || null
  if (body.estimate !== undefined) patch.estimate = body.estimate || null
  if (body.milestoneId !== undefined) patch.milestoneId = body.milestoneId || null
  if (body.executionId !== undefined) patch.executionId = body.executionId || null
  if (body.executionOutput !== undefined) patch.executionOutput = body.executionOutput || null
  if (body.executionError !== undefined) patch.executionError = body.executionError || null
  if (body.executionStartedAt !== undefined) patch.executionStartedAt = body.executionStartedAt ? new Date(body.executionStartedAt) : null
  if (body.executionCompletedAt !== undefined) patch.executionCompletedAt = body.executionCompletedAt ? new Date(body.executionCompletedAt) : null
  if (body.branchName !== undefined) patch.branchName = body.branchName || null
  if (body.prUrl !== undefined) patch.prUrl = body.prUrl || null
  if (body.prNumber !== undefined) patch.prNumber = body.prNumber || null
  if (body.type !== undefined) patch.type = body.type

  await db.update(planNodes).set(patch).where(eq(planNodes.clientId, id))
  return c.json({ ok: true })
})

app.delete('/plan/nodes/:id', async (c) => {
  const userId = c.get('user')!.id
  const id = c.req.param('id')

  // Get the node to verify project ownership
  const [node] = await db.select().from(planNodes).where(eq(planNodes.clientId, id))
  if (!node) return c.json({ error: 'Node not found' }, 404)

  // Verify project ownership
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, node.projectId), eq(projects.ownerId, userId))
  )
  if (!project) return c.json({ error: 'Not authorized' }, 403)

  // Delete edges referencing this node first
  await db.delete(planEdges).where(
    or(eq(planEdges.sourceClientId, id), eq(planEdges.targetClientId, id))
  )
  await db.delete(planNodes).where(eq(planNodes.clientId, id))
  return c.json({ ok: true })
})

app.post('/plan/edges', async (c) => {
  const userId = c.get('user')!.id
  const body = await c.req.json()

  // Verify project ownership
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, body.projectId), eq(projects.ownerId, userId))
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  await db.insert(planEdges).values({
    clientId: body.id,
    projectId: body.projectId,
    sourceClientId: body.source,
    targetClientId: body.target,
    type: body.type ?? 'dependency',
  })
  return c.json({ ok: true }, 201)
})

app.delete('/plan/edges/:id', async (c) => {
  const userId = c.get('user')!.id
  const id = c.req.param('id')

  // Get the edge to verify project ownership
  const [edge] = await db.select().from(planEdges).where(eq(planEdges.clientId, id))
  if (!edge) return c.json({ error: 'Edge not found' }, 404)

  // Verify project ownership
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, edge.projectId), eq(projects.ownerId, userId))
  )
  if (!project) return c.json({ error: 'Not authorized' }, 403)

  await db.delete(planEdges).where(eq(planEdges.clientId, id))
  return c.json({ ok: true })
})

// ── User Profile ──────────────────────────────────────────────────────

app.get('/profile', async (c) => {
  const [row] = await db.select().from(userProfiles).where(eq(userProfiles.id, c.get('user')!.id))
  if (!row) return c.json(null)
  return c.json(row)
})

app.put('/profile', async (c) => {
  const body = await c.req.json()
  const now = new Date()

  const profile = {
    id: c.get('user')!.id,
    name: body.name ?? '',
    email: body.email ?? '',
    avatarUrl: body.avatarUrl ?? null,
    bio: body.bio ?? '',
    domains: body.domains ?? [],
    experienceLevel: body.experienceLevel ?? 'intermediate',
    preferredEnvironments: body.preferredEnvironments ?? ['local'],
    notificationsEnabled: body.notificationsEnabled ?? true,
    emailNotifications: body.emailNotifications ?? false,
    apiKeys: body.apiKeys ?? [],
    createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number') ? new Date(body.createdAt) : now,
    updatedAt: now,
  }

  await db.insert(userProfiles).values(profile).onConflictDoUpdate({
    target: userProfiles.id,
    set: { ...profile, id: undefined } as typeof profile,
  })

  const [updated] = await db.select().from(userProfiles).where(eq(userProfiles.id, c.get('user')!.id))
  return c.json(updated)
})

// ── Display Settings ──────────────────────────────────────────────────

app.get('/display-settings', async (c) => {
  const rows = await db.select().from(displaySettings).where(eq(displaySettings.userId, c.get('user')!.id))
  const result: Record<string, unknown> = {}
  for (const row of rows) {
    result[row.viewKey] = row.settings
  }
  return c.json(result)
})

app.patch('/display-settings/:view', async (c) => {
  const viewKey = c.req.param('view')
  const body = await c.req.json()

  // Check if exists
  const [existing] = await db.select().from(displaySettings).where(
    and(eq(displaySettings.userId, c.get('user')!.id), eq(displaySettings.viewKey, viewKey))
  )

  if (existing) {
    const merged = { ...(existing.settings as Record<string, unknown>), ...body }
    await db.update(displaySettings).set({ settings: merged }).where(
      and(eq(displaySettings.userId, c.get('user')!.id), eq(displaySettings.viewKey, viewKey))
    )
  } else {
    await db.insert(displaySettings).values({
      userId: c.get('user')!.id,
      viewKey,
      settings: body,
    })
  }
  return c.json({ ok: true })
})

// ── Usage Metrics ─────────────────────────────────────────────────────

app.get('/usage/today', async (c) => {
  const today = new Date().toISOString().slice(0, 10)
  const [row] = await db.select().from(usageMetrics).where(
    and(eq(usageMetrics.userId, c.get('user')!.id), eq(usageMetrics.sessionDate, today))
  )
  if (!row) {
    return c.json({
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
    })
  }
  return c.json({
    totalCostUsd: row.totalCostUsd,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    tasksCompleted: row.tasksCompleted,
    tasksFailed: row.tasksFailed,
  })
})

app.post('/usage/increment', async (c) => {
  const body = await c.req.json()
  const today = new Date().toISOString().slice(0, 10)

  const [existing] = await db.select().from(usageMetrics).where(
    and(eq(usageMetrics.userId, c.get('user')!.id), eq(usageMetrics.sessionDate, today))
  )

  if (existing) {
    await db.update(usageMetrics).set({
      totalCostUsd: sql`${usageMetrics.totalCostUsd} + ${body.totalCostUsd ?? 0}`,
      totalInputTokens: sql`${usageMetrics.totalInputTokens} + ${body.totalInputTokens ?? 0}`,
      totalOutputTokens: sql`${usageMetrics.totalOutputTokens} + ${body.totalOutputTokens ?? 0}`,
      tasksCompleted: sql`${usageMetrics.tasksCompleted} + ${body.tasksCompleted ?? 0}`,
      tasksFailed: sql`${usageMetrics.tasksFailed} + ${body.tasksFailed ?? 0}`,
    }).where(eq(usageMetrics.id, existing.id))
  } else {
    await db.insert(usageMetrics).values({
      userId: c.get('user')!.id,
      sessionDate: today,
      totalCostUsd: body.totalCostUsd ?? 0,
      totalInputTokens: body.totalInputTokens ?? 0,
      totalOutputTokens: body.totalOutputTokens ?? 0,
      tasksCompleted: body.tasksCompleted ?? 0,
      tasksFailed: body.tasksFailed ?? 0,
    })
  }
  return c.json({ ok: true })
})

// ── Settings ──────────────────────────────────────────────────────────

app.get('/settings', async (c) => {
  // Settings are stored in user profile metadata
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, c.get('user')!.id))
  if (!profile) {
    return c.json({ model: 'claude-sonnet-4-5-20250929', defaultProvider: '' })
  }
  // Extract settings from profile bio or use defaults
  // For now, return defaults - in production, add model/defaultProvider columns to user_profiles
  return c.json({
    model: 'claude-sonnet-4-5-20250929',
    defaultProvider: '',
  })
})

app.patch('/settings', async (c) => {
  // Settings patch endpoint - in production, store in user_profiles
  // For now, just acknowledge the request
  return c.json({ ok: true })
})

// ── Task Chat ─────────────────────────────────────────────────────────

app.get('/chat', async (c) => {
  const sessions = await db.select().from(taskChatSessions).where(eq(taskChatSessions.userId, c.get('user')!.id))
  const result: Record<string, { session: typeof sessions[0]; messages: Array<typeof taskChatMessages.$inferSelect> }> = {}

  for (const session of sessions) {
    const messages = await db.select().from(taskChatMessages).where(
      eq(taskChatMessages.sessionId, session.id)
    )
    result[session.nodeId] = { session, messages }
  }
  return c.json(result)
})

app.get('/chat/:nodeId', async (c) => {
  const nodeId = c.req.param('nodeId')
  const [session] = await db.select().from(taskChatSessions).where(
    and(eq(taskChatSessions.nodeId, nodeId), eq(taskChatSessions.userId, c.get('user')!.id))
  )
  if (!session) return c.json(null)

  const messages = await db.select().from(taskChatMessages).where(
    eq(taskChatMessages.sessionId, session.id)
  )
  return c.json({ session, messages })
})

app.post('/chat/:nodeId/session', async (c) => {
  const nodeId = c.req.param('nodeId')
  const body = await c.req.json()
  const now = new Date()

  // Upsert session
  const [existing] = await db.select().from(taskChatSessions).where(
    and(eq(taskChatSessions.nodeId, nodeId), eq(taskChatSessions.userId, c.get('user')!.id))
  )

  if (existing) {
    await db.update(taskChatSessions).set({
      projectId: body.projectId ?? existing.projectId,
      sessionId: body.sessionId ?? existing.sessionId,
      updatedAt: now,
    }).where(eq(taskChatSessions.id, existing.id))
  } else {
    await db.insert(taskChatSessions).values({
      nodeId,
      userId: c.get('user')!.id,
      projectId: body.projectId,
      sessionId: body.sessionId ?? null,
      createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number') ? new Date(body.createdAt) : now,
      updatedAt: now,
    })
  }
  return c.json({ ok: true })
})

app.post('/chat/:nodeId/messages', async (c) => {
  const nodeId = c.req.param('nodeId')
  const body = await c.req.json()

  // Get or create session first
  const [session] = await db.select().from(taskChatSessions).where(
    and(eq(taskChatSessions.nodeId, nodeId), eq(taskChatSessions.userId, c.get('user')!.id))
  )

  if (!session) {
    return c.json({ error: 'Session not found. Create session first.' }, 404)
  }

  await db.insert(taskChatMessages).values({
    id: body.id,
    sessionId: session.id,
    role: body.role,
    content: body.content,
    createdAt: (typeof body.timestamp === 'string' || typeof body.timestamp === 'number') ? new Date(body.timestamp) : new Date(),
  }).onConflictDoUpdate({
    target: taskChatMessages.id,
    set: {
      content: body.content,
      createdAt: (typeof body.timestamp === 'string' || typeof body.timestamp === 'number') ? new Date(body.timestamp) : new Date(),
    },
  })
  return c.json({ ok: true }, 201)
})

app.patch('/chat/:nodeId/session', async (c) => {
  const nodeId = c.req.param('nodeId')
  const body = await c.req.json()

  await db.update(taskChatSessions).set({
    sessionId: body.sessionId,
    updatedAt: new Date(),
  }).where(
    and(eq(taskChatSessions.nodeId, nodeId), eq(taskChatSessions.userId, c.get('user')!.id))
  )
  return c.json({ ok: true })
})

app.delete('/chat/:nodeId', async (c) => {
  const nodeId = c.req.param('nodeId')

  // Get session first to find its ID
  const [session] = await db.select().from(taskChatSessions).where(
    and(eq(taskChatSessions.nodeId, nodeId), eq(taskChatSessions.userId, c.get('user')!.id))
  )

  if (session) {
    // Messages will cascade delete via foreign key
    await db.delete(taskChatSessions).where(eq(taskChatSessions.id, session.id))
  }

  return c.json({ ok: true })
})

// ── Unified Sessions ──────────────────────────────────────────────────

app.get('/sessions', async (c) => {
  const userId = c.get('user')!.id
  const userSessions = await db.select().from(sessions).where(eq(sessions.userId, userId))
  return c.json(userSessions)
})

app.get('/sessions/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const userId = c.get('user')!.id
  const [session] = await db.select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
  )
  return c.json(session || null)
})

app.post('/sessions', async (c) => {
  const userId = c.get('user')!.id
  const body = await c.req.json()

  await db.insert(sessions).values({
    ...body,
    userId,
  })

  return c.json(body)
})

app.patch('/sessions/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const userId = c.get('user')!.id
  const body = await c.req.json()

  await db.update(sessions)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))

  return c.json({ ok: true })
})

app.delete('/sessions/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const userId = c.get('user')!.id

  await db.delete(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
  )

  return c.json({ ok: true })
})

app.post('/sessions/:sessionId/messages', async (c) => {
  const sessionId = c.req.param('sessionId')
  const userId = c.get('user')!.id
  const message = await c.req.json()

  // Get current session
  const [session] = await db.select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
  )

  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  // Append message to messages array
  const updatedMessages = [...(session.messages || []), message]

  await db.update(sessions)
    .set({ messages: updatedMessages, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))

  return c.json({ ok: true })
})

// ── Task Executions ───────────────────────────────────────────────────

app.get('/executions', async (c) => {
  const userId = c.get('user')!.id

  // Get user's projects
  const userProjects = await db.select().from(projects).where(eq(projects.ownerId, userId))
  const projectIds = new Set(userProjects.map(p => p.id))

  if (projectIds.size === 0) {
    return c.json({})
  }

  // Get all executions for user's projects
  const executions = await db.select().from(taskExecutions)
  const filtered = executions.filter(e => projectIds.has(e.projectId))

  // Convert to map keyed by nodeClientId
  const result: Record<string, unknown> = {}
  for (const exec of filtered) {
    result[exec.nodeClientId] = {
      executionId: exec.executionId,
      nodeId: exec.nodeClientId,
      projectId: exec.projectId,
      status: exec.status,
      streamText: exec.streamText,
      error: exec.error,
      toolTraces: [],
      fileChanges: [],
      machineId: exec.machineId,
      providerId: exec.providerId,
      providerName: exec.providerName,
      startedAt: exec.startedAt,
      completedAt: exec.completedAt,
      durationMs: exec.durationMs,
    }
  }

  return c.json(result)
})

app.post('/executions', async (c) => {
  const userId = c.get('user')!.id
  const body = await c.req.json()

  // Verify the project belongs to the user
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, body.projectId), eq(projects.ownerId, userId))
  )
  if (!project) {
    return c.json({ error: 'Project not found or not authorized' }, 404)
  }

  // Upsert execution
  await db.insert(taskExecutions).values({
    executionId: body.executionId,
    nodeClientId: body.nodeId,
    projectId: body.projectId,
    status: body.status || 'pending',
    streamText: body.streamText || '',
    error: body.error || null,
    startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
    completedAt: body.completedAt ? new Date(body.completedAt) : null,
    sessionId: body.sessionId || null,
    machineId: body.machineId || null,
    providerId: body.providerId || null,
    providerName: body.providerName || null,
    durationMs: body.metrics?.durationMs || null,
    inputTokens: body.metrics?.inputTokens || null,
    outputTokens: body.metrics?.outputTokens || null,
    tokensUsed: body.metrics?.totalTokens || null,
    estimatedCostUsd: body.metrics?.estimatedCostUsd || null,
    model: body.metrics?.model || null,
    turnsUsed: body.metrics?.turnsUsed || null,
  }).onConflictDoUpdate({
    target: taskExecutions.executionId,
    set: {
      status: body.status,
      streamText: body.streamText || '',
      error: body.error || null,
      completedAt: body.completedAt ? new Date(body.completedAt) : null,
      durationMs: body.metrics?.durationMs || null,
      inputTokens: body.metrics?.inputTokens || null,
      outputTokens: body.metrics?.outputTokens || null,
      tokensUsed: body.metrics?.totalTokens || null,
      estimatedCostUsd: body.metrics?.estimatedCostUsd || null,
      model: body.metrics?.model || null,
      turnsUsed: body.metrics?.turnsUsed || null,
    },
  })

  return c.json({ ok: true })
})

// ── Data Export (GDPR compliance) ────────────────────────────────────

app.get('/export', async (c) => {
  const userId = c.get('user')!.id

  console.log('[data] Exporting user data for:', userId)

  try {
    // Export all user data
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
    const userProjects = await db.select().from(projects).where(eq(projects.ownerId, userId))
    const settings = await db.select().from(displaySettings).where(eq(displaySettings.userId, userId))
    const usage = await db.select().from(usageMetrics).where(eq(usageMetrics.userId, userId))
    const chatSessions = await db.select().from(taskChatSessions).where(eq(taskChatSessions.userId, userId))

    // Get all plan nodes for user's projects
    const projectIds = userProjects.map((p) => p.id)
    let nodes: Array<typeof planNodes.$inferSelect> = []
    let edges: Array<typeof planEdges.$inferSelect> = []
    let executions: Array<typeof taskExecutions.$inferSelect> = []

    if (projectIds.length > 0) {
      for (const projectId of projectIds) {
        const projectNodes = await db.select().from(planNodes).where(eq(planNodes.projectId, projectId))
        const projectEdges = await db.select().from(planEdges).where(eq(planEdges.projectId, projectId))
        const projectExecutions = await db.select().from(taskExecutions).where(eq(taskExecutions.projectId, projectId))
        nodes = [...nodes, ...projectNodes]
        edges = [...edges, ...projectEdges]
        executions = [...executions, ...projectExecutions]
      }
    }

    // Get chat messages for all sessions
    const chatMessages: Array<typeof taskChatMessages.$inferSelect> = []
    for (const session of chatSessions) {
      const messages = await db.select().from(taskChatMessages).where(
        eq(taskChatMessages.sessionId, session.id)
      )
      chatMessages.push(...messages)
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      userId,
      profile,
      projects: userProjects,
      planNodes: nodes,
      planEdges: edges,
      executions,
      displaySettings: settings,
      usageMetrics: usage,
      chatSessions,
      chatMessages,
    }

    console.log('[data] Export complete:', {
      projects: userProjects.length,
      nodes: nodes.length,
      edges: edges.length,
      executions: executions.length,
      chatSessions: chatSessions.length,
      chatMessages: chatMessages.length,
    })

    // Audit log the data export
    await logAuditEvent({
      userId,
      action: AuditActions.DATA_EXPORT,
      resourceType: ResourceTypes.DATA,
      details: {
        projectsExported: userProjects.length,
        nodesExported: nodes.length,
        executionsExported: executions.length,
      },
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    })

    return c.json(exportData)
  } catch (error) {
    console.error('[data] Export failed:', error)
    return c.json({ error: 'Failed to export user data' }, 500)
  }
})

export const dataRoute = app
