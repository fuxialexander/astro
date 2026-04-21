import { Hono } from 'hono'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { lookupIdentifier } from '../lib/references/translation-client.js'
import { enrichAbstracts } from '../lib/references/crossref-enrichment.js'
import { extractCiteKeys } from '../lib/references/cite-key-extractor.js'
import { db } from '../lib/db/index.js'
import { teamReferences, planNodes, projects } from '../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { toBibTeX, parseBibTeX } from '@astro/core'
import type { Reference } from '@astro/core/types'

const referencesRoute = new Hono()
referencesRoute.use('/*', requireAuth)

/** GET /api/references — all references for the active team */
referencesRoute.get('/', async (c) => {
  const user = c.get('user')! as AuthUser
  const teamId = user.teamId
  if (!teamId) return c.json({ error: 'No active team' }, 400)

  const rows = await db
    .select()
    .from(teamReferences)
    .where(eq(teamReferences.teamId, teamId))
    .orderBy(teamReferences.createdAt)

  return c.json({ references: rows.map(r => ({ ...r.data, id: r.id, _rowId: r.id })) })
})

/** POST /api/references — create a reference */
referencesRoute.post('/', async (c) => {
  const user = c.get('user')! as AuthUser
  const teamId = user.teamId
  if (!teamId) return c.json({ error: 'No active team' }, 400)

  const body = await c.req.json().catch(() => null) as Reference | null
  if (!body?.title || !body?.authors) return c.json({ error: 'Missing required fields' }, 400)

  const [row] = await db
    .insert(teamReferences)
    .values({ teamId, citeKey: body.id || '', data: body })
    .returning()

  return c.json({ reference: { ...row.data, id: row.id } }, 201)
})

/** PUT /api/references/:id — update a reference */
referencesRoute.put('/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const teamId = user.teamId
  const id = c.req.param('id')
  if (!teamId) return c.json({ error: 'No active team' }, 400)

  const body = await c.req.json().catch(() => null) as Reference | null
  if (!body) return c.json({ error: 'Invalid body' }, 400)

  const [row] = await db
    .update(teamReferences)
    .set({ data: body, citeKey: body.id || '', updatedAt: new Date() })
    .where(and(eq(teamReferences.id, id), eq(teamReferences.teamId, teamId)))
    .returning()

  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ reference: { ...row.data, id: row.id } })
})

/** DELETE /api/references/:id */
referencesRoute.delete('/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const teamId = user.teamId
  const id = c.req.param('id')
  if (!teamId) return c.json({ error: 'No active team' }, 400)

  await db
    .delete(teamReferences)
    .where(and(eq(teamReferences.id, id), eq(teamReferences.teamId, teamId)))

  return c.json({ ok: true })
})

/** POST /api/references/import — bulk import with optional upsert-by-cite-key */
referencesRoute.post('/import', async (c) => {
  const user = c.get('user')! as AuthUser
  const teamId = user.teamId
  if (!teamId) return c.json({ error: 'No active team' }, 400)

  const body = await c.req.json().catch(() => null) as {
    references: Reference[]
    mode?: 'insert' | 'upsert'
  } | null
  if (!body?.references?.length) return c.json({ error: 'No references provided' }, 400)
  if (body.references.length > 500) return c.json({ error: 'Too many references; split into batches of 500 or fewer' }, 400)

  const mode = body.mode ?? 'insert'

  // Fetch all existing rows for this team (need id + citeKey for upsert matching)
  const existing = await db
    .select({ id: teamReferences.id, citeKey: teamReferences.citeKey, data: teamReferences.data })
    .from(teamReferences)
    .where(eq(teamReferences.teamId, teamId))

  const existingByCiteKey = new Map(existing.map(r => [r.citeKey, r]))
  const existingKeys = new Set(existing.map(r => r.citeKey))

  // Normalize title for fuzzy duplicate detection
  function normalizeTitle(t: string): string {
    return t.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
  }
  const existingByFingerprint = new Map(
    existing
      .filter(r => r.data?.title && r.data?.year)
      .map(r => [
        `${normalizeTitle(r.data!.title)}|${r.data!.year}|${(r.data!.authors?.[0] ?? '').split(',')[0].toLowerCase().trim()}`,
        r,
      ])
  )

  const toInsert: Reference[] = []
  const toUpdate: Array<{ rowId: string; ref: Reference }> = []
  const usedKeys = new Set(existingKeys)

  for (const ref of body.references) {
    const fingerprint = `${normalizeTitle(ref.title)}|${ref.year}|${(ref.authors?.[0] ?? '').split(',')[0].toLowerCase().trim()}`

    if (mode === 'upsert' && existingByCiteKey.has(ref.id)) {
      // Exact cite key match → update
      toUpdate.push({ rowId: existingByCiteKey.get(ref.id)!.id, ref })
    } else if (mode === 'upsert' && existingByFingerprint.has(fingerprint)) {
      // Same title+year+firstAuthor under a different key → update, keep existing key
      const existing = existingByFingerprint.get(fingerprint)!
      toUpdate.push({ rowId: existing.id, ref: { ...ref, id: existing.citeKey } })
    } else if (!existingKeys.has(ref.id)) {
      // New ref — insert as-is (key already de-duplicated by caller)
      toInsert.push(ref)
      usedKeys.add(ref.id)
    } else if (mode === 'insert') {
      // Key collision in insert mode — add suffix
      let key = ref.id
      let suffix = 0
      while (usedKeys.has(key)) {
        suffix++
        key = suffix <= 26 ? `${ref.id}${String.fromCharCode(96 + suffix)}` : `${ref.id}_${suffix}`
      }
      usedKeys.add(key)
      toInsert.push({ ...ref, id: key })
    }
    // upsert + key exists + no fingerprint match → skip (already up-to-date or intentional divergence)
  }

  // Enrich missing abstracts (non-fatal)
  const enriched = await enrichAbstracts(toInsert).catch(() => toInsert)

  let insertedRows: typeof teamReferences.$inferSelect[] = []
  let updatedRows: typeof teamReferences.$inferSelect[] = []

  try {
    if (enriched.length) {
      insertedRows = await db
        .insert(teamReferences)
        .values(enriched.map(ref => ({ teamId, citeKey: ref.id, data: ref })))
        .returning()
    }

    // Batch updates in a transaction to avoid partial failure
    if (toUpdate.length) {
      updatedRows = await db.transaction(async (tx) => {
        const rows = []
        for (const { rowId, ref } of toUpdate) {
          const [row] = await tx
            .update(teamReferences)
            .set({ data: ref, citeKey: ref.id, updatedAt: new Date() })
            .where(and(eq(teamReferences.id, rowId), eq(teamReferences.teamId, teamId)))
            .returning()
          if (row) rows.push(row)
        }
        return rows
      })
    }
  } catch (err) {
    console.error('[references] import failed:', err)
    return c.json({ error: 'Import failed; check server logs for details' }, 500)
  }

  const allRefs = [
    ...insertedRows.map(r => ({ ...r.data, id: r.citeKey })),
    ...updatedRows.map(r => ({ ...r.data, id: r.citeKey })),
  ]

  return c.json({ imported: insertedRows.length, updated: updatedRows.length, references: allRefs })
})

/** GET /api/references/export — export team or project references as BibTeX */
referencesRoute.get('/export', async (c) => {
  const user = c.get('user')! as AuthUser
  const teamId = user.teamId
  if (!teamId) return c.json({ error: 'No active team' }, 400)

  const projectId = c.req.query('projectId')
  const format = c.req.query('format') ?? 'bibtex'
  if (format !== 'bibtex') return c.json({ error: 'Only format=bibtex is supported' }, 400)

  let refs: Reference[]

  if (projectId) {
    // Collect cite keys cited in this project's plan nodes + description
    const [project] = await db.select().from(projects).where(
      and(eq(projects.id, projectId), eq(projects.teamId, teamId))
    )
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const nodes = await db.select({ description: planNodes.description, content: planNodes.content })
      .from(planNodes)
      .where(and(eq(planNodes.projectId, projectId), eq(planNodes.teamId, teamId)))

    const keys = new Set<string>()
    for (const k of extractCiteKeys(project.description ?? '')) keys.add(k)
    for (const node of nodes) {
      for (const k of extractCiteKeys(node.description ?? '')) keys.add(k)
      for (const k of extractCiteKeys(node.content ?? '')) keys.add(k)
    }

    if (keys.size === 0) {
      refs = []
    } else {
      const allRows = await db.select()
        .from(teamReferences)
        .where(eq(teamReferences.teamId, teamId))
      refs = allRows
        .map(r => ({ ...r.data, id: r.citeKey } as Reference))
        .filter(r => keys.has(r.id))
    }
  } else {
    const rows = await db.select().from(teamReferences).where(eq(teamReferences.teamId, teamId))
    refs = rows.map(r => ({ ...r.data, id: r.citeKey } as Reference))
  }

  const bibtex = toBibTeX(refs)
  const filename = projectId ? `project-references.bib` : `references.bib`

  return new Response(bibtex, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

/** GET /api/references/search?q=<query>&projectId=<optional>&limit=<optional> */
referencesRoute.get('/search', async (c) => {
  const user = c.get('user')! as AuthUser
  const teamId = user.teamId
  if (!teamId) return c.json({ error: 'No active team' }, 400)

  const q = c.req.query('q') ?? ''
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)

  const rows = await db
    .select()
    .from(teamReferences)
    .where(eq(teamReferences.teamId, teamId))

  const all: Reference[] = rows.map(r => ({ ...r.data, id: r.citeKey } as Reference))

  if (!q.trim()) return c.json({ references: all.slice(0, limit) })

  const qLow = q.toLowerCase()
  const filtered = all.filter(r =>
    r.title?.toLowerCase().includes(qLow) ||
    r.authors?.some((a: string) => a.toLowerCase().includes(qLow)) ||
    String(r.year ?? '').includes(qLow) ||
    r.id?.toLowerCase().includes(qLow) ||
    r.venue?.toLowerCase().includes(qLow),
  ).slice(0, limit)

  return c.json({ references: filtered })
})

/** POST /api/references/import-bibtex — accept raw BibTeX text and upsert */
referencesRoute.post('/import-bibtex', async (c) => {
  const user = c.get('user')! as AuthUser
  const teamId = user.teamId
  if (!teamId) return c.json({ error: 'No active team' }, 400)

  const body = await c.req.json().catch(() => null) as { bibtex?: string } | null
  if (!body?.bibtex) return c.json({ error: 'Missing bibtex field' }, 400)
  if (body.bibtex.length > 5_000_000) return c.json({ error: 'BibTeX payload too large (max 5 MB)' }, 400)

  const parsed = parseBibTeX(body.bibtex)
  if (parsed.length === 0) return c.json({ imported: 0, updated: 0, references: [] })

  const refs: Reference[] = parsed.map(({ citeKey, ...ref }) => ({
    ...ref,
    id: (citeKey || 'unknown').replace(/[^a-z0-9_:-]/gi, ''),
  } as Reference))

  // Delegate to the import route logic inline
  const existing = await db
    .select({ id: teamReferences.id, citeKey: teamReferences.citeKey, data: teamReferences.data })
    .from(teamReferences)
    .where(eq(teamReferences.teamId, teamId))

  const existingByCiteKey = new Map(existing.map(r => [r.citeKey, r]))

  function normalizeTitle(t: string): string {
    return t.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
  }
  const existingByFingerprint = new Map(
    existing
      .filter(r => r.data?.title && r.data?.year)
      .map(r => [
        `${normalizeTitle(r.data!.title)}|${r.data!.year}|${(r.data!.authors?.[0] ?? '').split(',')[0].toLowerCase().trim()}`,
        r,
      ])
  )

  const toInsert: Reference[] = []
  const toUpdate: Array<{ rowId: string; ref: Reference }> = []
  const usedKeys = new Set(existing.map(r => r.citeKey))

  for (const ref of refs) {
    const fingerprint = `${normalizeTitle(ref.title)}|${ref.year}|${(ref.authors?.[0] ?? '').split(',')[0].toLowerCase().trim()}`
    if (existingByCiteKey.has(ref.id)) {
      toUpdate.push({ rowId: existingByCiteKey.get(ref.id)!.id, ref })
    } else if (existingByFingerprint.has(fingerprint)) {
      const ex = existingByFingerprint.get(fingerprint)!
      toUpdate.push({ rowId: ex.id, ref: { ...ref, id: ex.citeKey } })
    } else if (!usedKeys.has(ref.id)) {
      toInsert.push(ref)
      usedKeys.add(ref.id)
    } else {
      let key = ref.id; let suffix = 0
      while (usedKeys.has(key)) { suffix++; key = suffix <= 26 ? `${ref.id}${String.fromCharCode(96 + suffix)}` : `${ref.id}_${suffix}` }
      usedKeys.add(key)
      toInsert.push({ ...ref, id: key })
    }
  }

  const enriched = await enrichAbstracts(toInsert).catch(() => toInsert)

  let insertedRows: typeof teamReferences.$inferSelect[] = []
  let updatedRows: typeof teamReferences.$inferSelect[] = []

  try {
    if (enriched.length) {
      insertedRows = await db.insert(teamReferences).values(enriched.map(r => ({ teamId, citeKey: r.id, data: r }))).returning()
    }
    if (toUpdate.length) {
      updatedRows = await db.transaction(async (tx) => {
        const rows = []
        for (const { rowId, ref } of toUpdate) {
          const [row] = await tx.update(teamReferences).set({ data: ref, citeKey: ref.id, updatedAt: new Date() })
            .where(and(eq(teamReferences.id, rowId), eq(teamReferences.teamId, teamId))).returning()
          if (row) rows.push(row)
        }
        return rows
      })
    }
  } catch (err) {
    console.error('[references] import-bibtex failed:', err)
    return c.json({ error: 'Import failed; check server logs for details' }, 500)
  }

  return c.json({
    imported: insertedRows.length,
    updated: updatedRows.length,
    references: [
      ...insertedRows.map(r => ({ ...r.data, id: r.citeKey })),
      ...updatedRows.map(r => ({ ...r.data, id: r.citeKey })),
    ],
  })
})

/**
 * POST /api/references/lookup
 *
 * Accepts { identifier: string } where identifier can be:
 *   - DOI (e.g. "10.1038/nature12373" or "doi:10.1038/nature12373")
 *   - PMID (e.g. "PMID:12345678" or "12345678")
 *   - arXiv ID (e.g. "2301.07041" or "arxiv:2301.07041")
 *   - ISBN (e.g. "978-0-13-468599-1")
 *   - URL (e.g. "https://doi.org/10.1038/nature12373")
 *
 * Returns CSL-JSON items.
 */
referencesRoute.post('/lookup', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.identifier || typeof body.identifier !== 'string') {
    return c.json(
      { error: 'Missing or invalid "identifier" field. Expected a string.' },
      400,
    )
  }
  const result = await lookupIdentifier(body.identifier.trim())
  if (!result.success) {
    return c.json(
      { error: result.error ?? 'Lookup failed', identifier: result.identifier },
      result.identifier ? 502 : 400,
    )
  }
  return c.json({ items: result.items, identifier: result.identifier, source: result.source })
})

export { referencesRoute }
