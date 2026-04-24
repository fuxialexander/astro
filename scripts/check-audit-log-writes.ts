#!/usr/bin/env tsx
/**
 * Append-only audit_logs enforcement — static check.
 *
 * The `audit_logs` table is immutable by policy (HIPAA §164.312(b) /
 * §164.312(c)(1)). The ONLY approved write path is `writeAuditLog` /
 * `logAuditEvent` in `server/middleware/audit.ts`.
 *
 * This script fails the build if any file under `server/`, `packages/core/`,
 * or `src/` contains:
 *   - `db.update(auditLogs)`
 *   - `db.delete(auditLogs)`
 *
 * Migrations (`supabase/migrations/`, `drizzle/`) are exempt — they are the
 * legitimate schema-evolution path.
 *
 * SaaS enforcement also happens at the DB role level (see
 * supabase/migrations/*revoke_audit_logs_update_delete.sql). PGlite has no
 * roles, so this code-level check is the only enforcement for HIPAA/local
 * builds.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['server', 'packages/core', 'src']
const REPO_ROOT = process.cwd()

// Match `db.update(auditLogs)` / `db.delete(auditLogs)` with optional whitespace.
const FORBIDDEN = /\bdb\s*\.\s*(update|delete)\s*\(\s*auditLogs\b/g

// Exempt file: the audit middleware itself (where the insert lives).
// `.update/.delete` should still never appear there, but we scope the check.
const EXEMPT_SUFFIXES = [
  'server/middleware/audit.ts',  // shouldn't match anyway, just defense-in-depth
  'scripts/check-audit-log-writes.ts', // this file
]

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, acc)
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) {
      acc.push(full)
    }
  }
  return acc
}

const violations: string[] = []
for (const root of ROOTS) {
  const abs = join(REPO_ROOT, root)
  for (const file of walk(abs)) {
    const rel = relative(REPO_ROOT, file)
    if (EXEMPT_SUFFIXES.some((s) => rel.endsWith(s))) continue
    const src = readFileSync(file, 'utf8')
    FORBIDDEN.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = FORBIDDEN.exec(src)) !== null) {
      // Compute line number.
      const line = src.slice(0, m.index).split('\n').length
      violations.push(`${rel}:${line}  ${m[0]}`)
    }
  }
}

if (violations.length > 0) {
  console.error('❌ audit_logs is append-only. Found forbidden write calls:')
  for (const v of violations) console.error('   ' + v)
  console.error(
    '\nUse writeAuditLog() from server/middleware/audit.ts. UPDATE/DELETE ' +
      'on audit_logs is disallowed by policy (HIPAA §164.312(b)).',
  )
  process.exit(1)
}

console.log('✅ audit_logs append-only check passed')
