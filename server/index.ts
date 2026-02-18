import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { serve } from '@hono/node-server'
import { rateLimiter } from 'hono-rate-limiter'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
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
import { notificationsRoute } from './routes/notifications.js'
import githubRoute from './routes/github.js'
import { wellKnownRoute } from './routes/well-known.js'
import systemRoute from './routes/system.js'
import { runMigrations } from './lib/db/migrate.js'
import { initializeProviders } from './lib/providers/index.js'
import { relayServer } from './lib/relay-server.js'
import { redisPubSub } from './lib/redis-pubsub.js'
import { machineRegistry } from './lib/machine-registry.js'
import { dispatchEngine } from './lib/dispatch/index.js'
import { updateMachineConnectionStatus, ensureMachineRegistered } from './lib/registered-machines-store.js'
import { validateEnvironment, getRelayConfig, getRedisConfig, isProduction, isTest, isIndexedDBMode } from './lib/environment.js'
import { startCleanupScheduler, stopCleanupScheduler } from './lib/cleanup-scheduler.js'
import { astroEventTransport } from './lib/events/astro-event-transport.js'
import { sseNotificationHook } from './lib/events/hooks/sse-notification-hook.js'
import { auditLogHook } from './lib/events/hooks/audit-log-hook.js'
import { usageMetricsHook } from './lib/events/hooks/usage-metrics-hook.js'
import { prCreationHook } from './lib/events/hooks/pr-creation-hook.js'

// Validate environment variables on startup
try {
  validateEnvironment()
} catch {
  console.error('❌ Environment validation failed')
  process.exit(1)
}

const app = new Hono()

// Security headers
app.use('/*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "ws:", "wss:"],
    fontSrc: ["'self'", "data:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
  },
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
}))

// Explicit allowed origins list
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://astro.fuxialexander.work',
  process.env.CORS_ORIGIN || 'https://astro.pages.dev',
].filter(Boolean)

app.use('/*', cors({
  origin: (origin) => {
    if (isProduction()) {
      // In production, require explicit origin match
      if (!origin) return null
      return ALLOWED_ORIGINS.includes(origin) ? origin : null
    }
    // Dev/test mode: allow localhost and explicit origins only
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return origin || 'http://localhost:5173'
    }
    return null
  },
  allowHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID'],
  credentials: true,
}))

// Global rate limiter (10,000 req/15min per IP) - bypassed in test mode
if (!isTest()) {
  app.use('/*', rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10000, // 100x from 100 (generous for development)
    standardHeaders: 'draft-7',
    keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
  }))
}

// Auth endpoints rate limiter (3,000 req/15min per IP) - bypassed in test mode
// Higher limit to accommodate WebAuthn flows (register-options, login-options, verify)
if (!isTest()) {
  app.use('/api/auth/*', rateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 3000, // 100x from 30 - generous for development
    standardHeaders: 'draft-7',
    keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
  }))

  // Device endpoints rate limiter - excludes /token which has its own rate limiting
  app.use('/api/device/*', async (c, next) => {
    // Skip rate limiting for token polling endpoint (has its own internal rate limiting)
    if (c.req.path === '/api/device/token') {
      return next()
    }

    return rateLimiter({
      windowMs: 15 * 60 * 1000,
      limit: 2000, // 100x from 20 - generous for development
      standardHeaders: 'draft-7',
      keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
    })(c, next)
  })
}

// AI endpoints rate limiter (1,000 req/hour) - bypassed in test mode
if (process.env.NODE_ENV !== 'test') {
  app.use('/api/agent/*', rateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 1000, // 100x from 10 - generous for development
    standardHeaders: 'draft-7',
    keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
  }))
}

app.route('/.well-known', wellKnownRoute)
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
app.route('/api/notifications', notificationsRoute)
app.route('/api/github', githubRoute)
app.route('/api/system', systemRoute)

// Landing page route
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.get('/landing', (c) => {
  try {
    const html = readFileSync(join(__dirname, '../astro-landing.html'), 'utf-8')
    return c.html(html)
  } catch (err) {
    console.error('[landing] Failed to read landing page:', err)
    return c.text('Landing page not found', 404)
  }
})

app.get('/landing/about', (c) => {
  try {
    const html = readFileSync(join(__dirname, '../astro-about.html'), 'utf-8')
    return c.html(html)
  } catch (err) {
    console.error('[landing] Failed to read about page:', err)
    return c.text('About page not found', 404)
  }
})

const port = 3001
const relayPort = getRelayConfig().port

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

  // Register event transport hooks (skip in test mode to avoid side effects)
  if (!isTest()) {
    console.log('[event-transport] Registering hooks...')
    astroEventTransport.registerHook('sse-notification', sseNotificationHook)
    astroEventTransport.registerHook('audit-log', auditLogHook)
    astroEventTransport.registerHook('usage-metrics', usageMetricsHook)
    astroEventTransport.registerHook('pr-creation', prCreationHook)
    console.log('[event-transport] Registered 4 hooks:', astroEventTransport.listHooks().join(', '))
  } else {
    console.log('[event-transport] Test mode detected - hooks disabled')
    astroEventTransport.setEnabled(false)
  }

  // Initialize relay server
  try {
    // Connect to Redis if configured
    const redisConfig = getRedisConfig()
    if (redisConfig.url) {
      await redisPubSub.connect(redisConfig.url)
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

    relayServer.on('machine:connected', async (machineId: string, userId: string) => {
      console.log(`[relay] Machine ${machineId} connected for user ${userId}`)
      const entry = machineRegistry.get(machineId)
      // Ensure machine exists in persistent store (survives server restarts)
      await ensureMachineRegistered(machineId, {
        name: entry?.name || machineId,
        hostname: entry?.hostname || 'unknown',
        platform: entry?.platform || 'unknown',
        environmentType: entry?.environmentType || 'remote',
        providers: entry?.providers?.map(p => p.type) || [],
        userId,
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

  // Start cleanup scheduler (disabled in test mode and IndexedDB mode)
  if (!isTest() && !isIndexedDBMode()) {
    startCleanupScheduler({
      enabled: true,
      intervalMs: 24 * 60 * 60 * 1000, // 24 hours
      retentionDays: {
        executions: 90,
        chatHistory: 180,
      },
    })
    console.log('[cleanup] Cleanup scheduler started')
  }

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
    stopCleanupScheduler()
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
