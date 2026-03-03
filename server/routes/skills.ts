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
import { syncSkillById } from '../lib/db/bootstrap-skills.js'
import { skillManager } from '../lib/skill-manager.js'
import { skills } from '../lib/db/schema.js'
import { errorMessage } from '../lib/error-utils.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'

const skillsRoute = new Hono()

// All skills routes require authentication
skillsRoute.use('/*', requireAuth)

/**
 * Maximum config JSON text size in bytes (80KB) for API-layer validation.
 *
 * NOTE: This measures JSON.stringify().length (text bytes), while the DB
 * constraint uses pg_column_size() (storage bytes including TOAST headers,
 * alignment padding, and potential compression). These are intentionally
 * different measures — the API limit is set 20KB below the DB limit to
 * account for JSONB storage overhead which varies with content structure.
 * The wide buffer ensures requests always get a clear API-layer error
 * rather than a cryptic DB constraint violation. The DB constraint (100KB)
 * is the true safety net for direct DB access (Supabase Dashboard, PostgREST).
 */
const MAX_CONFIG_JSON_SIZE = 80 * 1024

/**
 * Validate config JSONB size.
 * Returns error message if invalid, null if valid.
 */
function validateConfig(config: unknown): string | null {
  if (config === undefined || config === null) return null
  const json = JSON.stringify(config)
  if (json.length > MAX_CONFIG_JSON_SIZE) {
    return `Config too large (${json.length} bytes). Maximum allowed is ${MAX_CONFIG_JSON_SIZE} bytes. Consider removing unused fields.`
  }
  return null
}

/**
 * Check if an error is a unique constraint violation.
 * PostgreSQL error code 23505 = unique_violation.
 * PGlite wraps errors in DrizzleQueryError with a 'cause' property.
 */
function isUniqueViolation(e: unknown): boolean {
  // Check the main error message
  const msg = errorMessage(e).toLowerCase()
  if (msg.includes('23505') || msg.includes('unique') || msg.includes('duplicate key')) {
    return true
  }
  // Check for nested cause (PGlite/Drizzle wraps errors)
  const errObj = e as { cause?: { message?: string } }
  if (errObj?.cause?.message) {
    const causeMsg = errObj.cause.message.toLowerCase()
    if (causeMsg.includes('23505') || causeMsg.includes('unique') || causeMsg.includes('duplicate key')) {
      return true
    }
  }
  return false
}

/**
 * Build a team-scoped filter for skills.
 * Matches rows where teamId equals the user's active team,
 * OR where teamId is null (global/builtin skills visible to all).
 */
function skillTeamScopeFilter(user: AuthUser) {
  return or(
    eq(skills.teamId, user.teamId),
    and(isNull(skills.teamId), eq(skills.source, 'builtin'))
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
    // instructions is not strictly required at creation time (users may add them later),
    // but skills without instructions won't be eligible for prompt injection.
    // The SkillManager.loadSkills() filters these out with a warning.

    // Block users from impersonating builtin skills via API.
    // Only system bootstrap (via bootstrapBuiltinSkills) can create builtins,
    // which bypasses this endpoint and writes to DB directly.
    if (body.source === 'builtin') {
      return c.json({ error: 'Cannot create skills with source=builtin. Only system-seeded skills can use this source.' }, 403)
    }
    const validSources = ['workspace', 'clawhub', 'plugin', 'user']
    // Normalize null/empty to default; reject invalid non-empty values
    if (body.source !== undefined && body.source !== null && body.source !== '') {
      if (!validSources.includes(body.source)) {
        return c.json({ error: `Invalid source. Must be one of: ${validSources.join(', ')}` }, 400)
      }
    }
    if (body.tags && !Array.isArray(body.tags)) {
      return c.json({ error: 'tags must be an array' }, 400)
    }
    if (body.allowedTools && !Array.isArray(body.allowedTools)) {
      return c.json({ error: 'allowedTools must be an array' }, 400)
    }

    // Validate OpenClaw extension field types before packing into config
    if (body.userInvocable !== undefined && typeof body.userInvocable !== 'boolean') {
      return c.json({ error: 'userInvocable must be a boolean' }, 400)
    }
    if (body.disableModelInvocation !== undefined && typeof body.disableModelInvocation !== 'boolean') {
      return c.json({ error: 'disableModelInvocation must be a boolean' }, 400)
    }

    // Pack OpenClaw extension fields into config JSONB.
    // These are stored inside `config` (not as separate DB columns) to keep the
    // schema stable. The canonical representation is `config.userInvocable` and
    // `config.disableModelInvocation`. Top-level body fields are a convenience alias
    // that OVERRIDES any values inside `body.config` (explicit wins over nested).
    const config = { ...(body.config ?? {}) } as Record<string, unknown>
    if (body.userInvocable !== undefined) config.userInvocable = body.userInvocable
    if (body.disableModelInvocation !== undefined) config.disableModelInvocation = body.disableModelInvocation

    // Validate config size
    const configError = validateConfig(config)
    if (configError) {
      return c.json({ error: configError }, 400)
    }

    const now = new Date()
    // Always generate a server-side UUID — never trust client-sent IDs
    // (client may send temp-{uuid} prefixed strings that aren't valid Postgres UUIDs)
    const skillId = crypto.randomUUID()

    const row = {
      id: skillId,
      name: body.name,
      version: body.version ?? '1.0.0',
      description: body.description ?? '',
      instructions: body.instructions ?? '',
      category: body.category ?? null,
      tags: body.tags ?? [],
      source: body.source || 'workspace',
      sourceUrl: body.sourceUrl ?? null,
      authorId: user.id,
      enabled: body.enabled ?? true,
      allowedTools: body.allowedTools ?? [],
      config,
      teamId: user.teamId ?? null,
      createdAt: body.createdAt ? new Date(body.createdAt) : now,
      updatedAt: body.updatedAt ? new Date(body.updatedAt) : now,
    }

    await db.insert(skills).values(row)

    const [created] = await db.select().from(skills).where(eq(skills.id, skillId))

    // Incrementally sync this skill into the in-memory cache (O(1) instead of O(N)).
    // If sync fails, the DB write (source of truth) already succeeded — prompt
    // injection will catch up on the next successful sync or server restart.
    let syncWarning: string | null = null
    try { await syncSkillById(skillManager, skillId) } catch (syncErr) {
      syncWarning = 'Skill saved but prompt injection cache update failed. Changes will take effect on next sync or server restart.'
      console.error('[skills] POST / sync warning:', syncErr)
    }

    if (syncWarning) {
      return c.json({ ...created, _warning: syncWarning }, 201)
    }
    return c.json(created, 201)
  } catch (e) {
    console.error('[skills] POST / error:', e)
    if (isUniqueViolation(e)) {
      return c.json({ error: 'A skill with this name already exists' }, 409)
    }
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

    if (existing.source === 'builtin') {
      return c.json({ error: 'Cannot modify builtin skills' }, 403)
    }

    const body = await c.req.json()

    // Validate name if provided
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return c.json({ error: 'name must be a non-empty string' }, 400)
      }
    }

    // Validate tags if provided
    if (body.tags !== undefined && !Array.isArray(body.tags)) {
      return c.json({ error: 'tags must be an array' }, 400)
    }

    // Validate allowedTools if provided
    if (body.allowedTools !== undefined && !Array.isArray(body.allowedTools)) {
      return c.json({ error: 'allowedTools must be an array' }, 400)
    }

    // Validate config size if provided
    if (body.config !== undefined) {
      const configError = validateConfig(body.config)
      if (configError) {
        return c.json({ error: configError }, 400)
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name !== undefined) patch.name = body.name
    if (body.version !== undefined) patch.version = body.version
    if (body.description !== undefined) patch.description = body.description
    if (body.instructions !== undefined) patch.instructions = body.instructions
    if (body.category !== undefined) patch.category = body.category || null
    if (body.tags !== undefined) patch.tags = body.tags
    // source is immutable after creation — reject attempts to change it
    if (body.source !== undefined) {
      if (body.source !== existing.source) {
        return c.json({ error: 'source field is immutable after creation to maintain skill provenance and prevent builtin impersonation' }, 403)
      }
      // Same source as existing — no-op
    }
    if (body.sourceUrl !== undefined) patch.sourceUrl = body.sourceUrl || null
    if (body.enabled !== undefined) patch.enabled = body.enabled
    if (body.allowedTools !== undefined) patch.allowedTools = body.allowedTools
    if (body.config !== undefined) patch.config = body.config
    // Validate OpenClaw extension field types
    if (body.userInvocable !== undefined && typeof body.userInvocable !== 'boolean') {
      return c.json({ error: 'userInvocable must be a boolean' }, 400)
    }
    if (body.disableModelInvocation !== undefined && typeof body.disableModelInvocation !== 'boolean') {
      return c.json({ error: 'disableModelInvocation must be a boolean' }, 400)
    }
    // Pack OpenClaw extension fields into config JSONB
    if (body.userInvocable !== undefined || body.disableModelInvocation !== undefined) {
      const existingConfig = (existing.config ?? {}) as Record<string, unknown>
      const mergedConfig = { ...existingConfig, ...(patch.config as Record<string, unknown> ?? {}) }
      if (body.userInvocable !== undefined) mergedConfig.userInvocable = body.userInvocable
      if (body.disableModelInvocation !== undefined) mergedConfig.disableModelInvocation = body.disableModelInvocation
      patch.config = mergedConfig
    }

    // Validate final merged config size (body.config was checked above,
    // but merging with existing config + OpenClaw fields could exceed the limit)
    if (patch.config !== undefined) {
      const mergedConfigError = validateConfig(patch.config)
      if (mergedConfigError) {
        return c.json({ error: mergedConfigError }, 400)
      }
    }

    await db.update(skills).set(patch).where(eq(skills.id, id))

    const [updated] = await db.select().from(skills).where(eq(skills.id, id))

    // Sync in-memory skill-manager for prompt injection (best-effort)
    let syncWarning: string | null = null
    try { await syncSkillById(skillManager, id) } catch (syncErr) {
      syncWarning = 'Skill updated but prompt injection cache update failed. Changes will take effect on next sync or server restart.'
      console.error('[skills] PUT /:id sync warning:', syncErr)
    }

    if (syncWarning) {
      return c.json({ ...updated, _warning: syncWarning })
    }
    return c.json(updated)
  } catch (e) {
    console.error('[skills] PUT /:id error:', e)
    if (isUniqueViolation(e)) {
      return c.json({ error: 'A skill with this name already exists' }, 409)
    }
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

    if (existing.source === 'builtin') {
      return c.json({ error: 'Cannot delete builtin skills' }, 403)
    }

    await db.delete(skills).where(eq(skills.id, id))

    // Sync in-memory skill-manager for prompt injection (best-effort)
    let syncWarning: string | null = null
    try { await syncSkillById(skillManager, id) } catch (syncErr) {
      syncWarning = 'Skill deleted but prompt injection cache update failed. Changes will take effect on next sync or server restart.'
      console.error('[skills] DELETE /:id sync warning:', syncErr)
    }

    return c.json({ ok: true, id, ...(syncWarning ? { _warning: syncWarning } : {}) })
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

    // Note: toggling builtin skills is intentionally allowed.
    // Users may want to disable a builtin skill from prompt injection
    // without deleting it. This differs from PUT/DELETE which block builtins.

    const newEnabled = !existing.enabled

    await db.update(skills).set({
      enabled: newEnabled,
      updatedAt: new Date(),
    }).where(eq(skills.id, id))

    const [updated] = await db.select().from(skills).where(eq(skills.id, id))

    // Sync in-memory skill-manager for prompt injection (best-effort)
    let syncWarning: string | null = null
    try { await syncSkillById(skillManager, id) } catch (syncErr) {
      syncWarning = 'Skill toggled but prompt injection cache update failed. Changes will take effect on next sync or server restart.'
      console.error('[skills] PUT /:id/toggle sync warning:', syncErr)
    }

    if (syncWarning) {
      return c.json({ ...updated, _warning: syncWarning })
    }
    return c.json(updated)
  } catch (e) {
    console.error('[skills] PUT /:id/toggle error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * GET /api/skills/files/:skillName/SKILL.md
 *
 * Serves SKILL.md files from the skills/ directory.
 * Used by the skill creation UI to load system prompts (e.g., skill-onboarder).
 *
 * Note: This endpoint requires authentication (via the route-level requireAuth
 * middleware) even though it serves static content. This is consistent with the
 * other skills endpoints and prevents unauthenticated enumeration of skills.
 */
skillsRoute.get('/files/:skillName/SKILL.md', async (c) => {
  try {
    const { skillName } = c.req.param()

    // Sanitize skill name to prevent path traversal
    if (!skillName || skillName.includes('..') || skillName.includes('/') || skillName.includes('\\')) {
      return c.json({ error: 'Invalid skill name' }, 400)
    }

    const fs = await import('fs/promises')
    const path = await import('path')
    const { fileURLToPath } = await import('url')

    // Get repo root (server/ is one level down from root)
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const repoRoot = path.resolve(__dirname, '../..')
    const skillPath = path.join(repoRoot, 'skills', skillName, 'SKILL.md')

    // Verify the resolved path is still within skills/ (extra safety)
    const skillsDir = path.join(repoRoot, 'skills')
    if (!skillPath.startsWith(skillsDir)) {
      return c.json({ error: 'Invalid skill path' }, 400)
    }

    try {
      const content = await fs.readFile(skillPath, 'utf-8')
      return c.text(content, 200, {
        'Content-Type': 'text/markdown; charset=utf-8',
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ error: `Skill ${skillName} not found` }, 404)
      }
      throw error
    }
  } catch (error) {
    console.error('Error serving skill file:', error)
    return c.json({ error: errorMessage(error) }, 500)
  }
})

export { skillsRoute }
