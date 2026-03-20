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
import { schedules, scheduleRuns, projects, teamMembers, planNodes } from '../lib/db/schema.js'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { serverSideDispatch } from '../lib/server-side-dispatch.js'
import {
  insertScheduleRun,
  isValidTimezone,
  computeBranchSuffix,
  checkMaxConcurrency,
  resetNodeIfTerminal,
  dispatchProjectRootNodes,
  isMachineOnline,
} from '../lib/cron-scheduler.js'

export const schedulesRoute = new Hono()

schedulesRoute.use('/*', requireAuth)

const VALID_RUN_STATUSES = ['pending', 'dispatched', 'running', 'success', 'failure', 'missed'] as const
const uuidSchema = z.string().uuid()

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
  activeHoursStart: z.string().regex(/^\d{1,2}:\d{2}$/, 'Must be HH:MM format').optional(),
  activeHoursEnd: z.string().regex(/^\d{1,2}:\d{2}$/, 'Must be HH:MM format').optional(),
  maxConcurrency: z.number().int().min(1).max(10).default(1),
  missedRunPolicy: z.enum(['skip', 'retry_on_reconnect']).default('skip'),
  retryTtlMinutes: z.number().int().min(1).max(1440).default(60),
}).refine(
  (d) => (d.activeHoursStart == null) === (d.activeHoursEnd == null),
  { message: 'Both activeHoursStart and activeHoursEnd must be provided together', path: ['activeHoursStart'] },
)

const updateScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  cronExpression: z.string().min(1).max(200).optional(),
  timezone: z.string().max(100).optional(),
  targetMachineId: z.string().min(1).max(100).optional(),
  nodeFilter: z.array(z.string().max(100)).optional(),
  enabled: z.boolean().optional(),
  activeHoursStart: z.string().regex(/^\d{1,2}:\d{2}$/, 'Must be HH:MM format').nullable().optional(),
  activeHoursEnd: z.string().regex(/^\d{1,2}:\d{2}$/, 'Must be HH:MM format').nullable().optional(),
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

  // Verify nodeId belongs to the specified project and is not deleted
  if (body.scope === 'node' && body.nodeId) {
    const [node] = await db.select({ clientId: planNodes.clientId })
      .from(planNodes)
      .where(and(
        eq(planNodes.clientId, body.nodeId),
        eq(planNodes.projectId, body.projectId),
        isNull(planNodes.deletedAt),
      ))
      .limit(1)
    if (!node) {
      return c.json({ success: false, error: 'Node not found in the specified project' }, 404)
    }
  }

  // Validate timezone
  if (!isValidTimezone(body.timezone)) {
    return c.json({ success: false, error: `Invalid timezone: ${body.timezone}` }, 400)
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
    .where(and(eq(schedules.projectId, projectId), isNull(schedules.deletedAt)))
    .orderBy(desc(schedules.createdAt))

  return c.json({ success: true, data: result })
})

// ── GET /:id — Get schedule with recent runs ────────────────────

schedulesRoute.get('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  if (!uuidSchema.safeParse(id).success) return c.json({ success: false, error: 'Invalid schedule ID' }, 400)

  const [schedule] = await db.select()
    .from(schedules)
    .where(and(eq(schedules.id, id), isNull(schedules.deletedAt)))
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
  if (!uuidSchema.safeParse(id).success) return c.json({ success: false, error: 'Invalid schedule ID' }, 400)

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

  // Validate timezone if changed
  if (body.timezone && !isValidTimezone(body.timezone)) {
    return c.json({ success: false, error: `Invalid timezone: ${body.timezone}` }, 400)
  }

  // Fetch current schedule to compute nextRunAt
  const [current] = await db.select()
    .from(schedules)
    .where(and(eq(schedules.id, id), isNull(schedules.deletedAt)))
    .limit(1)

  if (!current || !await verifyProjectAccess(current.projectId, user.id)) {
    return c.json({ success: false, error: 'Schedule not found' }, 404)
  }

  // Cross-validate active hours: after applying the patch, both must be set or both null
  const effectiveStart = body.activeHoursStart !== undefined ? body.activeHoursStart : current.activeHoursStart
  const effectiveEnd = body.activeHoursEnd !== undefined ? body.activeHoursEnd : current.activeHoursEnd
  if ((effectiveStart == null) !== (effectiveEnd == null)) {
    return c.json({ success: false, error: 'Both activeHoursStart and activeHoursEnd must be provided together' }, 400)
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
  if (!uuidSchema.safeParse(id).success) return c.json({ success: false, error: 'Invalid schedule ID' }, 400)

  // Verify ownership before deletion
  const [schedule] = await db.select({ projectId: schedules.projectId })
    .from(schedules).where(and(eq(schedules.id, id), isNull(schedules.deletedAt))).limit(1)

  if (!schedule || !await verifyProjectAccess(schedule.projectId, user.id)) {
    return c.json({ success: false, error: 'Schedule not found' }, 404)
  }

  await db.update(schedules).set({ deletedAt: new Date() }).where(eq(schedules.id, id))

  return c.json({ success: true })
})

// ── POST /:id/trigger — Manual "run now" ────────────────────────

schedulesRoute.post('/:id/trigger', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  if (!uuidSchema.safeParse(id).success) return c.json({ success: false, error: 'Invalid schedule ID' }, 400)

  const [schedule] = await db.select()
    .from(schedules)
    .where(and(eq(schedules.id, id), isNull(schedules.deletedAt)))
    .limit(1)

  if (!schedule || !await verifyProjectAccess(schedule.projectId, user.id)) {
    return c.json({ success: false, error: 'Schedule not found' }, 404)
  }

  // Max concurrency check — manual triggers respect the same limit
  const concurrency = await checkMaxConcurrency(schedule.id, schedule.maxConcurrency)
  if (!concurrency.allowed) {
    return c.json({ success: false, error: `Max concurrency (${schedule.maxConcurrency}) reached. Wait for active runs to complete.` }, 429)
  }

  // Machine connectivity check — warn user if target machine is offline
  try {
    const online = await isMachineOnline(schedule.targetMachineId)
    if (!online) {
      return c.json({ success: false, error: 'Target machine is offline. Connect the machine and try again.' }, 503)
    }
  } catch {
    // If we can't check connectivity (e.g. PGlite), proceed with dispatch
  }

  const now = new Date()

  // Use shared branch suffix computation (always includes time for manual triggers)
  const branchSuffix = computeBranchSuffix(schedule.cronExpression, now, schedule.timezone)

  // Create run entry using shared atomic helper
  const run = await insertScheduleRun({
    scheduleId: schedule.id,
    status: 'dispatched',
    scheduledAt: now,
    startedAt: now,
  })

  const logPrefix = `[schedules] trigger run=#${run.runNumber}`

  if (schedule.scope === 'node' && schedule.nodeId) {
    const nodeResult = await resetNodeIfTerminal(schedule.nodeId, now)
    if (nodeResult === 'not_found') {
      await db.update(scheduleRuns)
        .set({ status: 'failure', completedAt: now, errorMessage: 'Node not found or deleted' })
        .where(eq(scheduleRuns.id, run.id))
      return c.json({ success: false, error: 'Target node not found or deleted' }, 404)
    }

    serverSideDispatch(schedule.nodeId, schedule.projectId, {
      targetMachineId: schedule.targetMachineId,
      branchSuffix,
      scheduleRunId: run.id,
    }).catch((err) => {
      console.error(`${logPrefix}: dispatch failed:`, err)
      db.update(scheduleRuns)
        .set({ status: 'failure', completedAt: new Date(), errorMessage: String(err) })
        .where(eq(scheduleRuns.id, run.id))
        .execute().catch(() => {})
    })
  } else {
    const dispatched = await dispatchProjectRootNodes(schedule, run, branchSuffix, now, logPrefix)

    if (dispatched === 0) {
      await db.update(scheduleRuns)
        .set({ status: 'success', completedAt: now, summary: { message: 'No eligible nodes to dispatch' } })
        .where(eq(scheduleRuns.id, run.id))
    }

    console.log(`${logPrefix}: dispatched ${dispatched} root nodes`)
  }

  return c.json({ success: true, data: run })
})

// ── GET /:id/runs — Paginated run history ───────────────────────

schedulesRoute.get('/:id/runs', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  if (!uuidSchema.safeParse(id).success) return c.json({ success: false, error: 'Invalid schedule ID' }, 400)

  // Verify access
  const [schedule] = await db.select({ projectId: schedules.projectId })
    .from(schedules).where(and(eq(schedules.id, id), isNull(schedules.deletedAt))).limit(1)

  if (!schedule || !await verifyProjectAccess(schedule.projectId, user.id)) {
    return c.json({ success: false, error: 'Schedule not found' }, 404)
  }

  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20), 100)
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)
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
