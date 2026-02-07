/**
 * NotificationHub
 *
 * Central hub for dispatching notifications to multiple channels.
 * Subscribes to relay server events and fans out to registered channels
 * with error isolation and statistics tracking.
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { RelayServer } from '../relay-server.js'
import type {
  NotificationChannel,
  NotificationEvent,
  NotificationEventType,
  NotificationPriority,
} from './types.js'
import type {
  TaskResultMessage,
  TaskStdoutMessage,
  TaskProgressMessage,
  TaskSteerAckMessage,
  TaskToolTraceMessage,
  TaskFileChangeMessage,
  SessionEvent,
} from '../../types/relay.js'

// ============================================================================
// Hub Events
// ============================================================================

export interface NotificationHubEvents {
  /** Emitted when a notification is dispatched to channels */
  'notification:dispatched': (event: NotificationEvent, channelCount: number) => void
  /** Emitted when a channel fails to send */
  'channel:error': (channelId: string, error: Error, event: NotificationEvent) => void
  /** Emitted when a channel is registered */
  'channel:registered': (channelId: string) => void
  /** Emitted when a channel is unregistered */
  'channel:unregistered': (channelId: string) => void
}

// ============================================================================
// Hub Statistics
// ============================================================================

export interface HubStats {
  totalEventsProcessed: number
  totalEventsSent: number
  totalEventsDropped: number
  channelCount: number
  startedAt: Date
  lastEventAt?: Date
}

// ============================================================================
// NotificationHub Class
// ============================================================================

export class NotificationHub extends EventEmitter {
  // Typed event methods
  override on<K extends keyof NotificationHubEvents>(
    event: K,
    listener: NotificationHubEvents[K]
  ): this {
    return super.on(event, listener)
  }

  override emit<K extends keyof NotificationHubEvents>(
    event: K,
    ...args: Parameters<NotificationHubEvents[K]>
  ): boolean {
    return super.emit(event, ...args)
  }
  private channels: Map<string, NotificationChannel> = new Map()
  private stats: HubStats
  private relayServer?: RelayServer

  constructor() {
    super()
    this.stats = {
      totalEventsProcessed: 0,
      totalEventsSent: 0,
      totalEventsDropped: 0,
      channelCount: 0,
      startedAt: new Date(),
    }
  }

  /**
   * Connect the hub to a relay server
   * Subscribes to all relevant events
   */
  connectToRelay(relayServer: RelayServer): void {
    this.relayServer = relayServer

    // Task events
    relayServer.on('task:result', (msg: TaskResultMessage) => {
      this.dispatch(this.createEvent('task:result', 'high', {
        taskId: msg.result.taskId,
        status: msg.result.status,
        output: msg.result.output,
        error: msg.result.error,
        duration: msg.result.duration,
      }, { taskId: msg.result.taskId }))
    })

    relayServer.on('task:stdout', (msg: TaskStdoutMessage) => {
      this.dispatch(this.createEvent('task:stdout', 'low', {
        taskId: msg.output.taskId,
        data: msg.output.data,
      }, { taskId: msg.output.taskId }))
    })

    relayServer.on('task:progress', (msg: TaskProgressMessage) => {
      this.dispatch(this.createEvent('task:progress', 'normal', {
        taskId: msg.taskId,
        progress: msg.progress,
        message: msg.message,
      }, { taskId: msg.taskId }))
    })

    relayServer.on('task:steer_ack', (msg: TaskSteerAckMessage) => {
      this.dispatch(this.createEvent('task:steer_ack', 'normal', {
        taskId: msg.taskId,
        accepted: msg.accepted,
        message: msg.message,
      }, { taskId: msg.taskId }))
    })

    relayServer.on('task:tool_trace', (msg: TaskToolTraceMessage) => {
      this.dispatch(this.createEvent('task:tool_trace', 'low', {
        taskId: msg.taskId,
        toolName: msg.toolName,
        toolInput: msg.toolInput,
        toolResult: msg.toolResult,
        success: msg.success,
        duration: msg.duration,
      }, { taskId: msg.taskId }))
    })

    relayServer.on('task:file_change', (msg: TaskFileChangeMessage) => {
      this.dispatch(this.createEvent('task:file_change', 'normal', {
        taskId: msg.taskId,
        path: msg.path,
        action: msg.action,
        linesAdded: msg.linesAdded,
        linesRemoved: msg.linesRemoved,
        diff: msg.diff,
      }, { taskId: msg.taskId }))
    })

    // Machine events
    relayServer.on('machine:connected', (machineId: string) => {
      this.dispatch(this.createEvent('machine:connected', 'normal', {
        machineId,
      }, { machineId }))
    })

    relayServer.on('machine:disconnected', (machineId: string, reason?: string) => {
      this.dispatch(this.createEvent('machine:disconnected', 'high', {
        machineId,
        reason,
      }, { machineId }))
    })

    // Session events
    relayServer.on('session:attached', (sessionId: string, taskId: string, machineId: string) => {
      this.dispatch(this.createEvent('session:attached', 'normal', {
        sessionId,
        taskId,
        machineId,
        attachedAt: new Date().toISOString(),
      }, { taskId, machineId }))
    })

    relayServer.on('session:detached', (sessionId: string, taskId: string, reason?: string) => {
      this.dispatch(this.createEvent('session:detached', 'normal', {
        sessionId,
        taskId,
        reason,
      }, { taskId }))
    })

    relayServer.on('session:event', (sessionId: string, taskId: string, event: SessionEvent) => {
      this.dispatch(this.createEvent('session:event', 'low', {
        sessionId,
        taskId,
        event,
      }, { taskId }))
    })

    console.log('[NotificationHub] Connected to relay server')
  }

  /**
   * Register a notification channel
   */
  registerChannel(channel: NotificationChannel): void {
    if (this.channels.has(channel.id)) {
      console.warn(`[NotificationHub] Channel ${channel.id} already registered, replacing`)
    }

    this.channels.set(channel.id, channel)
    this.stats.channelCount = this.channels.size
    this.emit('channel:registered', channel.id)

    console.log(`[NotificationHub] Registered channel: ${channel.name} (${channel.id})`)
  }

  /**
   * Unregister a notification channel
   */
  unregisterChannel(channelId: string): boolean {
    const removed = this.channels.delete(channelId)
    if (removed) {
      this.stats.channelCount = this.channels.size
      this.emit('channel:unregistered', channelId)
      console.log(`[NotificationHub] Unregistered channel: ${channelId}`)
    }
    return removed
  }

  /**
   * Get a registered channel by ID
   */
  getChannel(channelId: string): NotificationChannel | undefined {
    return this.channels.get(channelId)
  }

  /**
   * Get all registered channels
   */
  getChannels(): NotificationChannel[] {
    return Array.from(this.channels.values())
  }

  /**
   * Get hub statistics
   */
  getStats(): HubStats {
    return { ...this.stats }
  }

  /**
   * Dispatch a notification event to all accepting channels
   * Uses Promise.allSettled for error isolation
   */
  async dispatch(event: NotificationEvent): Promise<void> {
    this.stats.totalEventsProcessed++
    this.stats.lastEventAt = new Date()

    // Find channels that accept this event
    const acceptingChannels = Array.from(this.channels.values())
      .filter(channel => channel.accepts(event))

    if (acceptingChannels.length === 0) {
      this.stats.totalEventsDropped++
      return
    }

    // Dispatch to all accepting channels in parallel with error isolation
    const results = await Promise.allSettled(
      acceptingChannels.map(channel => this.sendToChannel(channel, event))
    )

    // Count successes and failures
    let sentCount = 0
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sentCount++
      } else {
        const channel = acceptingChannels[index]
        this.emit('channel:error', channel.id, result.reason, event)
      }
    })

    this.stats.totalEventsSent += sentCount
    this.emit('notification:dispatched', event, sentCount)
  }

  /**
   * Send event to a specific channel with error handling
   */
  private async sendToChannel(
    channel: NotificationChannel,
    event: NotificationEvent
  ): Promise<void> {
    try {
      await channel.send(event)
    } catch (error) {
      console.error(`[NotificationHub] Channel ${channel.id} failed:`, error)
      throw error
    }
  }

  /**
   * Create a notification event with proper structure
   */
  private createEvent(
    type: NotificationEventType,
    priority: NotificationPriority,
    data: unknown,
    targeting: { userId?: string; projectId?: string; taskId?: string; machineId?: string } = {}
  ): NotificationEvent {
    return {
      id: randomUUID(),
      type,
      timestamp: new Date(),
      priority,
      data,
      ...targeting,
    }
  }

  /**
   * Start all registered channels
   */
  async startAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.channels.values()).map(channel => channel.start())
    )

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const channels = Array.from(this.channels.values())
        console.error(`[NotificationHub] Failed to start channel ${channels[index].id}:`, result.reason)
      }
    })

    console.log(`[NotificationHub] Started ${this.channels.size} channels`)
  }

  /**
   * Stop all registered channels
   */
  async stopAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.channels.values()).map(channel => channel.stop())
    )

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const channels = Array.from(this.channels.values())
        console.error(`[NotificationHub] Failed to stop channel ${channels[index].id}:`, result.reason)
      }
    })

    console.log(`[NotificationHub] Stopped ${this.channels.size} channels`)
  }
}

// Singleton instance
export const notificationHub = new NotificationHub()
