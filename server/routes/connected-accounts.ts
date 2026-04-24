/**
 * Connected Accounts CRUD API
 *
 * Manages per-user channel configurations (Slack, Telegram, GitHub Webhooks, Linear).
 * Credentials are stored encrypted in JSONB and only returned masked to the client.
 */

import { Hono } from 'hono'
import { db } from '../lib/db/index.js'
import { connectedAccounts } from '../lib/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth.js'
import { channelConfigManager } from '../lib/channel/channel-config-manager.js'
import { encryptJsonb, readCredentials } from '../lib/encryption.js'

const app = new Hono()

app.use('/*', requireAuth)

// ── Helpers ──────────────────────────────────────────────────────────

function maskValue(value: string): string {
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function maskCredentials(creds: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(creds)) {
    masked[key] = typeof val === 'string' ? maskValue(val) : val
  }
  return masked
}

type ChannelType = 'slack' | 'telegram' | 'github_webhook' | 'linear' | 'openclaw' | 'aws' | 'gcp' | 'daytona' | 'runloop'

const VALID_CHANNELS: ChannelType[] = ['slack', 'telegram', 'github_webhook', 'linear', 'openclaw', 'aws', 'gcp', 'daytona', 'runloop']

const REQUIRED_FIELDS: Record<ChannelType, string[]> = {
  slack: ['botToken', 'signingSecret'],
  telegram: ['botToken'],
  github_webhook: ['authToken', 'webhookSecret'],
  linear: ['apiToken', 'webhookSecret'],
  openclaw: ['gatewayUrl'],
  aws: ['accessKeyId', 'secretAccessKey'],
  gcp: ['serviceAccountJson'],
  daytona: ['apiKey'],
  runloop: ['apiKey'],
}

// ── Routes ──────────────────────────────────────────────────────────

/** GET / — List user's connected accounts (credentials masked) */
app.get('/', async (c) => {
  const userId = c.get('user')!.id

  const rows = await db
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.userId, userId))

  const result = rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    label: row.label,
    maskedCredentials: maskCredentials(readCredentials(row.credentials)),
    mappings: row.mappings,
    settings: row.settings,
    externalId: row.externalId,
    enabled: row.enabled,
    connectedAt: row.connectedAt.toISOString(),
  }))

  return c.json(result)
})

/** POST / — Add a new connected account */
app.post('/', async (c) => {
  const userId = c.get('user')!.id
  const body = await c.req.json()

  const { channel, label, credentials, mappings, settings } = body as {
    channel: string
    label?: string
    credentials: Record<string, string>
    mappings?: Record<string, string>
    settings?: Record<string, unknown>
  }

  // Validate channel type
  if (!VALID_CHANNELS.includes(channel as ChannelType)) {
    return c.json({ error: `Invalid channel type. Must be one of: ${VALID_CHANNELS.join(', ')}` }, 400)
  }

  // Validate required credential fields
  const required = REQUIRED_FIELDS[channel as ChannelType]
  const missing = required.filter((f) => !credentials[f])
  if (missing.length > 0) {
    return c.json({ error: `Missing required credential fields: ${missing.join(', ')}` }, 400)
  }

  // Determine external_id based on channel type
  const externalId: string | null = null
  // For now, external_id is set manually or derived later

  const [row] = await db
    .insert(connectedAccounts)
    .values({
      userId,
      channel,
      label: label || '',
      credentials: encryptJsonb(credentials),
      mappings: mappings || {},
      settings: settings || {},
      externalId,
    })
    .returning()

  channelConfigManager.invalidateCache()

  return c.json({
    id: row.id,
    channel: row.channel,
    label: row.label,
    maskedCredentials: maskCredentials(readCredentials(row.credentials)),
    mappings: row.mappings,
    settings: row.settings,
    externalId: row.externalId,
    enabled: row.enabled,
    connectedAt: row.connectedAt.toISOString(),
  }, 201)
})

/** PUT /:id — Update account (mappings, settings, label, enabled) */
app.put('/:id', async (c) => {
  const userId = c.get('user')!.id
  const id = c.req.param('id')
  const body = await c.req.json()

  const { label, mappings, settings, enabled } = body as {
    label?: string
    mappings?: Record<string, string>
    settings?: Record<string, unknown>
    enabled?: boolean
  }

  // Build update object
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (label !== undefined) updates.label = label
  if (mappings !== undefined) updates.mappings = mappings
  if (settings !== undefined) updates.settings = settings
  if (enabled !== undefined) updates.enabled = enabled

  const [row] = await db
    .update(connectedAccounts)
    .set(updates)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.userId, userId)))
    .returning()

  if (!row) {
    return c.json({ error: 'Account not found' }, 404)
  }

  channelConfigManager.invalidateCache()

  return c.json({
    id: row.id,
    channel: row.channel,
    label: row.label,
    maskedCredentials: maskCredentials(readCredentials(row.credentials)),
    mappings: row.mappings,
    settings: row.settings,
    externalId: row.externalId,
    enabled: row.enabled,
    connectedAt: row.connectedAt.toISOString(),
  })
})

/** DELETE /:id — Remove account */
app.delete('/:id', async (c) => {
  const userId = c.get('user')!.id
  const id = c.req.param('id')

  const [row] = await db
    .delete(connectedAccounts)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.userId, userId)))
    .returning()

  if (!row) {
    return c.json({ error: 'Account not found' }, 404)
  }

  channelConfigManager.invalidateCache()

  return c.json({ success: true })
})

/** POST /:id/test — Test connection */
app.post('/:id/test', async (c) => {
  const userId = c.get('user')!.id
  const id = c.req.param('id')

  const [row] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.userId, userId)))
    .limit(1)

  if (!row) {
    return c.json({ error: 'Account not found' }, 404)
  }

  const creds = readCredentials(row.credentials) as Record<string, string>
  const channel = row.channel as ChannelType

  try {
    switch (channel) {
      case 'slack': {
        const res = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${creds.botToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
        const data = await res.json() as { ok: boolean; team?: string; error?: string }
        if (data.ok) {
          // Update external_id with team ID
          if (data.team) {
            await db
              .update(connectedAccounts)
              .set({ externalId: data.team, updatedAt: new Date() })
              .where(eq(connectedAccounts.id, id))
            channelConfigManager.invalidateCache()
          }
          return c.json({ success: true, message: `Connected to Slack workspace: ${data.team || 'unknown'}`, details: data })
        }
        return c.json({ success: false, message: `Slack auth failed: ${data.error || 'unknown error'}` })
      }

      case 'telegram': {
        const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/getMe`)
        const data = await res.json() as { ok: boolean; result?: { username?: string }; description?: string }
        if (data.ok) {
          if (data.result?.username) {
            await db
              .update(connectedAccounts)
              .set({ externalId: data.result.username, updatedAt: new Date() })
              .where(eq(connectedAccounts.id, id))
            channelConfigManager.invalidateCache()
          }
          return c.json({ success: true, message: `Connected to Telegram bot: @${data.result?.username || 'unknown'}`, details: data.result })
        }
        return c.json({ success: false, message: `Telegram auth failed: ${data.description || 'unknown error'}` })
      }

      case 'github_webhook': {
        const res = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `Bearer ${creds.authToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Astro-App',
          },
        })
        if (res.ok) {
          const data = await res.json() as { login?: string }
          return c.json({ success: true, message: `Authenticated as GitHub user: ${data.login || 'unknown'}`, details: data })
        }
        return c.json({ success: false, message: `GitHub auth failed: ${res.status} ${res.statusText}` })
      }

      case 'linear': {
        const res = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Authorization': creds.apiToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: '{ viewer { id name } }' }),
        })
        if (res.ok) {
          const data = await res.json() as { data?: { viewer?: { name?: string } } }
          if (data.data?.viewer) {
            return c.json({ success: true, message: `Connected to Linear as: ${data.data.viewer.name || 'unknown'}`, details: data.data.viewer })
          }
        }
        return c.json({ success: false, message: 'Linear auth failed' })
      }

      case 'openclaw': {
        // Test gateway reachability by connecting via WebSocket and waiting for challenge
        const gatewayUrl = creds.gatewayUrl
        const { createRequire } = await import('node:module')
        const esmRequire = createRequire(import.meta.url)
        const WebSocket = esmRequire('ws') as typeof import('ws').default
        const result = await new Promise<{ success: boolean; message: string }>((resolve) => {
          const timeout = setTimeout(() => {
            ws.close()
            resolve({ success: false, message: 'Gateway connection timed out (5s)' })
          }, 5_000)
          let ws: InstanceType<typeof WebSocket>
          try {
            ws = new WebSocket(gatewayUrl)
          } catch (err) {
            clearTimeout(timeout)
            resolve({ success: false, message: `Failed to connect: ${(err as Error).message}` })
            return
          }
          ws.on('message', (data: unknown) => {
            try {
              const frame = JSON.parse(String(data)) as { type?: string; event?: string }
              if (frame.type === 'event' && frame.event === 'connect.challenge') {
                clearTimeout(timeout)
                ws.close()
                resolve({ success: true, message: `Gateway reachable at ${gatewayUrl} (protocol v3)` })
              }
            } catch { /* ignore non-JSON */ }
          })
          ws.on('error', (err: Error) => {
            clearTimeout(timeout)
            ws.close()
            resolve({ success: false, message: `WebSocket error: ${err.message}` })
          })
          ws.on('close', () => {
            clearTimeout(timeout)
          })
        })
        return c.json(result)
      }

      default:
        return c.json({ success: false, message: `Unknown channel type: ${channel}` })
    }
  } catch (err) {
    return c.json({ success: false, message: `Connection test error: ${(err as Error).message}` })
  }
})

export const connectedAccountsRoute = app
