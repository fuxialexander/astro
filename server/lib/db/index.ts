import * as schema from './schema.js'
import { isLocalMode } from '../app-mode.js'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { join } from 'node:path'
import { homedir } from 'node:os'

let _db: PgDatabase<typeof schema> | null = null

async function initDb(): Promise<PgDatabase<typeof schema>> {
  if (_db) return _db

  if (isLocalMode()) {
    // PGlite: Postgres-in-WASM, no network, data on local disk
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const dataDir = process.env.PGLITE_DATA_DIR || join(homedir(), '.astro', 'pglite')
    const client = new PGlite(dataDir)
    _db = drizzle(client, { schema }) as unknown as PgDatabase<typeof schema>
  } else {
    // postgres-js: TCP connection to external Postgres
    const postgres = (await import('postgres')).default
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    const client = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 })
    _db = drizzle(client, { schema }) as unknown as PgDatabase<typeof schema>
  }

  return _db
}

// Proxy preserves `export const db` — no import changes needed across 50+ files.
// All property accesses are forwarded to the lazily-initialized real db instance.
export const db = new Proxy({} as PgDatabase<typeof schema>, {
  get(_, prop) {
    if (!_db) {
      throw new Error(
        'Database not initialized. Call initDb() before accessing db. ' +
        'This usually means runMigrations() was not awaited in server startup.'
      )
    }
    return (_db as Record<string | symbol, unknown>)[prop]
  },
})

/**
 * Initialize the database connection.
 * Must be called (and awaited) during server startup before any route handlers run.
 */
export { initDb }

