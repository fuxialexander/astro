import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { serve } from '@hono/node-server'
import { rateLimiter } from 'hono-rate-limiter'
import { readFileSync } from 'fs'
import { execSync } from 'node:child_process'
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
import { skillsRoute } from './routes/skills.js'
import { shareRoute } from './routes/share.js'
import { connectedAccountsRoute } from './routes/connected-accounts.js'
import { teamsRoute } from './routes/teams.js'
import { runMigrations } from './lib/db/migrate.js'
import { relayServer } from './lib/relay-server.js'
import { redisPubSub } from './lib/redis-pubsub.js'
import { machineRegistry } from './lib/machine-registry.js'
import { dispatchEngine } from './lib/dispatch/index.js'
import { updateMachineConnectionStatus, ensureMachineRegistered, resetAllConnectionStatuses, getMachine } from './lib/registered-machines-store.js'
import { validateEnvironment, getRelayConfig, getRedisConfig, isProduction, isTest, isIndexedDBMode } from './lib/environment.js'
import { startCleanupScheduler, stopCleanupScheduler } from './lib/cleanup-scheduler.js'
import { astroEventTransport } from './lib/events/astro-event-transport.js'
import { sseNotificationHook } from './lib/events/hooks/sse-notification-hook.js'
import { auditLogHook } from './lib/events/hooks/audit-log-hook.js'
import { usageMetricsHook } from './lib/events/hooks/usage-metrics-hook.js'
import { prCreationHook } from './lib/events/hooks/pr-creation-hook.js'
import { mergeQueueHook } from './lib/events/hooks/merge-queue-hook.js'
import { gitPullHook } from './lib/events/hooks/git-pull-hook.js'
import { channelNotificationHook } from './lib/events/hooks/channel-notification-hook.js'
import { observabilityHook, observationCollector } from './lib/observability/observation-collector.js'
import { langfuseExportHook } from './lib/observability/langfuse-exporter.js'
import { observationsRoute } from './routes/observations.js'
import { cleanupExpiredChallenges } from './lib/challenge-store.js'
import { cleanupExpiredDeviceCodes } from './lib/device-code-store.js'

// Validate environment variables on startup
try {
  validateEnvironment()
} catch {
  console.error('❌ Environment validation failed')
  if (!isTest()) process.exit(1)
}

/**
 * Create and configure the Hono app with all middleware and routes.
 * Exported for integration testing via app.request().
 */
export function createApp() {
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

  // Explicit allowed origins list — all production origins come from env vars.
  // Set CORS_ORIGIN and/or FRONTEND_URL in deployment config (fly.toml, .env).
  const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    process.env.CORS_ORIGIN,
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[]

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
    allowHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID', 'X-Team-Id', 'X-User-Id'],
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
  if (!isTest()) {
    app.use('/api/agent/*', rateLimiter({
      windowMs: 60 * 60 * 1000, // 1 hour
      limit: 1000, // 100x from 10 - generous for development
      standardHeaders: 'draft-7',
      keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
    }))
  }

  // Routes that work in both local and server mode
  app.route('/.well-known', wellKnownRoute)
  app.route('/api', healthRoute)
  app.route('/api/agent', agentRoute)
  app.route('/api/relay', relayRoute)
  app.route('/api/dispatch', dispatchRoute)
  app.route('/api/device', deviceAuthRoute)
  app.route('/api/events', eventsRoute)
  app.route('/api/transcribe', transcribeRoute)
  app.route('/api/fs', fsRoute)
  app.route('/api/repo', repoRoute)
  app.route('/api/data', dataRoute)
  app.route('/api/system', systemRoute)
  app.route('/api/skills', skillsRoute)
  app.route('/api/observations', observationsRoute)
  app.route('/api/teams', teamsRoute)

  // Auth routes are always mounted (endpoints guard themselves with isLocalMode())
  app.route('/api/auth', authRoute)

  // Server-only routes (require Supabase Auth)
  if (!isIndexedDBMode()) {
    app.route('/api/notifications', notificationsRoute)
    app.route('/api/github', githubRoute)
    app.route('/api/share', shareRoute)
    app.route('/api/connected-accounts', connectedAccountsRoute)
  }

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

  return app
}

const port = 3001
const relayPort = getRelayConfig().port

let httpServer: ReturnType<typeof serve> | null = null
let challengeCleanup: ReturnType<typeof setInterval> | null = null
let deviceCodeCleanup: ReturnType<typeof setInterval> | null = null

/**
 * Kill any stale processes listening on a port.
 * This handles orphaned Node processes from tsx watch restarts
 * or unclean Ctrl+C shutdowns where signal propagation failed.
 */
function killStalePortProcess(targetPort: number): void {
  try {
    execSync(`fuser -k ${targetPort}/tcp 2>/dev/null || true`, {
      stdio: 'ignore',
      timeout: 3000,
    })
  } catch {
    // Ignore errors — no stale process to kill, or fuser not available
  }
}

// Initialize providers and relay server before starting
async function start() {
  // Kill any stale processes on our ports (handles tsx watch orphans)
  killStalePortProcess(port)
  killStalePortProcess(relayPort)

  // Run database migrations (initializes DB connection + runs PGlite migrations in local mode)
  try {
    await runMigrations()
  } catch (err) {
    console.error('[db] Migration failed:', err)
  }

  // Bootstrap local-mode team and user (PGlite only)
  if (isIndexedDBMode()) {
    try {
      const { bootstrapLocalMode } = await import('./lib/db/bootstrap-local.js')
      await bootstrapLocalMode()
    } catch (err) {
      console.error('[bootstrap] Local-mode bootstrap failed:', err)
    }
  }

  console.log('[backend] initializing server (relay-only mode)...')

  const app = createApp()

  // Register event transport hooks (skip in test mode to avoid side effects)
  if (!isTest()) {
    console.log('[event-transport] Registering hooks...')
    astroEventTransport.registerHook('sse-notification', sseNotificationHook)
    astroEventTransport.registerHook('audit-log', auditLogHook)
    astroEventTransport.registerHook('usage-metrics', usageMetricsHook)
    astroEventTransport.registerHook('pr-creation', prCreationHook)
    astroEventTransport.registerHook('merge-queue', mergeQueueHook)
    astroEventTransport.registerHook('git-pull', gitPullHook)
    astroEventTransport.registerHook('channel-notification', channelNotificationHook)
    astroEventTransport.registerHook('observability', observabilityHook)
    observationCollector.start()
    if (langfuseExportHook) {
      astroEventTransport.registerHook('langfuse-export', langfuseExportHook)
    }
    console.log('[event-transport] Registered hooks:', astroEventTransport.listHooks().join(', '))
  } else {
    console.log('[event-transport] Test mode detected - hooks disabled')
    astroEventTransport.setEnabled(false)
  }

  // Reset stale connection statuses from previous server session
  try {
    await resetAllConnectionStatuses()
    console.log('[relay] Reset all machine connection statuses')
  } catch (err) {
    console.warn('[relay] Could not reset connection statuses:', (err as Error).message)
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
      // In IndexedDB-only mode (no Postgres), this may fail — that's OK,
      // the in-memory machine registry still tracks the connection.
      try {
        await ensureMachineRegistered(machineId, {
          name: entry?.name || machineId,
          hostname: entry?.hostname || 'unknown',
          platform: entry?.platform || 'unknown',
          environmentType: entry?.environmentType || 'remote',
          providers: entry?.providers?.map(p => p.type) || [],
          userId,
        })
        // Sync user-set name from DB back to the live registry so SSE events use the correct name
        const dbMachine = await getMachine(machineId)
        if (dbMachine && entry && dbMachine.name !== entry.name) {
          entry.name = dbMachine.name
        }
      } catch (err) {
        console.warn(`[relay] Could not persist machine ${machineId} to database (IndexedDB-only mode?):`, (err as Error).message)
      }
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
      // Update registered machine status (may fail in IndexedDB-only mode — that's OK)
      updateMachineConnectionStatus(machineId, false).catch(() => {})
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

  // Periodic cleanup tasks
  if (!isTest()) {
    // Clean expired WebAuthn challenges every minute
    challengeCleanup = setInterval(async () => {
      try {
        const cleaned = await cleanupExpiredChallenges()
        if (cleaned > 0) {
          console.log(`[auth] Cleaned ${cleaned} expired challenge(s)`)
        }
      } catch (err) {
        console.warn('[auth] Challenge cleanup failed:', (err as Error).message)
      }
    }, 60 * 1000)

    // Clean expired device codes every 5 minutes
    deviceCodeCleanup = setInterval(async () => {
      try {
        const cleaned = await cleanupExpiredDeviceCodes()
        if (cleaned > 0) {
          console.log(`[device-auth] Cleaned ${cleaned} expired device code(s)`)
        }
      } catch (err) {
        console.warn('[device-auth] Device code cleanup failed:', (err as Error).message)
      }
    }, 5 * 60 * 1000)
  }

  httpServer = serve({ fetch: app.fetch, port })
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[backend] Port ${port} already in use. Killing stale process...`)
      import('child_process').then(({ execSync }) => {
        try {
          const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim()
          if (pids) {
            execSync(`kill ${pids}`)
            console.log(`[backend] Killed stale process(es): ${pids.replace(/\n/g, ', ')}`)
            // Retry after a short delay
            setTimeout(() => {
              httpServer = serve({ fetch: app.fetch, port })
              console.log(`[backend] listening on http://localhost:${port}`)
            }, 1000)
          }
        } catch {
          console.error(`[backend] Could not kill stale process on port ${port}. Run: kill $(lsof -ti :${port})`)
          process.exit(1)
        }
      })
    } else {
      console.error('[backend] Server error:', err)
      process.exit(1)
    }
  })
  httpServer.on('listening', () => {
    console.log(`[backend] listening on http://localhost:${port}`)
  })
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

  if (challengeCleanup) clearInterval(challengeCleanup)
  if (deviceCodeCleanup) clearInterval(deviceCodeCleanup)

  try {
    stopCleanupScheduler()
    await observationCollector.stop()
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

// Only start the server when not running in test mode.
// Tests use createApp() + app.request() for in-process testing.
if (!isTest()) {
  start()
}
