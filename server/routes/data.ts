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
  activityEvents,
  teams,
  teamMembers,
  toolTraces,
  fileChanges,
  blobs,
  nodeComments,
  environmentConfigs,
  streamingEvents,
} from '../lib/db/schema.js'
import { eq, and, or, sql, desc, isNull, inArray } from 'drizzle-orm'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { logAuditEvent, AuditActions, ResourceTypes } from '../middleware/audit.js'
import { isServerMode } from '../lib/app-mode.js'
import { getServiceClient } from '../lib/supabase.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { extractRepoInfo } from '../lib/git-url-utils.js'

/**
 * Build a team-scoped filter with legacy fallback.
 * Matches rows where teamId equals the user's active team,
 * OR where teamId is null and ownerId matches (for legacy data).
 */
function teamScopeFilter(table: { teamId: typeof projects.teamId; ownerId: typeof projects.ownerId }, user: AuthUser) {
  return or(
    eq(table.teamId, user.teamId),
    and(isNull(table.teamId), eq(table.ownerId, user.id))
  )!
}

const app = new Hono()

// Apply authentication middleware to all routes
app.use('/*', requireAuth)

// ── Projects ──────────────────────────────────────────────────────────

app.get('/projects', async (c) => {
  const user = c.get('user')! as AuthUser
  const rows = await db.select().from(projects).where(teamScopeFilter(projects, user))
  return c.json(rows)
})

app.post('/projects', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()
  const now = new Date()

  // Validate project name
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Project name is required and must be non-empty' }, 400)
  }

  // Validate GitHub metadata consistency (same logic as PATCH endpoint)
  const githubOwner = body.githubOwner || null
  const githubRepo = body.githubRepo || null
  const githubRepoId = body.githubRepoId || null
  const ownerOrRepoCleared = githubOwner === null || githubRepo === null
  const ownerOrRepoSet = githubOwner !== null || githubRepo !== null
  if (ownerOrRepoCleared && ownerOrRepoSet) {
    return c.json({ error: 'GitHub metadata inconsistent: githubOwner and githubRepo must both be set or both be null' }, 400)
  }

  // Auto-extract githubOwner/githubRepo from repository URL when not explicitly provided
  let finalGithubOwner = githubOwner
  let finalGithubRepo = githubRepo
  if (finalGithubOwner === null && finalGithubRepo === null && body.repository) {
    const extracted = extractRepoInfo(body.repository)
    if (extracted) {
      finalGithubOwner = extracted.owner
      finalGithubRepo = extracted.repo
    }
  }

  // Generate UUID if not provided
  const projectId = body.id || crypto.randomUUID()
  const teamId = user.teamId || body.teamId || null

  // Server-authoritative number assignment in a transaction
  let assignedNumber: number | null = null
  const isNewProject = body.id === undefined || !body.createdAt

  await db.transaction(async (tx) => {
    if (isNewProject) {
      // Compute MAX(number)+1 scoped to team (or owner for legacy data)
      const scopeFilter = teamId
        ? eq(projects.teamId, teamId)
        : eq(projects.ownerId, user.id)
      const [maxRow] = await tx.select({ maxNum: sql<number>`COALESCE(MAX(${projects.number}), 0)` })
        .from(projects)
        .where(scopeFilter)
      assignedNumber = (maxRow?.maxNum ?? 0) + 1
    }

    const row = {
      id: projectId,
      ownerId: user.id,
      name: body.name,
      description: body.description ?? '',
      visionDoc: body.visionDoc ?? '',
      status: body.status ?? 'active',
      startDate: body.startDate ?? null,
      targetDate: body.targetDate ?? null,
      lead: body.lead ?? null,
      health: body.health ?? null,
      initiativeId: body.initiativeId ?? null,
      teamId,
      progress: body.progress ?? 0,
      labels: body.labels ?? [],
      color: body.color ?? '#3b82f6',
      icon: body.icon ?? '📋',
      number: assignedNumber ?? (body.number ?? null),
      workingDirectory: body.workingDirectory || null,
      sourceDirectory: body.sourceDirectory || null,
      repository: body.repository || null,
      // Use pre-validated GitHub variables, with auto-extraction fallback from repository URL
      githubOwner: finalGithubOwner,
      githubRepo: finalGithubRepo,
      githubRepoId,
      defaultMachineId: body.defaultMachineId || null,
      projectBranch: body.projectBranch || null,
      mergeQueueEnabled: body.mergeQueueEnabled ?? false,
      mergeQueueMergeMethod: body.mergeQueueMergeMethod ?? 'squash',
      source: body.source ?? null,
      deliveryMode: body.deliveryMode ?? null,
      projectType: body.projectType ?? 'default',
      createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number') ? new Date(body.createdAt) : now,
      updatedAt: (typeof body.updatedAt === 'string' || typeof body.updatedAt === 'number') ? new Date(body.updatedAt) : now,
    }
    await tx.insert(projects).values(row).onConflictDoUpdate({
      target: projects.id,
      set: { ...row, id: undefined } as typeof row,
    })
  })

  const [created] = await db.select().from(projects).where(eq(projects.id, projectId))

  // Audit log project creation (only on new projects, not updates)
  if (body.id === undefined || !body.createdAt) {
    await logAuditEvent({
      userId: user.id,
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
  const user = c.get('user')! as AuthUser
  const projectId = c.req.param('id')
  const [row] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), teamScopeFilter(projects, user))
  )
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

app.patch('/projects/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const id = c.req.param('id')

  // Verify team access first
  const [existing] = await db.select().from(projects).where(
    and(eq(projects.id, id), teamScopeFilter(projects, user))
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
  if (body.teamId !== undefined) patch.teamId = body.teamId || null
  if (body.progress !== undefined) patch.progress = body.progress
  if (body.labels !== undefined) patch.labels = body.labels
  if (body.color !== undefined) patch.color = body.color
  if (body.icon !== undefined) patch.icon = body.icon
  if (body.number !== undefined) patch.number = body.number
  if (body.workingDirectory !== undefined) patch.workingDirectory = body.workingDirectory || null
  if (body.sourceDirectory !== undefined) patch.sourceDirectory = body.sourceDirectory || null
  if (body.repository !== undefined) patch.repository = body.repository || null
  if (body.githubOwner !== undefined) patch.githubOwner = body.githubOwner || null
  if (body.githubRepo !== undefined) patch.githubRepo = body.githubRepo || null
  if (body.githubRepoId !== undefined) patch.githubRepoId = body.githubRepoId ?? null
  if (body.defaultMachineId !== undefined) patch.defaultMachineId = body.defaultMachineId || null
  if (body.projectBranch !== undefined) patch.projectBranch = body.projectBranch || null
  if (body.mergeQueueEnabled !== undefined) patch.mergeQueueEnabled = body.mergeQueueEnabled ?? false
  if (body.mergeQueueMergeMethod !== undefined) patch.mergeQueueMergeMethod = body.mergeQueueMergeMethod || 'squash'
  if (body.source !== undefined) patch.source = body.source
  if (body.deliveryMode !== undefined) patch.deliveryMode = body.deliveryMode
  if (body.projectType !== undefined) patch.projectType = body.projectType

  // Auto-extract githubOwner/githubRepo from repository URL when repository is updated
  // but GitHub metadata is not explicitly provided
  const githubOwnerProvided = body.githubOwner !== undefined
  const githubRepoProvided = body.githubRepo !== undefined
  const githubRepoIdProvided = body.githubRepoId !== undefined

  if (body.repository !== undefined && !githubOwnerProvided && !githubRepoProvided) {
    const repoUrl = body.repository || null
    if (repoUrl) {
      const extracted = extractRepoInfo(repoUrl)
      if (extracted) {
        patch.githubOwner = extracted.owner
        patch.githubRepo = extracted.repo
      }
    } else {
      // Repository cleared — clear GitHub metadata too
      patch.githubOwner = null
      patch.githubRepo = null
      patch.githubRepoId = null
    }
  }

  // GitHub metadata consistency: If any field is being updated, apply atomic all-or-nothing logic
  // to prevent partial/inconsistent metadata (e.g., owner+repo set but repoId cleared)
  if (githubOwnerProvided || githubRepoProvided || githubRepoIdProvided) {
    // Compute final values (treating empty strings as null)
    const finalOwner = body.githubOwner || null
    const finalRepo = body.githubRepo || null
    const finalRepoId = body.githubRepoId || null

    // If clearing one field, clear all for consistency. If setting owner+repo, repoId can be null
    // (it may be populated later when the repo ID is fetched from GitHub API).
    // However, if owner or repo is null while the other is non-null, that's inconsistent.
    const ownerOrRepoCleared = finalOwner === null || finalRepo === null
    const ownerOrRepoSet = finalOwner !== null || finalRepo !== null

    if (ownerOrRepoCleared && ownerOrRepoSet) {
      // Inconsistent: one of owner/repo is set while the other is null
      return c.json({ error: 'GitHub metadata inconsistent: githubOwner and githubRepo must both be set or both be null' }, 400)
    }

    // Apply all three fields atomically
    patch.githubOwner = finalOwner
    patch.githubRepo = finalRepo
    // When clearing owner/repo, also clear repoId to prevent orphaned data.
    // When setting owner/repo, only update repoId if explicitly provided.
    if (finalOwner === null && finalRepo === null) {
      // Clearing all GitHub metadata
      patch.githubRepoId = null
    } else if (githubRepoIdProvided) {
      // Setting metadata and repoId was explicitly provided
      patch.githubRepoId = finalRepoId
    }
    // Otherwise, preserve existing githubRepoId (e.g., when updating owner/repo without providing repoId)
  }
  await db.update(projects).set(patch).where(
    and(eq(projects.id, id), teamScopeFilter(projects, user))
  )
  const [updated] = await db.select().from(projects).where(eq(projects.id, id))
  return c.json(updated)
})

app.delete('/projects/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const projectId = c.req.param('id')

  // Verify team access before deletion
  const [existing] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), teamScopeFilter(projects, user))
  )
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Audit log project deletion
  await logAuditEvent({
    userId: user.id,
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
    and(eq(projects.id, projectId), teamScopeFilter(projects, user))
  )
  return c.json({ ok: true })
})

// ── Initiatives ───────────────────────────────────────────────────────

app.get('/initiatives', async (c) => {
  const user = c.get('user')! as AuthUser
  const rows = await db.select().from(initiatives).where(
    or(
      eq(initiatives.teamId, user.teamId),
      and(isNull(initiatives.teamId), eq(initiatives.ownerId, user.id))
    )
  )
  return c.json(rows)
})

app.post('/initiatives', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()
  const now = new Date()

  const initiativeId = body.id || crypto.randomUUID()

  const row = {
    id: initiativeId,
    ownerId: user.id,
    teamId: user.teamId || null,
    name: body.name,
    description: body.description || '',
    goal: body.goal || null,
    status: body.status ?? 'active',
    startDate: body.startDate || null,
    targetDate: body.targetDate || null,
    lead: body.lead || null,
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
  const user = c.get('user')! as AuthUser
  const initiativeId = c.req.param('id')
  const [row] = await db.select().from(initiatives).where(
    and(eq(initiatives.id, initiativeId), or(
      eq(initiatives.teamId, user.teamId),
      and(isNull(initiatives.teamId), eq(initiatives.ownerId, user.id))
    ))
  )
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

app.patch('/initiatives/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const id = c.req.param('id')

  try {
    const teamFilter = or(
      eq(initiatives.teamId, user.teamId),
      and(isNull(initiatives.teamId), eq(initiatives.ownerId, user.id))
    )

    const [existing] = await db.select().from(initiatives).where(
      and(eq(initiatives.id, id), teamFilter)
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
      and(eq(initiatives.id, id), teamFilter)
    )
    const [updated] = await db.select().from(initiatives).where(
      and(eq(initiatives.id, id), teamFilter)
    )
    return c.json(updated)
  } catch (err) {
    console.error('[data] initiatives PATCH error:', err)
    return c.json({ error: 'Failed to update initiative' }, 500)
  }
})

app.delete('/initiatives/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const initiativeId = c.req.param('id')

  try {
    const teamFilter = or(
      eq(initiatives.teamId, user.teamId),
      and(isNull(initiatives.teamId), eq(initiatives.ownerId, user.id))
    )

    const [existing] = await db.select().from(initiatives).where(
      and(eq(initiatives.id, initiativeId), teamFilter)
    )
    if (!existing) return c.json({ error: 'Not found' }, 404)

    // Unassign projects from this initiative
    await db.update(projects)
      .set({ initiativeId: null })
      .where(eq(projects.initiativeId, initiativeId))

    await db.delete(initiatives).where(
      and(eq(initiatives.id, initiativeId), teamFilter)
    )
    return c.json({ ok: true })
  } catch (err) {
    console.error('[data] initiatives DELETE error:', err)
    return c.json({ error: 'Failed to delete initiative' }, 500)
  }
})

// ── Plan (nodes + edges) ──────────────────────────────────────────────

app.get('/plan', async (c) => {
  const user = c.get('user')! as AuthUser

  // Get team's projects
  const userProjects = await db.select().from(projects).where(teamScopeFilter(projects, user))
  const projectIds = new Set(userProjects.map(p => p.id))

  // Get all nodes for user's projects
  const rawNodes = await db.select().from(planNodes)
  const nodes = rawNodes
    .filter(n => projectIds.has(n.projectId) && !n.deletedAt)
    .map(n => ({
      id: n.clientId, // Use clientId as frontend ID
      projectId: n.projectId,
      number: n.number,
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
      content: n.content,
      attachments: n.attachments,
      links: n.links,
      acceptanceCriteria: n.acceptanceCriteria,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }))

  const rawEdges = await db.select().from(planEdges)
  const edges = rawEdges
    .filter(e => projectIds.has(e.projectId) && !e.deletedAt)
    .map(e => ({
      id: e.clientId,
      source: e.sourceClientId,
      target: e.targetClientId,
      type: e.type,
    }))

  return c.json({ nodes, edges })
})

app.get('/plan/:projectId', async (c) => {
  const user = c.get('user')! as AuthUser
  const projectId = c.req.param('projectId')

  // Verify project access via team scope
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), teamScopeFilter(projects, user))
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const rawNodes = await db.select().from(planNodes).where(eq(planNodes.projectId, projectId))
  const nodes = rawNodes.filter(n => !n.deletedAt).map(n => ({
    id: n.clientId, // Use clientId as frontend ID
    projectId: n.projectId,
    number: n.number,
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
    content: n.content,
    attachments: n.attachments,
    links: n.links,
    acceptanceCriteria: n.acceptanceCriteria,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }))

  const rawEdges = await db.select().from(planEdges).where(eq(planEdges.projectId, projectId))
  const edges = rawEdges.filter(e => !e.deletedAt).map(e => ({
    id: e.clientId,
    source: e.sourceClientId,
    target: e.targetClientId,
    type: e.type,
  }))

  return c.json({ nodes, edges })
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

app.put('/plan/:projectId', async (c) => {
  const user = c.get('user')! as AuthUser
  const projectId = c.req.param('projectId')

  if (!UUID_RE.test(projectId)) return c.json({ error: 'Invalid project ID' }, 400)

  // Verify project access via team scope
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), teamScopeFilter(projects, user))
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const body = await c.req.json()
  const { nodes: newNodes, edges: newEdges } = body as {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }

  // Transaction: delete existing, insert new with server-assigned numbers
  const numbers: Record<string, number> = {}
  await db.transaction(async (tx) => {
    await tx.delete(planEdges).where(eq(planEdges.projectId, projectId))
    await tx.delete(planNodes).where(eq(planNodes.projectId, projectId))

    let nextNumber = 1
    for (const n of newNodes) {
      const assignedNumber = nextNumber++
      const clientId = n.id as string
      numbers[clientId] = assignedNumber
      const position = n.position as { x: number; y: number } | undefined
      const row = {
        clientId, // Use client ID for compatibility
        projectId,
        number: assignedNumber,
        type: n.type as string,
        title: n.title as string,
        description: (n.description as string) ?? '',
        status: (n.status as string) ?? 'planned',
        parentId: (n.parentId as string) ?? null,
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
        mergeQueueStatus: (n.mergeQueueStatus as string) ?? null,
        autoPr: (n.autoPr as boolean) ?? false,
        content: (n.content as string) ?? null,
        attachments: (n.attachments as unknown[]) ?? [],
        links: (n.links as unknown[]) ?? [],
        acceptanceCriteria: (n.acceptanceCriteria as unknown[]) ?? [],
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

  return c.json({ ok: true, numbers })
})

app.post('/plan/nodes', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()

  if (!body.projectId || !UUID_RE.test(body.projectId)) return c.json({ error: 'Invalid project ID' }, 400)

  // Verify project access via team scope
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, body.projectId), teamScopeFilter(projects, user))
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const now = new Date()
  const position = body.position as { x: number; y: number } | undefined

  // Server-authoritative number assignment in a transaction
  let assignedNumber: number | null = null
  await db.transaction(async (tx) => {
    const [maxRow] = await tx.select({ maxNum: sql<number>`COALESCE(MAX(${planNodes.number}), 0)` })
      .from(planNodes)
      .where(eq(planNodes.projectId, body.projectId))
    assignedNumber = (maxRow?.maxNum ?? 0) + 1

    await tx.insert(planNodes).values({
      clientId: body.id,
      projectId: body.projectId,
      number: assignedNumber,
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
      mergeQueueStatus: body.mergeQueueStatus ?? null,
      autoPr: body.autoPr ?? false,
      content: body.content ?? null,
      attachments: body.attachments ?? [],
      links: body.links ?? [],
      acceptanceCriteria: body.acceptanceCriteria ?? [],
      createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number') ? new Date(body.createdAt) : now,
      updatedAt: (typeof body.updatedAt === 'string' || typeof body.updatedAt === 'number') ? new Date(body.updatedAt) : now,
    })
  })
  return c.json({ ok: true, number: assignedNumber }, 201)
})

app.patch('/plan/nodes/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const id = c.req.param('id')

  // Get the node to verify project access
  const [node] = await db.select().from(planNodes).where(eq(planNodes.clientId, id))
  if (!node) return c.json({ error: 'Node not found' }, 404)

  // Verify project access via team scope
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, node.projectId), teamScopeFilter(projects, user))
  )
  if (!project) return c.json({ error: 'Not authorized' }, 403)

  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date() }

  // number is server-authoritative — not patchable by clients
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
  if (body.actualStartDate !== undefined) patch.actualStartDate = body.actualStartDate ? new Date(body.actualStartDate) : null
  if (body.actualEndDate !== undefined) patch.actualEndDate = body.actualEndDate ? new Date(body.actualEndDate) : null
  if (body.branchName !== undefined) patch.branchName = body.branchName || null
  if (body.prUrl !== undefined) patch.prUrl = body.prUrl || null
  if (body.prNumber !== undefined) patch.prNumber = body.prNumber || null
  if (body.mergeQueueStatus !== undefined) patch.mergeQueueStatus = body.mergeQueueStatus || null
  if (body.autoPr !== undefined) patch.autoPr = body.autoPr ?? false
  if (body.content !== undefined) patch.content = body.content || null
  if (body.attachments !== undefined) patch.attachments = body.attachments ?? []
  if (body.links !== undefined) patch.links = body.links ?? []
  if (body.acceptanceCriteria !== undefined) patch.acceptanceCriteria = body.acceptanceCriteria ?? []
  if (body.type !== undefined) patch.type = body.type
  if (body.deletedAt !== undefined) patch.deletedAt = body.deletedAt ? new Date(body.deletedAt) : null
  if (body.deletionActionId !== undefined) patch.deletionActionId = body.deletionActionId || null

  await db.update(planNodes).set(patch).where(eq(planNodes.clientId, id))

  // If soft-deleting a node, also soft-delete connected edges
  if (body.deletedAt) {
    const edgePatch: Record<string, unknown> = {
      deletedAt: new Date(body.deletedAt),
    }
    if (body.deletionActionId) edgePatch.deletionActionId = body.deletionActionId
    await db.update(planEdges).set(edgePatch).where(
      or(eq(planEdges.sourceClientId, id), eq(planEdges.targetClientId, id))
    )
  }

  // Auto-dispatch downstream nodes when a node is manually approved
  if (body.status === 'completed' || body.status === 'auto_verified') {
    autoDispatchDownstream(node.projectId, id).catch((err) => {
      console.warn('[data] Auto-dispatch downstream failed:', err)
    })
  }

  // Cascade prune: when a node is pruned, prune all downstream dependents
  if (body.status === 'pruned') {
    cascadePruneDownstream(node.projectId, id).catch((err) => {
      console.warn('[data] Cascade prune downstream failed:', err)
    })
  }

  return c.json({ ok: true })
})

/**
 * Find downstream nodes whose dependencies are all completed, emit task:ready SSE events.
 */
async function autoDispatchDownstream(projectId: string, completedNodeId: string): Promise<void> {
  const allNodes = await db.select().from(planNodes)
    .where(and(eq(planNodes.projectId, projectId), isNull(planNodes.deletedAt)))
  const allEdges = await db.select().from(planEdges)
    .where(and(eq(planEdges.projectId, projectId), isNull(planEdges.deletedAt)))

  const downstreamIds = allEdges
    .filter(e => e.sourceClientId === completedNodeId)
    .map(e => e.targetClientId)

  const COMPLETED_STATUSES = ['completed', 'auto_verified']

  for (const downId of downstreamIds) {
    const downNode = allNodes.find(n => n.clientId === downId)
    if (!downNode || downNode.type !== 'task') continue
    if (downNode.status !== 'planned') continue

    const depEdges = allEdges.filter(e => e.targetClientId === downId)
    const allDepsMet = depEdges.every(depEdge => {
      const depNode = allNodes.find(n => n.clientId === depEdge.sourceClientId)
      return depNode && COMPLETED_STATUSES.includes(depNode.status)
    })

    if (allDepsMet) {
      executionEventBus.emit('task:ready', { nodeId: downId, projectId })
    }
  }
}

/**
 * Cascade prune: set all downstream dependents to 'pruned' recursively.
 */
async function cascadePruneDownstream(projectId: string, prunedNodeId: string): Promise<void> {
  const allNodes = await db.select().from(planNodes)
    .where(and(eq(planNodes.projectId, projectId), isNull(planNodes.deletedAt)))
  const allEdges = await db.select().from(planEdges)
    .where(and(eq(planEdges.projectId, projectId), isNull(planEdges.deletedAt)))

  // BFS to find all downstream nodes
  const visited = new Set<string>()
  const queue = [prunedNodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    const childIds = allEdges
      .filter(e => e.sourceClientId === current)
      .map(e => e.targetClientId)

    for (const childId of childIds) {
      if (visited.has(childId)) continue
      visited.add(childId)
      const childNode = allNodes.find(n => n.clientId === childId)
      if (!childNode) continue
      // Only prune nodes that aren't already completed
      if (childNode.status !== 'completed' && childNode.status !== 'auto_verified') {
        await db.update(planNodes).set({ status: 'pruned', updatedAt: new Date() }).where(eq(planNodes.clientId, childId))
      }
      queue.push(childId)
    }
  }
}

app.delete('/plan/nodes/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const id = c.req.param('id')

  // Get the node to verify project access
  const [node] = await db.select().from(planNodes).where(eq(planNodes.clientId, id))
  if (!node) return c.json({ error: 'Node not found' }, 404)

  // Verify project access via team scope
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, node.projectId), teamScopeFilter(projects, user))
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
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()

  // Verify project access via team scope
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, body.projectId), teamScopeFilter(projects, user))
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
  const user = c.get('user')! as AuthUser
  const id = c.req.param('id')

  // Get the edge to verify project access
  const [edge] = await db.select().from(planEdges).where(eq(planEdges.clientId, id))
  if (!edge) return c.json({ error: 'Edge not found' }, 404)

  // Verify project access via team scope
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, edge.projectId), teamScopeFilter(projects, user))
  )
  if (!project) return c.json({ error: 'Not authorized' }, 403)

  await db.delete(planEdges).where(eq(planEdges.clientId, id))
  return c.json({ ok: true })
})

// ── User Profile ──────────────────────────────────────────────────────

app.get('/profile', async (c) => {
  const userId = c.get('user')!.id
  console.log('[data] GET /profile for user:', userId)
  const [row] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
  console.log('[data] GET /profile result:', row ? { id: row.id, name: row.name, email: row.email } : 'null')
  if (!row) return c.json(null)
  return c.json(row)
})

app.put('/profile', async (c) => {
  const body = await c.req.json()
  const now = new Date()
  const userId = c.get('user')!.id

  // Read existing profile first to support partial updates
  const [existing] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))

  const defaults = {
    name: '',
    email: '',
    avatarUrl: null,
    bio: '',
    domains: [],
    experienceLevel: 'intermediate',
    preferredMachines: [],
    notificationsEnabled: true,
    emailNotifications: false,
    apiKeys: [],
    sidebarConfig: null,
  }

  // Merge: body wins over existing, existing wins over defaults
  const profile: Record<string, unknown> = {
    id: userId,
    name: body.name ?? (existing?.name ?? defaults.name),
    email: body.email ?? (existing?.email ?? defaults.email),
    avatarUrl: body.avatarUrl !== undefined ? body.avatarUrl : (existing?.avatarUrl ?? defaults.avatarUrl),
    bio: body.bio ?? (existing?.bio ?? defaults.bio),
    domains: body.domains ?? (existing?.domains ?? defaults.domains),
    experienceLevel: body.experienceLevel ?? (existing?.experienceLevel ?? defaults.experienceLevel),
    preferredMachines: body.preferredMachines ?? (existing?.preferredMachines ?? defaults.preferredMachines),
    notificationsEnabled: body.notificationsEnabled ?? (existing?.notificationsEnabled ?? defaults.notificationsEnabled),
    emailNotifications: body.emailNotifications ?? (existing?.emailNotifications ?? defaults.emailNotifications),
    apiKeys: body.apiKeys ?? (existing?.apiKeys ?? defaults.apiKeys),
    createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number') ? new Date(body.createdAt) : (existing?.createdAt ?? now),
    updatedAt: now,
  }

  // Include defaultMachineId if provided in body, otherwise keep existing
  if (body.defaultMachineId !== undefined) {
    profile.defaultMachineId = body.defaultMachineId || null
  } else if (existing?.defaultMachineId) {
    profile.defaultMachineId = existing.defaultMachineId
  }

  // Include sidebarConfig if provided in body, otherwise keep existing
  if (body.sidebarConfig !== undefined) {
    profile.sidebarConfig = body.sidebarConfig
  } else if (existing?.sidebarConfig) {
    profile.sidebarConfig = existing.sidebarConfig
  }

  await db.insert(userProfiles).values(profile).onConflictDoUpdate({
    target: userProfiles.id,
    set: { ...profile, id: undefined } as typeof profile,
  })

  // Sync name/email back to auth.users metadata (non-fatal on failure)
  if (isServerMode() && (body.name !== undefined || body.email !== undefined)) {
    try {
      const supabase = getServiceClient()
      const updatePayload: { user_metadata?: Record<string, string>; email?: string } = {}

      if (body.name !== undefined) {
        updatePayload.user_metadata = { name: body.name }
      }
      if (body.email !== undefined) {
        updatePayload.email = body.email
      }

      await supabase.auth.admin.updateUserById(userId, updatePayload)
    } catch (err) {
      console.warn('[data] Failed to sync profile to auth.users:', err)
    }
  }

  const [updated] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
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
    }).where(and(eq(usageMetrics.userId, existing.userId), eq(usageMetrics.sessionDate, existing.sessionDate)))
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
  const defaults = { model: 'claude-sonnet-4-6', defaultProvider: '' }
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, c.get('user')!.id))
  if (!profile) {
    return c.json(defaults)
  }
  const stored = (profile.settings ?? {}) as Record<string, string>
  return c.json({ ...defaults, ...stored })
})

app.patch('/settings', async (c) => {
  const userId = c.get('user')!.id
  const body = await c.req.json()

  // Read existing settings, merge with incoming
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
  const existing = (profile?.settings ?? {}) as Record<string, string>
  const merged = { ...existing, ...body }

  if (profile) {
    await db.update(userProfiles).set({ settings: merged, updatedAt: new Date() }).where(eq(userProfiles.id, userId))
  } else {
    await db.insert(userProfiles).values({ id: userId, settings: merged })
  }

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
    createdAt: body.createdAt ? new Date(body.createdAt) : new Date(),
    updatedAt: body.updatedAt ? new Date(body.updatedAt) : new Date(),
    completedAt: body.completedAt ? new Date(body.completedAt) : null,
  })

  return c.json(body)
})

app.patch('/sessions/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const userId = c.get('user')!.id
  const body = await c.req.json()

  const patch: Record<string, unknown> = { ...body, updatedAt: new Date() }
  if (body.createdAt !== undefined) {
    patch.createdAt = new Date(body.createdAt)
  }
  if (body.completedAt !== undefined) {
    patch.completedAt = body.completedAt ? new Date(body.completedAt) : null
  }
  await db.update(sessions)
    .set(patch)
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
  const user = c.get('user')! as AuthUser

  // Get team's projects
  const userProjects = await db.select().from(projects).where(teamScopeFilter(projects, user))
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
      userId: exec.userId,
      status: exec.status,
      streamText: exec.streamText,
      error: exec.error,
      toolTraces: [],
      fileChanges: [],
      activityEvents: [],
      machineId: exec.machineId,
      sessionId: exec.sessionId,
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
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()

  // Verify project access via team scope
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, body.projectId), teamScopeFilter(projects, user))
  )
  if (!project) {
    return c.json({ error: 'Project not found or not authorized' }, 404)
  }

  // Upsert execution
  await db.insert(taskExecutions).values({
    executionId: body.executionId,
    nodeClientId: body.nodeId,
    projectId: body.projectId,
    userId: user.id,
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

app.delete('/executions/:nodeId', async (c) => {
  const user = c.get('user')! as AuthUser
  const nodeId = c.req.param('nodeId')

  // Find execution records for this node
  const nodeExecutions = await db.select({
    executionId: taskExecutions.executionId,
    projectId: taskExecutions.projectId,
  })
    .from(taskExecutions)
    .where(eq(taskExecutions.nodeClientId, nodeId))

  if (nodeExecutions.length === 0) {
    return c.json({ ok: true }) // Nothing to delete
  }

  // Verify user has access to the project via team scope
  const projectId = nodeExecutions[0].projectId
  const [project] = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, projectId), teamScopeFilter(projects, user)))
  if (!project) {
    return c.json({ error: 'Not authorized' }, 403)
  }

  const executionIds = nodeExecutions.map(e => e.executionId)

  // Delete streaming events first (references execution_id)
  await db.delete(streamingEvents)
    .where(inArray(streamingEvents.executionId, executionIds))

  // Delete execution records
  await db.delete(taskExecutions)
    .where(eq(taskExecutions.nodeClientId, nodeId))

  return c.json({ ok: true })
})

// ── Tool Traces ──────────────────────────────────────────────────────

app.get('/tool-traces', async (c) => {
  const user = c.get('user')! as AuthUser
  const executionId = c.req.query('executionId')
  if (!executionId) return c.json({ error: 'executionId required' }, 400)

  // Verify user has access to this execution via project team scope
  const [execution] = await db.select({ projectId: taskExecutions.projectId })
    .from(taskExecutions)
    .where(eq(taskExecutions.executionId, executionId))
    .limit(1)
  if (execution?.projectId) {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, execution.projectId), teamScopeFilter(projects, user)))
      .limit(1)
    if (!project) return c.json({ error: 'Not authorized' }, 403)
  }

  const rows = await db.select().from(toolTraces)
    .where(eq(toolTraces.executionId, executionId))
    .orderBy(toolTraces.timestamp)
  return c.json(rows)
})

// ── File Changes ─────────────────────────────────────────────────────

app.get('/file-changes', async (c) => {
  const user = c.get('user')! as AuthUser
  const executionId = c.req.query('executionId')
  if (!executionId) return c.json({ error: 'executionId required' }, 400)

  // Verify user has access to this execution via project team scope
  const [execution] = await db.select({ projectId: taskExecutions.projectId })
    .from(taskExecutions)
    .where(eq(taskExecutions.executionId, executionId))
    .limit(1)
  if (execution?.projectId) {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, execution.projectId), teamScopeFilter(projects, user)))
      .limit(1)
    if (!project) return c.json({ error: 'Not authorized' }, 403)
  }

  const rows = await db.select().from(fileChanges)
    .where(eq(fileChanges.executionId, executionId))
    .orderBy(fileChanges.timestamp)
  return c.json(rows)
})

// ── Search ───────────────────────────────────────────────────────────

app.get('/search', async (c) => {
  const user = c.get('user')! as AuthUser
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q required' }, 400)

  const pattern = `%${q}%`

  // Search projects
  const projectResults = await db.select().from(projects)
    .where(and(
      teamScopeFilter(projects, user),
      or(
        sql`${projects.name} ILIKE ${pattern}`,
        sql`${projects.description} ILIKE ${pattern}`
      )
    ))

  // Search plan nodes (with project name join) — filter by team scope
  const taskResults = await db.select({
    id: planNodes.id,
    clientId: planNodes.clientId,
    title: planNodes.title,
    description: planNodes.description,
    status: planNodes.status,
    type: planNodes.type,
    projectId: planNodes.projectId,
    projectName: projects.name,
    updatedAt: planNodes.updatedAt,
  }).from(planNodes)
    .innerJoin(projects, eq(planNodes.projectId, projects.id))
    .where(and(
      isNull(planNodes.deletedAt),
      teamScopeFilter(projects, user),
      or(
        sql`${planNodes.title} ILIKE ${pattern}`,
        sql`${planNodes.description} ILIKE ${pattern}`
      )
    ))

  // Search executions — filter by team-scoped projects
  const executionResults = await db.select({
    executionId: taskExecutions.executionId,
    projectId: taskExecutions.projectId,
    userId: taskExecutions.userId,
    nodeId: taskExecutions.nodeId,
    status: taskExecutions.status,
    startedAt: taskExecutions.startedAt,
    completedAt: taskExecutions.completedAt,
  }).from(taskExecutions)
    .innerJoin(projects, eq(taskExecutions.projectId, projects.id))
    .where(and(
      teamScopeFilter(projects, user),
      or(
        sql`${taskExecutions.executionId} ILIKE ${pattern}`,
        sql`${taskExecutions.streamText} ILIKE ${pattern}`
      )
    ))
    .limit(20)

  return c.json({ projects: projectResults, tasks: taskResults, executions: executionResults })
})

// ── Data Export (GDPR compliance) ────────────────────────────────────

app.get('/export', async (c) => {
  const user = c.get('user')! as AuthUser

  console.log('[data] Exporting user data for:', user.id)

  try {
    // Export all user data
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, user.id))
    const userProjects = await db.select().from(projects).where(teamScopeFilter(projects, user))
    const settings = await db.select().from(displaySettings).where(eq(displaySettings.userId, user.id))
    const usage = await db.select().from(usageMetrics).where(eq(usageMetrics.userId, user.id))
    const chatSessions = await db.select().from(taskChatSessions).where(eq(taskChatSessions.userId, user.id))

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
      userId: user.id,
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
      userId: user.id,
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

// ── Activity Events ──────────────────────────────────────────────────

app.get('/activities', async (c) => {
  const projectId = c.req.query('projectId')
  const limit = parseInt(c.req.query('limit') || '100', 10)

  const conditions = [eq(activityEvents.userId, c.get('user')!.id)]
  if (projectId) {
    conditions.push(eq(activityEvents.projectId, projectId))
  }

  const rows = await db.select().from(activityEvents)
    .where(and(...conditions))
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit)
  return c.json(rows)
})

app.post('/activities', async (c) => {
  const body = await c.req.json()
  const row = {
    id: body.id ?? undefined,
    userId: c.get('user')!.id,
    projectId: body.projectId,
    type: body.type,
    title: body.title,
    description: body.description ?? null,
    nodeId: body.nodeId ?? null,
    metadata: body.metadata ?? {},
  }
  const [inserted] = await db.insert(activityEvents).values(row).returning()
  return c.json(inserted)
})

app.delete('/activities/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  await db.delete(activityEvents).where(
    and(eq(activityEvents.userId, c.get('user')!.id), eq(activityEvents.projectId, projectId))
  )
  return c.json({ ok: true })
})

// ── Teams ──────────────────────────────────────────────────────────────

app.get('/teams', async (c) => {
  const userId = c.get('user')!.id

  // Get all teams where user is a member
  const userTeamIds = await db.select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))

  if (userTeamIds.length === 0) {
    return c.json({ teams: [], teamMembers: {} })
  }

  const teamIdList = userTeamIds.map(t => t.teamId)
  const teamRows = await db.select().from(teams)
    .where(sql`${teams.id} IN (${sql.join(teamIdList.map(id => sql`${id}`), sql`, `)})`)

  // Get all team members for these teams
  const memberRows = await db.select().from(teamMembers)
    .where(sql`${teamMembers.teamId} IN (${sql.join(teamIdList.map(id => sql`${id}`), sql`, `)})`)

  // Group members by team
  const teamMembersMap: Record<string, typeof memberRows> = {}
  for (const member of memberRows) {
    if (!teamMembersMap[member.teamId]) {
      teamMembersMap[member.teamId] = []
    }
    teamMembersMap[member.teamId].push(member)
  }

  return c.json({ teams: teamRows, teamMembers: teamMembersMap })
})

app.post('/teams', async (c) => {
  const body = await c.req.json()
  const userId = c.get('user')!.id
  const now = new Date()

  const teamId = body.id || crypto.randomUUID()

  const row = {
    id: teamId,
    name: body.name,
    description: body.description ?? '',
    createdAt: (typeof body.createdAt === 'string' || typeof body.createdAt === 'number') ? new Date(body.createdAt) : now,
    updatedAt: (typeof body.updatedAt === 'string' || typeof body.updatedAt === 'number') ? new Date(body.updatedAt) : now,
  }

  await db.insert(teams).values(row).onConflictDoUpdate({
    target: teams.id,
    set: { ...row, id: undefined } as typeof row,
  })

  // Add creator as team owner
  await db.insert(teamMembers).values({
    teamId,
    userId,
    role: 'owner',
    joinedAt: now,
  }).onConflictDoNothing()

  const [created] = await db.select().from(teams).where(eq(teams.id, teamId))
  return c.json(created, 201)
})

app.patch('/teams/:id', async (c) => {
  const teamId = c.req.param('id')
  const userId = c.get('user')!.id

  // Verify user is team owner or admin
  const [membership] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description

  await db.update(teams).set(patch).where(eq(teams.id, teamId))
  const [updated] = await db.select().from(teams).where(eq(teams.id, teamId))
  return c.json(updated)
})

app.delete('/teams/:id', async (c) => {
  const teamId = c.req.param('id')
  const userId = c.get('user')!.id

  // Verify user is team owner
  const [membership] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))

  if (!membership || membership.role !== 'owner') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(teams).where(eq(teams.id, teamId))
  return c.json({ ok: true })
})

app.post('/teams/:teamId/members', async (c) => {
  const teamId = c.req.param('teamId')
  const userId = c.get('user')!.id
  const body = await c.req.json()

  // Verify user is team owner or admin
  const [membership] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.insert(teamMembers).values({
    teamId,
    userId: body.userId,
    role: body.role ?? 'member',
    joinedAt: new Date(),
  }).onConflictDoNothing()

  return c.json({ ok: true })
})

app.delete('/teams/:teamId/members/:userId', async (c) => {
  const teamId = c.req.param('teamId')
  const currentUserId = c.get('user')!.id
  const targetUserId = c.req.param('userId')

  // Verify user is team owner or admin
  const [membership] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, currentUserId)))

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(teamMembers).where(
    and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId))
  )
  return c.json({ ok: true })
})

app.patch('/teams/:teamId/members/:userId', async (c) => {
  const teamId = c.req.param('teamId')
  const currentUserId = c.get('user')!.id
  const targetUserId = c.req.param('userId')
  const body = await c.req.json()

  // Verify user is team owner or admin
  const [membership] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, currentUserId)))

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.update(teamMembers)
    .set({ role: body.role })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))

  return c.json({ ok: true })
})

// ── Blobs (image/file storage) ──────────────────────────────────────

const MAX_BLOB_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_BLOB_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/bmp', 'image/tiff', 'image/svg+xml',
  'application/pdf',
])

app.post('/blobs', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()

  if (!body.data || !body.mimeType || !body.filename) {
    return c.json({ error: 'Missing required fields: data, mimeType, filename' }, 400)
  }

  if (!ALLOWED_BLOB_MIME_TYPES.has(body.mimeType)) {
    return c.json({ error: `Unsupported file type: ${body.mimeType}` }, 400)
  }

  const size = body.size ?? Math.ceil((body.data.length * 3) / 4)
  if (size > MAX_BLOB_SIZE) {
    return c.json({ error: `File too large. Maximum size is ${MAX_BLOB_SIZE / 1024 / 1024}MB` }, 400)
  }

  const [row] = await db.insert(blobs).values({
    ownerId: user.id,
    teamId: user.teamId || null,
    mimeType: body.mimeType,
    size,
    data: body.data,
    filename: body.filename,
    nodeId: body.nodeId || null,
    projectId: body.projectId || null,
  }).returning()

  return c.json({ id: row.id }, 201)
})

app.get('/blobs/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid blob ID' }, 400)

  // Ownership check: blob must belong to the same team or be owned by the user
  const [row] = await db.select().from(blobs).where(
    and(eq(blobs.id, id), teamScopeFilter(blobs, user))
  )
  if (!row) return c.json({ error: 'Blob not found' }, 404)

  // Decode base64 and serve as binary
  const buffer = Buffer.from(row.data, 'base64')
  return new Response(buffer, {
    headers: {
      'Content-Type': row.mimeType,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

app.delete('/blobs/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid blob ID' }, 400)

  const [row] = await db.select().from(blobs).where(eq(blobs.id, id))
  if (!row) return c.json({ error: 'Blob not found' }, 404)
  if (row.ownerId !== user.id) return c.json({ error: 'Not authorized' }, 403)

  await db.delete(blobs).where(eq(blobs.id, id))
  return c.json({ ok: true })
})

// ── Node Comments ───────────────────────────────────────────────────

app.get('/comments', async (c) => {
  const user = c.get('user')! as AuthUser
  const nodeId = c.req.query('nodeId')
  const projectId = c.req.query('projectId')
  if (!nodeId) return c.json({ error: 'nodeId query parameter required' }, 400)
  if (!projectId) return c.json({ error: 'projectId query parameter required' }, 400)

  // Always verify project access (not just when comments exist)
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), teamScopeFilter(projects, user))
  )
  if (!project) return c.json({ error: 'Not authorized' }, 403)

  const rows = await db.select().from(nodeComments)
    .where(eq(nodeComments.nodeId, nodeId))
    .orderBy(nodeComments.createdAt)

  return c.json(rows)
})

app.post('/comments', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()

  if (!body.nodeId || !body.projectId || !body.content) {
    return c.json({ error: 'Missing required fields: nodeId, projectId, content' }, 400)
  }

  // Verify project access
  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, body.projectId), teamScopeFilter(projects, user))
  )
  if (!project) return c.json({ error: 'Not authorized' }, 403)

  const [row] = await db.insert(nodeComments).values({
    nodeId: body.nodeId,
    projectId: body.projectId,
    authorId: user.id,
    authorName: body.authorName || 'User',
    authorType: body.authorType || 'user',
    content: body.content,
    parentCommentId: body.parentCommentId || null,
  }).returning()

  return c.json(row, 201)
})

app.delete('/comments/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid comment ID' }, 400)

  const [row] = await db.select().from(nodeComments).where(eq(nodeComments.id, id))
  if (!row) return c.json({ error: 'Comment not found' }, 404)
  if (row.authorId !== user.id) return c.json({ error: 'Not authorized' }, 403)

  await db.delete(nodeComments).where(eq(nodeComments.id, id))
  return c.json({ ok: true })
})

// ── Environment Configs ──────────────────────────────────────────────

app.get('/environment-configs', async (c) => {
  const user = c.get('user')! as AuthUser
  const rows = await db.select().from(environmentConfigs).where(
    or(
      eq(environmentConfigs.userId, user.id),
      user.teamId ? eq(environmentConfigs.teamId, user.teamId) : undefined
    )!
  )
  return c.json(rows)
})

app.post('/environment-configs', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()
  const { backendId, machineId, customContext, displayName } = body

  if (!backendId || typeof backendId !== 'string') return c.json({ error: 'backendId is required' }, 400)
  if (backendId.length > 100) return c.json({ error: 'backendId too long' }, 400)
  if (machineId && typeof machineId !== 'string') return c.json({ error: 'Invalid machineId' }, 400)
  if (customContext && typeof customContext === 'string' && customContext.length > 10000) return c.json({ error: 'customContext too long (max 10000 chars)' }, 400)
  if (displayName && typeof displayName === 'string' && displayName.length > 200) return c.json({ error: 'displayName too long' }, 400)

  // Upsert: check for existing config with same (userId, machineId, backendId)
  // Wrapped in try/catch to handle race conditions on the unique index
  try {
    const machineFilter = machineId
      ? eq(environmentConfigs.machineId, machineId)
      : isNull(environmentConfigs.machineId)

    const [existing] = await db.select().from(environmentConfigs).where(
      and(
        eq(environmentConfigs.userId, user.id),
        eq(environmentConfigs.backendId, backendId),
        machineFilter
      )
    )

    if (existing) {
      await db.update(environmentConfigs).set({
        customContext: customContext ?? '',
        displayName: displayName ?? null,
        teamId: user.teamId,
        updatedAt: new Date(),
      }).where(eq(environmentConfigs.id, existing.id))
      const [updated] = await db.select().from(environmentConfigs).where(eq(environmentConfigs.id, existing.id))
      return c.json(updated)
    }

    const [row] = await db.insert(environmentConfigs).values({
      userId: user.id,
      teamId: user.teamId,
      machineId: machineId ?? null,
      backendId,
      customContext: customContext ?? '',
      displayName: displayName ?? null,
    }).returning()
    return c.json(row, 201)
  } catch (err: unknown) {
    // Handle race condition: unique constraint violation means a concurrent insert won
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505')) {
      // Retry as update
      const machineFilter = machineId
        ? eq(environmentConfigs.machineId, machineId)
        : isNull(environmentConfigs.machineId)
      const [existing] = await db.select().from(environmentConfigs).where(
        and(eq(environmentConfigs.userId, user.id), eq(environmentConfigs.backendId, backendId), machineFilter)
      )
      if (existing) {
        await db.update(environmentConfigs).set({
          customContext: customContext ?? '',
          displayName: displayName ?? null,
          teamId: user.teamId,
          updatedAt: new Date(),
        }).where(eq(environmentConfigs.id, existing.id))
        const [updated] = await db.select().from(environmentConfigs).where(eq(environmentConfigs.id, existing.id))
        return c.json(updated)
      }
    }
    console.error('[data] environment-configs POST error:', err)
    return c.json({ error: 'Failed to save environment config' }, 500)
  }
})

app.delete('/environment-configs/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid config ID' }, 400)

  const [row] = await db.select().from(environmentConfigs).where(eq(environmentConfigs.id, id))
  if (!row) return c.json({ error: 'Config not found' }, 404)
  if (row.userId !== user.id) return c.json({ error: 'Not authorized' }, 403)

  await db.delete(environmentConfigs).where(eq(environmentConfigs.id, id))
  return c.json({ ok: true })
})

export const dataRoute = app
