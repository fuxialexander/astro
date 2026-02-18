import { defineConfig } from 'drizzle-kit'
import { join } from 'node:path'
import { homedir } from 'node:os'

export default defineConfig({
  schema: './server/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: join(homedir(), '.astro', 'astro.db'),
  },
})
