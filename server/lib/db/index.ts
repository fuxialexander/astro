import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'
import { getServiceClient } from '../supabase.js'

// Use Supabase Postgres connection
// For local development, use direct Postgres connection (port 54322)
// For production, use DATABASE_URL from env
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
})

export const db = drizzle(client, { schema })

// For backwards compatibility, export getServiceClient for Supabase-specific operations
export { getServiceClient }
