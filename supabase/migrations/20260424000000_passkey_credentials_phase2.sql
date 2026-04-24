-- HIPAA Phase 2 — extend passkey_credentials for PGlite-native WebAuthn.
--
-- These columns are additive and nullable / defaulted so SaaS rows continue
-- to work unchanged. In HIPAA mode, the PGlitePasskeyStore populates them
-- on registration; in SaaS, the existing flow ignores them.
ALTER TABLE passkey_credentials
  ADD COLUMN IF NOT EXISTS device_type TEXT,
  ADD COLUMN IF NOT EXISTS backed_up BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Existing RLS policies (passkey_credentials_select / passkey_credentials_insert
-- / passkey_credentials_delete) defined in 00000000000000_initial_schema.sql
-- already cover the new columns since they gate on user_id. No additional
-- policies needed.
