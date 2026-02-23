/**
 * Shared test server setup for integration tests.
 *
 * Sets environment variables BEFORE any server imports, creates an isolated
 * PGlite database per test file, runs migrations, bootstraps local mode,
 * and exports request helpers for Hono app.request() based testing.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── Environment setup (must happen before any server imports) ────────
process.env.ASTRO_LOCAL_MODE = 'true'
process.env.NODE_ENV = 'test'

// Each test file gets its own PGlite data directory for isolation
const pgliteDir = mkdtempSync(join(tmpdir(), 'astro-test-pglite-'))
process.env.PGLITE_DATA_DIR = pgliteDir

// ── Server imports (after env vars are set) ──────────────────────────
import type { Hono } from 'hono'
import { runMigrations } from '../../server/lib/db/migrate.js'
import { bootstrapLocalMode, LOCAL_USER_ID, LOCAL_TEAM_ID } from '../../server/lib/db/bootstrap-local.js'
import { createApp } from '../../server/index.js'
import { db } from '../../server/lib/db/index.js'
import { teams, teamMembers, userProfiles } from '../../server/lib/db/schema.js'

// ── Constants ─────────────────────────────────────────────────────────
export { LOCAL_USER_ID, LOCAL_TEAM_ID }
export const SECOND_USER_ID = '00000000-0000-0000-0000-000000000099'
export const SECOND_TEAM_ID = '00000000-0000-0000-0000-000000000098'

// ── App singleton ─────────────────────────────────────────────────────
let app: Hono | null = null
let initialized = false

/**
 * Initialize the test server: run migrations, bootstrap, create app.
 * Idempotent — safe to call in beforeAll() of every test file.
 */
export async function setupTestServer(): Promise<Hono> {
  if (initialized && app) return app

  await runMigrations()
  await bootstrapLocalMode()
  app = createApp()
  initialized = true
  return app
}

/**
 * Get the initialized app instance.
 * Throws if setupTestServer() hasn't been called.
 */
export function getApp(): Hono {
  if (!app) throw new Error('Test server not initialized. Call setupTestServer() in beforeAll().')
  return app
}

// ── Request helpers ───────────────────────────────────────────────────

/**
 * Make a request as the default local user.
 */
export function request(path: string, init?: RequestInit): Promise<Response> {
  return getApp().request(path, init)
}

/**
 * Make a request as a specific user (sets X-User-Id header).
 */
export function requestAs(userId: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('X-User-Id', userId)
  return getApp().request(path, { ...init, headers })
}

/**
 * POST JSON as the default local user.
 */
export function postJson(path: string, body: unknown, init?: RequestInit): Promise<Response> {
  return getApp().request(path, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) },
    body: JSON.stringify(body),
  })
}

/**
 * POST JSON as a specific user.
 */
export function postJsonAs(userId: string, path: string, body: unknown, init?: RequestInit): Promise<Response> {
  return getApp().request(path, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      ...(init?.headers as Record<string, string>),
    },
    body: JSON.stringify(body),
  })
}

/**
 * PATCH JSON as the default local user.
 */
export function patchJson(path: string, body: unknown, init?: RequestInit): Promise<Response> {
  return getApp().request(path, {
    ...init,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) },
    body: JSON.stringify(body),
  })
}

/**
 * PATCH JSON as a specific user.
 */
export function patchJsonAs(userId: string, path: string, body: unknown, init?: RequestInit): Promise<Response> {
  return getApp().request(path, {
    ...init,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      ...(init?.headers as Record<string, string>),
    },
    body: JSON.stringify(body),
  })
}

/**
 * PUT JSON as the default local user.
 */
export function putJson(path: string, body: unknown, init?: RequestInit): Promise<Response> {
  return getApp().request(path, {
    ...init,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) },
    body: JSON.stringify(body),
  })
}

/**
 * PUT JSON as a specific user.
 */
export function putJsonAs(userId: string, path: string, body: unknown, init?: RequestInit): Promise<Response> {
  return getApp().request(path, {
    ...init,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      ...(init?.headers as Record<string, string>),
    },
    body: JSON.stringify(body),
  })
}

/**
 * DELETE as the default local user.
 */
export function del(path: string, init?: RequestInit): Promise<Response> {
  return getApp().request(path, { ...init, method: 'DELETE' })
}

/**
 * DELETE as a specific user.
 */
export function delAs(userId: string, path: string, init?: RequestInit): Promise<Response> {
  return getApp().request(path, {
    ...init,
    method: 'DELETE',
    headers: { 'X-User-Id': userId, ...(init?.headers as Record<string, string>) },
  })
}

/**
 * GET as a specific user.
 */
export function getAs(userId: string, path: string, init?: RequestInit): Promise<Response> {
  return getApp().request(path, {
    ...init,
    method: 'GET',
    headers: { 'X-User-Id': userId, ...(init?.headers as Record<string, string>) },
  })
}

// ── Cross-team test helpers ───────────────────────────────────────────

/**
 * Bootstrap a second user and team for cross-team isolation tests.
 * Creates team, user profile, and membership.
 */
export async function bootstrapSecondUser(): Promise<void> {
  const { eq } = await import('drizzle-orm')

  // Check if already bootstrapped
  const [existingTeam] = await db.select().from(teams).where(eq(teams.id, SECOND_TEAM_ID))
  if (existingTeam) return

  // Create team
  await db.insert(teams).values({
    id: SECOND_TEAM_ID,
    name: 'Second Team',
    description: 'Test team for isolation tests',
  })

  // Create user profile
  await db.insert(userProfiles).values({
    id: SECOND_USER_ID,
    name: 'Second User',
    email: 'user2@localhost',
  })

  // Create team membership
  await db.insert(teamMembers).values({
    teamId: SECOND_TEAM_ID,
    userId: SECOND_USER_ID,
    role: 'owner',
  })
}

export { db }
