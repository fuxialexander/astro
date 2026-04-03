/**
 * References API — Zotero integration and reference management.
 *
 * Routes:
 *   GET  /zotero/libraries       — List user's Zotero libraries
 *   POST /zotero/sync            — Sync items from a Zotero library
 *   GET  /zotero/sync-state      — Get sync state for user's libraries
 *   GET  /                       — List user's references (with optional filters)
 *   DELETE /:id                  — Delete a reference
 */

import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import { references, zoteroSyncState } from '../lib/db/schema.js'
import { eq, and, desc, ilike, or } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth.js'
import {
  listZoteroLibraries,
  syncZoteroLibrary,
  getZoteroCredentials,
  testZoteroConnection,
} from '../lib/references/zotero-sync.js'

const app = new Hono()

app.use('/*', requireAuth)

// ── Zotero Routes ──────────────────────────────────────────────────

/** GET /zotero/libraries — List user's personal + group libraries */
app.get('/zotero/libraries', async (c) => {
  const userId = c.get('user')!.id

  const creds = await getZoteroCredentials(userId)
  if (!creds) {
    return c.json(
      { error: 'No Zotero account connected. Add your Zotero API key in Connected Accounts.' },
      400,
    )
  }

  try {
    const libraries = await listZoteroLibraries(creds)

    // Enrich with sync state
    const syncStates = await db
      .select()
      .from(zoteroSyncState)
      .where(eq(zoteroSyncState.userId, userId))

    const syncMap = new Map(
      syncStates.map((s) => [`${s.libraryType}:${s.libraryId}`, s]),
    )

    const enriched = libraries.map((lib) => ({
      ...lib,
      syncState: syncMap.get(`${lib.type}:${lib.id}`) || null,
    }))

    return c.json(enriched)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})

/** POST /zotero/sync — Sync items from a Zotero library */
app.post('/zotero/sync', async (c) => {
  const userId = c.get('user')!.id
  const teamId = c.get('user')!.teamId

  const body = await c.req.json() as {
    libraryType: 'user' | 'group'
    libraryId: string
  }

  if (!body.libraryType || !body.libraryId) {
    return c.json({ error: 'libraryType and libraryId are required' }, 400)
  }

  if (!['user', 'group'].includes(body.libraryType)) {
    return c.json({ error: 'libraryType must be "user" or "group"' }, 400)
  }

  const creds = await getZoteroCredentials(userId)
  if (!creds) {
    return c.json(
      { error: 'No Zotero account connected. Add your Zotero API key in Connected Accounts.' },
      400,
    )
  }

  try {
    const result = await syncZoteroLibrary(
      userId,
      creds,
      body.libraryType,
      body.libraryId,
      teamId,
    )

    return c.json(result)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})

/** GET /zotero/sync-state — Get sync state for all user's libraries */
app.get('/zotero/sync-state', async (c) => {
  const userId = c.get('user')!.id

  const states = await db
    .select()
    .from(zoteroSyncState)
    .where(eq(zoteroSyncState.userId, userId))

  return c.json(states)
})

/** POST /zotero/test — Test Zotero credentials without saving */
app.post('/zotero/test', async (c) => {
  const body = await c.req.json() as { apiKey: string; userId: string }

  if (!body.apiKey || !body.userId) {
    return c.json({ error: 'apiKey and userId are required' }, 400)
  }

  const result = await testZoteroConnection({
    apiKey: body.apiKey,
    userId: body.userId,
  })

  return c.json(result)
})

// ── General Reference Routes ───────────────────────────────────────

/** GET / — List user's references with optional filtering */
app.get('/', async (c) => {
  const userId = c.get('user')!.id
  const source = c.req.query('source')
  const search = c.req.query('search')
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500)
  const offset = parseInt(c.req.query('offset') || '0', 10)

  const conditions = [eq(references.userId, userId)]

  if (source) {
    conditions.push(eq(references.source, source))
  }

  if (search) {
    conditions.push(
      or(
        ilike(references.title, `%${search}%`),
        ilike(references.authors, `%${search}%`),
        ilike(references.doi, `%${search}%`),
      )!,
    )
  }

  const rows = await db
    .select()
    .from(references)
    .where(and(...conditions))
    .orderBy(desc(references.updatedAt))
    .limit(limit)
    .offset(offset)

  return c.json(rows)
})

/** DELETE /:id — Delete a reference */
app.delete('/:id', async (c) => {
  const userId = c.get('user')!.id
  const id = c.req.param('id')

  const [row] = await db
    .delete(references)
    .where(and(eq(references.id, id), eq(references.userId, userId)))
    .returning()

  if (!row) {
    return c.json({ error: 'Reference not found' }, 404)
  }

  return c.json({ success: true })
})

export const referencesRoute = app
