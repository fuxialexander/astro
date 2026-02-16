import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const wellKnownRoute = new Hono()

// Serve apple-app-site-association for passkey sync
wellKnownRoute.get('/apple-app-site-association', (c) => {
  try {
    const filePath = join(__dirname, '../../public/.well-known/apple-app-site-association')
    const content = readFileSync(filePath, 'utf-8')

    return c.json(JSON.parse(content), 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    })
  } catch (error) {
    console.error('[well-known] Failed to serve apple-app-site-association:', error)
    return c.json({ error: 'File not found' }, 404)
  }
})
