/**
 * Channel Integration Types
 *
 * Shared types for messaging platform integrations (Slack, Telegram, GitHub, Linear).
 * Chat-based channels (Slack, Telegram) route messages through the agent chat system.
 * Event-based channels (GitHub, Linear) react to webhook events by updating plan nodes.
 */

// ---------------------------------------------------------------------------
// Inbound messages (chat channels → Astro)
// ---------------------------------------------------------------------------

/** Normalized message from any chat channel */
export interface InboundMessage {
  /** Unique ID of the source message (e.g., Slack ts, Telegram message_id) */
  sourceMessageId: string
  /** Which channel this came from */
  channel: ChannelType
  /** Message text content */
  text: string
  /** Sender info */
  sender: ChannelSender
  /** Enough info to reply back to the same conversation */
  conversationRef: ConversationRef
  /** Mapped Astro project ID (resolved from channel config) */
  projectId: string
}

export interface ChannelSender {
  id: string
  name: string
  avatarUrl?: string
}

/** Enough info to reply back to a specific conversation */
export interface ConversationRef {
  channelId: string
  threadId?: string
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Outbound responses (Astro → chat channels)
// ---------------------------------------------------------------------------

export interface OutboundResponse {
  text: string
  conversationRef: ConversationRef
}

// ---------------------------------------------------------------------------
// Webhook events (event-based channels → Astro)
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  /** Normalized event type (e.g., "issues.opened", "Issue.create") */
  eventType: string
  /** Action within the event (e.g., "opened", "closed", "merged") */
  action: string
  /** Raw event payload */
  data: Record<string, unknown>
  /** Mapped Astro project ID */
  projectId: string
  /** Source channel */
  channel: ChannelType
}

// ---------------------------------------------------------------------------
// Notifications (Astro → all channels)
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'task.completed'
  | 'task.failed'
  | 'approval.requested'
  | 'branch.pruned'
  | 'project.completed'

export interface ChannelNotification {
  type: NotificationType
  projectId: string
  /** Human-readable summary of what happened */
  summary: string
  /** Link back to the relevant Astro page */
  astroUrl: string
  /** Additional metadata for channel-specific formatting */
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Channel types and format
// ---------------------------------------------------------------------------

export type ChannelType = 'slack' | 'telegram' | 'github' | 'linear' | 'openclaw' | 'zotero'
export type ChannelFormat = 'slack_mrkdwn' | 'telegram_html' | 'github_gfm' | 'linear_markdown' | 'openclaw'

// ---------------------------------------------------------------------------
// Channel plugin configs
// ---------------------------------------------------------------------------

export interface SlackChannelConfig {
  botToken: string
  signingSecret: string
  /** Map of Slack channel ID → Astro project ID */
  channelMappings: Record<string, string>
}

export interface TelegramChannelConfig {
  botToken: string
  webhookSecret?: string
  /** Map of Telegram chat ID → Astro project ID */
  chatMappings: Record<string, string>
}

export interface GitHubChannelConfig {
  webhookSecret: string
  authToken: string
  /** Map of "owner/repo" → Astro project ID */
  repoMappings: Record<string, string>
  enabledEvents: string[]
  autoCreateTasks: boolean
}

export interface LinearChannelConfig {
  webhookSecret: string
  apiToken: string
  /** Map of Linear team ID → Astro project ID */
  teamMappings: Record<string, string>
  autoSyncIssues: boolean
}

export interface OpenClawChannelConfig {
  /** WebSocket gateway URL (e.g., ws://localhost:4000 or wss://gateway.openclaw.dev) */
  gatewayUrl: string
  /** API key for authenticating with the OpenClaw gateway */
  apiKey: string
  /** Map of OpenClaw channel ID → Astro project ID */
  channelMappings: Record<string, string>
}

// ---------------------------------------------------------------------------
// Channel router interface
// ---------------------------------------------------------------------------

export type ResponseSenderFn = (response: OutboundResponse) => Promise<void>
export type NotificationSenderFn = (notification: ChannelNotification) => Promise<void>

export interface ChannelRouter {
  /** Route an inbound chat message to the agent and return a response */
  routeMessage(message: InboundMessage): Promise<OutboundResponse>
  /** Send a notification to all registered channels for a project */
  sendNotification(notification: ChannelNotification): Promise<void>
  /** Register a function that can send responses for a given channel */
  registerResponseSender(channel: ChannelType, fn: ResponseSenderFn): void
  /** Register a function that can send notifications for a given project on a channel */
  registerNotificationSender(projectId: string, channel: ChannelType, fn: NotificationSenderFn): void
  /** Register a global notification sender that fires for ALL projects (e.g., OpenClaw) */
  registerGlobalNotificationSender(channel: ChannelType, fn: NotificationSenderFn): void
}

// ---------------------------------------------------------------------------
// Per-user channel config (loaded from DB)
// ---------------------------------------------------------------------------

export interface UserChannelConfig {
  userId: string
  accountId: string
  channel: ChannelType
  credentials: Record<string, unknown>
  mappings: Record<string, string>
  settings: Record<string, unknown>
  externalId?: string
}
