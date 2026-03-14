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

import { fsRoute } from './routes/fs.js'
import { repoRoute } from './routes/repo.js'
import { dataRoute } from './routes/data.js'
import { notificationsRoute } from './routes/notifications.js'
import githubRoute from './routes/github.js'
import githubAppRoute from './routes/github-app.js'
import githubAppWebhookRoute from './routes/github-app-webhook.js'
import githubPrRoute from './routes/github-pr-data.js'
import { wellKnownRoute } from './routes/well-known.js'
import { docsRoute } from './routes/docs.js'
import systemRoute from './routes/system.js'
import { skillsRoute } from './routes/skills.js'
import { machineInstructionsRoute } from './routes/machine-instructions.js'
import { schedulesRoute } from './routes/schedules.js'
import { examplesRoute } from './routes/examples.js'
import { shareRoute } from './routes/share.js'
import { connectedAccountsRoute } from './routes/connected-accounts.js'
import { openClawChannel } from './lib/channel/adapters/openclaw-channel.js'
import { telegramChannel } from './lib/channel/adapters/telegram-channel.js'
import { telegramRoute } from './routes/telegram.js'
import { teamsRoute } from './routes/teams.js'
import { communityRoute } from './routes/community.js'
import { runMigrations } from './lib/db/migrate.js'
import { closeDb } from '../packages/core/src/db/index.js'
import { relayServer } from './lib/relay-server.js'
import { redisPubSub } from './lib/redis-pubsub.js'
import { initRedisEventBridge } from './lib/redis-event-bridge.js'
import { machineRegistry } from './lib/machine-registry.js'
import { dispatchEngine } from './lib/dispatch/index.js'
import { updateMachineConnectionStatus, ensureMachineRegistered, resetAllConnectionStatuses, getMachine } from './lib/registered-machines-store.js'
import { validateEnvironment, getRelayConfig, getRedisConfig, isProduction, isTest, isLocalMode as isLocalModeEnv } from './lib/environment.js'
import { startCleanupScheduler, stopCleanupScheduler } from './lib/cleanup-scheduler.js'
import { startCronScheduler, stopCronScheduler, retryMissedRunsForMachine } from './lib/cron-scheduler.js'
import { startExecutionWatchdog, stopExecutionWatchdog } from './lib/execution-watchdog.js'
import { db } from './lib/db/index.js'
import { planNodes } from './lib/db/schema.js'
import { eq } from 'drizzle-orm'
import { executionEventBus } from './lib/execution-event-bus.js'
import { astroEventTransport } from './lib/events/astro-event-transport.js'
import { sseNotificationHook } from './lib/events/hooks/sse-notification-hook.js'
import { auditLogHook } from './lib/events/hooks/audit-log-hook.js'
import { usageMetricsHook } from './lib/events/hooks/usage-metrics-hook.js'
import { prCreationHook } from './lib/events/hooks/pr-creation-hook.js'
import { mergeQueueHook } from './lib/events/hooks/merge-queue-hook.js'
import { gitPullHook } from './lib/events/hooks/git-pull-hook.js'
import { channelNotificationHook } from './lib/events/hooks/channel-notification-hook.js'
import { githubIssueCloseHook } from './lib/events/hooks/github-issue-close-hook.js'
import { githubFieldSyncHook } from './lib/events/hooks/github-field-sync-hook.js'
import { prBodyUpdateHook } from './lib/events/hooks/pr-body-update-hook.js'
import { projectCompletionHook } from './lib/events/hooks/project-completion-hook.js'
import { prAutoLinkHook } from './lib/events/hooks/pr-auto-link-hook.js'
import { observabilityHook, observationCollector } from './lib/observability/observation-collector.js'
import { observationsRoute } from './routes/observations.js'
import { cleanupExpiredChallenges } from './lib/challenge-store.js'
import { cleanupExpiredDeviceCodes } from './lib/device-code-store.js'
import { streamingEventLog } from './lib/streaming-event-log.js'

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
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com", "https://esm.sh", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "data:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "blob:"],
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

  // Community write endpoints rate limiter (60 req/15min per IP) - bypassed in test mode
  // Covers star, comment, publish, fork operations to prevent abuse
  if (!isTest()) {
    const communityRateLimiter = rateLimiter({
      windowMs: 15 * 60 * 1000, // 15 minutes
      limit: 60,
      standardHeaders: 'draft-7',
      keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
    })
    // Cover both exact path (POST /plans) and sub-paths (/plans/:id/star, etc.)
    for (const path of ['/api/community/plans', '/api/community/plans/*']) {
      app.use(path, async (c, next) => {
        if (c.req.method === 'GET') return next()
        return communityRateLimiter(c, next)
      })
    }
  }

  // Routes that work in both local and server mode
  app.route('/.well-known', wellKnownRoute)
  app.route('/api/docs', docsRoute)
  app.route('/api', healthRoute)
  app.route('/api/agent', agentRoute)
  app.route('/api/relay', relayRoute)
  app.route('/api/dispatch', dispatchRoute)
  app.route('/api/device', deviceAuthRoute)
  app.route('/api/events', eventsRoute)

  app.route('/api/fs', fsRoute)
  app.route('/api/repo', repoRoute)
  app.route('/api/data', dataRoute)
  app.route('/api/system', systemRoute)
  app.route('/api/skills', skillsRoute)
  app.route('/api/machine-instructions', machineInstructionsRoute)
  app.route('/api/schedules', schedulesRoute)
  app.route('/api/examples', examplesRoute)

  // Backward-compat redirect: /api/templates → /api/examples
  // Use 308 (not 301) to preserve HTTP method — 301 converts POST to GET
  app.all('/api/templates', (c) => {
    const url = new URL(c.req.url)
    return c.redirect('/api/examples' + url.search, 308)
  })
  app.all('/api/templates/*', (c) => {
    const url = new URL(c.req.url)
    const newPath = url.pathname.replace('/api/templates', '/api/examples')
    return c.redirect(newPath + url.search, 308)
  })
  app.route('/api/observations', observationsRoute)
  app.route('/api/teams', teamsRoute)
  app.route('/api/community', communityRoute)

  // Auth routes are always mounted (endpoints guard themselves with isLocalMode())
  app.route('/api/auth', authRoute)

  // Connected accounts — needed in all modes for OpenClaw channel config
  app.route('/api/connected-accounts', connectedAccountsRoute)

  // Telegram channel (webhook + link/status/disconnect)
  app.route('/api/telegram', telegramRoute)

  // Server-only routes (require Supabase Auth)
  if (!isLocalModeEnv()) {
    app.route('/api/notifications', notificationsRoute)
    app.route('/api/github', githubRoute)
    app.route('/api/github-app', githubAppRoute)
    app.route('/api/github-app', githubAppWebhookRoute)
    app.route('/api/github/pr', githubPrRoute)
    app.route('/api/share', shareRoute)
  }

  // Landing page route
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  app.get('/landing', (c) => {
    try {
      const html = readFileSync(join(__dirname, '../public/landing/index.html'), 'utf-8')
      return c.html(html)
    } catch (err) {
      console.error('[landing] Failed to read landing page:', err)
      return c.text('Landing page not found', 404)
    }
  })

  app.get('/landing/about', (c) => {
    try {
      const html = readFileSync(join(__dirname, '../public/landing/about.html'), 'utf-8')
      return c.html(html)
    } catch (err) {
      console.error('[landing] Failed to read about page:', err)
      return c.text('About page not found', 404)
    }
  })

  app.get('/privacy', (c) => c.redirect('/landing/privacy', 301))

  app.get('/landing/privacy', (c) => {
    try {
      const html = readFileSync(join(__dirname, '../public/landing/privacy.html'), 'utf-8')
      return c.html(html)
    } catch (err) {
      console.error('[landing] Failed to read privacy page:', err)
      return c.text('Privacy page not found', 404)
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
  if (isLocalModeEnv()) {
    try {
      const { bootstrapLocalMode } = await import('./lib/db/bootstrap-local.js')
      await bootstrapLocalMode()
    } catch (err) {
      console.error('[bootstrap] Local-mode bootstrap failed:', err)
    }
  }

  // Seed built-in skills from skills/ directory (runs in all modes)
  let skillsBootstrapOk = false
  try {
    const { loadBuiltinSkillsFromDisk } = await import('./lib/load-builtin-skills.js')
    const { bootstrapBuiltinSkills } = await import('./lib/db/bootstrap-skills.js')
    const builtinSkills = loadBuiltinSkillsFromDisk()
    await bootstrapBuiltinSkills(builtinSkills)
    skillsBootstrapOk = true
  } catch (err) {
    console.error('[bootstrap] ⚠️  Built-in skills bootstrap FAILED — skills may be missing or outdated:', err)
  }


  // Load DB skills into in-memory skill-manager for prompt injection
  try {
    const { syncSkillsFromDb } = await import('./lib/db/bootstrap-skills.js')
    const { skillManager } = await import('./lib/skill-manager.js')
    await syncSkillsFromDb(skillManager)
    if (!skillsBootstrapOk) {
      console.warn('[bootstrap] ⚠️  Skills loaded from DB but bootstrap failed — some builtins may be stale')
    }
  } catch (err) {
    console.error('[bootstrap] ⚠️  Skill-manager sync FAILED — prompt injection will return empty skills:', err)
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
    astroEventTransport.registerHook('pr-body-update', prBodyUpdateHook)
    astroEventTransport.registerHook('github-issue-close', githubIssueCloseHook)
    astroEventTransport.registerHook('github-field-sync', githubFieldSyncHook)
    astroEventTransport.registerHook('merge-queue', mergeQueueHook)
    astroEventTransport.registerHook('project-completion', projectCompletionHook)
    astroEventTransport.registerHook('git-pull', gitPullHook)
    astroEventTransport.registerHook('channel-notification', channelNotificationHook)
    astroEventTransport.registerHook('pr-auto-link', prAutoLinkHook)
    astroEventTransport.registerHook('observability', observabilityHook)
    observationCollector.start()
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
          relayServer.dispatchTask(event.task, event.targetMachineId, event.userId)
        }
      })

      redisPubSub.on('task:cancel', async (event) => {
        if (machineRegistry.isConnected(event.machineId)) {
          relayServer.cancelTask(event.taskId, event.machineId, event.reason)
        }
      })
    }

    // Bridge executionEventBus → Redis for cross-instance delivery.
    // Works in both single-instance (no-ops) and multi-instance (publishes).
    // Must be called after Redis connects but before any events can fire.
    initRedisEventBridge()

    // Start WebSocket relay server
    relayServer.start(relayPort)

    // Set up relay event handlers
    relayServer.on('task:result', async (message) => {
      console.log(`[relay] Task ${message.result.taskId} completed: ${message.result.status}${message.result.error ? ` error=${message.result.error}` : ''}`)
      // Publish to Redis for other services to consume
      if (redisPubSub.isConnected()) {
        // Task machine mapping cleanup happens when task completes
        await redisPubSub.removeTaskMapping(message.result.taskId)
      }
      // Emit event for dispatch engine to handle result routing
      dispatchEngine.emit('relay:task:result', message)
    })

    // Handle dead job detection (P2 heartbeat cross-reference).
    // This is a FALLBACK handler for when the per-dispatch SSE handler (dispatch.ts)
    // has already cleaned up (browser disconnected, SSE stream closed).
    // The dispatch.ts handler is the primary handler and clears all execution fields.
    // This handler catches tasks whose SSE streams are gone — it uses executionId
    // matching, so if dispatch.ts already cleared executionId to null, the SELECT
    // returns nothing and we skip (no double-write).
    relayServer.on('task:dead', async (data) => {
      console.warn(`[relay] Dead task ${data.taskId} on machine ${data.machineId}: ${data.reason}`)
      try {
        const errorMsg = `Dead job detected: ${data.reason}. Task reset for re-execution.`
        // Look up the node first so we can emit node:status_changed with nodeId/projectId.
        // If the dispatch.ts handler already cleared executionId, this returns nothing.
        const [node] = await db.select({ clientId: planNodes.clientId, projectId: planNodes.projectId })
          .from(planNodes)
          .where(eq(planNodes.executionId, data.taskId))
          .limit(1)
        if (!node) {
          console.log(`[relay] Dead task ${data.taskId} — no matching node (already handled by dispatch SSE), skipping`)
          return
        }
        // Clear ALL execution fields to match dispatch.ts handler behavior
        const errorTime = new Date()
        await db.update(planNodes)
          .set({
            status: 'planned',
            executionId: null,
            executionError: errorMsg,
            executionStartedAt: null,
            executionOutput: null,
            executionCompletedAt: null,
            endDate: errorTime.toISOString(),
            actualEndDate: errorTime,
            updatedAt: errorTime,
          })
          .where(eq(planNodes.executionId, data.taskId))
        // DB-authoritative: notify all clients about the dead task reset
        executionEventBus.emit('node:status_changed', {
          nodeId: node.clientId,
          projectId: node.projectId,
          status: 'planned',
          executionId: data.taskId,
        })
        console.log(`[relay] Dead task ${data.taskId} reset to planned (node=${node.clientId})`)
      } catch (err) {
        console.error(`[relay] Failed to reset dead task ${data.taskId}:`, (err as Error).message)
      }
    })

    relayServer.on('machine:connected', async (machineId: string, userId: string) => {
      console.log(`[relay] Machine ${machineId} connected for user ${userId}`)
      const entry = machineRegistry.get(machineId)
      // Ensure machine exists in persistent store (survives server restarts)
      // In local/PGlite-only mode (no Postgres), this may fail — that's OK,
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
        console.warn(`[relay] Could not persist machine ${machineId} to database (local/PGlite-only mode?):`, (err as Error).message)
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

      // Retry missed cron schedule runs targeting this machine
      retryMissedRunsForMachine(machineId).catch((err) => {
        console.warn(`[cron] Failed to retry missed runs for machine ${machineId}:`, err)
      })
    })

    relayServer.on('machine:disconnected', async (machineId, reason) => {
      console.log(`[relay] Machine ${machineId} disconnected: ${reason}`)
      // Update registered machine status (may fail in local/PGlite-only mode — that's OK)
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

  // Start channel adapters (non-blocking, optional)
  if (!isTest()) {
    openClawChannel.start().catch((err) => {
      console.warn('[openclaw] Failed to start channel adapter:', err)
    })
    telegramChannel.start().catch((err) => {
      console.warn('[telegram] Failed to start channel adapter:', err)
    })
  }

  // Start cleanup scheduler (disabled in test mode and local/PGlite mode)
  if (!isTest() && !isLocalModeEnv()) {
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

  // Start cron scheduler for recurring task execution
  if (!isTest()) {
    startCronScheduler({
      enabled: true,
      intervalMs: 60_000, // 60 seconds
    })
    console.log('[cron] Cron scheduler started')
  }

  // Start execution watchdog (P7: server-side in_progress safety net)
  if (!isTest()) {
    startExecutionWatchdog({
      enabled: true,
      intervalMs: 5 * 60 * 1000,           // 5 minutes
      staleThresholdMs: 2 * 60 * 60 * 1000, // 2 hours
    })
    console.log('[watchdog] Execution watchdog started')
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
  // Set keepAlive timeouts above Fly.io's 75s proxy idle timeout.
  // Without this, Fly.io may reuse a connection Node.js has already closed,
  // causing 502 errors and client reconnect storms that inflate connection count.
  httpServer.keepAliveTimeout = 90_000
  httpServer.headersTimeout = 91_000
  // Enable OS-level TCP keepalive probes on every socket.
  // This is critical for SSE connections: when a client crashes or the network
  // drops, the OS sends TCP keepalive probes (every 10s, 3 retries = 30s to
  // detect dead). Without this, a zombie SSE connection behind Fly.io's proxy
  // can stay open indefinitely — the Fly→backend TCP socket stays alive even
  // after the client is gone, so application-level heartbeat writes succeed and
  // the server never learns the client left. TCP keepalive at the socket level
  // bypasses the proxy and detects the dead connection at the OS layer.
  httpServer.on('connection', (socket: import('net').Socket) => {
    socket.setKeepAlive(true, 10_000) // probe after 10s idle, OS retries 3× before giving up
  })
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
  httpServer.on('listening', async () => {
    console.log(`[backend] listening on http://localhost:${port}`)

    // Start built-in monitoring (Telegram alerts for health checks + startup notification)
    if (!isTest()) {
      const { startHealthCheckMonitor, notifyServerStartup } = await import('./lib/monitoring.js')
      startHealthCheckMonitor()
      notifyServerStartup({
        port,
        mode: isLocalMode() ? 'local' : 'supabase',
      })
    }
  })
}

// Shared shutdown logic with a hard timeout so the process never hangs
async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down gracefully`)
  // Hard kill after 5 seconds if cleanup stalls (PGlite needs time to checkpoint WAL)
  const timer = setTimeout(() => {
    console.log('[server] Shutdown timed out, forcing exit')
    process.exit(1)
  }, 5_000)
  timer.unref()

  if (challengeCleanup) clearInterval(challengeCleanup)
  if (deviceCodeCleanup) clearInterval(deviceCodeCleanup)

  try {
    const { stopHealthCheckMonitor } = await import('./lib/monitoring.js')
    stopHealthCheckMonitor()
    stopCleanupScheduler()
    stopCronScheduler()
    stopExecutionWatchdog()
    await observationCollector.stop()
    await streamingEventLog.flushAll()
    dispatchEngine.stop()
    httpServer?.close()
    await relayServer.stop()
    await redisPubSub.disconnect()
    // Close database last — flushes PGlite WAL/checkpoint, drains postgres-js pool
    await closeDb()
  } catch (e) {
    console.error('[server] Error during shutdown:', e)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Flush buffered streaming events on unexpected crashes so data isn't lost
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err)
  const forceExit = setTimeout(() => process.exit(1), 3_000)
  forceExit.unref()
  streamingEventLog.flushAll().catch(() => {}).finally(() => process.exit(1))
})
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason)
  streamingEventLog.flushAll().catch(() => {})
})

// Only start the server when not running in test mode.
// Tests use createApp() + app.request() for in-process testing.
if (!isTest()) {
  start()
}
