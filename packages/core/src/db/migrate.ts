import { isLocalMode } from '../app-mode.js'
import { initDb } from './index.js'

/**
 * Run database migrations.
 *
 * - Local mode: runs Drizzle migrations against PGlite (creates tables on first run, idempotent on restart)
 * - Server mode: no-op — Supabase manages migrations via supabase/migrations/
 */
export async function runMigrations() {
  // Initialize the database connection first
  await initDb()

  if (!isLocalMode()) {
    // Server mode: Supabase manages migrations
    console.log('[db] Using Supabase migrations (managed via npx supabase db)')
    return
  }

  // Local mode: run Drizzle migrations against PGlite
  console.log('[db] Running Drizzle migrations against PGlite...')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  const { db } = await import('./index.js')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, { migrationsFolder: './drizzle' })
  console.log('[db] PGlite migrations complete')
}
