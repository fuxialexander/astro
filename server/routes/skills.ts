/**
 * Skills API Route
 *
 * Manages skill registry using Drizzle ORM for database persistence.
 * Skills are reusable capability definitions that can be assigned to tasks/agents.
 *
 * All routes are team-scoped following patterns from data.ts.
 */

import { Hono } from 'hono'
import { eq, and, or, isNull } from 'drizzle-orm'
import { db } from '../lib/db/index.js'
import { skills } from '../lib/db/schema.js'
import { errorMessage } from '../lib/error-utils.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'

const skillsRoute = new Hono()

// All skills routes require authentication
skillsRoute.use('/*', requireAuth)

/**
 * Build a team-scoped filter for skills.
 * Matches rows where teamId equals the user's active team,
 * OR where teamId is null and authorId matches (for personal skills).
 */
function skillTeamScopeFilter(user: AuthUser) {
  return or(
    eq(skills.teamId, user.teamId),
    and(isNull(skills.teamId), eq(skills.authorId, user.id))
  )!
}

/**
 * List all skills for the user's team
 *
 * GET /api/skills
 */
skillsRoute.get('/', async (c) => {
  try {
    const user = c.get('user')! as AuthUser

    const rows = await db.select().from(skills).where(skillTeamScopeFilter(user))

    const result = rows.map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      description: s.description,
      instructions: s.instructions,
      category: s.category,
      tags: s.tags,
      source: s.source,
      sourceUrl: s.sourceUrl,
      authorId: s.authorId,
      enabled: s.enabled,
      allowedTools: s.allowedTools,
      config: s.config,
      teamId: s.teamId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))

    return c.json({ skills: result, total: result.length })
  } catch (e) {
    console.error('[skills] GET / error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Get a single skill by ID
 *
 * GET /api/skills/:id
 */
skillsRoute.get('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    const [row] = await db.select().from(skills).where(
      and(eq(skills.id, id), skillTeamScopeFilter(user))
    )

    if (!row) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    return c.json(row)
  } catch (e) {
    console.error('[skills] GET /:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Create a new skill
 *
 * POST /api/skills
 */
skillsRoute.post('/', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const body = await c.req.json()

    if (!body.name || typeof body.name !== 'string') {
      return c.json({ error: 'name is required' }, 400)
    }

    const now = new Date()
    const skillId = body.id || crypto.randomUUID()

    const row = {
      id: skillId,
      name: body.name,
      version: body.version ?? '1.0.0',
      description: body.description ?? '',
      instructions: body.instructions ?? '',
      category: body.category ?? null,
      tags: body.tags ?? [],
      source: body.source ?? 'user',
      sourceUrl: body.sourceUrl ?? null,
      authorId: user.id,
      enabled: body.enabled ?? true,
      allowedTools: body.allowedTools ?? [],
      config: body.config ?? {},
      teamId: user.teamId ?? null,
      createdAt: body.createdAt ? new Date(body.createdAt) : now,
      updatedAt: body.updatedAt ? new Date(body.updatedAt) : now,
    }

    await db.insert(skills).values(row).onConflictDoUpdate({
      target: skills.id,
      set: { ...row, id: undefined } as typeof row,
    })

    const [created] = await db.select().from(skills).where(eq(skills.id, skillId))

    return c.json(created, 201)
  } catch (e) {
    console.error('[skills] POST / error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Update an existing skill
 *
 * PUT /api/skills/:id
 */
skillsRoute.put('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    // Verify skill exists and user has access
    const [existing] = await db.select().from(skills).where(
      and(eq(skills.id, id), skillTeamScopeFilter(user))
    )

    if (!existing) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    const body = await c.req.json()
    const patch: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name !== undefined) patch.name = body.name
    if (body.version !== undefined) patch.version = body.version
    if (body.description !== undefined) patch.description = body.description
    if (body.instructions !== undefined) patch.instructions = body.instructions
    if (body.category !== undefined) patch.category = body.category || null
    if (body.tags !== undefined) patch.tags = body.tags
    if (body.source !== undefined) patch.source = body.source
    if (body.sourceUrl !== undefined) patch.sourceUrl = body.sourceUrl || null
    if (body.enabled !== undefined) patch.enabled = body.enabled
    if (body.allowedTools !== undefined) patch.allowedTools = body.allowedTools
    if (body.config !== undefined) patch.config = body.config

    await db.update(skills).set(patch).where(eq(skills.id, id))

    const [updated] = await db.select().from(skills).where(eq(skills.id, id))
    return c.json(updated)
  } catch (e) {
    console.error('[skills] PUT /:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Delete a skill
 *
 * DELETE /api/skills/:id
 */
skillsRoute.delete('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    // Verify skill exists and user has access
    const [existing] = await db.select().from(skills).where(
      and(eq(skills.id, id), skillTeamScopeFilter(user))
    )

    if (!existing) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    await db.delete(skills).where(eq(skills.id, id))

    return c.json({ ok: true, id })
  } catch (e) {
    console.error('[skills] DELETE /:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Toggle skill enabled/disabled status
 *
 * PUT /api/skills/:id/toggle
 */
skillsRoute.put('/:id/toggle', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    // Verify skill exists and user has access
    const [existing] = await db.select().from(skills).where(
      and(eq(skills.id, id), skillTeamScopeFilter(user))
    )

    if (!existing) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    const newEnabled = !existing.enabled

    await db.update(skills).set({
      enabled: newEnabled,
      updatedAt: new Date(),
    }).where(eq(skills.id, id))

    const [updated] = await db.select().from(skills).where(eq(skills.id, id))
    return c.json(updated)
  } catch (e) {
    console.error('[skills] PUT /:id/toggle error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

export { skillsRoute }
