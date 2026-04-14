/**
 * Channel Config Manager
 *
 * Loads channel plugin configurations from the database with caching.
 * Falls back to environment variables for backward compatibility.
 */

import { db } from '../db/index.js'
import { connectedAccounts } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import type { UserChannelConfig, ChannelType } from './channel-types.js'
import { isLocalMode } from '../app-mode.js'

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const CACHE_TTL_MS = 60_000 // 60 seconds

class ChannelConfigManager {
  private cache = new Map<string, CacheEntry<unknown>>()

  /** Get all enabled configs for a channel type */
  async getConfigsForChannel(channel: ChannelType): Promise<UserChannelConfig[]> {
    const cacheKey = `channel:${channel}`
    const cached = this.getFromCache<UserChannelConfig[]>(cacheKey)
    if (cached) return cached

    // Try DB first
    const dbConfigs = await this.loadFromDB(channel)
    if (dbConfigs.length > 0) {
      this.setCache(cacheKey, dbConfigs)
      return dbConfigs
    }

    // Fall back to env vars
    const envConfig = this.loadFromEnv(channel)
    if (envConfig) {
      this.setCache(cacheKey, [envConfig])
      return [envConfig]
    }

    return []
  }

  /** Look up a specific config by channel + external ID (for webhook routing) */
  async getConfigByExternalId(channel: ChannelType, externalId: string): Promise<UserChannelConfig | null> {
    const cacheKey = `external:${channel}:${externalId}`
    const cached = this.getFromCache<UserChannelConfig | null>(cacheKey)
    if (cached !== undefined) return cached

    // Try DB
    if (!isLocalMode()) {
      try {
        const rows = await db
          .select()
          .from(connectedAccounts)
          .where(
            and(
              eq(connectedAccounts.channel, channel),
              eq(connectedAccounts.externalId, externalId),
              eq(connectedAccounts.enabled, true)
            )
          )
          .limit(1)

        if (rows.length > 0) {
          const config = this.rowToConfig(rows[0])
          this.setCache(cacheKey, config)
          return config
        }
      } catch (err) {
        console.warn(`[channel-config] DB lookup failed for ${channel}/${externalId}:`, (err as Error).message)
      }
    }

    // Check env var configs by scanning mappings
    const envConfig = this.loadFromEnv(channel)
    if (envConfig && envConfig.externalId === externalId) {
      this.setCache(cacheKey, envConfig)
      return envConfig
    }

    // Also check if the external ID is a mapping key in the env config
    if (envConfig && envConfig.mappings[externalId]) {
      this.setCache(cacheKey, envConfig)
      return envConfig
    }

    this.setCache(cacheKey, null)
    return null
  }

  /** Get all configs for a specific user */
  async getConfigsForUser(userId: string): Promise<UserChannelConfig[]> {
    if (isLocalMode()) return []

    try {
      const rows = await db
        .select()
        .from(connectedAccounts)
        .where(eq(connectedAccounts.userId, userId))

      return rows.map((r) => this.rowToConfig(r))
    } catch (err) {
      console.warn('[channel-config] DB query failed for user configs:', (err as Error).message)
      return []
    }
  }

  /** Invalidate all cached configs (call after CRUD operations) */
  invalidateCache(): void {
    this.cache.clear()
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private async loadFromDB(channel: ChannelType): Promise<UserChannelConfig[]> {
    if (isLocalMode()) return []

    try {
      const rows = await db
        .select()
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.channel, channel),
            eq(connectedAccounts.enabled, true)
          )
        )

      return rows.map((r) => this.rowToConfig(r))
    } catch (err) {
      console.warn(`[channel-config] DB query failed for channel ${channel}:`, (err as Error).message)
      return []
    }
  }

  private rowToConfig(row: typeof connectedAccounts.$inferSelect): UserChannelConfig {
    return {
      userId: row.userId,
      accountId: row.id,
      channel: row.channel as ChannelType,
      credentials: row.credentials as Record<string, unknown>,
      mappings: (row.mappings || {}) as Record<string, string>,
      settings: (row.settings || {}) as Record<string, unknown>,
      externalId: row.externalId ?? undefined,
    }
  }

  private loadFromEnv(channel: ChannelType): UserChannelConfig | null {
    switch (channel) {
      case 'slack': {
        const botToken = process.env.SLACK_BOT_TOKEN
        const signingSecret = process.env.SLACK_SIGNING_SECRET
        const mappingsJson = process.env.SLACK_CHANNEL_MAPPINGS
        if (!botToken || !signingSecret) return null
        let channelMappings: Record<string, string> = {}
        try { if (mappingsJson) channelMappings = JSON.parse(mappingsJson) } catch { /* ignore */ }
        return {
          userId: 'env',
          accountId: 'env-slack',
          channel: 'slack',
          credentials: { botToken, signingSecret },
          mappings: channelMappings,
          settings: {},
        }
      }
      case 'telegram': {
        const botToken = process.env.TELEGRAM_BOT_TOKEN
        const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
        const mappingsJson = process.env.TELEGRAM_CHAT_MAPPINGS
        if (!botToken) return null
        let chatMappings: Record<string, string> = {}
        try { if (mappingsJson) chatMappings = JSON.parse(mappingsJson) } catch { /* ignore */ }
        const credentials: Record<string, unknown> = { botToken }
        if (webhookSecret) credentials.webhookSecret = webhookSecret
        // Parse advanced telegram config from env vars (optional, all forward-compat)
        const settings: Record<string, unknown> = {}
        const allowlistRaw = process.env.TELEGRAM_ALLOWED_USERS
        if (allowlistRaw) {
          settings.allowlistUsers = allowlistRaw.split(',').map((s) => s.trim()).filter(Boolean)
        }
        const mentionRaw = process.env.TELEGRAM_MENTION_PATTERNS
        if (mentionRaw) {
          try {
            const parsed = JSON.parse(mentionRaw)
            if (Array.isArray(parsed)) settings.mentionPatterns = parsed.map(String)
          } catch {
            settings.mentionPatterns = mentionRaw.split(',').map((s) => s.trim()).filter(Boolean)
          }
        }
        if (process.env.TELEGRAM_REQUIRE_MENTION !== undefined) {
          settings.requireMention = process.env.TELEGRAM_REQUIRE_MENTION !== 'false'
        }
        return {
          userId: 'env',
          accountId: 'env-telegram',
          channel: 'telegram',
          credentials,
          mappings: chatMappings,
          settings,
        }
      }
      case 'github': {
        const webhookSecret = process.env.GITHUB_CHANNEL_WEBHOOK_SECRET
        const authToken = process.env.GITHUB_CHANNEL_AUTH_TOKEN
        if (!webhookSecret || !authToken) return null
        let repoMappings: Record<string, string> = {}
        try { const raw = process.env.GITHUB_REPO_MAPPINGS; if (raw) repoMappings = JSON.parse(raw) } catch { /* ignore */ }
        return {
          userId: 'env',
          accountId: 'env-github',
          channel: 'github',
          credentials: { webhookSecret, authToken },
          mappings: repoMappings,
          settings: { enabledEvents: ['issues', 'issue_comment', 'pull_request', 'push', 'check_run'], autoCreateTasks: true },
        }
      }
      case 'linear': {
        const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET
        const apiToken = process.env.LINEAR_API_TOKEN
        if (!webhookSecret || !apiToken) return null
        let teamMappings: Record<string, string> = {}
        try { const raw = process.env.LINEAR_TEAM_MAPPINGS; if (raw) teamMappings = JSON.parse(raw) } catch { /* ignore */ }
        return {
          userId: 'env',
          accountId: 'env-linear',
          channel: 'linear',
          credentials: { webhookSecret, apiToken },
          mappings: teamMappings,
          settings: { autoSyncIssues: process.env.LINEAR_AUTO_SYNC_ISSUES !== 'false' },
        }
      }
      case 'openclaw': {
        const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL
        const apiKey = process.env.OPENCLAW_API_KEY
        if (!gatewayUrl || !apiKey) return null
        let channelMappings: Record<string, string> = {}
        try { const raw = process.env.OPENCLAW_CHANNEL_MAPPINGS; if (raw) channelMappings = JSON.parse(raw) } catch { /* ignore */ }
        return {
          userId: 'env',
          accountId: 'env-openclaw',
          channel: 'openclaw',
          credentials: { gatewayUrl, apiKey },
          mappings: channelMappings,
          settings: {},
        }
      }
      default:
        return null
    }
  }

  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry.data
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  }
}

export const channelConfigManager = new ChannelConfigManager()
