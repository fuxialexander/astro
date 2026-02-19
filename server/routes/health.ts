import { Hono } from 'hono'
import {
  providerRegistry,
  initializeProviders,
} from '../lib/providers/index.js'
import { getSessionStats } from '../lib/session-manager.js'
import { errorMessage } from '../lib/error-utils.js'
import { shouldUseSupabase } from '../lib/supabase.js'
import { detectLocalBackends, detectSingleBackend, buildContextString } from '../lib/local-backends.js'

const healthRoute = new Hono()

/**
 * Basic health check endpoint.
 * Returns server status and provider availability summary.
 */
healthRoute.get('/health', async (c) => {
  try {
    // Ensure providers are initialized
    if (!providerRegistry.isInitialized()) {
      await initializeProviders()
    }

    const summary = providerRegistry.getStatusSummary()
    const defaultProvider = providerRegistry.getDefaultProvider()

    return c.json({
      status: 'ok',
      mode: shouldUseSupabase() ? 'supabase' : 'indexeddb',
      // Server is considered authenticated if reachable — plan generation
      // uses the Claude Agent SDK directly, regardless of local provider status.
      // Provider auth only matters for local task execution.
      authenticated: true,
      providers: {
        total: summary.total,
        available: summary.available,
        authenticated: summary.authenticated,
      },
      defaultProvider: defaultProvider
        ? {
            id: defaultProvider.id,
            name: defaultProvider.name,
          }
        : null,
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ status: 'error', authenticated: false, error: message }, 500)
  }
})

/**
 * Get all registered providers with their status.
 */
healthRoute.get('/providers', async (c) => {
  try {
    // Ensure providers are initialized
    if (!providerRegistry.isInitialized()) {
      await initializeProviders()
    }

    const providers = providerRegistry.getAllProviders().map((r) => ({
      id: r.provider.id,
      name: r.provider.name,
      installed: r.detection.installed,
      authStatus: r.detection.authStatus,
      version: r.detection.version,
      available: r.available,
      message: r.detection.message,
      lastDetection: r.lastDetection.toISOString(),
      capabilities: r.capabilities,
    }))

    return c.json({ providers })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Get a specific provider's details.
 */
healthRoute.get('/providers/:providerId', async (c) => {
  try {
    const { providerId } = c.req.param()

    // Ensure providers are initialized
    if (!providerRegistry.isInitialized()) {
      await initializeProviders()
    }

    const registered = providerRegistry.getRegisteredProvider(providerId)

    if (!registered) {
      return c.json({ error: `Provider '${providerId}' not found` }, 404)
    }

    return c.json({
      id: registered.provider.id,
      name: registered.provider.name,
      installed: registered.detection.installed,
      authStatus: registered.detection.authStatus,
      version: registered.detection.version,
      available: registered.available,
      message: registered.detection.message,
      lastDetection: registered.lastDetection.toISOString(),
      capabilities: registered.capabilities,
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Re-detect a specific provider.
 * Useful when user installs or authenticates a provider.
 */
healthRoute.post('/providers/:providerId/detect', async (c) => {
  try {
    const { providerId } = c.req.param()

    // Ensure providers are initialized
    if (!providerRegistry.isInitialized()) {
      await initializeProviders()
    }

    const result = await providerRegistry.detectProvider(providerId)

    if (!result) {
      return c.json({ error: `Provider '${providerId}' not found` }, 404)
    }

    return c.json({
      providerId,
      detection: {
        installed: result.installed,
        authStatus: result.authStatus,
        version: result.version,
        message: result.message,
        detectedAt: result.detectedAt.toISOString(),
      },
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Re-detect all providers.
 */
healthRoute.post('/providers/detect-all', async (c) => {
  try {
    // Force re-initialization
    await initializeProviders()

    const summary = providerRegistry.getStatusSummary()

    return c.json({
      total: summary.total,
      available: summary.available,
      installed: summary.installed,
      authenticated: summary.authenticated,
      providers: summary.providers.map((p) => ({
        id: p.id,
        name: p.name,
        installed: p.installed,
        authStatus: p.authStatus,
        available: p.available,
      })),
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Get machine registration payload.
 * This is what would be sent to a relay server.
 */
healthRoute.get('/machine', async (c) => {
  try {
    // Ensure providers are initialized
    if (!providerRegistry.isInitialized()) {
      await initializeProviders()
    }

    const registration = providerRegistry.getMachineRegistration()

    return c.json(registration)
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Get session statistics.
 */
healthRoute.get('/sessions', async (c) => {
  try {
    const stats = getSessionStats()

    return c.json({
      activeSessions: stats.total,
      byProvider: stats.byProvider,
      byTaskType: stats.byTaskType,
      oldestSession: stats.oldestSession?.toISOString() ?? null,
    })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Generate test auth token for e2e testing.
 * Only available in development/test mode.
 * Returns a hardcoded test token that bypasses Supabase auth verification.
 */
healthRoute.post('/test/auth-token', async (c) => {
  // Only allow in non-production environments
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    return c.json({ error: 'Test endpoints only available in development' }, 403)
  }

  if (!shouldUseSupabase()) {
    return c.json({ error: 'Test auth token only needed in Supabase mode' }, 400)
  }

  // Return hardcoded test token that's recognized by auth middleware
  return c.json({
    userId: '00000000-0000-0000-0000-000000000000',
    accessToken: 'test-e2e-token',
    email: 'dev@localhost',
  })
})

/**
 * Detect local execution backends (Docker, Kubernetes, SLURM).
 * Returns available backends on the server machine.
 */
healthRoute.get('/backends', async (c) => {
  try {
    const result = await detectLocalBackends()
    return c.json(result)
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Get detail for a single backend (fresh detection, bypasses cache).
 */
healthRoute.get('/backends/:id', async (c) => {
  try {
    const { id } = c.req.param()
    const backend = await detectSingleBackend(id)
    if (!backend) {
      return c.json({ error: `Backend '${id}' not found or not available` }, 404)
    }
    const contextString = buildContextString(backend)
    return c.json({ backend, contextString })
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

/**
 * Force re-detect local execution backends.
 */
healthRoute.post('/backends/detect', async (c) => {
  try {
    // Clear cache by calling detect (cache TTL handles freshness)
    const result = await detectLocalBackends()
    return c.json(result)
  } catch (e: unknown) {
    const message = errorMessage(e)
    return c.json({ error: message }, 500)
  }
})

export { healthRoute }
