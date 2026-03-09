/**
 * Execution Verification Routes
 *
 * Endpoints:
 *   POST /api/executions/:executionId/verify  — Mark execution as verified/completed
 *   POST /api/executions/:executionId/rerun   — Create a new execution for re-verification
 *   POST /api/executions/:executionId/skip    — Skip verification, mark as completed
 */

import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import { taskExecutions, projects, projectMembers } from '../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { randomUUID } from 'crypto'

const executionsRoute = new Hono()

// Apply auth middleware to all routes
executionsRoute.use('*', requireAuth)

/**
 * Verify the user has access to the execution's project.
 * Returns the execution row if authorized, null otherwise.
 */
async function getAuthorizedExecution(executionId: string, user: AuthUser) {
  // Find the execution
  const [execution] = await db
    .select()
    .from(taskExecutions)
    .where(eq(taskExecutions.executionId, executionId))

  if (!execution) return null

  // Verify user has access to the project (owner, team member, or project member)
  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId, teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, execution.projectId))

  if (!project) return null

  // Check: project owner
  if (project.ownerId === user.id) return execution

  // Check: team member (user's active team matches project's team)
  if (project.teamId && user.teamIds.includes(project.teamId)) return execution

  // Check: project member
  const [membership] = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.userId, user.id),
    ))

  if (membership) return execution

  return null
}

/**
 * POST /api/executions/:executionId/verify
 *
 * Sets verifiedBy to the current user and transitions status to 'completed'.
 * Body: { note?: string }
 */
executionsRoute.post('/:executionId/verify', async (c) => {
  const user = c.get('user')! as AuthUser
  const executionId = c.req.param('executionId')

  const execution = await getAuthorizedExecution(executionId, user)
  if (!execution) {
    return c.json({ error: 'Execution not found or access denied' }, 404)
  }

  // Verifier must differ from the original executor to ensure independent review
  if (execution.userId && execution.userId === user.id) {
    return c.json({ error: 'Cannot verify your own execution' }, 403)
  }

  const body = await c.req.json<{ note?: string }>().catch(() => ({}))

  const [updated] = await db
    .update(taskExecutions)
    .set({
      verifiedBy: user.id,
      verificationNote: body.note ?? null,
      status: 'success',
      completedAt: execution.completedAt ?? new Date(),
    })
    .where(eq(taskExecutions.executionId, executionId))
    .returning()

  return c.json({ execution: updated })
})

/**
 * POST /api/executions/:executionId/rerun
 *
 * Creates a new execution for the same node, indicating intent to re-verify.
 * The original execution is left unchanged.
 * Body: { note?: string }
 */
executionsRoute.post('/:executionId/rerun', async (c) => {
  const user = c.get('user')! as AuthUser
  const executionId = c.req.param('executionId')

  const execution = await getAuthorizedExecution(executionId, user)
  if (!execution) {
    return c.json({ error: 'Execution not found or access denied' }, 404)
  }

  const body = await c.req.json<{ note?: string }>().catch(() => ({}))

  const newExecutionId = `rerun-${randomUUID()}`

  const [newExecution] = await db
    .insert(taskExecutions)
    .values({
      executionId: newExecutionId,
      nodeClientId: execution.nodeClientId,
      projectId: execution.projectId,
      userId: user.id,
      status: 'pending',
      verificationNote: body.note ?? null,
    })
    .returning()

  return c.json({ execution: newExecution }, 201)
})

/**
 * POST /api/executions/:executionId/skip
 *
 * Marks the task as completed without re-running (skip verification).
 * Body: { note?: string }
 */
executionsRoute.post('/:executionId/skip', async (c) => {
  const user = c.get('user')! as AuthUser
  const executionId = c.req.param('executionId')

  const execution = await getAuthorizedExecution(executionId, user)
  if (!execution) {
    return c.json({ error: 'Execution not found or access denied' }, 404)
  }

  // Verifier must differ from the original executor to ensure independent review
  if (execution.userId && execution.userId === user.id) {
    return c.json({ error: 'Cannot skip verification of your own execution' }, 403)
  }

  const body = await c.req.json<{ note?: string }>().catch(() => ({}))

  const [updated] = await db
    .update(taskExecutions)
    .set({
      verifiedBy: user.id,
      verificationNote: body.note ?? 'Skipped verification',
      status: 'success',
      completedAt: execution.completedAt ?? new Date(),
    })
    .where(eq(taskExecutions.executionId, executionId))
    .returning()

  return c.json({ execution: updated })
})

export { executionsRoute }
