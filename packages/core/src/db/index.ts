import * as schema from './schema.js'
import { isLocalMode } from '../app-mode.js'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Use `any` for db type — drizzle's PgDatabase generic constraints are too strict
// for a dual-driver setup (PGlite + postgres-js), and the original code used
// `as unknown as` casts anyway.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null
let _checkpointInterval: ReturnType<typeof setInterval> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function initDb(): Promise<any> {
  if (_db) return _db

  if (isLocalMode()) {
    // PGlite: Postgres-in-WASM, no network, data on local disk
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const dataDir = process.env.PGLITE_DATA_DIR || join(homedir(), '.astro', 'pglite')
    const client = new PGlite(dataDir)
    _db = drizzle(client, { schema })

    // Periodic CHECKPOINT every 30s so data survives abrupt process kills
    // (e.g. tsx watch restart, concurrently Ctrl+C)
    _checkpointInterval = setInterval(async () => {
      try {
        await client.exec('CHECKPOINT')
      } catch {
        // Ignore — client may be closing
      }
    }, 30_000)
    _checkpointInterval.unref() // Don't keep process alive just for checkpointing
  } else {
    // postgres-js: TCP connection to external Postgres
    const postgres = (await import('postgres')).default
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    const client = postgres(url, { max: 60, idle_timeout: 20, connect_timeout: 10 })
    _db = drizzle(client, { schema })
  }

  return _db
}

// Proxy preserves `export const db` — no import changes needed across 50+ files.
// All property accesses are forwarded to the lazily-initialized real db instance.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = new Proxy({}, {
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

/**
 * Close the database connection gracefully.
 * Must be called during server shutdown to flush PGlite WAL and release connections.
 */
async function closeDb(): Promise<void> {
  if (!_db) return

  if (_checkpointInterval) {
    clearInterval(_checkpointInterval)
    _checkpointInterval = null
  }

  try {
    // Drizzle wraps the underlying client — access it via $client
    const client = (_db as { $client?: unknown }).$client
    if (client && typeof (client as { close?: () => Promise<void> }).close === 'function') {
      // PGlite: flushes WAL, checkpoints, cleans up postmaster.pid
      await (client as { close: () => Promise<void> }).close()
    } else if (client && typeof (client as { end?: () => Promise<void> }).end === 'function') {
      // postgres-js: drains connection pool
      await (client as { end: () => Promise<void> }).end()
    }
  } catch (e) {
    console.error('[db] Error closing database:', e)
  }
  _db = null
}

export { closeDb }
