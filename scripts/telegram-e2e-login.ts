#!/usr/bin/env tsx
/**
 * One-time interactive login for the Telegram E2E test harness.
 *
 * Produces a gramjs session string you can paste into `.env.local` as
 * `TELEGRAM_TEST_SESSION`. From then on, the E2E tests log in non-interactively
 * as your real user account and DM the bot to verify end-to-end behavior.
 *
 * Prereqs (free, 2 min at https://my.telegram.org):
 *   - TELEGRAM_API_ID  (integer)
 *   - TELEGRAM_API_HASH (hex string)
 * Put them in `.env.local` before running.
 *
 * Run:
 *   npx tsx scripts/telegram-e2e-login.ts
 *
 * The script will prompt for phone number, the login code Telegram sends you,
 * and your 2FA password if you have one. Nothing is written to disk — copy the
 * printed session string and paste it into `.env.local` yourself.
 */

import 'dotenv/config'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import input from 'input'

const apiId = Number(process.env.TELEGRAM_API_ID)
const apiHash = process.env.TELEGRAM_API_HASH

if (!apiId || !apiHash) {
  console.error(
    'Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in env. Get them from https://my.telegram.org and add to .env.local.',
  )
  process.exit(1)
}

async function main() {
  const session = new StringSession('')
  const client = new TelegramClient(session, apiId, apiHash!, {
    connectionRetries: 3,
  })

  await client.start({
    phoneNumber: async () => await input.text('Phone number (with country code, e.g. +14155551234): '),
    password: async () => await input.text('2FA password (press Enter if none): '),
    phoneCode: async () => await input.text('Login code from Telegram: '),
    onError: (err) => console.error(err),
  })

  console.log('\n✅ Logged in successfully.\n')
  console.log('Copy the line below into your .env.local:\n')
  console.log(`TELEGRAM_TEST_SESSION=${client.session.save()}\n`)
  await client.disconnect()
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
