/**
 * Notification API Routes
 *
 * REST API for notification preferences, device registration,
 * and notification management.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'crypto'
import {
  notificationHub,
  sseChannel,
  type NotificationPreferences,
  type DeviceRegistration,
  type PushPlatform,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '../lib/notifications/index.js'
import { machineRegistry } from '../lib/machine-registry.js'
import { eventBuffer } from '../lib/event-buffer.js'
import { StdoutThrottle } from '../lib/stdout-throttle.js'

const notificationsRoute = new Hono()

// ============================================================================
// In-memory stores (replace with database in production)
// ============================================================================

const userPreferences = new Map<string, NotificationPreferences>()
const deviceRegistrations = new Map<string, DeviceRegistration>()

// ============================================================================
// Hub Status
// ============================================================================

/**
 * GET /api/notifications/status
 * Get notification hub status and statistics
 */
notificationsRoute.get('/status', (c) => {
  const hubStats = notificationHub.getStats()
  const channels = notificationHub.getChannels().map(ch => ({
    id: ch.id,
    name: ch.name,
    status: ch.status,
    stats: ch.stats,
  }))

  return c.json({
    status: 'ok',
    hub: hubStats,
    channels,
  })
})

// ============================================================================
// SSE Stream (moved from events.ts to integrate with hub)
// ============================================================================

/**
 * GET /api/notifications/stream
 * SSE stream for browser clients
 *
 * Query params:
 * - projectId (optional): filter events to a specific project
 * - userId (optional): filter events to a specific user
 *
 * Headers:
 * - Last-Event-ID: replay events after this ID on reconnection
 */
notificationsRoute.get('/stream', async (c) => {
  const projectId = c.req.query('projectId')
  const userId = c.req.query('userId')
  const lastEventId = c.req.header('Last-Event-ID')

  return streamSSE(c, async (stream) => {
    let alive = true
    const connectionId = randomUUID()

    // Stdout throttle for this connection
    const throttle = new StdoutThrottle((taskId, data) => {
      if (!alive) return
      const id = eventBuffer.push('task:stdout', JSON.stringify({ taskId, data }))
      stream.writeSSE({ id, event: 'task:stdout', data: JSON.stringify({ taskId, data }) }).catch(() => {
        alive = false
      })
    })

    // Register with SSE channel
    sseChannel.addConnection({
      id: connectionId,
      userId,
      projectId,
      write: (event, data, id) => {
        if (!alive) return
        stream.writeSSE({ id, event, data }).catch(() => {
          alive = false
        })
      },
      close: () => {
        alive = false
      },
      onClose: (callback) => {
        stream.onAbort(callback)
      },
    })

    // Replay missed events on reconnection
    if (lastEventId) {
      const missed = eventBuffer.getAfter(lastEventId)
      for (const event of missed) {
        await stream.writeSSE({ id: event.id, event: event.event, data: event.data })
      }
    }

    // Send initial machine list
    const machines = machineRegistry.getAll()
    const machineData = machines.map((m) => ({
      machineId: m.machineId,
      name: m.name,
      environmentType: m.environmentType,
      connectionStatus: m.connectionStatus,
      providers: m.providers,
      load: m.load,
    }))
    await stream.writeSSE({
      event: 'machines:snapshot',
      data: JSON.stringify(machineData),
    })

    // Keepalive heartbeat (15s)
    const heartbeat = setInterval(() => {
      if (!alive) {
        clearInterval(heartbeat)
        return
      }
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
        alive = false
        clearInterval(heartbeat)
      })
    }, 15000)

    // Wait for client disconnect
    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      throttle.shutdown()
      sseChannel.removeConnection(connectionId)
    })

    // Keep the stream open until aborted
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) {
          clearInterval(check)
          resolve()
        }
      }, 1000)
    })
  })
})

// ============================================================================
// User Preferences
// ============================================================================

/**
 * GET /api/notifications/preferences
 * Get notification preferences for current user
 */
notificationsRoute.get('/preferences', (c) => {
  const userId = c.req.header('X-User-ID') || 'anonymous'
  const prefs = userPreferences.get(userId) || {
    userId,
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  }
  return c.json(prefs)
})

/**
 * PUT /api/notifications/preferences
 * Update notification preferences
 */
notificationsRoute.put('/preferences', async (c) => {
  const userId = c.req.header('X-User-ID') || 'anonymous'
  const body = await c.req.json<Partial<NotificationPreferences>>()

  const existing = userPreferences.get(userId) || {
    userId,
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  }

  const updated: NotificationPreferences = {
    ...existing,
    ...body,
    userId, // Ensure userId can't be changed
  }

  userPreferences.set(userId, updated)

  return c.json(updated)
})

// ============================================================================
// Device Registration (for push notifications)
// ============================================================================

/**
 * POST /api/notifications/devices
 * Register a device for push notifications
 */
notificationsRoute.post('/devices', async (c) => {
  const userId = c.req.header('X-User-ID')
  if (!userId) {
    return c.json({ error: 'X-User-ID header required' }, 401)
  }

  const body = await c.req.json<{
    platform: PushPlatform
    token: string
    name?: string
  }>()

  if (!body.platform || !body.token) {
    return c.json({ error: 'platform and token required' }, 400)
  }

  const deviceId = `${body.platform}-${randomUUID()}`
  const registration: DeviceRegistration = {
    deviceId,
    userId,
    platform: body.platform,
    token: body.token,
    name: body.name,
    registeredAt: new Date(),
    lastActiveAt: new Date(),
  }

  deviceRegistrations.set(deviceId, registration)

  // TODO: Register with push channel when implemented
  // pushChannel.registerDevice(registration)

  return c.json({
    deviceId,
    registered: true,
  }, 201)
})

/**
 * GET /api/notifications/devices
 * List registered devices for current user
 */
notificationsRoute.get('/devices', (c) => {
  const userId = c.req.header('X-User-ID')
  if (!userId) {
    return c.json({ error: 'X-User-ID header required' }, 401)
  }

  const userDevices = Array.from(deviceRegistrations.values())
    .filter(d => d.userId === userId)
    .map(d => ({
      deviceId: d.deviceId,
      platform: d.platform,
      name: d.name,
      registeredAt: d.registeredAt,
      lastActiveAt: d.lastActiveAt,
    }))

  return c.json({ devices: userDevices })
})

/**
 * DELETE /api/notifications/devices/:deviceId
 * Unregister a device
 */
notificationsRoute.delete('/devices/:deviceId', (c) => {
  const userId = c.req.header('X-User-ID')
  if (!userId) {
    return c.json({ error: 'X-User-ID header required' }, 401)
  }

  const deviceId = c.req.param('deviceId')
  const device = deviceRegistrations.get(deviceId)

  if (!device) {
    return c.json({ error: 'Device not found' }, 404)
  }

  if (device.userId !== userId) {
    return c.json({ error: 'Not authorized' }, 403)
  }

  deviceRegistrations.delete(deviceId)

  // TODO: Unregister from push channel when implemented
  // pushChannel.unregisterDevice(deviceId)

  return c.json({ deleted: true })
})

// ============================================================================
// Test Endpoints (development only)
// ============================================================================

/**
 * POST /api/notifications/test
 * Send a test notification (development only)
 */
notificationsRoute.post('/test', async (c) => {
  const body = await c.req.json<{
    type?: string
    message?: string
  }>()

  await notificationHub.dispatch({
    id: randomUUID(),
    type: 'system:warning',
    timestamp: new Date(),
    priority: 'normal',
    data: {
      message: body.message || 'Test notification',
      source: 'api',
    },
  })

  return c.json({ sent: true })
})

export { notificationsRoute }
