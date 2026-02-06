import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { healthRoute } from './routes/health.js'
import { agentRoute } from './routes/agent.js'
import { initializeProviders } from './lib/providers/index.js'

const app = new Hono()

app.use('/*', cors({ origin: 'http://localhost:5173' }))

app.route('/api', healthRoute)
app.route('/api/agent', agentRoute)

const port = 3001

// Initialize providers before starting server
async function start() {
  console.log('[backend] initializing provider registry...')

  try {
    await initializeProviders()
    console.log('[backend] provider registry initialized')
  } catch (error) {
    console.warn('[backend] provider initialization warning:', error)
    // Continue even if initialization fails - providers can be detected on-demand
  }

  console.log(`[backend] listening on http://localhost:${port}`)
  serve({ fetch: app.fetch, port })
}

start()
