import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './index.js'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function runMigrations() {
  const migrationsFolder = join(__dirname, '../../../drizzle')
  console.log('[db] Running migrations from', migrationsFolder)
  migrate(db, { migrationsFolder })
  console.log('[db] Migrations complete')
}
