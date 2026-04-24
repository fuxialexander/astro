-- HIPAA Phase 2: Ensure WebAuthn challenge expiry is timezone-aware so that
-- comparisons against `now()` (timestamptz) don't silently rely on server
-- timezone. Drizzle schema updated to `timestamp(..., { withTimezone: true })`.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webauthn_challenges'
      AND column_name = 'expires_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE webauthn_challenges
      ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
  END IF;
END $$;
