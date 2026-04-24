#!/usr/bin/env -S npx tsx
/**
 * One-time data migration: encrypt `connected_accounts.credentials` and
 * `registered_machines.provider_configs` rows that were written before
 * Phase 0 envelope encryption landed.
 *
 * Usage:
 *   ASTRO_ENCRYPTION_KEY=<base64-32-bytes> npx tsx scripts/migrate-encrypt-credentials.ts
 *   ASTRO_ENCRYPTION_KEY=<...> npx tsx scripts/migrate-encrypt-credentials.ts --dry-run
 *
 * Notes:
 *   - Safe to run repeatedly: rows already in the `{ encrypted: "..." }`
 *     wrapper shape are detected by `isEncrypted()` and skipped.
 *   - Run against the intended database by pointing `DATABASE_URL` at it
 *     (same convention as `npm run db:push`).
 *   - NO schema change is required — both columns are already `jsonb`.
 */

import { db } from '../server/lib/db/index.js'
import { connectedAccounts, registeredMachines } from '../server/lib/db/schema.js'
import { encryptJsonb, isEncrypted } from '../server/lib/encryption.js'
import { eq } from 'drizzle-orm'

const DRY_RUN = process.argv.includes('--dry-run')

async function migrateConnectedAccounts(): Promise<{ scanned: number; updated: number }> {
  const rows = await db.select().from(connectedAccounts)
  let updated = 0
  for (const row of rows) {
    if (isEncrypted(row.credentials)) continue
    if (row.credentials == null) continue
    const wrapped = encryptJsonb(row.credentials)
    if (DRY_RUN) {
      console.log(`[dry-run] connected_accounts/${row.id}: would encrypt credentials`)
    } else {
      await db
        .update(connectedAccounts)
        .set({ credentials: wrapped, updatedAt: new Date() })
        .where(eq(connectedAccounts.id, row.id))
    }
    updated += 1
  }
  return { scanned: rows.length, updated }
}

async function migrateProviderConfigs(): Promise<{ scanned: number; updated: number }> {
  const rows = await db.select().from(registeredMachines)
  let updated = 0
  for (const row of rows) {
    const configs = row.providerConfigs
    if (!configs || isEncrypted(configs)) continue
    if (Array.isArray(configs) && configs.length === 0) continue
    const wrapped = encryptJsonb(configs) as unknown as never[]
    if (DRY_RUN) {
      console.log(`[dry-run] registered_machines/${row.id}: would encrypt provider_configs`)
    } else {
      await db
        .update(registeredMachines)
        .set({ providerConfigs: wrapped })
        .where(eq(registeredMachines.id, row.id))
    }
    updated += 1
  }
  return { scanned: rows.length, updated }
}

async function main(): Promise<void> {
  if (!process.env.ASTRO_ENCRYPTION_KEY) {
    console.error(
      '[migrate] Refusing to run without ASTRO_ENCRYPTION_KEY — the ephemeral ' +
        'fallback key would make migrated data unrecoverable on restart.',
    )
    process.exit(1)
  }

  console.log(
    `[migrate] Encrypting legacy credentials & provider_configs ` +
      (DRY_RUN ? '(DRY RUN)' : '(LIVE)'),
  )

  const ca = await migrateConnectedAccounts()
  console.log(
    `[migrate] connected_accounts: scanned=${ca.scanned} updated=${ca.updated}`,
  )

  const pc = await migrateProviderConfigs()
  console.log(
    `[migrate] registered_machines: scanned=${pc.scanned} updated=${pc.updated}`,
  )

  console.log('[migrate] Done.')
}

main().catch((err) => {
  console.error('[migrate] Failed:', err)
  process.exit(1)
})
