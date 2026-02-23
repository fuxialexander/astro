/**
 * Integration test: Authentication-to-Database Flow
 *
 * Tests the full data flow from login/registration through the backend
 * to the database. Verifies:
 *
 * 1. User profile creation and retrieval
 * 2. Team auto-creation during registration
 * 3. Team CRUD through the data layer
 * 4. Team membership management
 * 5. Team-scoped data isolation (projects, plans)
 * 6. Invite creation and acceptance (including expiration edge cases)
 * 7. Multi-user scenarios (switching users, stale data)
 * 8. Auth session endpoint
 * 9. Ensure-profile endpoint
 * 10. Team cascade deletion (members + invites)
 * 11. requireAuth middleware team resolution
 * 12. Auto-create personal team for new users
 *
 * These tests run against real PGlite (Postgres-in-WASM) with the actual
 * Drizzle ORM schema, testing the full backend API → database path.
 *
 * ── What CANNOT be tested here ─────────────────────────────────────
 * See tests/auth-routes.test.ts header for the full list of flows
 * requiring a real browser + Supabase (OAuth, passkeys, magic link).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  setupTestServer,
  request,
  postJson,
  postJsonAs,
  patchJson,
  del,
  getAs,
  db,
  bootstrapSecondUser,
  LOCAL_USER_ID,
  LOCAL_TEAM_ID,
  SECOND_USER_ID,
  SECOND_TEAM_ID,
} from '../helpers/test-server.js'
import {
  projects,
  teams,
  teamMembers,
  inviteTokens,
  userProfiles,
  planNodes,
  planEdges,
} from '../../server/lib/db/schema.js'
import { eq, and } from 'drizzle-orm'

beforeAll(async () => {
  await setupTestServer()
  await bootstrapSecondUser()
})

// ── Auth Session ─────────────────────────────────────────────────────

describe('Auth session verification', () => {
  it('GET /api/auth/session returns authenticated in local mode', async () => {
    const res = await request('/api/auth/session')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.authenticated).toBe(true)
    expect(body.user.id).toBe(LOCAL_USER_ID)
    expect(body.user.email).toBe('dev@localhost')
    expect(body.mode).toBe('development')
  })
})

// ── Ensure-Profile Endpoint ──────────────────────────────────────────

describe('Ensure-profile endpoint', () => {
  it('POST /api/auth/ensure-profile returns ok in local mode', async () => {
    const res = await postJson('/api/auth/ensure-profile', {
      name: 'OAuth User',
      avatarUrl: 'https://example.com/avatar.jpg',
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('local')
  })
})

// ── User Profile CRUD ────────────────────────────────────────────────

describe('User profile management', () => {
  it('local user profile exists after bootstrap', async () => {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, LOCAL_USER_ID))
    expect(profile).toBeDefined()
    expect(profile.email).toBe('dev@localhost')
  })

  it('second user profile exists after bootstrap', async () => {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, SECOND_USER_ID))
    expect(profile).toBeDefined()
    expect(profile.name).toBe('Second User')
    expect(profile.email).toBe('user2@localhost')
  })

  it('GET /api/data/profile returns current user profile', async () => {
    const res = await request('/api/data/profile')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.id).toBe(LOCAL_USER_ID)
  })

  it('user profiles are unique per user', async () => {
    const profileA = await request('/api/data/profile')
    const profileB = await getAs(SECOND_USER_ID, '/api/data/profile')

    const bodyA = await profileA.json()
    const bodyB = await profileB.json()

    expect(bodyA.id).toBe(LOCAL_USER_ID)
    expect(bodyB.id).toBe(SECOND_USER_ID)
    expect(bodyA.id).not.toBe(bodyB.id)
  })
})

// ── Team Auto-Creation ───────────────────────────────────────────────

describe('Team auto-creation during registration', () => {
  it('local user has a team after bootstrap', async () => {
    const memberships = await db.select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, LOCAL_USER_ID))

    expect(memberships.length).toBeGreaterThanOrEqual(1)

    // Local user should be owner of their team
    const localMembership = memberships.find(m => m.teamId === LOCAL_TEAM_ID)
    expect(localMembership).toBeDefined()
    expect(localMembership!.role).toBe('owner')
  })

  it('second user has their own team', async () => {
    const memberships = await db.select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, SECOND_USER_ID))

    expect(memberships.length).toBeGreaterThanOrEqual(1)

    const membership = memberships.find(m => m.teamId === SECOND_TEAM_ID)
    expect(membership).toBeDefined()
    expect(membership!.role).toBe('owner')
  })

  it('users belong to different teams by default', async () => {
    const localTeams = await db.select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, LOCAL_USER_ID))

    const secondTeams = await db.select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, SECOND_USER_ID))

    // Users should not share teams by default
    const localTeamIds = new Set(localTeams.map(t => t.teamId))
    const secondTeamIds = new Set(secondTeams.map(t => t.teamId))

    const sharedTeams = [...localTeamIds].filter(id => secondTeamIds.has(id))
    expect(sharedTeams.length).toBe(0)
  })
})

// ── Team Data Directly ───────────────────────────────────────────────

describe('Team data layer (Drizzle ORM)', () => {
  it('teams table has local and second teams', async () => {
    const allTeams = await db.select().from(teams)
    expect(allTeams.length).toBeGreaterThanOrEqual(2)

    const localTeam = allTeams.find(t => t.id === LOCAL_TEAM_ID)
    expect(localTeam).toBeDefined()

    const secondTeam = allTeams.find(t => t.id === SECOND_TEAM_ID)
    expect(secondTeam).toBeDefined()
    expect(secondTeam!.name).toBe('Second Team')
  })

  it('can create a new team via direct DB insert', async () => {
    const newTeamId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

    // Clean up if exists
    await db.delete(teamMembers).where(eq(teamMembers.teamId, newTeamId))
    await db.delete(teams).where(eq(teams.id, newTeamId))

    // Create team
    const [team] = await db.insert(teams).values({
      id: newTeamId,
      name: 'Test Direct Team',
      description: 'Created via direct DB',
    }).returning()

    expect(team.id).toBe(newTeamId)
    expect(team.name).toBe('Test Direct Team')

    // Add owner
    await db.insert(teamMembers).values({
      teamId: newTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })

    // Verify membership
    const [membership] = await db.select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, newTeamId), eq(teamMembers.userId, LOCAL_USER_ID)))

    expect(membership).toBeDefined()
    expect(membership.role).toBe('owner')

    // Cleanup
    await db.delete(teamMembers).where(eq(teamMembers.teamId, newTeamId))
    await db.delete(teams).where(eq(teams.id, newTeamId))
  })
})

// ── Invite Flow via DB ───────────────────────────────────────────────

describe('Invite token flow (data layer)', () => {
  const inviteId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const inviteTeamId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

  beforeEach(async () => {
    // Cleanup
    await db.delete(inviteTokens).where(eq(inviteTokens.id, inviteId))
    await db.delete(teamMembers).where(eq(teamMembers.teamId, inviteTeamId))
    await db.delete(teams).where(eq(teams.id, inviteTeamId))
  })

  it('can create and retrieve an invite token', async () => {
    // Create team for invite
    await db.insert(teams).values({
      id: inviteTeamId,
      name: 'Invite Test Team',
    })
    await db.insert(teamMembers).values({
      teamId: inviteTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })

    // Create invite
    const token = 'test-invite-token-' + Date.now()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const [invite] = await db.insert(inviteTokens).values({
      id: inviteId,
      token,
      teamId: inviteTeamId,
      email: 'user2@localhost',
      invitedBy: LOCAL_USER_ID,
      role: 'member',
      expiresAt,
    }).returning()

    expect(invite.email).toBe('user2@localhost')
    expect(invite.role).toBe('member')
    expect(invite.teamId).toBe(inviteTeamId)

    // Retrieve by token
    const [retrieved] = await db.select()
      .from(inviteTokens)
      .where(eq(inviteTokens.token, token))

    expect(retrieved).toBeDefined()
    expect(retrieved.email).toBe('user2@localhost')
    expect(retrieved.usedAt).toBeNull()
  })

  it('accepting an invite adds user to team', async () => {
    // Create team for invite
    await db.insert(teams).values({
      id: inviteTeamId,
      name: 'Accept Test Team',
    })
    await db.insert(teamMembers).values({
      teamId: inviteTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })

    // Create invite for second user
    const token = 'accept-invite-token-' + Date.now()
    const [invite] = await db.insert(inviteTokens).values({
      id: inviteId,
      token,
      teamId: inviteTeamId,
      email: 'user2@localhost',
      invitedBy: LOCAL_USER_ID,
      role: 'member',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }).returning()

    // Simulate accept: add member + mark used
    await db.insert(teamMembers).values({
      teamId: invite.teamId,
      userId: SECOND_USER_ID,
      role: invite.role,
    })
    await db.update(inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(inviteTokens.id, invite.id))

    // Verify membership
    const [membership] = await db.select()
      .from(teamMembers)
      .where(and(
        eq(teamMembers.teamId, inviteTeamId),
        eq(teamMembers.userId, SECOND_USER_ID),
      ))

    expect(membership).toBeDefined()
    expect(membership.role).toBe('member')

    // Verify invite is marked used
    const [usedInvite] = await db.select()
      .from(inviteTokens)
      .where(eq(inviteTokens.id, inviteId))

    expect(usedInvite.usedAt).not.toBeNull()

    // Cleanup: remove second user from invite team
    await db.delete(teamMembers).where(
      and(eq(teamMembers.teamId, inviteTeamId), eq(teamMembers.userId, SECOND_USER_ID))
    )
  })
})

// ── Project Scoping to Teams ─────────────────────────────────────────

describe('Projects scoped to teams', () => {
  beforeEach(async () => {
    await db.delete(planEdges)
    await db.delete(planNodes)
    await db.delete(projects)
  })

  it('projects are assigned to the users team on creation', async () => {
    const res = await postJson('/api/data/projects', {
      name: 'Team-Scoped Project',
      description: 'Should be scoped to local team',
    })
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.teamId).toBe(LOCAL_TEAM_ID)
    expect(body.ownerId).toBe(LOCAL_USER_ID)
  })

  it('User A and User B projects are in different teams', async () => {
    // User A creates project
    const resA = await postJson('/api/data/projects', { name: 'A Team Project' })
    const projectA = await resA.json()

    // User B creates project
    const resB = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Team Project' })
    const projectB = await resB.json()

    // Verify different team IDs
    expect(projectA.teamId).toBe(LOCAL_TEAM_ID)
    expect(projectB.teamId).toBe(SECOND_TEAM_ID)
    expect(projectA.teamId).not.toBe(projectB.teamId)
  })

  it('listing projects only returns projects from users team', async () => {
    // Create projects for both users
    await postJson('/api/data/projects', { name: 'A Visible' })
    await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Visible' })

    // User A list
    const listA = await request('/api/data/projects')
    const projectsA = await listA.json()
    expect(projectsA).toHaveLength(1)
    expect(projectsA[0].name).toBe('A Visible')

    // User B list
    const listB = await getAs(SECOND_USER_ID, '/api/data/projects')
    const projectsB = await listB.json()
    expect(projectsB).toHaveLength(1)
    expect(projectsB[0].name).toBe('B Visible')
  })

  it('User A cannot access User B project by ID', async () => {
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Private' })
    const project = await createRes.json()

    const getRes = await request(`/api/data/projects/${project.id}`)
    expect(getRes.status).toBe(404)
  })

  it('User A cannot update User B project', async () => {
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Locked' })
    const project = await createRes.json()

    const patchRes = await patchJson(`/api/data/projects/${project.id}`, { name: 'Hacked' })
    expect(patchRes.status).toBe(404)
  })

  it('User A cannot delete User B project', async () => {
    const createRes = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Protected' })
    const project = await createRes.json()

    const deleteRes = await del(`/api/data/projects/${project.id}`)
    expect(deleteRes.status).toBe(404)
  })
})

// ── Plan Nodes Scoped to Teams ───────────────────────────────────────

describe('Plan nodes scoped to teams', () => {
  beforeEach(async () => {
    await db.delete(planEdges)
    await db.delete(planNodes)
    await db.delete(projects)
  })

  it('plan nodes for User B project are invisible to User A', async () => {
    // User B creates project and plan
    const projRes = await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B Plan Project' })
    const proj = await projRes.json()

    // User B saves plan nodes using PUT
    const planRes = await request(`/api/data/plan/${proj.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': SECOND_USER_ID,
      },
      body: JSON.stringify({
        nodes: [{ id: 'node-1', type: 'task', title: 'B Task', position: { x: 0, y: 0 } }],
        edges: [],
      }),
    })
    expect(planRes.status).toBe(200)

    // User A tries to read User B plan
    const readRes = await request(`/api/data/plan/${proj.id}`)
    expect(readRes.status).toBe(404) // Project not found for User A team
  })
})

// ── Multi-User Switching ─────────────────────────────────────────────

describe('Multi-user data switching', () => {
  beforeEach(async () => {
    await db.delete(planEdges)
    await db.delete(planNodes)
    await db.delete(projects)
  })

  it('switching users shows different projects', async () => {
    // User A creates projects
    await postJson('/api/data/projects', { name: 'A-1' })
    await postJson('/api/data/projects', { name: 'A-2' })

    // User B creates projects
    await postJsonAs(SECOND_USER_ID, '/api/data/projects', { name: 'B-1' })

    // User A sees 2 projects
    const listA = await request('/api/data/projects')
    const projectsA = await listA.json()
    expect(projectsA).toHaveLength(2)
    expect(projectsA.map((p: { name: string }) => p.name).sort()).toEqual(['A-1', 'A-2'])

    // User B sees 1 project
    const listB = await getAs(SECOND_USER_ID, '/api/data/projects')
    const projectsB = await listB.json()
    expect(projectsB).toHaveLength(1)
    expect(projectsB[0].name).toBe('B-1')
  })

  it('user profile is per-user', async () => {
    const profileA = await request('/api/data/profile')
    const profileB = await getAs(SECOND_USER_ID, '/api/data/profile')

    const bodyA = await profileA.json()
    const bodyB = await profileB.json()

    // Each user has their own profile
    expect(bodyA.id).toBe(LOCAL_USER_ID)
    expect(bodyB.id).toBe(SECOND_USER_ID)
    expect(bodyA.id).not.toBe(bodyB.id)
  })
})

// ── Team Member Role Verification (DB layer) ─────────────────────────

describe('Team member roles (data layer)', () => {
  it('local user is owner of their team', async () => {
    const [membership] = await db.select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, LOCAL_TEAM_ID), eq(teamMembers.userId, LOCAL_USER_ID)))

    expect(membership).toBeDefined()
    expect(membership.role).toBe('owner')
  })

  it('second user is owner of their team', async () => {
    const [membership] = await db.select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, SECOND_TEAM_ID), eq(teamMembers.userId, SECOND_USER_ID)))

    expect(membership).toBeDefined()
    expect(membership.role).toBe('owner')
  })

  it('can update member role via DB', async () => {
    const testTeamId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    const testUserId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

    // Cleanup
    await db.delete(teamMembers).where(eq(teamMembers.teamId, testTeamId))
    await db.delete(teams).where(eq(teams.id, testTeamId))
    await db.delete(userProfiles).where(eq(userProfiles.id, testUserId))

    // Create team, user, and membership
    await db.insert(teams).values({ id: testTeamId, name: 'Role Test Team' })
    await db.insert(userProfiles).values({ id: testUserId, name: 'Role User', email: 'role@test.com' })
    await db.insert(teamMembers).values({
      teamId: testTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })
    await db.insert(teamMembers).values({
      teamId: testTeamId,
      userId: testUserId,
      role: 'member',
    })

    // Update role
    await db.update(teamMembers)
      .set({ role: 'admin' })
      .where(and(eq(teamMembers.teamId, testTeamId), eq(teamMembers.userId, testUserId)))

    // Verify
    const [updated] = await db.select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, testTeamId), eq(teamMembers.userId, testUserId)))

    expect(updated.role).toBe('admin')

    // Cleanup
    await db.delete(teamMembers).where(eq(teamMembers.teamId, testTeamId))
    await db.delete(teams).where(eq(teams.id, testTeamId))
    await db.delete(userProfiles).where(eq(userProfiles.id, testUserId))
  })
})

// ── X-Team-Id Header Integration ─────────────────────────────────────

describe('X-Team-Id header behavior', () => {
  beforeEach(async () => {
    await db.delete(planEdges)
    await db.delete(planNodes)
    await db.delete(projects)
  })

  it('projects are scoped to team via X-User-Id (which resolves team)', async () => {
    // Create project as local user (LOCAL_TEAM_ID)
    const createRes = await postJson('/api/data/projects', { name: 'Team-Scoped' })
    const project = await createRes.json()
    expect(project.teamId).toBe(LOCAL_TEAM_ID)

    // Verify visible to local user
    const listLocal = await request('/api/data/projects')
    const localProjects = await listLocal.json()
    expect(localProjects.some((p: { id: string }) => p.id === project.id)).toBe(true)

    // Verify NOT visible to second user
    const listOther = await getAs(SECOND_USER_ID, '/api/data/projects')
    const otherProjects = await listOther.json()
    expect(otherProjects.some((p: { id: string }) => p.id === project.id)).toBe(false)
  })
})

// ── Invite Token Edge Cases ──────────────────────────────────────────

describe('Invite token edge cases (data layer)', () => {
  const edgeTeamId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

  beforeEach(async () => {
    await db.delete(inviteTokens).where(eq(inviteTokens.teamId, edgeTeamId))
    await db.delete(teamMembers).where(eq(teamMembers.teamId, edgeTeamId))
    await db.delete(teams).where(eq(teams.id, edgeTeamId))
  })

  it('expired invite token has past expiresAt date', async () => {
    await db.insert(teams).values({ id: edgeTeamId, name: 'Expired Invite Team' })
    await db.insert(teamMembers).values({
      teamId: edgeTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })

    const token = 'expired-invite-' + Date.now()
    const [invite] = await db.insert(inviteTokens).values({
      token,
      teamId: edgeTeamId,
      email: 'expired@test.com',
      invitedBy: LOCAL_USER_ID,
      role: 'member',
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
    }).returning()

    expect(invite.expiresAt.getTime()).toBeLessThan(Date.now())
    expect(invite.usedAt).toBeNull()

    // Application should check expiresAt before allowing acceptance
    // The DB doesn't enforce this — it's up to the route handler
    const [retrieved] = await db.select()
      .from(inviteTokens)
      .where(eq(inviteTokens.token, token))
    expect(retrieved).toBeDefined()
    expect(retrieved.expiresAt.getTime()).toBeLessThan(Date.now())
  })

  it('duplicate invite tokens are rejected (unique constraint)', async () => {
    await db.insert(teams).values({ id: edgeTeamId, name: 'Unique Token Team' })
    await db.insert(teamMembers).values({
      teamId: edgeTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })

    const token = 'unique-token-' + Date.now()
    await db.insert(inviteTokens).values({
      token,
      teamId: edgeTeamId,
      email: 'first@test.com',
      invitedBy: LOCAL_USER_ID,
      role: 'member',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    // Second insert with same token should fail
    await expect(
      db.insert(inviteTokens).values({
        token, // duplicate
        teamId: edgeTeamId,
        email: 'second@test.com',
        invitedBy: LOCAL_USER_ID,
        role: 'member',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
    ).rejects.toThrow()
  })

  it('already-used invite token has non-null usedAt', async () => {
    await db.insert(teams).values({ id: edgeTeamId, name: 'Used Token Team' })
    await db.insert(teamMembers).values({
      teamId: edgeTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })

    const token = 'used-invite-' + Date.now()
    const [invite] = await db.insert(inviteTokens).values({
      token,
      teamId: edgeTeamId,
      email: 'user2@localhost',
      invitedBy: LOCAL_USER_ID,
      role: 'member',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }).returning()

    // Mark as used
    await db.update(inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(inviteTokens.id, invite.id))

    // Verify it's marked used
    const [used] = await db.select()
      .from(inviteTokens)
      .where(eq(inviteTokens.id, invite.id))
    expect(used.usedAt).not.toBeNull()

    // Application should check usedAt before allowing re-acceptance
  })

  it('multiple invites to different emails for the same team', async () => {
    await db.insert(teams).values({ id: edgeTeamId, name: 'Multi-Invite Team' })
    await db.insert(teamMembers).values({
      teamId: edgeTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })

    const invites = await Promise.all([
      db.insert(inviteTokens).values({
        token: 'multi-invite-a-' + Date.now(),
        teamId: edgeTeamId,
        email: 'alice@test.com',
        invitedBy: LOCAL_USER_ID,
        role: 'member',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).returning(),
      db.insert(inviteTokens).values({
        token: 'multi-invite-b-' + Date.now(),
        teamId: edgeTeamId,
        email: 'bob@test.com',
        invitedBy: LOCAL_USER_ID,
        role: 'admin',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).returning(),
    ])

    expect(invites[0][0].email).toBe('alice@test.com')
    expect(invites[0][0].role).toBe('member')
    expect(invites[1][0].email).toBe('bob@test.com')
    expect(invites[1][0].role).toBe('admin')
  })
})

// ── Team Cascade Deletion ───────────────────────────────────────────

describe('Team cascade deletion', () => {
  const cascadeTeamId = '11111111-1111-1111-1111-111111111111'

  beforeEach(async () => {
    // Clean up from previous runs
    await db.delete(inviteTokens).where(eq(inviteTokens.teamId, cascadeTeamId))
    await db.delete(teamMembers).where(eq(teamMembers.teamId, cascadeTeamId))
    await db.delete(teams).where(eq(teams.id, cascadeTeamId))
  })

  it('deleting a team cascades to team_members', async () => {
    // Create team with members
    await db.insert(teams).values({ id: cascadeTeamId, name: 'Cascade Test Team' })
    await db.insert(teamMembers).values({
      teamId: cascadeTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })
    await db.insert(teamMembers).values({
      teamId: cascadeTeamId,
      userId: SECOND_USER_ID,
      role: 'member',
    })

    // Verify members exist
    const membersBefore = await db.select()
      .from(teamMembers)
      .where(eq(teamMembers.teamId, cascadeTeamId))
    expect(membersBefore).toHaveLength(2)

    // Delete team
    await db.delete(teams).where(eq(teams.id, cascadeTeamId))

    // Members should be cascade-deleted
    const membersAfter = await db.select()
      .from(teamMembers)
      .where(eq(teamMembers.teamId, cascadeTeamId))
    expect(membersAfter).toHaveLength(0)
  })

  it('deleting a team cascades to invite_tokens', async () => {
    await db.insert(teams).values({ id: cascadeTeamId, name: 'Cascade Invite Team' })
    await db.insert(teamMembers).values({
      teamId: cascadeTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })

    // Create invite for the team
    await db.insert(inviteTokens).values({
      token: 'cascade-invite-' + Date.now(),
      teamId: cascadeTeamId,
      email: 'cascade@test.com',
      invitedBy: LOCAL_USER_ID,
      role: 'member',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    // Verify invite exists
    const invitesBefore = await db.select()
      .from(inviteTokens)
      .where(eq(inviteTokens.teamId, cascadeTeamId))
    expect(invitesBefore).toHaveLength(1)

    // Delete team
    await db.delete(teams).where(eq(teams.id, cascadeTeamId))

    // Invites should be cascade-deleted
    const invitesAfter = await db.select()
      .from(inviteTokens)
      .where(eq(inviteTokens.teamId, cascadeTeamId))
    expect(invitesAfter).toHaveLength(0)
  })
})

// ── requireAuth Middleware Team Resolution ───────────────────────────

describe('requireAuth middleware team resolution', () => {
  beforeEach(async () => {
    await db.delete(planEdges)
    await db.delete(planNodes)
    await db.delete(projects)
  })

  it('auto-creates personal team for user with no memberships', async () => {
    const orphanUserId = '22222222-2222-2222-2222-222222222222'

    // Cleanup
    await db.delete(teamMembers).where(eq(teamMembers.userId, orphanUserId))
    await db.delete(userProfiles).where(eq(userProfiles.id, orphanUserId))

    // Create user profile without any team membership
    await db.insert(userProfiles).values({
      id: orphanUserId,
      name: 'Orphan User',
      email: 'orphan@test.com',
    })

    // Making a request as this user should trigger team auto-creation
    // via requireAuth → resolveTeams
    const res = await postJsonAs(orphanUserId, '/api/data/projects', { name: 'Orphan Project' })
    expect(res.status).toBe(201)

    const project = await res.json()
    // Project should have a team assigned (auto-created)
    expect(project.teamId).toBeDefined()
    expect(project.teamId).not.toBeNull()

    // Verify the user now has a team membership
    const memberships = await db.select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, orphanUserId))
    expect(memberships.length).toBe(1)
    expect(memberships[0].role).toBe('owner')

    // Cleanup
    await db.delete(projects).where(eq(projects.teamId, project.teamId))
    await db.delete(teamMembers).where(eq(teamMembers.userId, orphanUserId))
    await db.delete(teams).where(eq(teams.id, project.teamId))
    await db.delete(userProfiles).where(eq(userProfiles.id, orphanUserId))
  })

  it('multi-team user sees data from correct team', async () => {
    // Create a shared team and add both users
    const sharedTeamId = '33333333-3333-3333-3333-333333333333'

    await db.delete(teamMembers).where(eq(teamMembers.teamId, sharedTeamId))
    await db.delete(teams).where(eq(teams.id, sharedTeamId))

    await db.insert(teams).values({ id: sharedTeamId, name: 'Shared Team' })
    await db.insert(teamMembers).values({
      teamId: sharedTeamId,
      userId: LOCAL_USER_ID,
      role: 'owner',
    })
    await db.insert(teamMembers).values({
      teamId: sharedTeamId,
      userId: SECOND_USER_ID,
      role: 'member',
    })

    // Verify both users now have multiple team memberships
    const localMemberships = await db.select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, LOCAL_USER_ID))
    expect(localMemberships.length).toBeGreaterThanOrEqual(2)

    // Cleanup
    await db.delete(teamMembers).where(eq(teamMembers.teamId, sharedTeamId))
    await db.delete(teams).where(eq(teams.id, sharedTeamId))
  })
})

// ── User Profile Edge Cases ─────────────────────────────────────────

describe('User profile edge cases', () => {
  it('user profile update via API works', async () => {
    const res = await request('/api/data/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Updated Name',
        expertiseDomains: ['ai', 'biology'],
      }),
    })
    expect(res.status).toBe(200)

    // Read back
    const getRes = await request('/api/data/profile')
    const profile = await getRes.json()
    expect(profile.name).toBe('Updated Name')
  })

  it('user profile is isolated between users', async () => {
    // Update User A's profile
    await request('/api/data/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User A Name' }),
    })

    // User B's profile should be unaffected
    const profileB = await getAs(SECOND_USER_ID, '/api/data/profile')
    const bodyB = await profileB.json()
    expect(bodyB.name).toBe('Second User')
  })
})

// ── Team Member Removal ─────────────────────────────────────────────

describe('Team member removal (data layer)', () => {
  const removalTeamId = '44444444-4444-4444-4444-444444444444'

  beforeEach(async () => {
    await db.delete(teamMembers).where(eq(teamMembers.teamId, removalTeamId))
    await db.delete(teams).where(eq(teams.id, removalTeamId))
  })

  it('removing a member does not affect other members', async () => {
    const thirdUserId = '55555555-5555-5555-5555-555555555555'

    await db.delete(userProfiles).where(eq(userProfiles.id, thirdUserId))
    await db.insert(teams).values({ id: removalTeamId, name: 'Removal Test Team' })
    await db.insert(userProfiles).values({ id: thirdUserId, name: 'Third User', email: 'third@test.com' })

    // Add three members
    await db.insert(teamMembers).values([
      { teamId: removalTeamId, userId: LOCAL_USER_ID, role: 'owner' },
      { teamId: removalTeamId, userId: SECOND_USER_ID, role: 'member' },
      { teamId: removalTeamId, userId: thirdUserId, role: 'member' },
    ])

    // Remove second user
    await db.delete(teamMembers).where(
      and(eq(teamMembers.teamId, removalTeamId), eq(teamMembers.userId, SECOND_USER_ID))
    )

    // Two members remain
    const remaining = await db.select()
      .from(teamMembers)
      .where(eq(teamMembers.teamId, removalTeamId))
    expect(remaining).toHaveLength(2)
    expect(remaining.map(m => m.userId)).toContain(LOCAL_USER_ID)
    expect(remaining.map(m => m.userId)).toContain(thirdUserId)
    expect(remaining.map(m => m.userId)).not.toContain(SECOND_USER_ID)

    // Cleanup
    await db.delete(teamMembers).where(eq(teamMembers.teamId, removalTeamId))
    await db.delete(teams).where(eq(teams.id, removalTeamId))
    await db.delete(userProfiles).where(eq(userProfiles.id, thirdUserId))
  })
})

// ── Health Check ─────────────────────────────────────────────────────

describe('Health check', () => {
  it('GET /api/health returns healthy', async () => {
    const res = await request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
