import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import { pushTokens } from '../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { requireAuth, type AuthUser } from '../middleware/auth.js'

const app = new Hono()

// All notification routes require authentication
app.use('/*', requireAuth)

// Register APNs device token
app.post('/register', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()
  const { deviceToken, preferences } = body

  if (!deviceToken) {
    return c.json({ error: 'deviceToken is required' }, 400)
  }

  // Always use authenticated user's ID — never accept userId from body
  const userId = user.id

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
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()
  const { deviceToken } = body

  if (!deviceToken) {
    return c.json({ error: 'deviceToken is required' }, 400)
  }

  // Only allow unregistering own tokens
  await db.delete(pushTokens).where(
    and(eq(pushTokens.deviceToken, deviceToken), eq(pushTokens.userId, user.id))
  )

  return c.json({ success: true })
})

// Update notification preferences
app.patch('/preferences', async (c) => {
  const user = c.get('user')! as AuthUser
  const body = await c.req.json()
  const { deviceToken, preferences } = body

  if (!deviceToken || !preferences) {
    return c.json({ error: 'deviceToken and preferences are required' }, 400)
  }

  // Only allow updating own tokens
  const [existing] = await db.select().from(pushTokens).where(
    and(eq(pushTokens.deviceToken, deviceToken), eq(pushTokens.userId, user.id))
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

// List registered tokens for the authenticated user
app.get('/tokens', async (c) => {
  const user = c.get('user')! as AuthUser
  const tokens = await db.select().from(pushTokens).where(eq(pushTokens.userId, user.id))
  return c.json({ tokens, count: tokens.length })
})

export const notificationsRoute = app
