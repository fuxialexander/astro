/**
 * Tests for Telegram Command Registry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommandRegistry } from '../telegram-commands.js'
import type { CommandContext } from '../telegram-commands.js'

describe('CommandRegistry', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
  })

  it('should register and execute a command', async () => {
    const handler = vi.fn().mockResolvedValue('Hello!')
    registry.register('test', 'A test command', handler)

    const ctx: CommandContext = {
      chatId: '123',
      userId: 'user-1',
      args: 'some args',
      botToken: 'token',
    }

    const result = await registry.execute('test', ctx)
    expect(result).toBe('Hello!')
    expect(handler).toHaveBeenCalledWith(ctx)
  })

  it('should return error for unknown commands', async () => {
    const ctx: CommandContext = {
      chatId: '123',
      userId: 'user-1',
      args: '',
      botToken: 'token',
    }

    const result = await registry.execute('unknown', ctx)
    expect(result).toContain('Unknown command')
  })

  it('should check if a command exists', () => {
    registry.register('test', 'A test', async () => 'ok')
    expect(registry.has('test')).toBe(true)
    expect(registry.has('nope')).toBe(false)
  })

  it('should be case insensitive', async () => {
    const handler = vi.fn().mockResolvedValue('ok')
    registry.register('Test', 'A test', handler)

    expect(registry.has('test')).toBe(true)
    expect(registry.has('TEST')).toBe(true)

    const ctx: CommandContext = {
      chatId: '123',
      userId: 'user-1',
      args: '',
      botToken: 'token',
    }

    await registry.execute('TEST', ctx)
    expect(handler).toHaveBeenCalled()
  })

  it('should catch handler errors gracefully', async () => {
    registry.register('fail', 'Fails', async () => {
      throw new Error('Something broke')
    })

    const ctx: CommandContext = {
      chatId: '123',
      userId: 'user-1',
      args: '',
      botToken: 'token',
    }

    const result = await registry.execute('fail', ctx)
    expect(result).toContain('Error')
    expect(result).toContain('Something broke')
  })

  it('should return BotCommand array', () => {
    registry.register('projects', 'List projects', async () => 'ok')
    registry.register('help', 'Show help', async () => 'ok')

    const commands = registry.getBotCommands()
    expect(commands).toHaveLength(2)
    expect(commands[0]).toEqual({ command: 'projects', description: 'List projects' })
    expect(commands[1]).toEqual({ command: 'help', description: 'Show help' })
  })

  it('should register commands with Telegram API', async () => {
    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    })
    vi.stubGlobal('fetch', mockFetch)

    registry.register('projects', 'List projects', async () => 'ok')
    registry.register('help', 'Show help', async () => 'ok')

    const result = await registry.registerWithTelegram('test-token')
    expect(result).toBe(true)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/setMyCommands',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('projects'),
      }),
    )

    vi.unstubAllGlobals()
  })
})
