-- HIPAA Phase 2: WebAuthn spec requires counter to hold values up to 2^32
-- (fits in uint32 on the client). Postgres integer is int4 (signed 32-bit)
-- which overflows at 2^31. Widen to bigint to match the spec.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'passkey_credentials' AND column_name = 'counter'
  ) THEN
    ALTER TABLE passkey_credentials ALTER COLUMN counter TYPE bigint;
  END IF;
END $$;
