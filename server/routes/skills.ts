/**
 * Skills API Routes (Drizzle ORM)
 *
 * Persistent skill registry backed by the `skills` table.
 * Skills are agent-level extensions that inject instructions into
 * AI agent prompts during task execution.
 *
 * Routes:
 *   GET    /api/skills          — List skills (team-scoped)
 *   GET    /api/skills/:id      — Get a single skill
 *   POST   /api/skills          — Create a new skill
 *   PUT    /api/skills/:id      — Update a skill
 *   DELETE /api/skills/:id      — Delete a skill
 *   PUT    /api/skills/:id/toggle — Toggle enabled state
 */

import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import { skills } from '../lib/db/schema.js'
import { eq, and, or, isNull } from 'drizzle-orm'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { errorMessage } from '../lib/error-utils.js'

/**
 * Build a team-scoped filter for the skills table.
 * Matches rows where teamId equals the user's active team,
 * OR where teamId is null and authorId matches (personal skills).
 */
function skillTeamScope(user: AuthUser) {
  return or(
    eq(skills.teamId, user.teamId),
    and(isNull(skills.teamId), eq(skills.authorId, user.id))
  )!
}

/** Generate a URL-safe slug from a skill name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const skillsRoute = new Hono()

// All skills routes require authentication
skillsRoute.use('/*', requireAuth)

// ── List skills (team-scoped) ─────────────────────────────────────────

skillsRoute.get('/', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const rows = await db.select().from(skills).where(skillTeamScope(user))
    return c.json({ skills: rows, total: rows.length })
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 500)
  }
})

// ── Get a single skill ────────────────────────────────────────────────

skillsRoute.get('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    const [row] = await db.select().from(skills).where(
      and(eq(skills.id, id), skillTeamScope(user))
    )
    if (!row) return c.json({ error: 'Skill not found' }, 404)

    return c.json(row)
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 500)
  }
})

// ── Create a new skill ────────────────────────────────────────────────

skillsRoute.post('/', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const body = await c.req.json()

    if (!body.name || typeof body.name !== 'string') {
      return c.json({ error: 'name is required and must be a string' }, 400)
    }

    const now = new Date()
    const slug = body.slug || slugify(body.name)

    const row = {
      id: body.id || crypto.randomUUID(),
      name: body.name,
      slug,
      description: body.description ?? '',
      instructions: body.instructions ?? '',
      source: body.source ?? 'workspace',
      enabled: body.enabled ?? true,
      userInvocable: body.userInvocable ?? true,
      disableModelInvocation: body.disableModelInvocation ?? false,
      commandDispatch: body.commandDispatch ?? null,
      commandTool: body.commandTool ?? null,
      homepage: body.homepage ?? null,
      metadata: body.metadata ?? null,
      pluginId: body.pluginId ?? null,
      config: body.config ?? {},
      authorId: user.id,
      teamId: user.teamId || null,
      createdAt: now,
      updatedAt: now,
    }

    const [created] = await db.insert(skills).values(row).returning()
    return c.json(created, 201)
  } catch (e) {
    // Handle unique constraint violation on slug
    const msg = errorMessage(e)
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: 'A skill with this slug already exists' }, 409)
    }
    return c.json({ error: msg }, 500)
  }
})

// ── Update a skill ────────────────────────────────────────────────────

skillsRoute.put('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    // Verify the skill exists and user has access
    const [existing] = await db.select().from(skills).where(
      and(eq(skills.id, id), skillTeamScope(user))
    )
    if (!existing) return c.json({ error: 'Skill not found' }, 404)

    const body = await c.req.json()
    const patch: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name !== undefined) {
      patch.name = body.name
      // Re-derive slug if name changes and no explicit slug provided
      if (body.slug === undefined) patch.slug = slugify(body.name)
    }
    if (body.slug !== undefined) patch.slug = body.slug
    if (body.description !== undefined) patch.description = body.description
    if (body.instructions !== undefined) patch.instructions = body.instructions
    if (body.source !== undefined) patch.source = body.source
    if (body.enabled !== undefined) patch.enabled = body.enabled
    if (body.userInvocable !== undefined) patch.userInvocable = body.userInvocable
    if (body.disableModelInvocation !== undefined) patch.disableModelInvocation = body.disableModelInvocation
    if (body.commandDispatch !== undefined) patch.commandDispatch = body.commandDispatch || null
    if (body.commandTool !== undefined) patch.commandTool = body.commandTool || null
    if (body.homepage !== undefined) patch.homepage = body.homepage || null
    if (body.metadata !== undefined) patch.metadata = body.metadata
    if (body.pluginId !== undefined) patch.pluginId = body.pluginId || null
    if (body.config !== undefined) patch.config = body.config

    const [updated] = await db.update(skills)
      .set(patch)
      .where(and(eq(skills.id, id), skillTeamScope(user)))
      .returning()

    return c.json(updated)
  } catch (e) {
    const msg = errorMessage(e)
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: 'A skill with this slug already exists' }, 409)
    }
    return c.json({ error: msg }, 500)
  }
})

// ── Delete a skill ────────────────────────────────────────────────────

skillsRoute.delete('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    // Verify the skill exists and user has access
    const [existing] = await db.select().from(skills).where(
      and(eq(skills.id, id), skillTeamScope(user))
    )
    if (!existing) return c.json({ error: 'Skill not found' }, 404)

    await db.delete(skills).where(
      and(eq(skills.id, id), skillTeamScope(user))
    )

    return c.json({ success: true, id })
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 500)
  }
})

// ── Toggle skill enabled state ────────────────────────────────────────

skillsRoute.put('/:id/toggle', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    // Verify the skill exists and user has access
    const [existing] = await db.select().from(skills).where(
      and(eq(skills.id, id), skillTeamScope(user))
    )
    if (!existing) return c.json({ error: 'Skill not found' }, 404)

    const [updated] = await db.update(skills)
      .set({ enabled: !existing.enabled, updatedAt: new Date() })
      .where(and(eq(skills.id, id), skillTeamScope(user)))
      .returning()

    return c.json(updated)
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 500)
  }
})

export { skillsRoute }
