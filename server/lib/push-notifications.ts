import { db } from './db/index.js'
import { pushTokens } from './db/schema.js'
import { eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'

// Apple Push Notification Service (APNs) HTTP/2 client
// In production, use @parse/node-apn or similar library
// For now, this provides the hook points that trigger from the SSE event bridge

export interface PushPayload {
  title: string
  body: string
  badge?: number
  sound?: string
  data?: Record<string, string>
  category?: string
}

type EventType = 'judgmentRequired' | 'taskFailed' | 'taskCompleted' | 'machineDisconnected' | 'branchUnblocked'

/**
 * Send push notification to all devices for a user
 */
export async function sendPushNotification(userId: string, eventType: EventType, payload: PushPayload) {
  // Get all registered tokens for this user
  const tokens = await db.select().from(pushTokens).where(eq(pushTokens.userId, userId))

  for (const token of tokens) {
    const prefs = token.preferences as Record<string, boolean> | null

    // Check if user has this event type enabled
    if (prefs && prefs[eventType] === false) {
      continue
    }

    try {
      await sendAPNs(token.deviceToken, payload)
    } catch (err) {
      console.error(`[push] Failed to send to ${token.deviceToken}:`, err)
      // If token is invalid, remove it
      if (isInvalidTokenError(err)) {
        await db.delete(pushTokens).where(eq(pushTokens.id, token.id))
        console.log(`[push] Removed invalid token ${token.deviceToken}`)
      }
    }
  }
}

/**
 * Generate APNs JWT token for authentication
 * Uses ES256 algorithm with .p8 private key
 */
function generateAPNsToken(keyId: string, teamId: string, authKey: string): string {
  const now = Math.floor(Date.now() / 1000)

  return jwt.sign(
    {
      iss: teamId,
      iat: now,
    },
    authKey,
    {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: keyId,
      },
    }
  )
}

// Cache APNs token (valid for 1 hour)
let cachedToken: { token: string; expiresAt: number } | null = null

/**
 * Send notification via Apple APNs HTTP/2 API
 * Requires APNs auth key (.p8 file content) in APNS_AUTH_KEY env var
 */
async function sendAPNs(deviceToken: string, payload: PushPayload) {
  const apnsHost = process.env.APNS_HOST || 'https://api.sandbox.push.apple.com'
  const teamId = process.env.APNS_TEAM_ID
  const keyId = process.env.APNS_KEY_ID
  const authKey = process.env.APNS_AUTH_KEY // .p8 file content
  const bundleId = process.env.APNS_BUNDLE_ID || 'com.astro.app'

  if (!teamId || !keyId || !authKey) {
    console.warn('[push] APNs not configured (missing APNS_TEAM_ID/APNS_KEY_ID/APNS_AUTH_KEY), skipping notification')
    return
  }

  // Generate or reuse cached JWT token
  const now = Date.now()
  if (!cachedToken || cachedToken.expiresAt < now) {
    const token = generateAPNsToken(keyId, teamId, authKey)
    cachedToken = {
      token,
      expiresAt: now + 55 * 60 * 1000, // Cache for 55 minutes (tokens valid for 60 min)
    }
  }

  const apnsPayload = {
    aps: {
      alert: {
        title: payload.title,
        body: payload.body,
      },
      badge: payload.badge ?? 1,
      sound: payload.sound ?? 'default',
      'mutable-content': 1,
      category: payload.category,
    },
    ...payload.data,
  }

  const url = `${apnsHost}/3/device/${deviceToken}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'authorization': `bearer ${cachedToken.token}`,
    },
    body: JSON.stringify(apnsPayload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`APNs HTTP ${response.status}: ${body}`)
  }
}

function isInvalidTokenError(err: unknown): boolean {
  return err instanceof Error && (
    err.message.includes('BadDeviceToken') ||
    err.message.includes('Unregistered') ||
    err.message.includes('410')
  )
}

// MARK: - Event-triggered notifications

/**
 * Hook into the SSE event bridge to trigger push notifications
 * Call this from server/routes/events.ts when events are emitted
 */
export function shouldNotify(eventType: string): { pushType: EventType; builder: (data: Record<string, unknown>) => PushPayload } | null {
  switch (eventType) {
    case 'task:result': {
      return {
        pushType: 'taskCompleted',
        builder: (data) => {
          const status = data.status as string
          const isFailure = status === 'failure'
          return {
            // Generic notification messages to avoid leaking task details
            title: isFailure ? 'Task Failed' : 'Task Completed',
            body: isFailure ? 'A task has failed' : 'A task has completed successfully',
            // Sensitive data (task IDs, project IDs) remain in encrypted data payload only
            data: {
              type: 'task_result',
              nodeId: data.nodeId as string || '',
              projectId: data.projectId as string || '',
              deepLink: `/project/${data.projectId}/task/${data.nodeId}`,
            },
            category: isFailure ? 'TASK_FAILED' : 'TASK_COMPLETED',
          }
        },
      }
    }

    case 'machine:disconnected': {
      return {
        pushType: 'machineDisconnected',
        builder: (data) => ({
          title: 'Machine Disconnected',
          body: 'An environment went offline',
          // Machine ID remains in encrypted data payload only
          data: {
            type: 'machine_disconnected',
            machineId: data.machineId as string || '',
            deepLink: '/environments',
          },
        }),
      }
    }

    default:
      return null
  }
}
