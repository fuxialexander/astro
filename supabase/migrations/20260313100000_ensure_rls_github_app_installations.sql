-- Ensure RLS is enabled on github_app_installations.
-- The original migration (20260303000000) already enables RLS, but the
-- Supabase dashboard flagged it as disabled — possibly the migration
-- wasn't fully applied to production. This is idempotent (safe to re-run).

ALTER TABLE IF EXISTS public.github_app_installations ENABLE ROW LEVEL SECURITY;

-- Verify policies exist (these are no-ops if already created)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'github_app_installations'
    AND policyname = 'Users can view their own GitHub App installations'
  ) THEN
    CREATE POLICY "Users can view their own GitHub App installations"
      ON public.github_app_installations FOR SELECT
      USING (
        auth.uid() = user_id
        OR team_id IN (
          SELECT team_id FROM team_members WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'github_app_installations'
    AND policyname = 'Users can insert their own GitHub App installations'
  ) THEN
    CREATE POLICY "Users can insert their own GitHub App installations"
      ON public.github_app_installations FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'github_app_installations'
    AND policyname = 'Users can update their own GitHub App installations'
  ) THEN
    CREATE POLICY "Users can update their own GitHub App installations"
      ON public.github_app_installations FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'github_app_installations'
    AND policyname = 'Users can delete their own GitHub App installations'
  ) THEN
    CREATE POLICY "Users can delete their own GitHub App installations"
      ON public.github_app_installations FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END
$$;
