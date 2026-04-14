/**
 * Message Bus
 *
 * Envelope-based pub/sub bus for decoupled message routing.
 * Handlers subscribe by envelope type; the bus fans out published
 * envelopes to all matching subscribers.
 *
 * Inspired by Ductor's Envelope/MessageBus pattern — all outbound
 * messages flow through a single bus, decoupling production from delivery.
 *
 * ⚠️ SECURITY / ISOLATION:
 * This bus has NO built-in user/team isolation. All subscribers of a given
 * envelope type receive ALL envelopes of that type, regardless of which team
 * or user produced them. Handlers MUST filter by `envelope.teamId` /
 * `envelope.userId` (or whatever identity field is on their envelope) before
 * acting on a message. Do not assume the bus does this filtering for you.
 */

import type {
  Envelope,
  EnvelopeType,
  EnvelopeHandler,
  BusSubscription,
} from './channel-types.js'

export class MessageBus {
  /** type → set of handler functions */
  private handlers = new Map<EnvelopeType, Set<EnvelopeHandler>>()

  /** wildcard handlers that receive ALL envelope types */
  private wildcardHandlers = new Set<EnvelopeHandler>()

  /**
   * Subscribe to envelopes of a given type.
   * Pass '*' as type to receive all envelopes (wildcard).
   */
  subscribe(type: EnvelopeType | '*', handler: EnvelopeHandler): BusSubscription {
    if (type === '*') {
      this.wildcardHandlers.add(handler)
      return {
        unsubscribe: () => {
          this.wildcardHandlers.delete(handler)
        },
      }
    }

    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler)

    return {
      unsubscribe: () => {
        set!.delete(handler)
        if (set!.size === 0) {
          this.handlers.delete(type)
        }
      },
    }
  }

  /**
   * Publish an envelope to all matching subscribers.
   * Errors in individual handlers are caught and logged — they don't
   * prevent other handlers from receiving the envelope.
   */
  async publish(envelope: Envelope): Promise<void> {
    const promises: Promise<void>[] = []

    // Type-specific handlers
    const typeHandlers = this.handlers.get(envelope.type)
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        promises.push(
          handler(envelope).catch(err => {
            console.error(
              `[message-bus] Handler error for envelope type=${envelope.type} origin=${envelope.origin}:`,
              err
            )
          })
        )
      }
    }

    // Wildcard handlers
    for (const handler of this.wildcardHandlers) {
      promises.push(
        handler(envelope).catch(err => {
          console.error(
            `[message-bus] Wildcard handler error for envelope type=${envelope.type}:`,
            err
          )
        })
      )
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises)
    }
  }

  /**
   * Return the count of subscribers for a given type (useful for diagnostics).
   */
  subscriberCount(type: EnvelopeType | '*'): number {
    if (type === '*') return this.wildcardHandlers.size
    return this.handlers.get(type)?.size ?? 0
  }

  /**
   * Remove all subscribers (useful for testing / shutdown).
   */
  clear(): void {
    this.handlers.clear()
    this.wildcardHandlers.clear()
  }
}
