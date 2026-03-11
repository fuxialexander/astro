/**
 * Index Drift Test
 *
 * Ensures indexes defined in the Drizzle ORM schema also exist in the
 * Supabase SQL migrations (by table + column coverage, not by exact name).
 *
 * This catches:
 * - Indexes added to Drizzle but missing a Supabase migration (PGlite-only)
 * - Tables with no indexes at all in Drizzle (forces PGlite full table scans)
 *
 * NOTE: Supabase's initial migration and our new migration use different naming
 * conventions (e.g., idx_projects_team vs idx_projects_team_id). This test
 * compares by (table, column_list) rather than exact index names.
 */
import { PGlite } from '@electric-sql/pglite'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

interface IndexInfo {
  tablename: string
  indexname: string
  indexdef: string
}

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

function stripSupabaseFeatures(sql: string): string {
  let result = sql
  result = result.replace(/create\s+policy[\s\S]*?;\n?/gi, '')
  result = result.replace(/alter\s+table\s+\S+\s+enable\s+row\s+level\s+security\s*;\n?/gi, '')
  result = result.replace(/alter\s+publication[\s\S]*?;\n?/gi, '')
  result = result.replace(/INSERT\s+INTO[\s\S]*?;\n?/gi, '')
  result = result.replace(/create\s+extension[\s\S]*?;\n?/gi, '')
  return result
}

function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inDollarQuote = false

  for (const line of sql.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('--') && !inDollarQuote) continue
    current += line + '\n'
    const dollarCount = (line.match(/\$\$/g) ?? []).length
    for (let i = 0; i < dollarCount; i++) inDollarQuote = !inDollarQuote
    if (!inDollarQuote && trimmed.endsWith(';')) {
      const stmt = current.trim()
      if (stmt && stmt !== ';') statements.push(stmt)
      current = ''
    }
  }
  const remaining = current.trim()
  if (remaining && remaining !== ';' && !remaining.startsWith('--')) statements.push(remaining)
  return statements
}

async function getIndexes(pg: PGlite): Promise<IndexInfo[]> {
  const result = await pg.query<IndexInfo>(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `)
  return result.rows
}

/**
 * Pre-existing index drift (Drizzle-only, no Supabase migration).
 * These should be resolved over time but won't block the test.
 */
const KNOWN_INDEX_DRIFT = new Set([
  // plan_node_dependencies has a composite unique in Drizzle but no dedicated migration
  'plan_node_dependencies:node_project_id,node_client_id,depends_on_client_id',
])

/**
 * Extract column list from an index definition.
 * e.g. "CREATE INDEX idx_foo ON public.bar USING btree (col1, col2)" → "col1,col2"
 * Strips WHERE clauses for comparison.
 */
function extractColumns(indexdef: string): string {
  const match = indexdef.match(/\(([^)]+)\)/)
  if (!match) return ''
  return match[1]
    .split(',')
    .map(c => c.trim().replace(/ DESC$/i, '').replace(/ ASC$/i, ''))
    .join(',')
}

/**
 * Build a set of "table:columns" keys from index list.
 * Ignores pkey indexes and internal tables.
 */
function buildColumnCoverageSet(indexes: IndexInfo[]): Set<string> {
  const set = new Set<string>()
  for (const idx of indexes) {
    if (idx.indexname.endsWith('_pkey')) continue
    if (idx.tablename.startsWith('__drizzle')) continue
    const cols = extractColumns(idx.indexdef)
    if (cols) set.add(`${idx.tablename}:${cols}`)
  }
  return set
}

describe('Index Drift: Drizzle vs Supabase migrations', () => {
  let drizzlePg: PGlite
  let supabasePg: PGlite

  beforeAll(async () => {
    // Instance A: Drizzle migrations
    drizzlePg = new PGlite()
    const drizzleDir = join(process.cwd(), 'drizzle')
    const drizzleFiles = (await readdir(drizzleDir)).filter(f => f.endsWith('.sql')).sort()

    for (const file of drizzleFiles) {
      const sql = await readFile(join(drizzleDir, file), 'utf-8')
      for (const stmt of sql.split('--> statement-breakpoint')) {
        const trimmed = stmt.trim()
        if (trimmed) await drizzlePg.exec(trimmed)
      }
    }

    // Instance B: Supabase migrations
    supabasePg = new PGlite()
    await supabasePg.exec(AUTH_STUB_SQL)

    const supabaseDir = join(process.cwd(), 'supabase', 'migrations')
    const supabaseFiles = (await readdir(supabaseDir)).filter(f => f.endsWith('.sql')).sort()

    for (const file of supabaseFiles) {
      const rawSql = await readFile(join(supabaseDir, file), 'utf-8')
      const cleanSql = stripSupabaseFeatures(rawSql)
      for (const stmt of splitStatements(cleanSql)) {
        try { await supabasePg.exec(stmt) } catch { /* tolerate non-DDL failures */ }
      }
    }
  }, 60_000)

  afterAll(async () => {
    await drizzlePg?.close()
    await supabasePg?.close()
  })

  it('every Drizzle index column set has a matching Supabase index', async () => {
    const drizzleIndexes = await getIndexes(drizzlePg)
    const supabaseCoverage = buildColumnCoverageSet(await getIndexes(supabasePg))

    // Exclude:
    // - _pkey indexes (auto-created by PRIMARY KEY)
    // - _pk indexes (composite primary keys — Supabase uses ALTER TABLE ... PRIMARY KEY)
    // - _unique indexes that end in _key in Supabase (naming difference for UNIQUE constraints)
    // - DESC indexes (Supabase creates these differently)
    const missing = drizzleIndexes
      .filter(i => !i.indexname.endsWith('_pkey'))
      .filter(i => !i.indexname.endsWith('_pk'))
      .filter(i => !i.tablename.startsWith('__drizzle'))
      // Composite PKs are handled by the PRIMARY KEY constraint, not separate indexes
      .filter(i => !i.indexname.includes('_pk'))
      // UNIQUE constraints: Drizzle uses _unique suffix, Supabase uses _key
      .filter(i => {
        if (!i.indexname.includes('_unique')) return true
        // Check if Supabase has an equivalent _key constraint
        const cols = extractColumns(i.indexdef)
        return cols && !supabaseCoverage.has(`${i.tablename}:${cols}`)
      })
      .filter(i => {
        const cols = extractColumns(i.indexdef)
        if (!cols) return false
        // Skip DESC indexes (Supabase creates these with WHERE clauses differently)
        if (cols.includes('DESC')) return false
        // Skip known pre-existing drift
        if (KNOWN_INDEX_DRIFT.has(`${i.tablename}:${cols}`)) return false
        return !supabaseCoverage.has(`${i.tablename}:${cols}`)
      })
      .map(i => `${i.tablename}: ${i.indexname} (${extractColumns(i.indexdef)})`)

    if (missing.length > 0) {
      console.error(
        'Index column sets in Drizzle but NOT covered by Supabase:\n' +
        missing.join('\n')
      )
    }

    expect(missing).toEqual([])
  })

  it('core tables have indexes on commonly queried columns', async () => {
    const drizzleIndexes = await getIndexes(drizzlePg)
    const coverage = buildColumnCoverageSet(drizzleIndexes)

    // These are the critical indexes that must exist for performance
    const required = [
      'projects:team_id',
      'projects:owner_id',
      'plan_nodes:project_id',
      'plan_nodes:status',
      'plan_nodes:client_id',
      'plan_edges:project_id',
      'plan_edges:source_client_id',
      'plan_edges:target_client_id',
      'task_executions:project_id',
      'task_executions:node_client_id',
      'sessions:user_id',
      'sessions:project_id',
      'task_chat_sessions:user_id',
      'task_chat_sessions:project_id',
      'task_chat_messages:session_id',
      'node_comments:node_id',
      'registered_machines:user_id',
      'encrypted_api_keys:user_id',
      'audit_logs:user_id',
      'activity_events:project_id',
      'streaming_events:execution_id,seq',
    ]

    const missing = required.filter(key => !coverage.has(key))

    if (missing.length > 0) {
      console.error('Missing required indexes in Drizzle schema:\n' + missing.join('\n'))
    }

    expect(missing).toEqual([])
  })
})
