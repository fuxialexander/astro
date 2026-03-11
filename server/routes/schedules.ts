/**
 * Schedules Routes
 *
 * CRUD API for cron schedule management + manual trigger + run history.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { Cron } from 'croner'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { db } from '../lib/db/index.js'
import { schedules, scheduleRuns, projects, teamMembers } from '../lib/db/schema.js'
import { eq, and, desc, max } from 'drizzle-orm'
import { serverSideDispatch } from '../lib/server-side-dispatch.js'
import { planNodes, planEdges } from '../lib/db/schema.js'
import { isNull } from 'drizzle-orm'

export const schedulesRoute = new Hono()

schedulesRoute.use('/*', requireAuth)

const VALID_RUN_STATUSES = ['pending', 'dispatched', 'running', 'success', 'failure', 'missed'] as const

/**
 * Verify the authenticated user has access to a project (owner or team member).
 */
async function verifyProjectAccess(projectId: string, userId: string): Promise<boolean> {
  const [project] = await db.select({ ownerId: projects.ownerId, teamId: projects.teamId })
    .from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) return false
  if (project.ownerId === userId) return true
  if (project.teamId) {
    const [membership] = await db.select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, userId)))
      .limit(1)
    return !!membership
  }
  return false
}

// ── Validation schemas ──────────────────────────────────────────

const createScheduleSchema = z.object({
  projectId: z.string().uuid(),
  scope: z.enum(['project', 'node']),
  nodeId: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  cronExpression: z.string().min(1).max(200),
  timezone: z.string().max(100).default('UTC'),
  targetMachineId: z.string().min(1).max(100),
  nodeFilter: z.array(z.string().max(100)).optional(),
  enabled: z.boolean().default(true),
  activeHoursStart: z.string().max(10).optional(),
  activeHoursEnd: z.string().max(10).optional(),
  maxConcurrency: z.number().int().min(1).max(10).default(1),
  missedRunPolicy: z.enum(['skip', 'retry_on_reconnect']).default('skip'),
  retryTtlMinutes: z.number().int().min(1).max(1440).default(60),
})

const updateScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  cronExpression: z.string().min(1).max(200).optional(),
  timezone: z.string().max(100).optional(),
  targetMachineId: z.string().min(1).max(100).optional(),
  nodeFilter: z.array(z.string().max(100)).optional(),
  enabled: z.boolean().optional(),
  activeHoursStart: z.string().max(10).nullable().optional(),
  activeHoursEnd: z.string().max(10).nullable().optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  missedRunPolicy: z.enum(['skip', 'retry_on_reconnect']).optional(),
  retryTtlMinutes: z.number().int().min(1).max(1440).optional(),
})

/**
 * Validate a cron expression and reject sub-5-minute intervals.
 */
function validateCronExpression(expr: string): { valid: boolean; error?: string } {
  try {
    const cron = new Cron(expr)
    // Check minimum interval: reject expressions that fire more frequently than every 5 minutes
    const next1 = cron.nextRun()
    if (next1) {
      const next2 = cron.nextRun(next1)
      if (next2) {
        const gapMs = next2.getTime() - next1.getTime()
        if (gapMs < 5 * 60 * 1000) {
          return { valid: false, error: 'Schedule interval must be at least 5 minutes' }
        }
      }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid cron expression' }
  }
}

// ── POST / — Create schedule ────────────────────────────────────

schedulesRoute.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  let body: z.infer<typeof createScheduleSchema>
  try {
    body = createScheduleSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ success: false, error: 'Invalid input', details: err.issues }, 400)
    }
    return c.json({ success: false, error: 'Invalid JSON' }, 400)
  }

  // Verify project access
  if (!await verifyProjectAccess(body.projectId, user.id)) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  // Validate scope + nodeId
  if (body.scope === 'node' && !body.nodeId) {
    return c.json({ success: false, error: 'nodeId is required for node-scope schedules' }, 400)
  }

  // Validate cron expression
  const validation = validateCronExpression(body.cronExpression)
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400)
  }

  // Compute nextRunAt
  const cron = new Cron(body.cronExpression, { timezone: body.timezone })
  const nextRunAt = body.enabled ? cron.nextRun() : null

  const [schedule] = await db.insert(schedules).values({
    projectId: body.projectId,
    scope: body.scope,
    nodeId: body.nodeId,
    name: body.name,
    cronExpression: body.cronExpression,
    timezone: body.timezone,
    targetMachineId: body.targetMachineId,
    nodeFilter: body.nodeFilter,
    enabled: body.enabled,
    nextRunAt,
    activeHoursStart: body.activeHoursStart,
    activeHoursEnd: body.activeHoursEnd,
    maxConcurrency: body.maxConcurrency,
    missedRunPolicy: body.missedRunPolicy,
    retryTtlMinutes: body.retryTtlMinutes,
    createdBy: user.id,
  }).returning()

  return c.json({ success: true, data: schedule }, 201)
})

// ── GET /?projectId=X — List schedules for project ──────────────

schedulesRoute.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const projectId = c.req.query('projectId')
  if (!projectId || !z.string().uuid().safeParse(projectId).success) {
    return c.json({ success: false, error: 'Valid projectId query parameter required' }, 400)
  }

  if (!await verifyProjectAccess(projectId, user.id)) {
    return c.json({ success: true, data: [] }) // Return empty, not 403 (don't leak existence)
  }

  const result = await db.select()
    .from(schedules)
    .where(eq(schedules.projectId, projectId))
    .orderBy(desc(schedules.createdAt))

  return c.json({ success: true, data: result })
})

// ── GET /:id — Get schedule with recent runs ────────────────────

schedulesRoute.get('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const [schedule] = await db.select()
    .from(schedules)
    .where(eq(schedules.id, id))
    .limit(1)

  if (!schedule || !await verifyProjectAccess(schedule.projectId, user.id)) {
    return c.json({ success: false, error: 'Schedule not found' }, 404)
  }

  const recentRuns = await db.select()
    .from(scheduleRuns)
    .where(eq(scheduleRuns.scheduleId, id))
    .orderBy(desc(scheduleRuns.createdAt))
    .limit(10)

  return c.json({ success: true, data: { ...schedule, recentRuns } })
})

// ── PATCH /:id — Update schedule ────────────────────────────────

schedulesRoute.patch('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  let body: z.infer<typeof updateScheduleSchema>
  try {
    body = updateScheduleSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ success: false, error: 'Invalid input', details: err.issues }, 400)
    }
    return c.json({ success: false, error: 'Invalid JSON' }, 400)
  }

  // If cron expression changed, validate it
  if (body.cronExpression) {
    const validation = validateCronExpression(body.cronExpression)
    if (!validation.valid) {
      return c.json({ success: false, error: validation.error }, 400)
    }
  }

  // Fetch current schedule to compute nextRunAt
  const [current] = await db.select()
    .from(schedules)
    .where(eq(schedules.id, id))
    .limit(1)

  if (!current || !await verifyProjectAccess(current.projectId, user.id)) {
    return c.json({ success: false, error: 'Schedule not found' }, 404)
  }

  // Recompute nextRunAt if cron expression, timezone, or enabled changed
  const patch: Partial<typeof schedules.$inferInsert> = {
    ...body,
    updatedAt: new Date(),
  }

  const newCron = body.cronExpression ?? current.cronExpression
  const newTimezone = body.timezone ?? current.timezone
  const newEnabled = body.enabled ?? current.enabled

  if (body.cronExpression !== undefined || body.timezone !== undefined || body.enabled !== undefined) {
    if (newEnabled) {
      const cron = new Cron(newCron, { timezone: newTimezone })
      patch.nextRunAt = cron.nextRun()
    } else {
      patch.nextRunAt = null
    }
  }

  const [updated] = await db.update(schedules)
    .set(patch)
    .where(eq(schedules.id, id))
    .returning()

  return c.json({ success: true, data: updated })
})

// ── DELETE /:id — Delete schedule ───────────────────────────────

schedulesRoute.delete('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  // Verify ownership before deletion
  const [schedule] = await db.select({ projectId: schedules.projectId })
    .from(schedules).where(eq(schedules.id, id)).limit(1)

  if (!schedule || !await verifyProjectAccess(schedule.projectId, user.id)) {
    return c.json({ success: false, error: 'Schedule not found' }, 404)
  }

  await db.delete(schedules).where(eq(schedules.id, id))

  return c.json({ success: true })
})

// ── POST /:id/trigger — Manual "run now" ────────────────────────

schedulesRoute.post('/:id/trigger', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const [schedule] = await db.select()
    .from(schedules)
    .where(eq(schedules.id, id))
    .limit(1)

  if (!schedule || !await verifyProjectAccess(schedule.projectId, user.id)) {
    return c.json({ success: false, error: 'Schedule not found' }, 404)
  }

  const now = new Date()

  // Compute run number
  const [maxRun] = await db.select({ maxNum: max(scheduleRuns.runNumber) })
    .from(scheduleRuns).where(eq(scheduleRuns.scheduleId, id))
  const runNumber = (maxRun?.maxNum ?? 0) + 1

  // Compute branch suffix
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: schedule.timezone,
  })
  const parts = formatter.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  const branchSuffix = `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}`

  // Create run entry
  const [run] = await db.insert(scheduleRuns).values({
    scheduleId: schedule.id,
    runNumber,
    status: 'dispatched',
    scheduledAt: now,
    startedAt: now,
  }).returning()

  if (schedule.scope === 'node' && schedule.nodeId) {
    // Reset node if terminal
    const [node] = await db.select({ status: planNodes.status })
      .from(planNodes).where(eq(planNodes.clientId, schedule.nodeId)).limit(1)

    if (node) {
      const terminalStatuses = ['completed', 'auto_verified', 'pruned', 'awaiting_judgment']
      if (terminalStatuses.includes(node.status)) {
        await db.update(planNodes)
          .set({
            status: 'planned',
            executionId: null,
            executionOutput: null,
            executionError: null,
            executionStartedAt: null,
            executionCompletedAt: null,
            updatedAt: now,
          })
          .where(eq(planNodes.clientId, schedule.nodeId))
      }
    }

    serverSideDispatch(schedule.nodeId, schedule.projectId, {
      targetMachineId: schedule.targetMachineId,
      branchSuffix,
      scheduleRunId: run.id,
    }).catch((err) => {
      console.error(`[schedules] Manual trigger dispatch failed:`, err)
      db.update(scheduleRuns)
        .set({ status: 'failure', completedAt: new Date(), errorMessage: String(err) })
        .where(eq(scheduleRuns.id, run.id))
        .execute().catch(() => {})
    })
  } else {
    // Project scope — dispatch root nodes
    const allNodes = await db.select()
      .from(planNodes)
      .where(and(eq(planNodes.projectId, schedule.projectId), isNull(planNodes.deletedAt)))
    const allEdges = await db.select()
      .from(planEdges)
      .where(and(eq(planEdges.projectId, schedule.projectId), isNull(planEdges.deletedAt)))

    let taskNodes = allNodes.filter(n => n.type === 'task')
    if (schedule.nodeFilter && schedule.nodeFilter.length > 0) {
      const filterSet = new Set(schedule.nodeFilter)
      taskNodes = taskNodes.filter(n => filterSet.has(n.clientId))
    }

    // Reset terminal nodes
    const terminalStatuses = ['completed', 'auto_verified', 'pruned', 'awaiting_judgment']
    for (const node of taskNodes) {
      if (terminalStatuses.includes(node.status)) {
        await db.update(planNodes)
          .set({
            status: 'planned',
            executionId: null,
            executionOutput: null,
            executionError: null,
            executionStartedAt: null,
            executionCompletedAt: null,
            updatedAt: now,
          })
          .where(eq(planNodes.clientId, node.clientId))
      }
    }

    // Dispatch root nodes
    const nodeIds = new Set(taskNodes.map(n => n.clientId))
    let dispatched = 0
    for (const node of taskNodes) {
      if (node.status === 'in_progress' || node.status === 'dispatched') continue
      const depEdges = allEdges.filter(e => e.targetClientId === node.clientId)
      const allDepsMet = depEdges.every(depEdge => {
        if (!nodeIds.has(depEdge.sourceClientId)) return true
        const depNode = allNodes.find(n => n.clientId === depEdge.sourceClientId)
        return depNode && ['completed', 'auto_verified'].includes(depNode.status)
      })
      if (allDepsMet) {
        serverSideDispatch(node.clientId, schedule.projectId, {
          targetMachineId: schedule.targetMachineId,
          branchSuffix,
          scheduleRunId: run.id,
        }).catch((err) => {
          console.error(`[schedules] Manual trigger dispatch failed for ${node.clientId}:`, err)
        })
        dispatched++
      }
    }

    console.log(`[schedules] Manual trigger: dispatched ${dispatched} root nodes`)
  }

  return c.json({ success: true, data: run })
})

// ── GET /:id/runs — Paginated run history ───────────────────────

schedulesRoute.get('/:id/runs', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  // Verify access
  const [schedule] = await db.select({ projectId: schedules.projectId })
    .from(schedules).where(eq(schedules.id, id)).limit(1)

  if (!schedule || !await verifyProjectAccess(schedule.projectId, user.id)) {
    return c.json({ success: false, error: 'Schedule not found' }, 404)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100)
  const offset = parseInt(c.req.query('offset') || '0', 10)
  const statusParam = c.req.query('status')
  const status = statusParam && (VALID_RUN_STATUSES as readonly string[]).includes(statusParam) ? statusParam : undefined

  const runs = await db.select()
    .from(scheduleRuns)
    .where(
      status
        ? and(eq(scheduleRuns.scheduleId, id), eq(scheduleRuns.status, status))
        : eq(scheduleRuns.scheduleId, id)
    )
    .orderBy(desc(scheduleRuns.createdAt))
    .limit(limit)
    .offset(offset)

  return c.json({ success: true, data: runs })
})
