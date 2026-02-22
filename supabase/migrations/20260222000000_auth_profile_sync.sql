-- Auth / Profile Sync Hardening
-- Fixes desync between auth.users and user_profiles

-- ============================================================================
-- 1. Harden handle_new_user trigger with ON CONFLICT + exception handler
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, name, email)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.email, '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
EXCEPTION WHEN others THEN
  RAISE WARNING 'handle_new_user failed for %: %', new.id, sqlerrm;
  RETURN new;  -- don't block auth.users insert
END;
$$;

-- ============================================================================
-- 2. RPC to look up auth.users by email (avoids expensive listUsers admin API)
-- ============================================================================
CREATE OR REPLACE FUNCTION find_auth_user_by_email(p_email text)
RETURNS TABLE(id uuid, email text, raw_user_meta_data jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.id, au.email, au.raw_user_meta_data
  FROM auth.users au
  WHERE au.email = p_email
  LIMIT 1;
$$;

-- Only callable by service role (not exposed to anon/authenticated)
REVOKE ALL ON FUNCTION find_auth_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION find_auth_user_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION find_auth_user_by_email(text) FROM authenticated;
