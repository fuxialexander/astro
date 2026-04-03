/**
 * References API Route
 *
 * Manages bibliographic references imported from BibTeX, RIS, and EndNote XML.
 * POST /import accepts multipart file upload, detects format, parses to CSL-JSON,
 * and bulk-inserts into the references table.
 */

import { Hono } from 'hono'
import { eq, and, inArray, isNull, type AnyColumn } from 'drizzle-orm'
import { db } from '../lib/db/index.js'
import { references } from '../lib/db/schema.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { resolveWritableTeamId } from '../lib/team-utils.js'
import { detectFormat, parseReferences, type CslReference, type ImportFormat } from '../lib/references/importers.js'

const referencesRoute = new Hono()

// Apply authentication to all routes
referencesRoute.use('/*', requireAuth)

/**
 * Cross-team scope filter (consistent with data.ts pattern)
 */
function allTeamsScopeFilter<TTeamColumn extends AnyColumn>(table: { teamId: TTeamColumn }, user: AuthUser) {
  return inArray(table.teamId, user.teamIds)
}

// ── GET /api/references?projectId=... ────────────────────────────────
// List all references for a project.
referencesRoute.get('/', async (c) => {
  const user = c.get('user')! as AuthUser
  const projectId = c.req.query('projectId')

  if (!projectId) {
    return c.json({ error: 'projectId query parameter is required' }, 400)
  }

  const rows = await db.select().from(references).where(
    and(
      eq(references.projectId, projectId),
      allTeamsScopeFilter(references, user),
      isNull(references.deletedAt),
    )
  )

  return c.json(rows)
})

// ── POST /api/references/import ──────────────────────────────────────
// Accept multipart file upload (field name: "file"), detect format,
// parse to CSL-JSON array, bulk-insert into references table.
referencesRoute.post('/import', async (c) => {
  const user = c.get('user')! as AuthUser

  const formData = await c.req.formData()
  const file = formData.get('file')
  const projectId = formData.get('projectId')
  const formatHint = formData.get('format') as ImportFormat | null

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No file uploaded. Use multipart form with field "file".' }, 400)
  }
  if (!projectId || typeof projectId !== 'string') {
    return c.json({ error: 'projectId is required' }, 400)
  }

  // Read file content
  const content = await file.text()
  if (!content.trim()) {
    return c.json({ error: 'Uploaded file is empty' }, 400)
  }

  // Detect format
  const format = formatHint || detectFormat(file.name, content)
  if (!format) {
    return c.json({
      error: `Could not detect file format. Supported formats: .bib (BibTeX), .ris (RIS), .xml (EndNote XML). You can also pass a "format" field with value "bibtex", "ris", or "endnote-xml".`,
    }, 400)
  }

  // Parse references
  const { references: parsed, errors } = parseReferences(content, format)

  if (parsed.length === 0) {
    return c.json({
      imported: 0,
      errors: errors.length > 0 ? errors : ['No references found in file'],
    }, 200)
  }

  // Resolve team ID for writes
  const teamIdParam = formData.get('teamId')
  const teamResult = resolveWritableTeamId(user, teamIdParam)
  if ('error' in teamResult) {
    return c.json({ error: teamResult.error }, 403)
  }
  const teamId = teamResult.teamId

  // Bulk-insert into references table
  const rows = parsed.map((ref: CslReference) => ({
    projectId,
    teamId,
    type: ref.type,
    title: ref.title,
    authors: ref.authors,
    year: ref.year || null,
    month: ref.month || null,
    abstract: ref.abstract || null,
    doi: ref.doi || null,
    url: ref.url || null,
    journal: ref.journal || null,
    volume: ref.volume || null,
    issue: ref.issue || null,
    pages: ref.pages || null,
    publisher: ref.publisher || null,
    isbn: ref.isbn || null,
    issn: ref.issn || null,
    keywords: ref.keywords || [],
    language: ref.language || null,
    extra: ref.extra || null,
    sourceFormat: format,
  }))

  try {
    const inserted = await db.insert(references).values(rows).returning({ id: references.id })
    return c.json({
      imported: inserted.length,
      errors: errors.length > 0 ? errors : undefined,
      ids: inserted.map((r) => r.id),
    })
  } catch (err) {
    return c.json({
      error: `Database insert failed: ${err instanceof Error ? err.message : String(err)}`,
      parsed: parsed.length,
    }, 500)
  }
})

// ── DELETE /api/references/:id ───────────────────────────────────────
// Soft-delete a reference.
referencesRoute.delete('/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const { id } = c.req.param()

  const [existing] = await db.select().from(references).where(
    and(
      eq(references.id, id),
      allTeamsScopeFilter(references, user),
      isNull(references.deletedAt),
    )
  )

  if (!existing) {
    return c.json({ error: 'Reference not found' }, 404)
  }

  await db.update(references).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(references.id, id))

  return c.json({ success: true })
})

// ── DELETE /api/references/bulk ──────────────────────────────────────
// Bulk soft-delete references by project.
referencesRoute.post('/bulk-delete', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json() as { projectId: string; ids?: string[] }

  if (!body.projectId) {
    return c.json({ error: 'projectId is required' }, 400)
  }

  const conditions = [
    eq(references.projectId, body.projectId),
    allTeamsScopeFilter(references, user),
    isNull(references.deletedAt),
  ]

  if (body.ids && body.ids.length > 0) {
    conditions.push(inArray(references.id, body.ids))
  }

  await db.update(references)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(...conditions))

  return c.json({ success: true })
})

export { referencesRoute }
