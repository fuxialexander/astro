/**
 * Schema Drift Test
 *
 * Ensures the Drizzle ORM schema (used by PGlite in local mode) and
 * Supabase SQL migrations (used in dev/prod) produce the same table
 * structure. Catches missing columns like the initiatives.team_id bug.
 *
 * How it works:
 * 1. Spins up PGlite instance A, applies Drizzle migrations (from ./drizzle/)
 * 2. Spins up PGlite instance B, applies Supabase migrations (from supabase/migrations/)
 *    with auth.* references and Supabase-specific features stripped out
 * 3. Compares information_schema.columns for all public tables
 */
import { PGlite } from '@electric-sql/pglite'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

interface ColumnInfo {
  table_name: string
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

/**
 * Known table-level drift between Drizzle and Supabase.
 * These are pre-existing issues that should be resolved over time.
 * Adding new entries here requires a comment explaining why.
 */
const KNOWN_TABLE_DRIFT = new Set([
  // In Drizzle schema but missing Supabase migration:
  'device_codes',         // TODO: add supabase migration
  'push_tokens',          // TODO: add supabase migration
  'webauthn_challenges',  // TODO: add supabase migration
  // In Supabase migration but missing from Drizzle schema:
  'encrypted_api_keys',   // TODO: add to packages/core/src/db/schema.ts
])

const AUTH_STUB_SQL = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    instance_id uuid,
    aud text,
    role text
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid; $$
    LANGUAGE sql;
`

/**
 * Strip or rewrite Supabase-specific SQL that PGlite can't handle.
 * We keep DDL (CREATE TABLE, ALTER TABLE ADD COLUMN) but remove
 * RLS policies, realtime publications, and seed data.
 */
function stripSupabaseFeatures(sql: string): string {
  let result = sql

  // Remove CREATE POLICY ... ; (may span multiple lines)
  result = result.replace(/create\s+policy[\s\S]*?;\n?/gi, '')

  // Remove ALTER TABLE ... ENABLE ROW LEVEL SECURITY
  result = result.replace(/alter\s+table\s+\S+\s+enable\s+row\s+level\s+security\s*;\n?/gi, '')

  // Remove ALTER PUBLICATION (supabase_realtime)
  result = result.replace(/alter\s+publication[\s\S]*?;\n?/gi, '')

  // Remove INSERT statements (seed data)
  result = result.replace(/INSERT\s+INTO[\s\S]*?;\n?/gi, '')

  // Remove CREATE EXTENSION (PGlite handles these internally)
  result = result.replace(/create\s+extension[\s\S]*?;\n?/gi, '')

  return result
}

/**
 * Split SQL into individual statements, handling $$ function bodies
 * and multi-line constructs. Returns non-empty statements.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inDollarQuote = false

  const lines = sql.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip pure comment lines
    if (trimmed.startsWith('--') && !inDollarQuote) {
      continue
    }

    current += line + '\n'

    // Track $$ dollar-quoted blocks (function bodies)
    const dollarCount = (line.match(/\$\$/g) ?? []).length
    for (let i = 0; i < dollarCount; i++) {
      inDollarQuote = !inDollarQuote
    }

    // Statement ends with ; outside of dollar-quoted blocks
    if (!inDollarQuote && trimmed.endsWith(';')) {
      const stmt = current.trim()
      if (stmt && stmt !== ';') {
        statements.push(stmt)
      }
      current = ''
    }
  }

  // Capture any trailing statement without ;
  const remaining = current.trim()
  if (remaining && remaining !== ';' && !remaining.startsWith('--')) {
    statements.push(remaining)
  }

  return statements
}

async function getColumns(pg: PGlite): Promise<ColumnInfo[]> {
  const result = await pg.query<ColumnInfo>(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `)
  return result.rows
}

async function getTables(pg: PGlite): Promise<string[]> {
  const result = await pg.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `)
  return result.rows.map(r => r.table_name)
}

describe('Schema Drift: Drizzle vs Supabase migrations', () => {
  let drizzlePg: PGlite
  let supabasePg: PGlite

  beforeAll(async () => {
    // Instance A: Drizzle migrations (what PGlite local mode uses)
    drizzlePg = new PGlite()

    const drizzleDir = join(process.cwd(), 'drizzle')
    const drizzleFiles = (await readdir(drizzleDir))
      .filter(f => f.endsWith('.sql'))
      .sort()

    for (const file of drizzleFiles) {
      const sql = await readFile(join(drizzleDir, file), 'utf-8')
      const statements = sql.split('--> statement-breakpoint')
      for (const stmt of statements) {
        const trimmed = stmt.trim()
        if (trimmed) {
          await drizzlePg.exec(trimmed)
        }
      }
    }

    // Instance B: Supabase migrations (what dev/prod uses)
    supabasePg = new PGlite()

    // First, create auth stub so FK references to auth.users work
    await supabasePg.exec(AUTH_STUB_SQL)

    const supabaseDir = join(process.cwd(), 'supabase', 'migrations')
    const supabaseFiles = (await readdir(supabaseDir))
      .filter(f => f.endsWith('.sql'))
      .sort()

    for (const file of supabaseFiles) {
      const rawSql = await readFile(join(supabaseDir, file), 'utf-8')
      const cleanSql = stripSupabaseFeatures(rawSql)
      const stmts = splitStatements(cleanSql)

      for (const stmt of stmts) {
        try {
          await supabasePg.exec(stmt)
        } catch {
          // Tolerate per-statement failures (triggers, functions, etc.)
          // The comparison will catch any real missing DDL.
        }
      }
    }
  }, 60_000)

  afterAll(async () => {
    await drizzlePg?.close()
    await supabasePg?.close()
  })

  it('should have the same tables', async () => {
    const drizzleTables = (await getTables(drizzlePg))
      .filter(t => !KNOWN_TABLE_DRIFT.has(t))
    const supabaseTables = (await getTables(supabasePg))
      .filter(t => !KNOWN_TABLE_DRIFT.has(t))

    const drizzleSet = new Set(drizzleTables)
    const supabaseSet = new Set(supabaseTables)

    const missingInSupabase = drizzleTables.filter(t => !supabaseSet.has(t))
    const missingInDrizzle = supabaseTables.filter(t => !drizzleSet.has(t))

    if (missingInSupabase.length > 0) {
      console.error('Tables in Drizzle but MISSING in Supabase:', missingInSupabase)
    }
    if (missingInDrizzle.length > 0) {
      console.error('Tables in Supabase but MISSING in Drizzle:', missingInDrizzle)
    }

    expect(missingInSupabase).toEqual([])
    expect(missingInDrizzle).toEqual([])
  })

  it('should have the same columns for each table', async () => {
    const drizzleColumns = await getColumns(drizzlePg)
    const supabaseColumns = await getColumns(supabasePg)

    // Build column maps: table -> Set<column_name>
    const drizzleMap = new Map<string, Set<string>>()
    for (const col of drizzleColumns) {
      if (!drizzleMap.has(col.table_name)) drizzleMap.set(col.table_name, new Set())
      drizzleMap.get(col.table_name)!.add(col.column_name)
    }

    const supabaseMap = new Map<string, Set<string>>()
    for (const col of supabaseColumns) {
      if (KNOWN_TABLE_DRIFT.has(col.table_name)) continue
      if (!supabaseMap.has(col.table_name)) supabaseMap.set(col.table_name, new Set())
      supabaseMap.get(col.table_name)!.add(col.column_name)
    }

    // Only compare tables that exist in both (table-level mismatches caught above)
    const commonTables = [...drizzleMap.keys()].filter(t => supabaseMap.has(t))
    const diffs: string[] = []

    for (const table of commonTables) {
      const drizzleCols = drizzleMap.get(table)!
      const supabaseCols = supabaseMap.get(table)!

      for (const col of drizzleCols) {
        if (!supabaseCols.has(col)) {
          diffs.push(`${table}.${col}: in Drizzle but MISSING in Supabase migration`)
        }
      }
      for (const col of supabaseCols) {
        if (!drizzleCols.has(col)) {
          diffs.push(`${table}.${col}: in Supabase but MISSING in Drizzle schema`)
        }
      }
    }

    if (diffs.length > 0) {
      console.error('Column drift detected:\n' + diffs.join('\n'))
    }

    expect(diffs).toEqual([])
  })
})
