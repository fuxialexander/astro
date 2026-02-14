import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import { pushTokens } from '../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'

const app = new Hono()

// Register APNs device token
app.post('/register', async (c) => {
  const body = await c.req.json()
  const { deviceToken, userId, preferences } = body

  if (!deviceToken || !userId) {
    return c.json({ error: 'deviceToken and userId are required' }, 400)
  }

  // Upsert: if same token exists, update preferences
  const [existing] = await db.select().from(pushTokens).where(
    and(eq(pushTokens.deviceToken, deviceToken), eq(pushTokens.userId, userId))
  )

  if (existing) {
    await db.update(pushTokens).set({
      preferences: preferences || {},
      updatedAt: new Date(),
    }).where(eq(pushTokens.id, existing.id))
  } else {
    await db.insert(pushTokens).values({
      userId,
      deviceToken,
      platform: body.platform || 'ios',
      preferences: preferences || {},
    })
  }

  return c.json({ success: true })
})

// Unregister device token
app.delete('/unregister', async (c) => {
  const body = await c.req.json()
  const { deviceToken, userId } = body

  if (!deviceToken) {
    return c.json({ error: 'deviceToken is required' }, 400)
  }

  if (userId) {
    await db.delete(pushTokens).where(
      and(eq(pushTokens.deviceToken, deviceToken), eq(pushTokens.userId, userId))
    )
  } else {
    await db.delete(pushTokens).where(eq(pushTokens.deviceToken, deviceToken))
  }

  return c.json({ success: true })
})

// Update notification preferences
app.patch('/preferences', async (c) => {
  const body = await c.req.json()
  const { deviceToken, userId, preferences } = body

  if (!deviceToken || !userId || !preferences) {
    return c.json({ error: 'deviceToken, userId, and preferences are required' }, 400)
  }

  const [existing] = await db.select().from(pushTokens).where(
    and(eq(pushTokens.deviceToken, deviceToken), eq(pushTokens.userId, userId))
  )

  if (!existing) {
    return c.json({ error: 'Token not found' }, 404)
  }

  const merged = { ...(existing.preferences as Record<string, unknown>), ...preferences }
  await db.update(pushTokens).set({
    preferences: merged,
    updatedAt: new Date(),
  }).where(eq(pushTokens.id, existing.id))

  return c.json({ success: true })
})

// List registered tokens for a user (debug)
app.get('/tokens', async (c) => {
  const userId = c.req.query('userId') || 'dev-user'
  const tokens = await db.select().from(pushTokens).where(eq(pushTokens.userId, userId))
  return c.json({ tokens, count: tokens.length })
})

export const notificationsRoute = app
