import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const docsRoute = new Hono()

// Serve agent quickstart guide as Markdown (machine-readable, no auth required)
docsRoute.get('/agent-quickstart', (c) => {
  try {
    const filePath = join(__dirname, '../../docs/guides/agent-quickstart.md')
    const content = readFileSync(filePath, 'utf-8')

    const accept = c.req.header('Accept') || ''
    if (accept.includes('application/json')) {
      return c.json({
        title: 'Astro Agent Quickstart',
        format: 'markdown',
        content,
      }, 200, {
        'Cache-Control': 'public, max-age=3600',
      })
    }

    return c.text(content, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    })
  } catch (error) {
    console.error('[docs] Failed to serve agent-quickstart:', error)
    return c.json({ error: 'Document not found' }, 404)
  }
})
