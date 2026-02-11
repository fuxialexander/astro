import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { healthRoute } from './routes/health.js'
import { agentRoute } from './routes/agent.js'
import { authRoute } from './routes/auth.js'
import { relayRoute } from './routes/relay.js'
import { dispatchRoute } from './routes/dispatch.js'
import { deviceAuthRoute } from './routes/device-auth.js'
import { eventsRoute } from './routes/events.js'
import { transcribeRoute } from './routes/transcribe.js'
import { fsRoute } from './routes/fs.js'
import { repoRoute } from './routes/repo.js'
import { dataRoute } from './routes/data.js'
import { runMigrations } from './lib/db/migrate.js'
import { initializeProviders } from './lib/providers/index.js'
import { relayServer } from './lib/relay-server.js'
import { redisPubSub } from './lib/redis-pubsub.js'
import { machineRegistry } from './lib/machine-registry.js'
import { dispatchEngine } from './lib/dispatch/index.js'
import { updateMachineConnectionStatus, ensureMachineRegistered } from './lib/registered-machines-store.js'

const app = new Hono()

app.use('/*', cors({
  origin: (origin) => {
    if (process.env.NODE_ENV === 'production') {
      const allowed = process.env.CORS_ORIGIN || 'https://nexus.pages.dev'
      return origin === allowed ? allowed : null
    }
    // Dev mode: allow localhost and null origin (native apps)
    if (!origin || origin === 'http://localhost:5173' || origin.startsWith('nexus://')) {
      return origin || 'http://localhost:5173'
    }
    return null
  },
  allowHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID'],
  credentials: true,
}))

app.route('/api', healthRoute)
app.route('/api/auth', authRoute)
app.route('/api/agent', agentRoute)
app.route('/api/relay', relayRoute)
app.route('/api/dispatch', dispatchRoute)
app.route('/api/device', deviceAuthRoute)
app.route('/api/events', eventsRoute)
app.route('/api/transcribe', transcribeRoute)
app.route('/api/fs', fsRoute)
app.route('/api/repo', repoRoute)
app.route('/api/data', dataRoute)

const port = 3001
const relayPort = parseInt(process.env.RELAY_PORT || '3002', 10)

let httpServer: ReturnType<typeof serve> | null = null

// Initialize providers and relay server before starting
async function start() {
  // Run database migrations
  try {
    runMigrations()
  } catch (err) {
    console.error('[db] Migration failed:', err)
  }

  console.log('[backend] initializing provider registry...')

  try {
    // Timeout provider detection after 15 seconds so server starts even if detection hangs
    await Promise.race([
      initializeProviders(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Provider detection timed out')), 15_000)),
    ])
    console.log('[backend] provider registry initialized')
  } catch (error) {
    console.warn('[backend] provider initialization warning:', error)
    // Continue even if initialization fails - providers can be detected on-demand
  }

  // Initialize relay server
  try {
    // Connect to Redis if configured
    if (process.env.REDIS_URL) {
      await redisPubSub.connect(process.env.REDIS_URL)
      console.log('[relay] Connected to Redis for horizontal scaling')

      // Set up Redis event handlers for cross-instance routing
      redisPubSub.on('task:dispatch', async (event) => {
        // Only handle if this instance has the machine
        if (event.targetMachineId && machineRegistry.isConnected(event.targetMachineId)) {
          relayServer.dispatchTask(event.task, event.targetMachineId)
        }
      })

      redisPubSub.on('task:cancel', async (event) => {
        if (machineRegistry.isConnected(event.machineId)) {
          relayServer.cancelTask(event.taskId, event.machineId, event.reason)
        }
      })
    }

    // Start WebSocket relay server
    relayServer.start(relayPort)

    // Set up relay event handlers
    relayServer.on('task:result', async (message) => {
      console.log(`[relay] Task ${message.result.taskId} completed: ${message.result.status}`)
      // Publish to Redis for other services to consume
      if (redisPubSub.isConnected()) {
        // Task machine mapping cleanup happens when task completes
        await redisPubSub.removeTaskMapping(message.result.taskId)
      }
      // Emit event for dispatch engine to handle result routing
      dispatchEngine.emit('relay:task:result', message)
    })

    relayServer.on('machine:connected', async (machineId) => {
      console.log(`[relay] Machine ${machineId} connected`)
      const entry = machineRegistry.get(machineId)
      // Ensure machine exists in persistent store (survives server restarts)
      await ensureMachineRegistered(machineId, {
        name: entry?.name || machineId,
        hostname: entry?.hostname || 'unknown',
        platform: entry?.platform || 'unknown',
        environmentType: entry?.environmentType || 'remote',
        providers: entry?.providers?.map(p => p.type) || [],
        userId: 'user-1',
      })
      if (entry && redisPubSub.isConnected()) {
        await redisPubSub.registerMachine(machineId, entry)
        await redisPubSub.publishMachineState({
          event: 'machine.connected',
          machineId,
          machineInfo: entry,
          timestamp: new Date(),
        })
      }
    })

    relayServer.on('machine:disconnected', async (machineId, reason) => {
      console.log(`[relay] Machine ${machineId} disconnected: ${reason}`)
      // Update registered machine status
      void updateMachineConnectionStatus(machineId, false)
      if (redisPubSub.isConnected()) {
        await redisPubSub.unregisterMachine(machineId)
        await redisPubSub.publishMachineState({
          event: 'machine.disconnected',
          machineId,
          timestamp: new Date(),
        })
      }
    })

    console.log(`[relay] WebSocket server listening on port ${relayPort}`)
  } catch (err) {
    console.error('[relay] Failed to initialize:', err)
  }

  // Initialize dispatch engine
  console.log('[dispatch] Initializing dispatch engine...')
  dispatchEngine.start()
  console.log('[dispatch] Dispatch engine started')

  console.log(`[backend] listening on http://localhost:${port}`)
  httpServer = serve({ fetch: app.fetch, port })
}

// Shared shutdown logic with a hard timeout so the process never hangs
async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down gracefully`)
  // Hard kill after 3 seconds if cleanup stalls
  const timer = setTimeout(() => {
    console.log('[server] Shutdown timed out, forcing exit')
    process.exit(1)
  }, 3_000)
  timer.unref()

  try {
    dispatchEngine.stop()
    httpServer?.close()
    await relayServer.stop()
    await redisPubSub.disconnect()
  } catch (e) {
    console.error('[server] Error during shutdown:', e)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

start()
