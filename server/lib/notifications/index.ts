/**
 * Notification System
 *
 * Multi-transport notification system with channel abstraction.
 * Supports SSE (browsers), WebSocket (native apps), and Push (background).
 */

// Types
export type {
  NotificationEventType,
  NotificationPriority,
  NotificationEvent,
  NotificationChannel,
  NotificationPreferences,
  ChannelStatus,
  ChannelStats,
  DeviceRegistration,
  PushPlatform,
} from './types.js'
export { DEFAULT_NOTIFICATION_PREFERENCES } from './types.js'

// Hub
export { NotificationHub, notificationHub } from './hub.js'
export type { NotificationHubEvents, HubStats } from './hub.js'

// Channels
export {
  SSEChannel,
  sseChannel,
  WebSocketChannel,
  createWebSocketChannel,
  PushChannel,
  createPushChannel,
} from './channels/index.js'
export type { WebSocketChannelConfig, PushChannelConfig } from './channels/index.js'
