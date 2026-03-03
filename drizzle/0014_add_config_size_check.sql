-- Enforce a 100KB limit on the config JSONB column at the DB level.
-- This provides defense-in-depth beyond the API-layer validation in skills.ts,
-- catching writes from direct DB access, Supabase dashboard, or future endpoints.
-- Note: pg_column_size includes TOAST header overhead, so the actual JSON may be
-- slightly smaller than 102400 bytes. This is intentional — it's a safety net.
ALTER TABLE "skills" ADD CONSTRAINT "skills_config_size_limit" CHECK (pg_column_size("config") <= 102400);
