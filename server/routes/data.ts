import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import {
  projects,
  planNodes,
  planEdges,
  userProfiles,
  apiKeys,
  displaySettings,
  usageMetrics,
  taskChatSessions,
  taskChatMessages,
  appSettings,
} from '../lib/db/schema.js'
import { eq, and, or, sql } from 'drizzle-orm'

const app = new Hono()

const USER_ID = 'dev-user'

// ── Projects ──────────────────────────────────────────────────────────

app.get('/projects', async (c) => {
  const rows = await db.select().from(projects).where(eq(projects.userId, USER_ID))
  return c.json(rows)
})

app.post('/projects', async (c) => {
  const body = await c.req.json()
  const now = new Date()
  const row = {
    id: body.id,
    userId: USER_ID,
    name: body.name,
    description: body.description ?? '',
    visionDoc: body.visionDoc ?? '',
    status: body.status ?? 'active',
    startDate: body.startDate ?? null,
    targetDate: body.targetDate ?? null,
    lead: body.lead ?? null,
    health: body.health ?? null,
    initiative: body.initiative ?? null,
    progress: body.progress ?? 0,
    labels: body.labels ?? [],
    workingDirectory: body.workingDirectory ?? null,
    repository: body.repository ?? null,
    defaultEnvironment: body.defaultEnvironment ?? null,
    defaultMachineId: body.defaultMachineId ?? null,
    createdAt: body.createdAt ? new Date(body.createdAt) : now,
    updatedAt: body.updatedAt ? new Date(body.updatedAt) : now,
  }
  await db.insert(projects).values(row).onConflictDoUpdate({
    target: projects.id,
    set: { ...row, userId: undefined } as typeof row,
  })
  const [created] = await db.select().from(projects).where(eq(projects.id, row.id))
  return c.json(created, 201)
})

app.get('/projects/:id', async (c) => {
  const [row] = await db.select().from(projects).where(eq(projects.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

app.patch('/projects/:id', async (c) => {
  const id = c.req.param('id')
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
  if (body.initiative !== undefined) patch.initiative = body.initiative || null
  if (body.progress !== undefined) patch.progress = body.progress
  if (body.labels !== undefined) patch.labels = body.labels
  if (body.workingDirectory !== undefined) patch.workingDirectory = body.workingDirectory || null
  if (body.repository !== undefined) patch.repository = body.repository || null
  if (body.defaultEnvironment !== undefined) patch.defaultEnvironment = body.defaultEnvironment || null
  if (body.defaultMachineId !== undefined) patch.defaultMachineId = body.defaultMachineId || null

  await db.update(projects).set(patch).where(eq(projects.id, id))
  const [updated] = await db.select().from(projects).where(eq(projects.id, id))
  return c.json(updated)
})

app.delete('/projects/:id', async (c) => {
  await db.delete(projects).where(eq(projects.id, c.req.param('id')))
  return c.json({ ok: true })
})

// ── Plan (nodes + edges) ──────────────────────────────────────────────

app.get('/plan', async (c) => {
  const nodes = await db.select().from(planNodes)
  const edges = await db.select().from(planEdges)
  return c.json({ nodes, edges })
})

app.get('/plan/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const nodes = await db.select().from(planNodes).where(eq(planNodes.projectId, projectId))
  const edges = await db.select().from(planEdges).where(eq(planEdges.projectId, projectId))
  return c.json({ nodes, edges })
})

app.put('/plan/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const body = await c.req.json()
  const { nodes: newNodes, edges: newEdges } = body as {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }

  // Transaction: delete existing, insert new
  db.transaction((tx) => {
    tx.delete(planEdges).where(eq(planEdges.projectId, projectId)).run()
    tx.delete(planNodes).where(eq(planNodes.projectId, projectId)).run()

    for (const n of newNodes) {
      const row = {
        id: n.id as string,
        projectId,
        type: n.type as string,
        title: n.title as string,
        description: (n.description as string) ?? '',
        status: (n.status as string) ?? 'planned',
        parentId: (n.parentId as string) ?? null,
        dependencies: (n.dependencies as string[]) ?? [],
        environment: (n.environment as string) ?? null,
        verification: (n.verification as string) ?? 'auto',
        position: n.position as { x: number; y: number },
        startDate: (n.startDate as string) ?? null,
        endDate: (n.endDate as string) ?? null,
        priority: (n.priority as string) ?? null,
        labelIds: (n.labelIds as string[]) ?? null,
        dueDate: (n.dueDate as string) ?? null,
        estimate: (n.estimate as string) ?? null,
        milestoneId: (n.milestoneId as string) ?? null,
        boardOrder: (n.boardOrder as number) ?? null,
        executionId: (n.executionId as string) ?? null,
        executionOutput: (n.executionOutput as string) ?? null,
        executionError: (n.executionError as string) ?? null,
        executionStartedAt: n.executionStartedAt ? new Date(n.executionStartedAt as string) : null,
        executionCompletedAt: n.executionCompletedAt ? new Date(n.executionCompletedAt as string) : null,
        createdAt: n.createdAt ? new Date(n.createdAt as string) : new Date(),
        updatedAt: n.updatedAt ? new Date(n.updatedAt as string) : new Date(),
      }
      tx.insert(planNodes).values(row).onConflictDoUpdate({
        target: planNodes.id,
        set: { ...row, id: undefined } as typeof row,
      }).run()
    }

    for (const e of newEdges) {
      tx.insert(planEdges).values({
        id: e.id as string,
        projectId,
        source: e.source as string,
        target: e.target as string,
        type: (e.type as string) ?? 'dependency',
      }).onConflictDoUpdate({
        target: planEdges.id,
        set: {
          projectId,
          source: e.source as string,
          target: e.target as string,
          type: (e.type as string) ?? 'dependency',
        },
      }).run()
    }
  })

  return c.json({ ok: true })
})

app.post('/plan/nodes', async (c) => {
  const body = await c.req.json()
  const now = new Date()
  await db.insert(planNodes).values({
    id: body.id,
    projectId: body.projectId,
    type: body.type,
    title: body.title,
    description: body.description ?? '',
    status: body.status ?? 'planned',
    parentId: body.parentId ?? null,
    dependencies: body.dependencies ?? [],
    environment: body.environment ?? null,
    verification: body.verification ?? 'auto',
    position: body.position,
    startDate: body.startDate ?? null,
    endDate: body.endDate ?? null,
    priority: body.priority ?? null,
    labelIds: body.labelIds ?? null,
    dueDate: body.dueDate ?? null,
    estimate: body.estimate ?? null,
    milestoneId: body.milestoneId ?? null,
    boardOrder: body.boardOrder ?? null,
    executionId: body.executionId ?? null,
    executionOutput: body.executionOutput ?? null,
    executionError: body.executionError ?? null,
    executionStartedAt: body.executionStartedAt ? new Date(body.executionStartedAt) : null,
    executionCompletedAt: body.executionCompletedAt ? new Date(body.executionCompletedAt) : null,
    createdAt: body.createdAt ? new Date(body.createdAt) : now,
    updatedAt: body.updatedAt ? new Date(body.updatedAt) : now,
  })
  return c.json({ ok: true }, 201)
})

app.patch('/plan/nodes/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (body.title !== undefined) patch.title = body.title
  if (body.description !== undefined) patch.description = body.description
  if (body.status !== undefined) patch.status = body.status
  if (body.parentId !== undefined) patch.parentId = body.parentId
  if (body.dependencies !== undefined) patch.dependencies = body.dependencies
  if (body.environment !== undefined) patch.environment = body.environment
  if (body.verification !== undefined) patch.verification = body.verification
  if (body.position !== undefined) patch.position = body.position
  if (body.startDate !== undefined) patch.startDate = body.startDate || null
  if (body.endDate !== undefined) patch.endDate = body.endDate || null
  if (body.priority !== undefined) patch.priority = body.priority || null
  if (body.labelIds !== undefined) patch.labelIds = body.labelIds
  if (body.dueDate !== undefined) patch.dueDate = body.dueDate || null
  if (body.estimate !== undefined) patch.estimate = body.estimate || null
  if (body.milestoneId !== undefined) patch.milestoneId = body.milestoneId || null
  if (body.boardOrder !== undefined) patch.boardOrder = body.boardOrder
  if (body.executionId !== undefined) patch.executionId = body.executionId || null
  if (body.executionOutput !== undefined) patch.executionOutput = body.executionOutput || null
  if (body.executionError !== undefined) patch.executionError = body.executionError || null
  if (body.executionStartedAt !== undefined) patch.executionStartedAt = body.executionStartedAt ? new Date(body.executionStartedAt) : null
  if (body.executionCompletedAt !== undefined) patch.executionCompletedAt = body.executionCompletedAt ? new Date(body.executionCompletedAt) : null
  if (body.type !== undefined) patch.type = body.type

  await db.update(planNodes).set(patch).where(eq(planNodes.id, id))
  return c.json({ ok: true })
})

app.delete('/plan/nodes/:id', async (c) => {
  const id = c.req.param('id')
  // Delete edges referencing this node first
  await db.delete(planEdges).where(
    or(eq(planEdges.source, id), eq(planEdges.target, id))
  )
  await db.delete(planNodes).where(eq(planNodes.id, id))
  return c.json({ ok: true })
})

app.post('/plan/edges', async (c) => {
  const body = await c.req.json()
  await db.insert(planEdges).values({
    id: body.id,
    projectId: body.projectId,
    source: body.source,
    target: body.target,
    type: body.type ?? 'dependency',
  })
  return c.json({ ok: true }, 201)
})

app.delete('/plan/edges/:id', async (c) => {
  await db.delete(planEdges).where(eq(planEdges.id, c.req.param('id')))
  return c.json({ ok: true })
})

// ── User Profile ──────────────────────────────────────────────────────

app.get('/profile', async (c) => {
  const [row] = await db.select().from(userProfiles).where(eq(userProfiles.id, USER_ID))
  if (!row) return c.json(null)

  // Load api keys
  const keys = await db.select().from(apiKeys).where(eq(apiKeys.userId, USER_ID))
  return c.json({ ...row, apiKeys: keys })
})

app.put('/profile', async (c) => {
  const body = await c.req.json()
  const now = new Date()

  const profile = {
    id: USER_ID,
    name: body.name ?? '',
    email: body.email ?? '',
    avatarUrl: body.avatarUrl ?? null,
    bio: body.bio ?? '',
    domains: body.domains ?? [],
    experienceLevel: body.experienceLevel ?? 'intermediate',
    preferredEnvironments: body.preferredEnvironments ?? ['local'],
    notificationsEnabled: body.notificationsEnabled ?? true,
    emailNotifications: body.emailNotifications ?? false,
    createdAt: body.createdAt ? new Date(body.createdAt) : now,
    updatedAt: now,
  }

  await db.insert(userProfiles).values(profile).onConflictDoUpdate({
    target: userProfiles.id,
    set: { ...profile },
  })

  // Handle api keys: delete + re-insert
  if (body.apiKeys) {
    db.transaction((tx) => {
      tx.delete(apiKeys).where(eq(apiKeys.userId, USER_ID)).run()
      for (const key of body.apiKeys as Array<Record<string, unknown>>) {
        tx.insert(apiKeys).values({
          id: key.id as string,
          userId: USER_ID,
          provider: key.provider as string,
          name: key.name as string,
          maskedKey: key.maskedKey as string,
          createdAt: key.createdAt ? new Date(key.createdAt as string) : now,
        }).run()
      }
    })
  }

  const keys = await db.select().from(apiKeys).where(eq(apiKeys.userId, USER_ID))
  const [updated] = await db.select().from(userProfiles).where(eq(userProfiles.id, USER_ID))
  return c.json({ ...updated, apiKeys: keys })
})

// ── Display Settings ──────────────────────────────────────────────────

app.get('/display-settings', async (c) => {
  const rows = await db.select().from(displaySettings).where(eq(displaySettings.userId, USER_ID))
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
    and(eq(displaySettings.userId, USER_ID), eq(displaySettings.viewKey, viewKey))
  )

  if (existing) {
    const merged = { ...(existing.settings as Record<string, unknown>), ...body }
    await db.update(displaySettings).set({ settings: merged }).where(eq(displaySettings.id, existing.id))
  } else {
    await db.insert(displaySettings).values({
      userId: USER_ID,
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
    and(eq(usageMetrics.userId, USER_ID), eq(usageMetrics.sessionDate, today))
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
    and(eq(usageMetrics.userId, USER_ID), eq(usageMetrics.sessionDate, today))
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
      userId: USER_ID,
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

// ── Task Chat ─────────────────────────────────────────────────────────

app.get('/chat', async (c) => {
  const sessions = await db.select().from(taskChatSessions).where(eq(taskChatSessions.userId, USER_ID))
  const result: Record<string, { session: typeof sessions[0]; messages: Array<typeof taskChatMessages.$inferSelect> }> = {}

  for (const session of sessions) {
    const messages = await db.select().from(taskChatMessages).where(
      and(
        eq(taskChatMessages.sessionNodeId, session.nodeId),
        eq(taskChatMessages.sessionUserId, USER_ID),
      )
    )
    result[session.nodeId] = { session, messages }
  }
  return c.json(result)
})

app.get('/chat/:nodeId', async (c) => {
  const nodeId = c.req.param('nodeId')
  const [session] = await db.select().from(taskChatSessions).where(
    and(eq(taskChatSessions.nodeId, nodeId), eq(taskChatSessions.userId, USER_ID))
  )
  if (!session) return c.json(null)

  const messages = await db.select().from(taskChatMessages).where(
    and(
      eq(taskChatMessages.sessionNodeId, nodeId),
      eq(taskChatMessages.sessionUserId, USER_ID),
    )
  )
  return c.json({ session, messages })
})

app.post('/chat/:nodeId/session', async (c) => {
  const nodeId = c.req.param('nodeId')
  const body = await c.req.json()
  const now = new Date()

  // Upsert session
  const [existing] = await db.select().from(taskChatSessions).where(
    and(eq(taskChatSessions.nodeId, nodeId), eq(taskChatSessions.userId, USER_ID))
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
      userId: USER_ID,
      projectId: body.projectId,
      sessionId: body.sessionId ?? null,
      createdAt: body.createdAt ? new Date(body.createdAt) : now,
      updatedAt: now,
    })
  }
  return c.json({ ok: true })
})

app.post('/chat/:nodeId/messages', async (c) => {
  const nodeId = c.req.param('nodeId')
  const body = await c.req.json()

  await db.insert(taskChatMessages).values({
    id: body.id,
    sessionNodeId: nodeId,
    sessionUserId: USER_ID,
    role: body.role,
    content: body.content,
    timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
  }).onConflictDoUpdate({
    target: taskChatMessages.id,
    set: {
      content: body.content,
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
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
    and(eq(taskChatSessions.nodeId, nodeId), eq(taskChatSessions.userId, USER_ID))
  )
  return c.json({ ok: true })
})

app.delete('/chat/:nodeId', async (c) => {
  const nodeId = c.req.param('nodeId')
  await db.delete(taskChatMessages).where(
    and(
      eq(taskChatMessages.sessionNodeId, nodeId),
      eq(taskChatMessages.sessionUserId, USER_ID),
    )
  )
  await db.delete(taskChatSessions).where(
    and(eq(taskChatSessions.nodeId, nodeId), eq(taskChatSessions.userId, USER_ID))
  )
  return c.json({ ok: true })
})

// ── App Settings ──────────────────────────────────────────────────────

app.get('/settings', async (c) => {
  const rows = await db.select().from(appSettings).where(eq(appSettings.userId, USER_ID))
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return c.json(result)
})

app.patch('/settings', async (c) => {
  const body = await c.req.json() as Record<string, string>

  for (const [key, value] of Object.entries(body)) {
    const [existing] = await db.select().from(appSettings).where(
      and(eq(appSettings.userId, USER_ID), eq(appSettings.key, key))
    )
    if (existing) {
      await db.update(appSettings).set({ value }).where(eq(appSettings.id, existing.id))
    } else {
      await db.insert(appSettings).values({ userId: USER_ID, key, value })
    }
  }
  return c.json({ ok: true })
})

export const dataRoute = app
