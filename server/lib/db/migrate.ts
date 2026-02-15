// Migrations are now handled by Supabase (supabase/migrations/)
// Run `npx supabase db reset` or `npx supabase migration up` to apply migrations

export function runMigrations() {
  // No-op: Drizzle auto-migrations disabled since we're using Supabase Postgres
  // All schema changes should be made via Supabase migrations in supabase/migrations/
  console.log('[db] Using Supabase migrations (managed via npx supabase db)')
}
