import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import { sharedBundles } from '../lib/db/schema.js'
import { eq, sql } from 'drizzle-orm'

export const shareRoute = new Hono()

// POST /api/share — store a bundle and return a share ID
shareRoute.post('/', async (c) => {
  try {
    const bundle = await c.req.json()

    if (!bundle || typeof bundle !== 'object' || bundle.$schema !== 'astro-export') {
      return c.json({ error: 'Invalid bundle: must be an Astro export bundle' }, 400)
    }

    const rows = await db
      .insert(sharedBundles)
      .values({ bundle })
      .returning({ id: sharedBundles.id })

    return c.json({ id: rows[0].id })
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
})

// GET /api/share/:id — retrieve a shared bundle
shareRoute.get('/:id', async (c) => {
  const id = c.req.param('id')

  const rows = await db
    .select({ bundle: sharedBundles.bundle })
    .from(sharedBundles)
    .where(eq(sharedBundles.id, id))

  if (rows.length === 0) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // Atomically increment download count
  await db
    .update(sharedBundles)
    .set({ downloads: sql`${sharedBundles.downloads} + 1` })
    .where(eq(sharedBundles.id, id))

  return c.json(rows[0].bundle)
})
