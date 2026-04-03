import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth.js'
import { lookupIdentifier } from '../lib/references/translation-client.js'

const referencesRoute = new Hono()

// All reference routes require authentication
referencesRoute.use('/*', requireAuth)

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
      {
        error: result.error ?? 'Lookup failed',
        identifier: result.identifier,
      },
      result.identifier ? 502 : 400,
    )
  }

  return c.json({
    items: result.items,
    identifier: result.identifier,
    source: result.source,
  })
})

export { referencesRoute }
