import { Hono } from 'hono'
import { errorMessage } from '../lib/error-utils.js'
import { isServerMode } from '../lib/app-mode.js'
import { buildContextString } from '../lib/local-backends.js'
import { machineRegistry } from '../lib/machine-registry.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'

const healthRoute = new Hono()

/**
 * Basic health check endpoint.
 * Returns server status and connected agent runner count.
 */
healthRoute.get('/health', async (c) => {
  try {
    const machines = machineRegistry.getAll()

    return c.json({
      status: 'ok',
      mode: isServerMode() ? 'supabase' : 'pglite',
      // Server is always authenticated — it's a relay hub, not an AI provider
      authenticated: true,
      relay: {
        connectedRunners: machines.length,
        machines: machines.map((m) => ({
          id: m.machineId,
          name: m.name,
          activeTasks: m.load.activeTasks,
        })),
      },
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ status: 'error', authenticated: false, error: message }, 500)
  }
})

/**
 * Get connected agent runners (replaces provider listing).
 */
healthRoute.get('/providers', async (c) => {
  try {
    const machines = machineRegistry.getAll()

    return c.json({
      providers: machines.map((m) => ({
        id: m.machineId,
        name: m.name,
        installed: true,
        authStatus: 'authenticated',
        available: true,
        providers: m.providers,
        capabilities: {
          activeTasks: m.load.activeTasks,
        },
      })),
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Get a specific machine's details.
 */
healthRoute.get('/providers/:providerId', async (c) => {
  try {
    const { providerId } = c.req.param()
    const machine = machineRegistry.get(providerId)

    if (!machine) {
      return c.json({ error: `Machine '${providerId}' not found` }, 404)
    }

    return c.json({
      id: machine.machineId,
      name: machine.name,
      installed: true,
      authStatus: 'authenticated',
      available: true,
      providers: machine.providers,
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Re-detect is a no-op in relay mode — runners self-register.
 */
healthRoute.post('/providers/:providerId/detect', async (c) => {
  const { providerId } = c.req.param()
  const machine = machineRegistry.get(providerId)

  return c.json({
    providerId,
    detection: {
      installed: !!machine,
      authStatus: machine ? 'authenticated' : 'not_connected',
      message: machine ? 'Agent runner connected' : 'Agent runner not connected',
      detectedAt: new Date().toISOString(),
    },
  })
})

/**
 * Re-detect all is a no-op in relay mode.
 */
healthRoute.post('/providers/detect-all', async (c) => {
  const machines = machineRegistry.getAll()
  return c.json({
    total: machines.length,
    available: machines.length,
    installed: machines.length,
    authenticated: machines.length,
    providers: machines.map((m) => ({
      id: m.machineId,
      name: m.name,
      installed: true,
      authStatus: 'authenticated',
      available: true,
    })),
  })
})

/**
 * Get machine registration info.
 */
healthRoute.get('/machine', async (c) => {
  const machines = machineRegistry.getAll()
  return c.json({
    mode: 'relay',
    connectedRunners: machines.length,
    machines: machines.map((m) => ({
      id: m.machineId,
      name: m.name,
      providers: m.providers,
    })),
  })
})

/**
 * Get relay session statistics (replaces session manager stats).
 */
healthRoute.get('/sessions', async (c) => {
  try {
    const machines = machineRegistry.getAll()
    const totalActiveTasks = machines.reduce((sum, m) => sum + m.load.activeTasks, 0)

    return c.json({
      activeSessions: totalActiveTasks,
      byMachine: Object.fromEntries(machines.map((m) => [m.machineId, m.load.activeTasks])),
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Generate test auth token for e2e testing.
 */
healthRoute.post('/test/auth-token', async (c) => {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    return c.json({ error: 'Test endpoints only available in development' }, 403)
  }

  if (!isServerMode()) {
    return c.json({ error: 'Test auth token only needed in Supabase mode' }, 400)
  }

  return c.json({
    userId: '00000000-0000-0000-0000-000000000000',
    accessToken: 'test-e2e-token',
    email: 'dev@localhost',
  })
})

/**
 * List all execution backends across all connected machines.
 * Backends are detected by agent runners and reported via the machine registry.
 * Works in both local and multi-tenant mode — agent runners are the single source of truth.
 */
healthRoute.get('/backends', async (c) => {
  try {
    const machines = machineRegistry.getAll()
    const backends = machines.flatMap((m) =>
      (m.executionStrategies ?? [])
        .filter((s) => s.id !== 'direct')
        .map((s) => ({
          id: s.id,
          name: s.name,
          available: s.available,
          version: s.version,
          metadata: s.metadata,
          machineId: m.machineId,
          machineName: m.name,
        }))
    )
    return c.json({ backends, detectedAt: new Date().toISOString() })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Force re-detect is a no-op now — agent runners detect on registration.
 * Returns current state from machine registry.
 */
healthRoute.post('/backends/detect', async (c) => {
  try {
    const machines = machineRegistry.getAll()
    const backends = machines.flatMap((m) =>
      (m.executionStrategies ?? [])
        .filter((s) => s.id !== 'direct')
        .map((s) => ({
          id: s.id,
          name: s.name,
          available: s.available,
          version: s.version,
          metadata: s.metadata,
          machineId: m.machineId,
          machineName: m.name,
        }))
    )
    return c.json({ backends, detectedAt: new Date().toISOString() })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Get remote machine backend context by machine ID + strategy ID.
 * MUST be registered BEFORE /backends/:id to avoid route shadowing.
 */
healthRoute.get('/backends/remote/:machineId/:strategyId', requireAuth, async (c) => {
  try {
    const { machineId, strategyId } = c.req.param()
    const user = c.get('user') as AuthUser

    const machine = machineRegistry.get(machineId)
    if (!machine) {
      return c.json({ error: 'Machine not found' }, 404)
    }

    if (machine.userId && machine.userId !== LOCAL_USER_ID && machine.userId !== user.id) {
      return c.json({ error: 'Machine not found' }, 404)
    }

    const strategy = machine.executionStrategies?.find(s => s.id === strategyId)
    if (!strategy) {
      return c.json({ error: `Strategy '${strategyId}' not found on machine ${machineId}` }, 404)
    }

    const contextString = buildContextString({
      id: strategy.id,
      name: strategy.name,
      available: strategy.available,
      version: strategy.version,
      metadata: strategy.metadata as Record<string, unknown> | undefined,
    })

    return c.json({
      backend: strategy,
      contextString,
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Get a specific backend by ID — searches across all connected machines.
 * Registered AFTER /backends/remote/:machineId/:strategyId to avoid route shadowing.
 */
healthRoute.get('/backends/:id', async (c) => {
  try {
    const { id } = c.req.param()
    const machines = machineRegistry.getAll()

    for (const machine of machines) {
      const strategy = machine.executionStrategies?.find((s) => s.id === id)
      if (strategy) {
        const backend = {
          id: strategy.id,
          name: strategy.name,
          available: strategy.available,
          version: strategy.version,
          metadata: strategy.metadata as Record<string, unknown> | undefined,
        }
        const contextString = buildContextString(backend)
        return c.json({ backend, contextString })
      }
    }

    return c.json({ error: `Backend '${id}' not found on any connected machine` }, 404)
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

export { healthRoute }
