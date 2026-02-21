/**
 * Teams Routes — Team Management & Invitations
 *
 * Handles team CRUD operations and email-based invitation flow.
 *
 * Flow:
 * 1. Team admin sends invite → generates token, sends email
 * 2. New users: click link → register with team context → auto-join team
 * 3. Existing users: click link → accept invite → join team
 */

import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { getServiceClient } from '../lib/supabase.js'
import { isLocalMode } from '../lib/app-mode.js'
import { errorMessage } from '../lib/error-utils.js'
import { requireAuth } from '../middleware/auth.js'
import { sendInvitationEmail } from '../lib/email-service.js'

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
    const userId = c.get('userId')
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

    const supabase = getServiceClient()

    // Verify user is admin/owner of the team
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .single()

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
      .eq('user_id', (
        await supabase
          .from('user_profiles')
          .select('id')
          .eq('email', email)
          .single()
      ).data?.id || '')
      .single()

    if (existingMember) {
      return c.json({ error: 'User is already a team member' }, 400)
    }

    // Check for existing pending invites to this email
    const { data: existingInvite } = await supabase
      .from('invite_tokens')
      .select('id, expires_at')
      .eq('team_id', teamId)
      .eq('email', email)
      .is('used_at', null)
      .gte('expires_at', new Date().toISOString())
      .single()

    if (existingInvite) {
      return c.json({ error: 'An active invitation already exists for this email' }, 400)
    }

    // Generate secure random token
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    // Create invite token
    const { data: invite, error: inviteError } = await supabase
      .from('invite_tokens')
      .insert({
        token,
        team_id: teamId,
        email,
        invited_by: userId,
        role,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()

    if (inviteError) {
      console.error('[teams] Failed to create invite:', inviteError)
      return c.json({ error: 'Failed to create invitation' }, 500)
    }

    // Get team details for email
    const { data: team } = await supabase
      .from('teams')
      .select('name')
      .eq('id', teamId)
      .single()

    // Get inviter details
    const { data: inviter } = await supabase
      .from('user_profiles')
      .select('name, email')
      .eq('id', userId)
      .single()

    // Send invitation email
    const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite/${token}`

    const emailSent = await sendInvitationEmail({
      to: email,
      teamName: team?.name || 'Unknown Team',
      inviterName: inviter?.name || 'Team Admin',
      inviterEmail: inviter?.email || 'noreply@astro.fuxialexander.work',
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

    // Return success with invite details
    return c.json({
      success: true,
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expires_at,
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
    const userId = c.get('userId')
    const teamId = c.req.param('teamId')

    const supabase = getServiceClient()

    // Verify user is admin/owner of the team
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .single()

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    // Get pending invites
    const { data: invites, error } = await supabase
      .from('invite_tokens')
      .select('id, email, role, expires_at, created_at, invited_by')
      .eq('team_id', teamId)
      .is('used_at', null)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[teams] Failed to fetch invites:', error)
      return c.json({ error: 'Failed to fetch invitations' }, 500)
    }

    // Get inviter details
    const inviterIds = [...new Set(invites.map((inv) => inv.invited_by))]
    const { data: inviters } = await supabase
      .from('user_profiles')
      .select('id, name, email')
      .in('id', inviterIds)

    const inviterMap = new Map(inviters?.map((u) => [u.id, u]) || [])

    const enrichedInvites = invites.map((inv) => ({
      ...inv,
      inviter: inviterMap.get(inv.invited_by),
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
    const userId = c.get('userId')
    const inviteId = c.req.param('inviteId')

    const supabase = getServiceClient()

    // Get invite to verify team ownership
    const { data: invite } = await supabase
      .from('invite_tokens')
      .select('team_id')
      .eq('id', inviteId)
      .single()

    if (!invite) {
      return c.json({ error: 'Invitation not found' }, 404)
    }

    // Verify user is admin/owner of the team
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', invite.team_id)
      .eq('user_id', userId)
      .single()

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    // Delete the invite
    const { error: deleteError } = await supabase
      .from('invite_tokens')
      .delete()
      .eq('id', inviteId)

    if (deleteError) {
      console.error('[teams] Failed to delete invite:', deleteError)
      return c.json({ error: 'Failed to revoke invitation' }, 500)
    }

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

    const supabase = getServiceClient()

    // Get invite by token
    const { data: invite, error } = await supabase
      .from('invite_tokens')
      .select('*, teams(name)')
      .eq('token', token)
      .is('used_at', null)
      .gte('expires_at', new Date().toISOString())
      .single()

    if (error || !invite) {
      return c.json({ error: 'Invalid or expired invitation' }, 404)
    }

    // Check if user already exists with this email
    const { data: existingUser } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('email', invite.email)
      .single()

    return c.json({
      invite: {
        email: invite.email,
        role: invite.role,
        teamName: invite.teams?.name || 'Unknown Team',
        expiresAt: invite.expires_at,
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
    const userId = c.get('userId')
    const token = c.req.param('token')

    const supabase = getServiceClient()

    // Get user's email
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('id', userId)
      .single()

    if (!userProfile) {
      return c.json({ error: 'User profile not found' }, 404)
    }

    // Get invite by token and verify it matches user's email
    const { data: invite, error: inviteError } = await supabase
      .from('invite_tokens')
      .select('*')
      .eq('token', token)
      .eq('email', userProfile.email)
      .is('used_at', null)
      .gte('expires_at', new Date().toISOString())
      .single()

    if (inviteError || !invite) {
      return c.json({ error: 'Invalid or expired invitation' }, 404)
    }

    // Check if already a member
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', invite.team_id)
      .eq('user_id', userId)
      .single()

    if (existingMember) {
      // Mark invite as used even though they're already a member
      await supabase
        .from('invite_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', invite.id)

      return c.json({ error: 'You are already a member of this team' }, 400)
    }

    // Add user to team
    const { error: memberError } = await supabase
      .from('team_members')
      .insert({
        team_id: invite.team_id,
        user_id: userId,
        role: invite.role,
      })

    if (memberError) {
      console.error('[teams] Failed to add team member:', memberError)
      return c.json({ error: 'Failed to join team' }, 500)
    }

    // Mark invite as used
    await supabase
      .from('invite_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invite.id)

    // Get team details
    const { data: team } = await supabase
      .from('teams')
      .select('*')
      .eq('id', invite.team_id)
      .single()

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
    const userId = c.get('userId')
    const teamId = c.req.param('teamId')

    const supabase = getServiceClient()

    // Verify user is a member of the team
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .single()

    if (!membership) {
      return c.json({ error: 'Not a team member' }, 403)
    }

    // Get all team members with their profiles
    const { data: members, error } = await supabase
      .from('team_members')
      .select('user_id, role, joined_at')
      .eq('team_id', teamId)
      .order('joined_at', { ascending: true })

    if (error) {
      console.error('[teams] Failed to fetch members:', error)
      return c.json({ error: 'Failed to fetch team members' }, 500)
    }

    // Get user profiles
    const userIds = members.map((m) => m.user_id)
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, name, email, avatar_url')
      .in('id', userIds)

    const profileMap = new Map(profiles?.map((p) => [p.id, p]) || [])

    const enrichedMembers = members.map((m) => ({
      ...m,
      user: profileMap.get(m.user_id),
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
    const userId = c.get('userId')
    const teamId = c.req.param('teamId')
    const memberId = c.req.param('memberId')

    const supabase = getServiceClient()

    // Check if removing self
    const isSelfRemoval = userId === memberId

    if (!isSelfRemoval) {
      // Verify user is admin/owner of the team
      const { data: membership } = await supabase
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .single()

      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return c.json({ error: 'Insufficient permissions' }, 403)
      }
    }

    // Prevent removing the last owner
    const { data: targetMember } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', memberId)
      .single()

    if (targetMember?.role === 'owner') {
      const { count } = await supabase
        .from('team_members')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('role', 'owner')

      if (count === 1) {
        return c.json({ error: 'Cannot remove the last owner' }, 400)
      }
    }

    // Remove member
    const { error: deleteError } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', memberId)

    if (deleteError) {
      console.error('[teams] Failed to remove member:', deleteError)
      return c.json({ error: 'Failed to remove team member' }, 500)
    }

    return c.json({ success: true })
  } catch (err) {
    console.error('[teams] Remove member error:', err)
    return c.json({ error: errorMessage(err) }, 500)
  }
})

export { teamsRoute }
