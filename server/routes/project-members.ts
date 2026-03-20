/**
 * Project Members Routes — Per-project member management
 *
 * Note: This route is currently not mounted in server/index.ts.
 * Project authorization is team-based; these endpoints do not create
 * cross-team sharing exceptions if they are mounted in the future.
 *
 * Endpoints:
 *   GET    /api/projects/:projectId/members          — List project members
 *   POST   /api/projects/:projectId/members          — Add a member (owner only)
 *   DELETE /api/projects/:projectId/members/:userId   — Remove a member (owner only)
 *   PATCH  /api/projects/:projectId/members/:userId   — Change member role (owner only)
 */

import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import { projects, projectMembers, teamMembers, userProfiles } from '../lib/db/schema.js'
import { eq, and, sql } from 'drizzle-orm'
import { requireAuth, type AuthUser } from '../middleware/auth.js'

const VALID_ROLES = ['owner', 'editor', 'viewer'] as const
type ProjectMemberRole = (typeof VALID_ROLES)[number]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const projectMembersRoute = new Hono()

// Apply auth middleware to all routes
projectMembersRoute.use('*', requireAuth)

/**
 * Verify the requesting user is the project owner.
 * Returns the project row if authorized, or null otherwise.
 */
async function verifyProjectOwner(projectId: string, userId: string) {
  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId, teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, projectId))

  if (!project) return null
  if (project.ownerId !== userId) return null
  return project
}

/**
 * GET /api/projects/:projectId/members
 *
 * List all members of a project. Accessible to project owner or same-team members.
 */
projectMembersRoute.get('/:projectId/members', async (c) => {
  const user = c.get('user')! as AuthUser
  const projectId = c.req.param('projectId')
  if (!UUID_RE.test(projectId)) return c.json({ error: 'Invalid project ID' }, 400)

  // Verify the project exists
  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId, teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, projectId))

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Access check: project owner or same team only.
  const isOwner = project.ownerId === user.id
  const isSameTeam = project.teamId != null && user.teamIds.includes(project.teamId)
  if (!isOwner && !isSameTeam) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Fetch members
  const members = await db
    .select({
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt)

  // Enrich with user profiles
  const userIds = members.map((m) => m.userId)
  const profiles =
    userIds.length > 0
      ? await db
          .select({
            id: userProfiles.id,
            name: userProfiles.name,
            email: userProfiles.email,
            avatarUrl: userProfiles.avatarUrl,
          })
          .from(userProfiles)
          .where(
            sql`${userProfiles.id} IN (${sql.join(
              userIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
      : []

  const profileMap = new Map(profiles.map((p) => [p.id, p]))

  const enrichedMembers = members.map((m) => ({
    ...m,
    user: profileMap.get(m.userId) ?? null,
  }))

  return c.json({ members: enrichedMembers })
})

/**
 * POST /api/projects/:projectId/members
 *
 * Add a member to a project. Only the project owner can add members.
 * Body: { userId: string, role?: 'owner' | 'editor' | 'viewer' }
 */
projectMembersRoute.post('/:projectId/members', async (c) => {
  const user = c.get('user')! as AuthUser
  const projectId = c.req.param('projectId')
  if (!UUID_RE.test(projectId)) return c.json({ error: 'Invalid project ID' }, 400)

  const project = await verifyProjectOwner(projectId, user.id)
  if (!project) {
    return c.json({ error: 'Forbidden: only the project owner can manage members' }, 403)
  }

  const body = await c.req.json<{ userId: string; role?: string }>()

  if (!body.userId || typeof body.userId !== 'string') {
    return c.json({ error: 'userId is required' }, 400)
  }
  if (!UUID_RE.test(body.userId)) return c.json({ error: 'Invalid user ID' }, 400)

  const role = (body.role ?? 'viewer') as ProjectMemberRole
  if (!VALID_ROLES.includes(role)) {
    return c.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, 400)
  }
  if (!project.teamId) {
    return c.json({ error: 'Projects without a team do not support project members' }, 400)
  }

  // Verify target user exists
  const [targetUser] = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.id, body.userId))

  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404)
  }

  const [targetMembership] = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, body.userId)))

  if (!targetMembership) {
    return c.json({ error: 'Only members of the project team can be added as project members' }, 400)
  }

  // Insert (or ignore if already exists)
  await db
    .insert(projectMembers)
    .values({
      projectId,
      userId: body.userId,
      role,
      createdAt: new Date(),
    })
    .onConflictDoNothing()

  return c.json({ ok: true }, 201)
})

/**
 * DELETE /api/projects/:projectId/members/:userId
 *
 * Remove a member from a project. Only the project owner can remove members.
 */
projectMembersRoute.delete('/:projectId/members/:userId', async (c) => {
  const user = c.get('user')! as AuthUser
  const projectId = c.req.param('projectId')
  const targetUserId = c.req.param('userId')
  if (!UUID_RE.test(projectId)) return c.json({ error: 'Invalid project ID' }, 400)
  if (!UUID_RE.test(targetUserId)) return c.json({ error: 'Invalid user ID' }, 400)

  const project = await verifyProjectOwner(projectId, user.id)
  if (!project) {
    return c.json({ error: 'Forbidden: only the project owner can manage members' }, 403)
  }

  // Don't allow removing yourself as project owner via this endpoint
  if (targetUserId === user.id) {
    return c.json({ error: 'Cannot remove yourself as project owner' }, 400)
  }

  const result = await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)))
    .returning()

  if (result.length === 0) {
    return c.json({ error: 'Member not found' }, 404)
  }

  return c.json({ ok: true })
})

/**
 * PATCH /api/projects/:projectId/members/:userId
 *
 * Change a project member's role. Only the project owner can change roles.
 * Body: { role: 'owner' | 'editor' | 'viewer' }
 */
projectMembersRoute.patch('/:projectId/members/:userId', async (c) => {
  const user = c.get('user')! as AuthUser
  const projectId = c.req.param('projectId')
  const targetUserId = c.req.param('userId')
  if (!UUID_RE.test(projectId)) return c.json({ error: 'Invalid project ID' }, 400)
  if (!UUID_RE.test(targetUserId)) return c.json({ error: 'Invalid user ID' }, 400)

  const project = await verifyProjectOwner(projectId, user.id)
  if (!project) {
    return c.json({ error: 'Forbidden: only the project owner can manage members' }, 403)
  }

  const body = await c.req.json<{ role: string }>()

  if (!body.role || !VALID_ROLES.includes(body.role as ProjectMemberRole)) {
    return c.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, 400)
  }

  const result = await db
    .update(projectMembers)
    .set({ role: body.role })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)))
    .returning()

  if (result.length === 0) {
    return c.json({ error: 'Member not found' }, 404)
  }

  return c.json({ ok: true })
})

export { projectMembersRoute }
