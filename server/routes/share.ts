import { Hono } from 'hono'

interface StoredBundle {
  bundle: unknown
  createdAt: Date
  downloads: number
}

// In-memory store for shared bundles (no database needed for initial implementation)
const shareStore = new Map<string, StoredBundle>()

export const shareRoute = new Hono()

// POST /api/share — store a bundle and return a share ID
shareRoute.post('/', async (c) => {
  try {
    const bundle = await c.req.json()

    if (!bundle || typeof bundle !== 'object' || bundle.$schema !== 'astro-export') {
      return c.json({ error: 'Invalid bundle: must be an Astro export bundle' }, 400)
    }

    const id = crypto.randomUUID()
    shareStore.set(id, {
      bundle,
      createdAt: new Date(),
      downloads: 0,
    })

    return c.json({ id })
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
})

// GET /api/share/:id — retrieve a shared bundle
shareRoute.get('/:id', (c) => {
  const id = c.req.param('id')
  const entry = shareStore.get(id)

  if (!entry) {
    return c.json({ error: 'Share not found' }, 404)
  }

  entry.downloads++
  return c.json(entry.bundle)
})
