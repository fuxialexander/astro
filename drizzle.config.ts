import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './packages/core/src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
})
