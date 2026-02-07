/**
 * Notification System Types
 *
 * Defines the notification event types, channel interface, and preferences
 * for the multi-transport notification system.
 */

// ============================================================================
// Notification Event Types
// ============================================================================

/** All notification event types */
export type NotificationEventType =
  // Task events
  | 'task:result'
  | 'task:stdout'
  | 'task:progress'
  | 'task:steer_ack'
  | 'task:tool_trace'
  | 'task:file_change'
  // Machine events
  | 'machine:connected'
  | 'machine:disconnected'
  | 'machine:status'
  // Session events (MCP bridge)
  | 'session:attached'
  | 'session:detached'
  | 'session:event'
  // System events
  | 'system:error'
  | 'system:warning'

/** Priority levels for notifications */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

/** Base notification event structure */
export interface NotificationEvent {
  id: string
  type: NotificationEventType
  timestamp: Date
  priority: NotificationPriority
  data: unknown
  // Optional targeting
  userId?: string
  projectId?: string
  taskId?: string
  machineId?: string
}

/** Task result notification */
export interface TaskResultNotification extends NotificationEvent {
  type: 'task:result'
  data: {
    taskId: string
    status: string
    output?: string
    error?: string
    duration?: number
  }
}

/** Task progress notification */
export interface TaskProgressNotification extends NotificationEvent {
  type: 'task:progress'
  data: {
    taskId: string
    progress: number
    message?: string
  }
}

/** Machine connected notification */
export interface MachineConnectedNotification extends NotificationEvent {
  type: 'machine:connected'
  data: {
    machineId: string
    name: string
    environmentType: string
    providers: Array<{ type: string; status: string }>
  }
}

/** Machine disconnected notification */
export interface MachineDisconnectedNotification extends NotificationEvent {
  type: 'machine:disconnected'
  data: {
    machineId: string
    reason?: string
  }
}

// ============================================================================
// Notification Channel Interface
// ============================================================================

/** Channel status */
export type ChannelStatus = 'active' | 'inactive' | 'error'

/** Channel statistics */
export interface ChannelStats {
  eventsSent: number
  eventsDropped: number
  lastEventAt?: Date
  errors: number
}

/**
 * NotificationChannel interface
 *
 * Implement this interface to add a new notification transport
 * (e.g., SSE, WebSocket, Push, Email, Slack)
 */
export interface NotificationChannel {
  /** Unique channel identifier */
  readonly id: string

  /** Human-readable channel name */
  readonly name: string

  /** Current channel status */
  readonly status: ChannelStatus

  /** Channel statistics */
  readonly stats: ChannelStats

  /**
   * Check if this channel should handle the event
   * Used for filtering based on event type, user preferences, etc.
   */
  accepts(event: NotificationEvent): boolean

  /**
   * Send the notification event through this channel
   * Should handle errors gracefully and update stats
   */
  send(event: NotificationEvent): Promise<void>

  /**
   * Start the channel (connect, initialize resources)
   */
  start(): Promise<void>

  /**
   * Stop the channel (disconnect, cleanup resources)
   */
  stop(): Promise<void>
}

// ============================================================================
// Notification Preferences
// ============================================================================

/** User notification preferences */
export interface NotificationPreferences {
  userId: string

  /** Which event types to receive */
  enabledEvents: NotificationEventType[]

  /** Minimum priority to notify */
  minPriority: NotificationPriority

  /** Per-channel settings */
  channels: {
    sse?: { enabled: boolean }
    websocket?: { enabled: boolean }
    push?: {
      enabled: boolean
      deviceTokens: string[]
    }
  }

  /** Quiet hours (don't send push notifications) */
  quietHours?: {
    enabled: boolean
    startHour: number  // 0-23
    endHour: number    // 0-23
    timezone: string
  }

  /** Per-project overrides */
  projectOverrides?: Record<string, Partial<NotificationPreferences>>
}

/** Default preferences for new users */
export const DEFAULT_NOTIFICATION_PREFERENCES: Omit<NotificationPreferences, 'userId'> = {
  enabledEvents: [
    'task:result',
    'task:progress',
    'machine:connected',
    'machine:disconnected',
    'system:error',
  ],
  minPriority: 'normal',
  channels: {
    sse: { enabled: true },
    websocket: { enabled: true },
    push: { enabled: false, deviceTokens: [] },
  },
}

// ============================================================================
// Device Registration (for push notifications)
// ============================================================================

/** Push notification platform */
export type PushPlatform = 'ios' | 'macos' | 'android' | 'web'

/** Device registration for push notifications */
export interface DeviceRegistration {
  deviceId: string
  userId: string
  platform: PushPlatform
  token: string  // APNS token, FCM token, or web push subscription
  name?: string  // User-friendly device name
  registeredAt: Date
  lastActiveAt: Date
}
