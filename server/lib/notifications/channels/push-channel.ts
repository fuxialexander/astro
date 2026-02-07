/**
 * Push Notification Channel
 *
 * Sends push notifications to iOS/macOS (APNS) and Android (FCM) devices.
 * This is a stub implementation - full implementation requires:
 * - Apple Push Notification Service (APNS) credentials
 * - Firebase Cloud Messaging (FCM) credentials
 */

import type {
  NotificationChannel,
  NotificationEvent,
  NotificationEventType,
  NotificationPriority,
  ChannelStatus,
  ChannelStats,
  DeviceRegistration,
  PushPlatform,
} from '../types.js'

// ============================================================================
// Push Configuration
// ============================================================================

export interface PushChannelConfig {
  /** Apple Push Notification Service configuration */
  apns?: {
    keyId: string
    teamId: string
    bundleId: string
    keyPath: string  // Path to .p8 key file
    production?: boolean
  }
  /** Firebase Cloud Messaging configuration */
  fcm?: {
    projectId: string
    serviceAccountPath: string  // Path to service account JSON
  }
  /** Events that trigger push notifications (high priority only by default) */
  pushableEvents?: NotificationEventType[]
  /** Minimum priority for push notifications */
  minPriority?: NotificationPriority
}

const DEFAULT_PUSHABLE_EVENTS: NotificationEventType[] = [
  'task:result',
  'machine:disconnected',
  'system:error',
]

const PRIORITY_ORDER: NotificationPriority[] = ['low', 'normal', 'high', 'urgent']

// ============================================================================
// Push Channel Implementation
// ============================================================================

export class PushChannel implements NotificationChannel {
  readonly id = 'push'
  readonly name = 'Push Notifications'

  private config: PushChannelConfig
  private devices: Map<string, DeviceRegistration> = new Map()
  private pushableEvents: Set<NotificationEventType>
  private minPriorityIndex: number
  private _status: ChannelStatus = 'inactive'
  private _stats: ChannelStats = {
    eventsSent: 0,
    eventsDropped: 0,
    errors: 0,
  }

  constructor(config: PushChannelConfig = {}) {
    this.config = config
    this.pushableEvents = new Set(config.pushableEvents || DEFAULT_PUSHABLE_EVENTS)
    this.minPriorityIndex = PRIORITY_ORDER.indexOf(config.minPriority || 'high')
  }

  get status(): ChannelStatus {
    return this._status
  }

  get stats(): ChannelStats {
    return { ...this._stats }
  }

  /**
   * Register a device for push notifications
   */
  registerDevice(registration: DeviceRegistration): void {
    this.devices.set(registration.deviceId, registration)
    console.log(`[PushChannel] Device registered: ${registration.deviceId} (${registration.platform})`)
  }

  /**
   * Unregister a device
   */
  unregisterDevice(deviceId: string): boolean {
    const removed = this.devices.delete(deviceId)
    if (removed) {
      console.log(`[PushChannel] Device unregistered: ${deviceId}`)
    }
    return removed
  }

  /**
   * Get devices for a user
   */
  getDevicesForUser(userId: string): DeviceRegistration[] {
    return Array.from(this.devices.values()).filter(d => d.userId === userId)
  }

  /**
   * Get device count by platform
   */
  getDevicesByPlatform(): Record<PushPlatform, number> {
    const counts: Record<string, number> = { ios: 0, macos: 0, android: 0, web: 0 }
    for (const device of this.devices.values()) {
      counts[device.platform] = (counts[device.platform] || 0) + 1
    }
    return counts as Record<PushPlatform, number>
  }

  /**
   * Check if channel accepts this event
   */
  accepts(event: NotificationEvent): boolean {
    // Only push specific event types
    if (!this.pushableEvents.has(event.type)) {
      return false
    }

    // Check priority threshold
    const eventPriorityIndex = PRIORITY_ORDER.indexOf(event.priority)
    if (eventPriorityIndex < this.minPriorityIndex) {
      return false
    }

    // Only process if we have devices
    if (this.devices.size === 0) {
      return false
    }

    return true
  }

  /**
   * Send push notification to matching devices
   */
  async send(event: NotificationEvent): Promise<void> {
    // Find target devices
    const targetDevices = this.findTargetDevices(event)

    if (targetDevices.length === 0) {
      this._stats.eventsDropped++
      return
    }

    // Build notification payload
    const payload = this.buildPayload(event)

    // Send to each device based on platform
    const results = await Promise.allSettled(
      targetDevices.map(device => this.sendToDevice(device, payload))
    )

    // Count results
    let sentCount = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        sentCount++
      } else {
        this._stats.errors++
        console.error('[PushChannel] Send failed:', result.reason)
      }
    }

    this._stats.eventsSent += sentCount
    this._stats.lastEventAt = new Date()
  }

  /**
   * Start the push channel
   */
  async start(): Promise<void> {
    // Validate configuration
    const hasAPNS = !!this.config.apns
    const hasFCM = !!this.config.fcm

    if (!hasAPNS && !hasFCM) {
      console.warn('[PushChannel] No APNS or FCM configuration provided - running in stub mode')
      this._status = 'active'
      return
    }

    // TODO: Initialize APNS client
    if (hasAPNS) {
      console.log('[PushChannel] APNS configured (not yet implemented)')
    }

    // TODO: Initialize FCM client
    if (hasFCM) {
      console.log('[PushChannel] FCM configured (not yet implemented)')
    }

    this._status = 'active'
    console.log('[PushChannel] Started')
  }

  /**
   * Stop the push channel
   */
  async stop(): Promise<void> {
    // TODO: Cleanup APNS/FCM clients
    this._status = 'inactive'
    console.log('[PushChannel] Stopped')
  }

  /**
   * Find devices that should receive this notification
   */
  private findTargetDevices(event: NotificationEvent): DeviceRegistration[] {
    return Array.from(this.devices.values()).filter(device => {
      // Filter by user if specified
      if (event.userId && device.userId !== event.userId) {
        return false
      }
      return true
    })
  }

  /**
   * Build push notification payload
   */
  private buildPayload(event: NotificationEvent): PushPayload {
    const data = event.data as Record<string, unknown>

    // Build title and body based on event type
    let title: string
    let body: string

    switch (event.type) {
      case 'task:result': {
        const status = data.status as string
        const taskId = data.taskId as string
        title = status === 'completed' ? 'Task Completed' : 'Task Failed'
        body = `Task ${taskId} ${status === 'completed' ? 'completed successfully' : 'failed'}`
        if (data.error) {
          body += `: ${data.error}`
        }
        break
      }

      case 'machine:disconnected':
        title = 'Machine Disconnected'
        body = `Machine ${data.machineId} disconnected`
        if (data.reason) {
          body += `: ${data.reason}`
        }
        break

      case 'system:error':
        title = 'System Error'
        body = (data.message as string) || 'An error occurred'
        break

      default:
        title = 'Nexus Notification'
        body = `${event.type}: ${JSON.stringify(data).slice(0, 100)}`
    }

    return {
      title,
      body,
      data: {
        eventId: event.id,
        eventType: event.type,
        taskId: event.taskId,
        projectId: event.projectId,
      },
      priority: event.priority === 'urgent' ? 'high' : 'normal',
    }
  }

  /**
   * Send notification to a specific device
   */
  private async sendToDevice(device: DeviceRegistration, payload: PushPayload): Promise<void> {
    switch (device.platform) {
      case 'ios':
      case 'macos':
        await this.sendAPNS(device, payload)
        break
      case 'android':
        await this.sendFCM(device, payload)
        break
      case 'web':
        await this.sendWebPush(device, payload)
        break
      default:
        throw new Error(`Unknown platform: ${device.platform}`)
    }
  }

  /**
   * Send via Apple Push Notification Service
   * TODO: Implement with @parse/node-apn or similar
   */
  private async sendAPNS(device: DeviceRegistration, payload: PushPayload): Promise<void> {
    if (!this.config.apns) {
      console.log(`[PushChannel] APNS stub: Would send to ${device.deviceId}:`, payload.title)
      return
    }

    // TODO: Real APNS implementation
    // const notification = new apn.Notification()
    // notification.alert = { title: payload.title, body: payload.body }
    // notification.payload = payload.data
    // notification.topic = this.config.apns.bundleId
    // await apnProvider.send(notification, device.token)

    throw new Error('APNS not implemented')
  }

  /**
   * Send via Firebase Cloud Messaging
   * TODO: Implement with firebase-admin
   */
  private async sendFCM(device: DeviceRegistration, payload: PushPayload): Promise<void> {
    if (!this.config.fcm) {
      console.log(`[PushChannel] FCM stub: Would send to ${device.deviceId}:`, payload.title)
      return
    }

    // TODO: Real FCM implementation
    // const message = {
    //   notification: { title: payload.title, body: payload.body },
    //   data: payload.data,
    //   token: device.token
    // }
    // await admin.messaging().send(message)

    throw new Error('FCM not implemented')
  }

  /**
   * Send via Web Push
   * TODO: Implement with web-push
   */
  private async sendWebPush(device: DeviceRegistration, payload: PushPayload): Promise<void> {
    console.log(`[PushChannel] WebPush stub: Would send to ${device.deviceId}:`, payload.title)
    // TODO: Implement with web-push library
  }
}

interface PushPayload {
  title: string
  body: string
  data: Record<string, unknown>
  priority: 'normal' | 'high'
}

// Factory function
export function createPushChannel(config?: PushChannelConfig): PushChannel {
  return new PushChannel(config)
}
