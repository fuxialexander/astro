#!/usr/bin/env tsx
/**
 * CLI entry for the daily audit log export (HIPAA Phase 5).
 *
 * Usage:
 *   npm run audit:export -- --date 2026-04-23
 *
 * Behavior:
 *   - Resolves `since` = 00:00:00Z of the given date, `until` = 00:00:00Z next day.
 *   - Calls exportAuditLogsToS3(since, until).
 *   - Exits 0 on success, 1 on failure.
 *   - Only operates when ASTRO_HIPAA_MODE=true; otherwise prints a warning and exits 0.
 */

import { exportAuditLogsToS3 } from '../server/lib/audit-log-export.js'

function parseArgs(argv: string[]): { date?: string } {
  const out: { date?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--date' || a === '-d') {
      out.date = argv[++i]
    } else if (a?.startsWith('--date=')) {
      out.date = a.slice('--date='.length)
    }
  }
  return out
}

async function main() {
  const { date } = parseArgs(process.argv.slice(2))
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: npm run audit:export -- --date YYYY-MM-DD')
    process.exit(2)
  }

  // UTC bounds — the S3 key path is also UTC-based.
  const since = new Date(`${date}T00:00:00.000Z`)
  const until = new Date(since.getTime() + 24 * 60 * 60 * 1000)

  try {
    const res = await exportAuditLogsToS3(since, until)
    if (res === null) {
      // Non-HIPAA environment — already logged by the exporter.
      process.exit(0)
    }
    console.log(`✅ Exported ${res.rowCount} rows → ${res.uri} (${res.bytes} bytes)`)
    process.exit(0)
  } catch (err) {
    console.error('❌ audit export failed:', err)
    process.exit(1)
  }
}

main()
