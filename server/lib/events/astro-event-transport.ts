/**
 * Astro Event Transport
 *
 * Platform-agnostic event bus for task execution lifecycle.
 * Emits events that hooks can subscribe to for post-execution actions.
 *
 * Pattern from Cyrus linear-event-transport/src/LinearEventTransport.ts
 */

import { EventEmitter } from 'events'
import type { AstroEvent, AstroEventTransportEvents, EventHook } from './types.js'

/**
 * Astro Event Transport
 *
 * Decouples task execution from post-execution actions via event-driven hooks.
 * Hooks run asynchronously without blocking the main execution flow.
 */
export class AstroEventTransport extends EventEmitter {
  private hooks = new Map<string, EventHook>()
  private enabled = true

  constructor() {
    super();
    // Support multiple concurrent SSE connections
    // Each SSE client registers 1 listener, allow plenty of headroom
    this.setMaxListeners(100);
  }

  /**
   * Register a hook for events
   * @param name - Unique hook identifier
   * @param hook - Event handler function
   */
  registerHook(name: string, hook: EventHook): void {
    if (this.hooks.has(name)) {
      console.warn(`[event-transport] Hook '${name}' already registered, replacing`)
    }
    this.hooks.set(name, hook)
    console.log(`[event-transport] Registered hook: ${name}`)
  }

  /**
   * Unregister a hook
   * @param name - Hook identifier to remove
   */
  unregisterHook(name: string): boolean {
    const existed = this.hooks.delete(name)
    if (existed) {
      console.log(`[event-transport] Unregistered hook: ${name}`)
    }
    return existed
  }

  /**
   * Get list of registered hooks
   */
  listHooks(): string[] {
    return Array.from(this.hooks.keys())
  }

  /**
   * Emit an event to all listeners and hooks
   * @param event - The event to emit
   */
  async emitEvent(event: AstroEvent): Promise<void> {
    if (!this.enabled) {
      console.warn('[event-transport] Transport disabled, skipping event emission')
      return
    }

    // Emit to EventEmitter listeners first (synchronous)
    this.emit('event', event)

    // Run all registered hooks in parallel
    const hookPromises = Array.from(this.hooks.entries()).map(async ([name, hook]) => {
      try {
        await hook(event)
      } catch (error) {
        const err = new Error(`[event-transport] Hook '${name}' failed`)
        if (error instanceof Error) {
          err.cause = error
        }
        console.error(err)
        this.emit('error', err as Error)
      }
    })

    await Promise.allSettled(hookPromises)
  }

  /**
   * Enable/disable event transport
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    console.log(`[event-transport] Transport ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Check if transport is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Type-safe event listener
   */
  on<K extends keyof AstroEventTransportEvents>(
    event: K,
    listener: AstroEventTransportEvents[K]
  ): this {
    return super.on(event, listener)
  }

  /**
   * Get hook statistics
   */
  getStats(): {
    totalHooks: number
    hookNames: string[]
    enabled: boolean
  } {
    return {
      totalHooks: this.hooks.size,
      hookNames: this.listHooks(),
      enabled: this.enabled,
    }
  }
}

// Singleton instance
export const astroEventTransport = new AstroEventTransport()
