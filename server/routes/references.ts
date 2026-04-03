/**
 * References API Route
 *
 * Manages academic/literature references using CSL-JSON as the canonical data model.
 * References are team-owned resources supporting slim mode (exclude cslJson blob in list views).
 *
 * Endpoints:
 *   GET    /api/references              — list references (slim, no cslJson)
 *   GET    /api/references/search       — search by title/DOI/author/arxivId
 *   GET    /api/references/:id          — get single reference (full, includes cslJson)
 *   POST   /api/references              — create reference
 *   PUT    /api/references/:id          — update reference
 *   DELETE /api/references/:id          — delete reference
 *
 *   GET    /api/references/collections              — list collections
 *   POST   /api/references/collections              — create collection
 *   PUT    /api/references/collections/:id          — update collection
 *   DELETE /api/references/collections/:id          — delete collection
 *   POST   /api/references/collections/:id/items    — add reference to collection
 *   DELETE /api/references/collections/:id/items/:refId — remove reference from collection
 */

import { Hono } from 'hono'
import { eq, and, ilike, or, sql } from 'drizzle-orm'
import { db } from '../lib/db/index.js'
import { references, referenceCollections, referenceCollectionItems } from '../lib/db/schema.js'
import { errorMessage } from '../lib/error-utils.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { resolveWritableTeamId } from '../lib/team-utils.js'

const referencesRoute = new Hono()

// All references routes require authentication
referencesRoute.use('/*', requireAuth)

// ── Helper: build a slim row (exclude cslJson blob) ───────────────────────────

function toSlimRow(r: typeof references.$inferSelect) {
  return {
    id: r.id,
    teamId: r.teamId,
    projectId: r.projectId,
    cslType: r.cslType,
    title: r.title,
    doi: r.doi,
    pmid: r.pmid,
    arxivId: r.arxivId,
    pdfPath: r.pdfPath,
    pdfUrl: r.pdfUrl,
    source: r.source,
    zoteroKey: r.zoteroKey,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function toFullRow(r: typeof references.$inferSelect) {
  return {
    ...toSlimRow(r),
    cslJson: r.cslJson,
  }
}

/**
 * List all references for the user's team (slim mode — cslJson excluded).
 *
 * GET /api/references
 * Query params:
 *   projectId — optional filter by project
 *   slim      — "false" to include cslJson (default: true)
 */
referencesRoute.get('/', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const { projectId, slim } = c.req.query()
    const includeFullCsl = slim === 'false'

    const conditions = [eq(references.teamId, user.teamId)]
    if (projectId) {
      conditions.push(eq(references.projectId, projectId))
    }

    const rows = await db
      .select()
      .from(references)
      .where(and(...conditions))
      .orderBy(references.createdAt)

    const result = rows.map((r) => (includeFullCsl ? toFullRow(r) : toSlimRow(r)))
    return c.json({ references: result, total: result.length })
  } catch (e) {
    console.error('[references] GET / error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Search references by title, DOI, arxivId, or author (via cslJson).
 *
 * GET /api/references/search?q=<query>
 */
referencesRoute.get('/search', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const { q } = c.req.query()

    if (!q || q.trim().length === 0) {
      return c.json({ references: [], total: 0 })
    }

    const term = `%${q.trim()}%`

    const rows = await db
      .select()
      .from(references)
      .where(
        and(
          eq(references.teamId, user.teamId),
          or(
            ilike(references.title, term),
            ilike(references.doi, term),
            ilike(references.arxivId, term),
            ilike(references.pmid, term),
            // Full-text search in cslJson for author names
            sql`${references.cslJson}::text ilike ${term}`,
          )
        )
      )
      .orderBy(references.createdAt)

    return c.json({ references: rows.map(toSlimRow), total: rows.length })
  } catch (e) {
    console.error('[references] GET /search error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * List all collections for the user's team.
 *
 * GET /api/references/collections
 */
referencesRoute.get('/collections', async (c) => {
  try {
    const user = c.get('user')! as AuthUser

    const rows = await db
      .select()
      .from(referenceCollections)
      .where(eq(referenceCollections.teamId, user.teamId))
      .orderBy(referenceCollections.createdAt)

    return c.json({ collections: rows, total: rows.length })
  } catch (e) {
    console.error('[references] GET /collections error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Create a new collection.
 *
 * POST /api/references/collections
 * Body: { name, parentId?, teamId? }
 */
referencesRoute.post('/collections', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const body = await c.req.json()

    const teamTarget = resolveWritableTeamId(user, body.teamId)
    if ('error' in teamTarget) return c.json({ error: teamTarget.error }, 400)

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return c.json({ error: 'name is required' }, 400)
    }

    const [created] = await db
      .insert(referenceCollections)
      .values({
        teamId: teamTarget.teamId,
        name: body.name.trim(),
        parentId: typeof body.parentId === 'string' ? body.parentId : null,
      })
      .returning()

    return c.json(created, 201)
  } catch (e) {
    console.error('[references] POST /collections error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Update a collection.
 *
 * PUT /api/references/collections/:id
 * Body: { name?, parentId? }
 */
referencesRoute.put('/collections/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db
      .select()
      .from(referenceCollections)
      .where(and(eq(referenceCollections.id, id), eq(referenceCollections.teamId, user.teamId)))
      .limit(1)

    if (!existing) {
      return c.json({ error: 'Collection not found' }, 404)
    }

    const updates: Partial<typeof referenceCollections.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (typeof body.name === 'string' && body.name.trim().length > 0) {
      updates.name = body.name.trim()
    }
    if ('parentId' in body) {
      updates.parentId = typeof body.parentId === 'string' ? body.parentId : null
    }

    const [updated] = await db
      .update(referenceCollections)
      .set(updates)
      .where(eq(referenceCollections.id, id))
      .returning()

    return c.json(updated)
  } catch (e) {
    console.error('[references] PUT /collections/:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Delete a collection (and its membership items via cascade).
 *
 * DELETE /api/references/collections/:id
 */
referencesRoute.delete('/collections/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    const [existing] = await db
      .select()
      .from(referenceCollections)
      .where(and(eq(referenceCollections.id, id), eq(referenceCollections.teamId, user.teamId)))
      .limit(1)

    if (!existing) {
      return c.json({ error: 'Collection not found' }, 404)
    }

    await db
      .delete(referenceCollections)
      .where(eq(referenceCollections.id, id))

    return c.json({ ok: true })
  } catch (e) {
    console.error('[references] DELETE /collections/:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Add a reference to a collection.
 *
 * POST /api/references/collections/:id/items
 * Body: { referenceId }
 */
referencesRoute.post('/collections/:id/items', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const collectionId = c.req.param('id')
    const body = await c.req.json()

    if (!body.referenceId || typeof body.referenceId !== 'string') {
      return c.json({ error: 'referenceId is required' }, 400)
    }

    // Verify collection ownership
    const [collection] = await db
      .select()
      .from(referenceCollections)
      .where(and(eq(referenceCollections.id, collectionId), eq(referenceCollections.teamId, user.teamId)))
      .limit(1)

    if (!collection) {
      return c.json({ error: 'Collection not found' }, 404)
    }

    // Verify reference ownership
    const [reference] = await db
      .select()
      .from(references)
      .where(and(eq(references.id, body.referenceId), eq(references.teamId, user.teamId)))
      .limit(1)

    if (!reference) {
      return c.json({ error: 'Reference not found' }, 404)
    }

    // Upsert (ignore if already exists)
    await db
      .insert(referenceCollectionItems)
      .values({ collectionId, referenceId: body.referenceId })
      .onConflictDoNothing()

    return c.json({ ok: true, collectionId, referenceId: body.referenceId })
  } catch (e) {
    console.error('[references] POST /collections/:id/items error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Remove a reference from a collection.
 *
 * DELETE /api/references/collections/:id/items/:refId
 */
referencesRoute.delete('/collections/:id/items/:refId', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const collectionId = c.req.param('id')
    const referenceId = c.req.param('refId')

    // Verify collection ownership
    const [collection] = await db
      .select()
      .from(referenceCollections)
      .where(and(eq(referenceCollections.id, collectionId), eq(referenceCollections.teamId, user.teamId)))
      .limit(1)

    if (!collection) {
      return c.json({ error: 'Collection not found' }, 404)
    }

    await db
      .delete(referenceCollectionItems)
      .where(
        and(
          eq(referenceCollectionItems.collectionId, collectionId),
          eq(referenceCollectionItems.referenceId, referenceId),
        )
      )

    return c.json({ ok: true })
  } catch (e) {
    console.error('[references] DELETE /collections/:id/items/:refId error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Get a single reference by ID (full, includes cslJson).
 *
 * GET /api/references/:id
 */
referencesRoute.get('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    const [row] = await db
      .select()
      .from(references)
      .where(and(eq(references.id, id), eq(references.teamId, user.teamId)))
      .limit(1)

    if (!row) {
      return c.json({ error: 'Reference not found' }, 404)
    }

    return c.json(toFullRow(row))
  } catch (e) {
    console.error('[references] GET /:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Create a new reference.
 *
 * POST /api/references
 * Body: { cslJson, cslType, title, doi?, pmid?, arxivId?, pdfPath?, pdfUrl?, source?, zoteroKey?, projectId?, teamId? }
 */
referencesRoute.post('/', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const body = await c.req.json()

    const teamTarget = resolveWritableTeamId(user, body.teamId)
    if ('error' in teamTarget) return c.json({ error: teamTarget.error }, 400)

    if (!body.cslJson || typeof body.cslJson !== 'object') {
      return c.json({ error: 'cslJson is required and must be an object' }, 400)
    }
    if (!body.cslType || typeof body.cslType !== 'string') {
      return c.json({ error: 'cslType is required' }, 400)
    }
    if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
      return c.json({ error: 'title is required' }, 400)
    }

    const [created] = await db
      .insert(references)
      .values({
        teamId: teamTarget.teamId,
        projectId: typeof body.projectId === 'string' ? body.projectId : null,
        cslJson: body.cslJson,
        cslType: body.cslType,
        title: body.title.trim(),
        doi: typeof body.doi === 'string' ? body.doi : null,
        pmid: typeof body.pmid === 'string' ? body.pmid : null,
        arxivId: typeof body.arxivId === 'string' ? body.arxivId : null,
        pdfPath: typeof body.pdfPath === 'string' ? body.pdfPath : null,
        pdfUrl: typeof body.pdfUrl === 'string' ? body.pdfUrl : null,
        source: typeof body.source === 'string' ? body.source : 'manual',
        zoteroKey: typeof body.zoteroKey === 'string' ? body.zoteroKey : null,
      })
      .returning()

    return c.json(toFullRow(created), 201)
  } catch (e) {
    console.error('[references] POST / error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Update an existing reference.
 *
 * PUT /api/references/:id
 * Body: partial reference fields
 */
referencesRoute.put('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db
      .select()
      .from(references)
      .where(and(eq(references.id, id), eq(references.teamId, user.teamId)))
      .limit(1)

    if (!existing) {
      return c.json({ error: 'Reference not found' }, 404)
    }

    const updates: Partial<typeof references.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (body.cslJson !== undefined && typeof body.cslJson === 'object') {
      updates.cslJson = body.cslJson
    }
    if (typeof body.cslType === 'string') updates.cslType = body.cslType
    if (typeof body.title === 'string' && body.title.trim().length > 0) {
      updates.title = body.title.trim()
    }
    if ('doi' in body) updates.doi = typeof body.doi === 'string' ? body.doi : null
    if ('pmid' in body) updates.pmid = typeof body.pmid === 'string' ? body.pmid : null
    if ('arxivId' in body) updates.arxivId = typeof body.arxivId === 'string' ? body.arxivId : null
    if ('pdfPath' in body) updates.pdfPath = typeof body.pdfPath === 'string' ? body.pdfPath : null
    if ('pdfUrl' in body) updates.pdfUrl = typeof body.pdfUrl === 'string' ? body.pdfUrl : null
    if (typeof body.source === 'string') updates.source = body.source
    if ('zoteroKey' in body) updates.zoteroKey = typeof body.zoteroKey === 'string' ? body.zoteroKey : null
    if ('projectId' in body) updates.projectId = typeof body.projectId === 'string' ? body.projectId : null

    const [updated] = await db
      .update(references)
      .set(updates)
      .where(eq(references.id, id))
      .returning()

    return c.json(toFullRow(updated))
  } catch (e) {
    console.error('[references] PUT /:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

/**
 * Delete a reference.
 *
 * DELETE /api/references/:id
 */
referencesRoute.delete('/:id', async (c) => {
  try {
    const user = c.get('user')! as AuthUser
    const id = c.req.param('id')

    const [existing] = await db
      .select()
      .from(references)
      .where(and(eq(references.id, id), eq(references.teamId, user.teamId)))
      .limit(1)

    if (!existing) {
      return c.json({ error: 'Reference not found' }, 404)
    }

    await db.delete(references).where(eq(references.id, id))

    return c.json({ ok: true })
  } catch (e) {
    console.error('[references] DELETE /:id error:', e)
    return c.json({ error: errorMessage(e) }, 500)
  }
})

export { referencesRoute }
