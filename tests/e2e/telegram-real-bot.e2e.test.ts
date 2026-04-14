/**
 * Telegram Real-Bot E2E Test
 *
 * Closes the testing loop for the Telegram integration: a real user account
 * (logged in via gramjs with a saved session string) sends commands/messages
 * to the real bot, and asserts the bot's replies arrive within a timeout.
 *
 * Requires ALL of the following env vars (auto-skips otherwise):
 *   TELEGRAM_API_ID           — from https://my.telegram.org
 *   TELEGRAM_API_HASH         — from https://my.telegram.org
 *   TELEGRAM_TEST_SESSION     — from `npx tsx scripts/telegram-e2e-login.ts`
 *   TELEGRAM_BOT_TOKEN        — the bot under test (throwaway dev bot!)
 *   TELEGRAM_BOT_USERNAME     — e.g. `my_astro_dev_bot` (no @)
 *
 * Also assumes the backend is running with that TELEGRAM_BOT_TOKEN and its
 * webhook is reachable (cloudflared tunnel in dev mode). The test itself does
 * NOT start the backend — run `npm run dev:dev` in another terminal first.
 *
 * Run:
 *   npx vitest run tests/e2e/telegram-real-bot.e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js'

const apiId = Number(process.env.TELEGRAM_API_ID)
const apiHash = process.env.TELEGRAM_API_HASH
const sessionString = process.env.TELEGRAM_TEST_SESSION
const botToken = process.env.TELEGRAM_BOT_TOKEN
const botUsername = process.env.TELEGRAM_BOT_USERNAME

const enabled = Boolean(apiId && apiHash && sessionString && botToken && botUsername)

const REPLY_TIMEOUT_MS = 20_000

let client: TelegramClient | null = null
let botEntity: Api.User | null = null

/**
 * Wait for the next message from the bot matching `predicate`, or reject on timeout.
 */
function waitForBotReply(
  predicate: (text: string) => boolean,
  timeoutMs = REPLY_TIMEOUT_MS,
): Promise<string> {
  if (!client || !botEntity) throw new Error('client not initialized')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client!.removeEventHandler(handler, event)
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for bot reply`))
    }, timeoutMs)

    const event = new NewMessage({ fromUsers: [botEntity!.id], incoming: true })
    const handler = async (update: NewMessageEvent) => {
      const text = update.message?.message ?? ''
      if (predicate(text)) {
        clearTimeout(timer)
        client!.removeEventHandler(handler, event)
        resolve(text)
      }
    }
    client!.addEventHandler(handler, event)
  })
}

describe.skipIf(!enabled)('Telegram real-bot E2E', () => {
  beforeAll(async () => {
    client = new TelegramClient(new StringSession(sessionString!), apiId, apiHash!, {
      connectionRetries: 3,
    })
    await client.connect()
    const me = await client.getMe()
    if (!me) throw new Error('Failed to log in as user')
    botEntity = (await client.getEntity(botUsername!)) as Api.User
    if (!botEntity) throw new Error(`Could not resolve bot @${botUsername}`)
  }, 30_000)

  afterAll(async () => {
    if (client) await client.disconnect()
  })

  it('responds to /start', async () => {
    const waiter = waitForBotReply((t) => t.length > 0)
    await client!.sendMessage(botEntity!, { message: '/start' })
    const reply = await waiter
    expect(reply.length).toBeGreaterThan(0)
  })

  it('responds to /help with a formatted help message', async () => {
    const waiter = waitForBotReply((t) => /help|command|bind/i.test(t))
    await client!.sendMessage(botEntity!, { message: '/help' })
    const reply = await waiter
    expect(reply).toMatch(/help|command|bind/i)
  })

  it('echoes a plain text message through the chat pipeline', async () => {
    const marker = `e2e-${Date.now()}`
    // A plain text DM triggers handleChatMessage → dispatch to agent. We only
    // assert that SOME reply comes back; exact content depends on the agent.
    const waiter = waitForBotReply((t) => t.length > 0, 60_000)
    await client!.sendMessage(botEntity!, { message: `ping ${marker}` })
    const reply = await waiter
    expect(reply.length).toBeGreaterThan(0)
  }, 90_000)
})
