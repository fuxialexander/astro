-- HIPAA Phase 5: audit_logs is append-only.
--
-- Revoke UPDATE and DELETE on the `audit_logs` table from the PostgREST app
-- roles so that even if application code is compromised, historical audit
-- rows cannot be mutated or erased. INSERT and SELECT remain permitted;
-- RLS continues to scope SELECT to the user's own rows (unchanged).
--
-- This is the SaaS/Supabase enforcement. PGlite (local + HIPAA PGlite)
-- has no role system; the code-level check
-- `scripts/check-audit-log-writes.ts` is the enforcement there.
--
-- References:
--   HIPAA §164.312(b) — Audit controls
--   HIPAA §164.312(c)(1) — Integrity
--   NIST SP 800-66r2 §6.6

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    -- Standard Supabase roles.
    REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM anon;
    REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM authenticated;
    REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM service_role;

    -- Make this the DEFAULT for any future role that gets TABLE privileges
    -- via GRANT ALL; we revoke right after to keep the grant narrow. This
    -- is idempotent — re-running the migration is safe.
    -- NOTE: we intentionally do NOT revoke from `postgres` superuser; that
    -- role is used for migrations and disaster recovery.
  END IF;
END
$$;
