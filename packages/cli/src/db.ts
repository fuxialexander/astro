/**
 * Database initialization helper for CLI.
 *
 * Ensures PGlite is initialized and migrations are run before any CLI command.
 */

// Note: Using relative imports for workspace package runtime compatibility
// TypeScript paths in tsconfig.json map @astro/core/* for type-checking
import { initDb } from '../../core/src/db/index.js'
import { runMigrations } from '../../core/src/db/migrate.js'
import { bootstrapLocalMode } from '../../core/src/db/bootstrap-local.js'

let _initialized = false

/**
 * Initialize the database connection for CLI usage.
 * Must be called before any database operations.
 */
export async function ensureDb(): Promise<void> {
  if (_initialized) return

  // Force local mode for CLI
  process.env.APP_MODE = 'local'

  // Initialize DB connection (PGlite)
  await initDb()

  // Run migrations
  await runMigrations()

  // Bootstrap local user/team
  await bootstrapLocalMode()

  _initialized = true
}
