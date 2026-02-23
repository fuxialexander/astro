/**
 * Unit tests for teams routes (server/routes/teams.ts)
 *
 * Tests team CRUD, invitation flow, and member management.
 * All routes require auth middleware — uses local mode with X-User-Id.
 *
 * Note: Teams routes return 503 in local mode because they check isLocalMode().
 * These tests verify the 503 guard works correctly. For full CRUD testing,
 * see tests/integration/auth-flow.integration.test.ts which tests the data
 * layer directly.
 *
 * ── What CANNOT be tested here ─────────────────────────────────────
 * In server mode (Supabase), team routes support:
 * - GET /api/teams → list user's teams
 * - POST /api/teams → create team
 * - POST /api/teams/invite → send invite (requires email service)
 * - GET /api/teams/:teamId/members → list members
 * - POST /api/teams/accept/:token → accept invite (requires Supabase auth)
 * These require a running Supabase instance and are tested via E2E tests.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  setupTestServer,
  request,
  postJson,
  LOCAL_TEAM_ID,
  bootstrapSecondUser,
} from './helpers/test-server.js'

beforeAll(async () => {
  await setupTestServer()
  await bootstrapSecondUser()
})

describe('GET /api/teams (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await request('/api/teams')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('Teams not available in local mode')
  })
})

describe('POST /api/teams (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await postJson('/api/teams', { name: 'New Team' })
    expect(res.status).toBe(503)
  })

  it('returns 503 even with complete team data', async () => {
    const res = await postJson('/api/teams', {
      name: 'Full Team',
      description: 'A team with all fields',
    })
    expect(res.status).toBe(503)
  })
})

describe('POST /api/teams/invite (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await postJson('/api/teams/invite', {
      teamId: LOCAL_TEAM_ID,
      email: 'invite@example.com',
    })
    expect(res.status).toBe(503)
  })

  it('returns 503 for invite with role specified', async () => {
    const res = await postJson('/api/teams/invite', {
      teamId: LOCAL_TEAM_ID,
      email: 'admin@example.com',
      role: 'admin',
    })
    expect(res.status).toBe(503)
  })
})

describe('GET /api/teams/:teamId/members (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await request(`/api/teams/${LOCAL_TEAM_ID}/members`)
    expect(res.status).toBe(503)
  })

  it('returns 503 for any team ID', async () => {
    const res = await request('/api/teams/nonexistent-id/members')
    expect(res.status).toBe(503)
  })
})

describe('POST /api/teams/accept/:token (local mode)', () => {
  it('returns 503 in local mode', async () => {
    const res = await postJson('/api/teams/accept/some-token', {})
    expect(res.status).toBe(503)
  })

  it('returns 503 for any token value', async () => {
    const res = await postJson('/api/teams/accept/valid-looking-uuid-token-here', {})
    expect(res.status).toBe(503)
  })
})
