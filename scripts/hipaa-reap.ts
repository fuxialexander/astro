#!/usr/bin/env tsx
/**
 * HIPAA Auto-Terminate Reaper (cron entry point)
 * ============================================================================
 *
 * Server-side safety net for HIPAA AWS runner pools. Run this from cron
 * (every ~5 minutes is reasonable) on the same host that has DB + AWS access.
 * Does nothing unless ASTRO_HIPAA_MODE=true.
 *
 * Exits 0 if every pool was inspected and any expired instances were
 * terminated. Exits 1 if any pool reported an error so cron will email.
 *
 * Usage:
 *   ASTRO_HIPAA_MODE=true tsx scripts/hipaa-reap.ts
 *
 * Env vars:
 *   ASTRO_HIPAA_AUTO_TERMINATE_HOURS  - override the default 4-hour TTL
 *   DATABASE_URL                       - required (Postgres)
 *   AWS_REGION                         - default region for EC2 client
 */

import { reapExpiredInstances } from '../server/lib/remote-compute/hipaa-watchdog.js'

async function main(): Promise<void> {
  const started = Date.now()
  const results = await reapExpiredInstances()
  const totalTerminated = results.reduce((sum, r) => sum + r.terminated.length, 0)
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0)
  const elapsedMs = Date.now() - started

  console.log(JSON.stringify({
    event: 'hipaa-reap',
    poolsInspected: results.length,
    instancesTerminated: totalTerminated,
    errors: totalErrors,
    elapsedMs,
    results,
  }, null, 2))

  if (totalErrors > 0) {
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('[hipaa-reap] Fatal error:', err)
  process.exit(1)
})
