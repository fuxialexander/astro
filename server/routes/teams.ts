/**
 * Teams Routes — Team Management & Invitations
 *
 * Handles team CRUD operations and email-based invitation flow.
 * Now uses Drizzle ORM directly (no Supabase SDK dependency).
 *
 * Flow:
 * 1. Team admin sends invite → generates token, sends email
 * 2. New users: click link → register with team context → auto-join team
 * 3. Existing users: click link → accept invite → join team
 */

import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { isLocalMode } from '../lib/app-mode.js'
import { errorMessage } from '../lib/error-utils.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { sendInvitationEmail } from '../lib/email-service.js'
import { db } from '../lib/db/index.js'
import { teams, teamMembers, userProfiles, inviteTokens } from '../lib/db/schema.js'
import { eq, and, sql, gt, isNull, count } from 'drizzle-orm'

const teamsRoute = new Hono()

// Apply auth middleware to all team routes
teamsRoute.use('*', requireAuth)

/**
 * POST /api/teams/invite
 *
 * Create an invitation token and send email to invitee.
 */
teamsRoute.post('/invite', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const { teamId, email, role = 'member' } = await c.req.json<{
      teamId: string
      email: string
      role?: 'owner' | 'admin' | 'member'
    }>()

    if (!teamId || !email) {
      return c.json({ error: 'teamId and email are required' }, 400)
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return c.json({ error: 'Invalid email format' }, 400)
    }

    // Verify user is admin/owner of the team
    const [membership] = await db.select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    // Check if user is already a member (by email → profile → membership)
    const [profileByEmail] = await db.select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.email, email))

    if (profileByEmail) {
      const [existingMember] = await db.select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, profileByEmail.id)))

      if (existingMember) {
        return c.json({ error: 'User is already a team member' }, 400)
      }
    }

    // Check for existing pending invites to this email
    const now = new Date()
    const [existingInvite] = await db.select({ id: inviteTokens.id })
      .from(inviteTokens)
      .where(and(
        eq(inviteTokens.teamId, teamId),
        eq(inviteTokens.email, email),
        isNull(inviteTokens.usedAt),
        gt(inviteTokens.expiresAt, now),
      ))

    if (existingInvite) {
      return c.json({ error: 'An active invitation already exists for this email' }, 400)
    }

    // Generate secure random token
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    // Create invite token
    const [invite] = await db.insert(inviteTokens).values({
      token,
      teamId,
      email,
      invitedBy: user.id,
      role,
      expiresAt,
    }).returning()

    // Get team details for email
    const [team] = await db.select({ name: teams.name })
      .from(teams)
      .where(eq(teams.id, teamId))

    // Get inviter details
    const [inviter] = await db.select({ name: userProfiles.name, email: userProfiles.email })
      .from(userProfiles)
      .where(eq(userProfiles.id, user.id))

    // Send invitation email
    const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite/${token}`

    const emailSent = await sendInvitationEmail({
      to: email,
      teamName: team?.name || 'Unknown Team',
      inviterName: inviter?.name || 'Team Admin',
      inviterEmail: inviter?.email || (process.env.ASTRO_NOREPLY_EMAIL || 'noreply@astro.app'),
      inviteUrl,
      role,
      expiresAt,
    })

    if (!emailSent) {
      console.warn('[teams] Failed to send invitation email, but invite was created')
    }

    console.log('[teams] Invitation created:', {
      email,
      team: team?.name,
      inviter: inviter?.name || inviter?.email,
      url: inviteUrl,
      expiresAt,
      emailSent,
    })

    return c.json({
      success: true,
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        emailSent,
      },
    })
  } catch (err) {
    console.error('[teams] Invite error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * GET /api/teams/:teamId/invites
 *
 * List all pending invites for a team (admin only).
 */
teamsRoute.get('/:teamId/invites', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const teamId = c.req.param('teamId')

    // Verify user is admin/owner of the team
    const [membership] = await db.select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    // Get pending invites
    const now = new Date()
    const invites = await db.select({
      id: inviteTokens.id,
      token: inviteTokens.token,
      email: inviteTokens.email,
      role: inviteTokens.role,
      expiresAt: inviteTokens.expiresAt,
      createdAt: inviteTokens.createdAt,
      invitedBy: inviteTokens.invitedBy,
    })
      .from(inviteTokens)
      .where(and(
        eq(inviteTokens.teamId, teamId),
        isNull(inviteTokens.usedAt),
        gt(inviteTokens.expiresAt, now),
      ))
      .orderBy(sql`${inviteTokens.createdAt} DESC`)

    // Get inviter details
    const inviterIds = [...new Set(invites.map((inv) => inv.invitedBy))]
    const inviters = inviterIds.length > 0
      ? await db.select({ id: userProfiles.id, name: userProfiles.name, email: userProfiles.email })
          .from(userProfiles)
          .where(sql`${userProfiles.id} IN (${sql.join(inviterIds.map(id => sql`${id}`), sql`, `)})`)
      : []

    const inviterMap = new Map(inviters.map((u) => [u.id, u]))

    const enrichedInvites = invites.map((inv) => ({
      ...inv,
      inviter: inviterMap.get(inv.invitedBy),
    }))

    return c.json({ invites: enrichedInvites })
  } catch (err) {
    console.error('[teams] List invites error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * DELETE /api/teams/invites/:inviteId
 *
 * Revoke (delete) an invitation (admin only).
 */
teamsRoute.delete('/invites/:inviteId', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const inviteId = c.req.param('inviteId')

    // Get invite to verify team ownership
    const [invite] = await db.select({ teamId: inviteTokens.teamId })
      .from(inviteTokens)
      .where(eq(inviteTokens.id, inviteId))

    if (!invite) {
      return c.json({ error: 'Invitation not found' }, 404)
    }

    // Verify user is admin/owner of the team
    const [membership] = await db.select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, user.id)))

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    // Delete the invite
    await db.delete(inviteTokens).where(eq(inviteTokens.id, inviteId))

    return c.json({ success: true })
  } catch (err) {
    console.error('[teams] Revoke invite error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * GET /api/teams/invite/:token
 *
 * Get invitation details by token (public endpoint for invite acceptance).
 */
teamsRoute.get('/invite/:token', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const token = c.req.param('token')
    const now = new Date()

    // Get invite by token
    const [invite] = await db.select()
      .from(inviteTokens)
      .where(and(
        eq(inviteTokens.token, token),
        isNull(inviteTokens.usedAt),
        gt(inviteTokens.expiresAt, now),
      ))

    if (!invite) {
      return c.json({ error: 'Invalid or expired invitation' }, 404)
    }

    // Get team name
    const [team] = await db.select({ name: teams.name })
      .from(teams)
      .where(eq(teams.id, invite.teamId))

    // Check if user already exists with this email
    const [existingUser] = await db.select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.email, invite.email))

    return c.json({
      invite: {
        email: invite.email,
        role: invite.role,
        teamName: team?.name || 'Unknown Team',
        expiresAt: invite.expiresAt,
        userExists: !!existingUser,
      },
    })
  } catch (err) {
    console.error('[teams] Get invite error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * POST /api/teams/accept/:token
 *
 * Accept a team invitation (requires authentication).
 */
teamsRoute.post('/accept/:token', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const token = c.req.param('token')

    // Get user's email
    const [userProfile] = await db.select({ email: userProfiles.email })
      .from(userProfiles)
      .where(eq(userProfiles.id, user.id))

    if (!userProfile) {
      return c.json({ error: 'User profile not found' }, 404)
    }

    // Get invite by token and verify it matches user's email
    const now = new Date()
    const [invite] = await db.select()
      .from(inviteTokens)
      .where(and(
        eq(inviteTokens.token, token),
        eq(inviteTokens.email, userProfile.email),
        isNull(inviteTokens.usedAt),
        gt(inviteTokens.expiresAt, now),
      ))

    if (!invite) {
      return c.json({ error: 'Invalid or expired invitation' }, 404)
    }

    // Check if already a member
    const [existingMember] = await db.select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, user.id)))

    if (existingMember) {
      // Mark invite as used even though they're already a member
      await db.update(inviteTokens)
        .set({ usedAt: new Date() })
        .where(eq(inviteTokens.id, invite.id))

      return c.json({ error: 'You are already a member of this team' }, 400)
    }

    // Add user to team
    await db.insert(teamMembers).values({
      teamId: invite.teamId,
      userId: user.id,
      role: invite.role,
    })

    // Mark invite as used
    await db.update(inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(inviteTokens.id, invite.id))

    // Get team details
    const [team] = await db.select()
      .from(teams)
      .where(eq(teams.id, invite.teamId))

    return c.json({
      success: true,
      team,
    })
  } catch (err) {
    console.error('[teams] Accept invite error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * GET /api/teams/:teamId/members
 *
 * List all members of a team (requires team membership).
 */
teamsRoute.get('/:teamId/members', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const teamId = c.req.param('teamId')

    // Verify user is a member of the team
    const [membership] = await db.select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))

    if (!membership) {
      return c.json({ error: 'Not a team member' }, 403)
    }

    // Get all team members
    const members = await db.select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
    })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId))
      .orderBy(teamMembers.joinedAt)

    // Get user profiles
    const userIds = members.map((m) => m.userId)
    const profiles = userIds.length > 0
      ? await db.select({
          id: userProfiles.id,
          name: userProfiles.name,
          email: userProfiles.email,
          avatarUrl: userProfiles.avatarUrl,
        })
          .from(userProfiles)
          .where(sql`${userProfiles.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
      : []

    const profileMap = new Map(profiles.map((p) => [p.id, p]))

    const enrichedMembers = members.map((m) => ({
      ...m,
      user: profileMap.get(m.userId),
    }))

    return c.json({ members: enrichedMembers })
  } catch (err) {
    console.error('[teams] List members error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * DELETE /api/teams/:teamId/members/:userId
 *
 * Remove a member from a team (admin only, or self-removal).
 */
teamsRoute.delete('/:teamId/members/:memberId', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const teamId = c.req.param('teamId')
    const memberId = c.req.param('memberId')

    // Check if removing self
    const isSelfRemoval = user.id === memberId

    if (!isSelfRemoval) {
      // Verify user is admin/owner of the team
      const [membership] = await db.select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))

      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return c.json({ error: 'Insufficient permissions' }, 403)
      }
    }

    // Prevent removing the last owner
    const [targetMember] = await db.select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, memberId)))

    if (targetMember?.role === 'owner') {
      const [ownerCount] = await db.select({ cnt: count() })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'owner')))

      if (ownerCount.cnt === 1) {
        return c.json({ error: 'Cannot remove the last owner' }, 400)
      }
    }

    // Remove member
    await db.delete(teamMembers).where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, memberId))
    )

    return c.json({ success: true })
  } catch (err) {
    console.error('[teams] Remove member error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * GET /api/teams
 *
 * List all teams the current user belongs to.
 */
teamsRoute.get('/', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser

    const rows = await db
      .select({
        id: teams.id,
        name: teams.name,
        description: teams.description,
        createdAt: teams.createdAt,
        updatedAt: teams.updatedAt,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, user.id))

    return c.json(rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      memberRole: r.role,
    })))
  } catch (err) {
    console.error('[teams] List teams error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * POST /api/teams
 *
 * Create a new team. The creating user becomes the owner.
 */
teamsRoute.post('/', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const body = await c.req.json<{ name: string; description?: string }>()

    if (!body.name?.trim()) {
      return c.json({ error: 'Team name is required' }, 400)
    }

    const teamId = crypto.randomUUID()
    const now = new Date()

    await db.insert(teams).values({
      id: teamId,
      name: body.name.trim(),
      description: body.description?.trim() ?? null,
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(teamMembers).values({
      teamId,
      userId: user.id,
      role: 'owner',
      joinedAt: now,
    })

    return c.json({
      id: teamId,
      name: body.name.trim(),
      description: body.description?.trim() ?? null,
      createdAt: now,
      updatedAt: now,
      memberRole: 'owner',
    }, 201)
  } catch (err) {
    console.error('[teams] Create team error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * PATCH /api/teams/:teamId
 *
 * Update team name/description. Requires admin or owner role.
 */
teamsRoute.patch('/:teamId', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const teamId = c.req.param('teamId')
    const body = await c.req.json<{ name?: string; description?: string }>()

    // Check permission
    const [membership] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return c.json({ error: 'Only team admins and owners can update team settings' }, 403)
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name !== undefined) updates.name = body.name.trim()
    if (body.description !== undefined) updates.description = body.description.trim()

    await db.update(teams).set(updates).where(eq(teams.id, teamId))

    const [updated] = await db.select().from(teams).where(eq(teams.id, teamId))
    return c.json(updated)
  } catch (err) {
    console.error('[teams] Update team error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * DELETE /api/teams/:teamId
 *
 * Delete a team. Only the owner can delete. Cannot delete personal team.
 */
teamsRoute.delete('/:teamId', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const teamId = c.req.param('teamId')

    // Check ownership
    const [membership] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))

    if (!membership || membership.role !== 'owner') {
      return c.json({ error: 'Only team owners can delete teams' }, 403)
    }

    // Check it's not the user's personal (auto-created) team
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId))
    if (team && team.name === 'Personal') {
      return c.json({ error: 'Cannot delete your personal team' }, 400)
    }

    // Delete members first, then team
    await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId))
    await db.delete(inviteTokens).where(eq(inviteTokens.teamId, teamId))
    await db.delete(teams).where(eq(teams.id, teamId))

    return c.json({ success: true })
  } catch (err) {
    console.error('[teams] Delete team error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

/**
 * PATCH /api/teams/:teamId/members/:userId
 *
 * Change a member's role. Requires owner role.
 */
teamsRoute.patch('/:teamId/members/:userId', async (c) => {
  if (isLocalMode()) {
    return c.json({ error: 'Teams not available in local mode' }, 503)
  }

  try {
    const user = c.get('user') as AuthUser
    const teamId = c.req.param('teamId')
    const targetUserId = c.req.param('userId')
    const body = await c.req.json<{ role: 'owner' | 'admin' | 'member' }>()

    if (!['owner', 'admin', 'member'].includes(body.role)) {
      return c.json({ error: 'Invalid role. Must be owner, admin, or member' }, 400)
    }

    // Check requester is owner
    const [membership] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))

    if (!membership || membership.role !== 'owner') {
      return c.json({ error: 'Only team owners can change member roles' }, 403)
    }

    // Cannot change own role
    if (targetUserId === user.id) {
      return c.json({ error: 'Cannot change your own role' }, 400)
    }

    await db
      .update(teamMembers)
      .set({ role: body.role })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))

    return c.json({ success: true })
  } catch (err) {
    console.error('[teams] Change role error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

export { teamsRoute }
