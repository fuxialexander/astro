import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageBus } from '../message-bus.js'
import type { Envelope, EnvelopeType } from '../channel-types.js'

function makeEnvelope(type: EnvelopeType, payload: unknown = {}): Envelope {
  return {
    origin: 'test',
    type,
    deliveryMode: 'broadcast',
    payload,
    timestamp: new Date().toISOString(),
  }
}

describe('MessageBus', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus()
  })

  it('delivers envelope to matching type subscriber', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    bus.subscribe('notification', handler)

    const env = makeEnvelope('notification', { summary: 'test' })
    await bus.publish(env)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(env)
  })

  it('does not deliver to non-matching type subscribers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    bus.subscribe('chat', handler)

    await bus.publish(makeEnvelope('notification'))

    expect(handler).not.toHaveBeenCalled()
  })

  it('delivers to wildcard subscribers for any type', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    bus.subscribe('*', handler)

    await bus.publish(makeEnvelope('notification'))
    await bus.publish(makeEnvelope('chat'))
    await bus.publish(makeEnvelope('stream'))

    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('delivers to both type-specific and wildcard subscribers', async () => {
    const typeHandler = vi.fn().mockResolvedValue(undefined)
    const wildcardHandler = vi.fn().mockResolvedValue(undefined)
    bus.subscribe('notification', typeHandler)
    bus.subscribe('*', wildcardHandler)

    const env = makeEnvelope('notification')
    await bus.publish(env)

    expect(typeHandler).toHaveBeenCalledTimes(1)
    expect(wildcardHandler).toHaveBeenCalledTimes(1)
  })

  it('supports multiple subscribers for the same type', async () => {
    const handler1 = vi.fn().mockResolvedValue(undefined)
    const handler2 = vi.fn().mockResolvedValue(undefined)
    bus.subscribe('approval', handler1)
    bus.subscribe('approval', handler2)

    await bus.publish(makeEnvelope('approval'))

    expect(handler1).toHaveBeenCalledTimes(1)
    expect(handler2).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe removes the handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    const sub = bus.subscribe('notification', handler)

    await bus.publish(makeEnvelope('notification'))
    expect(handler).toHaveBeenCalledTimes(1)

    sub.unsubscribe()

    await bus.publish(makeEnvelope('notification'))
    expect(handler).toHaveBeenCalledTimes(1) // not called again
  })

  it('unsubscribe works for wildcard handlers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    const sub = bus.subscribe('*', handler)

    await bus.publish(makeEnvelope('chat'))
    expect(handler).toHaveBeenCalledTimes(1)

    sub.unsubscribe()

    await bus.publish(makeEnvelope('chat'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('handler errors are caught and do not prevent other handlers', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failHandler = vi.fn().mockRejectedValue(new Error('boom'))
    const okHandler = vi.fn().mockResolvedValue(undefined)

    bus.subscribe('notification', failHandler)
    bus.subscribe('notification', okHandler)

    await bus.publish(makeEnvelope('notification'))

    expect(failHandler).toHaveBeenCalledTimes(1)
    expect(okHandler).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('subscriberCount returns correct counts', () => {
    expect(bus.subscriberCount('notification')).toBe(0)
    expect(bus.subscriberCount('*')).toBe(0)

    const sub1 = bus.subscribe('notification', vi.fn().mockResolvedValue(undefined))
    bus.subscribe('notification', vi.fn().mockResolvedValue(undefined))
    bus.subscribe('*', vi.fn().mockResolvedValue(undefined))

    expect(bus.subscriberCount('notification')).toBe(2)
    expect(bus.subscriberCount('*')).toBe(1)
    expect(bus.subscriberCount('chat')).toBe(0)

    sub1.unsubscribe()
    expect(bus.subscriberCount('notification')).toBe(1)
  })

  it('clear removes all subscribers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    bus.subscribe('notification', handler)
    bus.subscribe('*', handler)

    bus.clear()

    await bus.publish(makeEnvelope('notification'))
    expect(handler).not.toHaveBeenCalled()
    expect(bus.subscriberCount('notification')).toBe(0)
    expect(bus.subscriberCount('*')).toBe(0)
  })

  it('handles publishing with no subscribers gracefully', async () => {
    // Should not throw
    await bus.publish(makeEnvelope('webhook'))
  })
})
