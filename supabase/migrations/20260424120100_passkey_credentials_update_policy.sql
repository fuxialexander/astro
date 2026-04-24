-- HIPAA Phase 2: Allow users to update their own passkey rows (e.g. counter,
-- lastUsedAt after successful authentication). Without this, RLS blocks the
-- counter bump and login succeeds only once.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'passkey_credentials_update') THEN
    CREATE POLICY passkey_credentials_update ON passkey_credentials
      FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
