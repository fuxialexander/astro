-- ============================================================================
-- Prod Catch-up Migration
-- Consolidates all incremental migrations that were not applied to the
-- production Supabase instance. Each section is idempotent (IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS) so it is safe to re-run.
-- ============================================================================

-- ============================================================================
-- 1. Projects table: missing columns
-- ============================================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS icon text DEFAULT '📋';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color text DEFAULT '#3b82f6';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS number integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_directory text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS merge_queue_enabled boolean DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS merge_queue_merge_method text DEFAULT 'squash';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_mode text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS "references" jsonb DEFAULT '[]';

-- ============================================================================
-- 2. Initiatives table: missing columns
-- ============================================================================
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS icon text DEFAULT '🎯';
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS team_id uuid;

-- ============================================================================
-- 3. User profiles: missing columns
-- ============================================================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS sidebar_config jsonb DEFAULT NULL;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS default_machine_id text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS default_provider text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_machines text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_profiles DROP COLUMN IF EXISTS preferred_environments;

-- ============================================================================
-- 4. Plan nodes: missing columns
-- ============================================================================
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS number integer;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS pr_url text;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS pr_number integer;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS merge_queue_status text;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS auto_pr boolean DEFAULT false;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS actual_start_date timestamptz;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS actual_end_date timestamptz;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS deletion_action_id text;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS links jsonb DEFAULT '[]'::jsonb;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb DEFAULT '[]'::jsonb;

-- ============================================================================
-- 5. Plan edges: missing columns
-- ============================================================================
ALTER TABLE plan_edges ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE plan_edges ADD COLUMN IF NOT EXISTS deletion_action_id text;

-- ============================================================================
-- 6. Task executions: missing columns
-- ============================================================================
ALTER TABLE task_executions ADD COLUMN IF NOT EXISTS markdown_summary text;

-- ============================================================================
-- 7. Registered machines: missing columns
-- ============================================================================
ALTER TABLE registered_machines ADD COLUMN IF NOT EXISTS provider_configs jsonb DEFAULT '[]'::jsonb;
ALTER TABLE registered_machines ADD COLUMN IF NOT EXISTS team_id uuid;

-- ============================================================================
-- 8. New tables
-- ============================================================================

-- Activity events
CREATE TABLE IF NOT EXISTS activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  description text,
  node_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Observation events
CREATE TABLE IF NOT EXISTS observation_events (
  id text PRIMARY KEY,
  trace_id text NOT NULL,
  parent_observation_id text,
  type text NOT NULL,
  name text NOT NULL,
  start_time timestamp NOT NULL,
  end_time timestamp,
  input jsonb,
  output jsonb,
  model text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd real,
  level text NOT NULL DEFAULT 'default',
  metadata jsonb,
  project_id uuid,
  node_id text,
  status_message text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Connected accounts
CREATE TABLE IF NOT EXISTS connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel text NOT NULL,
  label text NOT NULL DEFAULT '',
  credentials jsonb NOT NULL,
  mappings jsonb NOT NULL DEFAULT '{}',
  settings jsonb NOT NULL DEFAULT '{}',
  external_id text,
  enabled boolean NOT NULL DEFAULT true,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Encrypted API keys
CREATE TABLE IF NOT EXISTS encrypted_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  service_name text NOT NULL,
  encrypted_key text NOT NULL,
  iv text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, service_name)
);

-- Teams
CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Team members
CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- Invite tokens
CREATE TABLE IF NOT EXISTS invite_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_by uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Machine usage logs
CREATE TABLE IF NOT EXISTS machine_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id text NOT NULL REFERENCES registered_machines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  execution_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- WebAuthn challenges
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  key text PRIMARY KEY,
  challenge text NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Device codes (OAuth2 RFC 8628)
CREATE TABLE IF NOT EXISTS device_codes (
  user_code text PRIMARY KEY,
  device_code text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}',
  machine_info jsonb,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  authorized_by text,
  authorized_at timestamp,
  last_polled_at timestamp
);

-- Chat sessions (SDK session pool)
CREATE TABLE IF NOT EXISTS chat_sessions (
  key text PRIMARY KEY,
  sdk_session_id text NOT NULL,
  provider_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  last_used_at timestamp NOT NULL DEFAULT now()
);

-- Shared bundles
CREATE TABLE IF NOT EXISTS shared_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle jsonb NOT NULL,
  downloads integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Dispatch queue entries
CREATE TABLE IF NOT EXISTS dispatch_queue_entries (
  id text PRIMARY KEY,
  node_id text NOT NULL,
  project_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  priority text NOT NULL DEFAULT 'normal',
  environment text NOT NULL DEFAULT 'local',
  preferred_provider text,
  target_machine_id text,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 2,
  execution_id text,
  session_id text,
  last_dispatch_attempt timestamp,
  last_error text,
  procedure_state jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Blobs (image/file storage)
CREATE TABLE IF NOT EXISTS blobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  team_id uuid,
  mime_type text NOT NULL,
  size integer NOT NULL,
  data text NOT NULL,
  filename text NOT NULL,
  node_id text,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Node comments
CREATE TABLE IF NOT EXISTS node_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_name text NOT NULL,
  author_type text NOT NULL DEFAULT 'user',
  content text NOT NULL,
  parent_comment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 9. Foreign keys (deferred to avoid ordering issues)
-- ============================================================================
DO $$ BEGIN
  -- projects.team_id → teams.id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_team_id_fkey_v2'
  ) THEN
    BEGIN
      ALTER TABLE projects ADD CONSTRAINT projects_team_id_fkey_v2
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;

  -- initiatives.team_id → teams.id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'initiatives_team_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE initiatives ADD CONSTRAINT initiatives_team_id_fkey
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;

  -- registered_machines.team_id → teams.id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'registered_machines_team_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE registered_machines ADD CONSTRAINT registered_machines_team_id_fkey
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ============================================================================
-- 10. Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_plan_nodes_pr_number ON plan_nodes(pr_number) WHERE pr_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plan_nodes_branch_name ON plan_nodes(branch_name) WHERE branch_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plan_nodes_actual_dates ON plan_nodes(actual_start_date, actual_end_date);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_deleted_at ON plan_nodes(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_plan_edges_deleted_at ON plan_edges(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_events_project ON activity_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_user ON activity_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_trace_id ON observation_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_obs_project_id ON observation_events(project_id);
CREATE INDEX IF NOT EXISTS idx_obs_type ON observation_events(type);
CREATE INDEX IF NOT EXISTS idx_obs_start_time ON observation_events(start_time);
CREATE INDEX IF NOT EXISTS idx_obs_level ON observation_events(level) WHERE level != 'default';
CREATE INDEX IF NOT EXISTS idx_obs_name ON observation_events(name);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_lookup ON connected_accounts(channel, external_id) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user ON connected_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_encrypted_api_keys_user_id ON encrypted_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_role ON team_members(team_id, role);
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_initiatives_team ON initiatives(team_id);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON invite_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_team ON invite_tokens(team_id);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_email ON invite_tokens(email);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_expires ON invite_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_registered_machines_team ON registered_machines(team_id);
CREATE INDEX IF NOT EXISTS idx_machine_usage_logs_machine ON machine_usage_logs(machine_id);
CREATE INDEX IF NOT EXISTS idx_machine_usage_logs_user ON machine_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_machine_usage_logs_project ON machine_usage_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_machine_usage_logs_started_at ON machine_usage_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_profiles_sidebar_config ON user_profiles USING GIN (sidebar_config);
CREATE INDEX IF NOT EXISTS idx_blobs_project_id ON blobs(project_id);
CREATE INDEX IF NOT EXISTS idx_blobs_node_id ON blobs(node_id);
CREATE INDEX IF NOT EXISTS idx_node_comments_node_id ON node_comments(node_id);
CREATE INDEX IF NOT EXISTS idx_node_comments_project_id ON node_comments(project_id);

-- ============================================================================
-- 11. Triggers
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'teams_updated_at') THEN
    CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'encrypted_api_keys_updated_at') THEN
    CREATE TRIGGER encrypted_api_keys_updated_at BEFORE UPDATE ON encrypted_api_keys
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================================
-- 12. Helper functions
-- ============================================================================

-- Team membership check
CREATE OR REPLACE FUNCTION user_is_team_member(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
    AND user_id = auth.uid()
  );
$$;

-- Team admin check
CREATE OR REPLACE FUNCTION user_can_manage_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'admin')
  );
$$;

-- Machine access check
CREATE OR REPLACE FUNCTION user_can_access_machine(p_machine_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM registered_machines
    WHERE id = p_machine_id AND user_id = auth.uid()
    UNION ALL
    SELECT 1 FROM registered_machines rm
    JOIN team_members tm ON tm.team_id = rm.team_id
    WHERE rm.id = p_machine_id AND tm.user_id = auth.uid()
  );
$$;

-- Update project access to include team membership
CREATE OR REPLACE FUNCTION user_has_project_access(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM project_members WHERE project_id = p_project_id AND user_id = auth.uid()
    UNION ALL
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = p_project_id AND tm.user_id = auth.uid()
  );
$$;

-- Auth user lookup by email
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

-- Handle new user trigger (hardened with ON CONFLICT)
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
  RETURN new;
END;
$$;

-- Team creator trigger (null-safe)
CREATE OR REPLACE FUNCTION add_team_creator_as_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (new.id, auth.uid(), 'owner');
  END IF;
  RETURN new;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_team_created') THEN
    CREATE TRIGGER on_team_created AFTER INSERT ON teams
      FOR EACH ROW EXECUTE FUNCTION add_team_creator_as_owner();
  END IF;
END $$;

-- Invite token cleanup
CREATE OR REPLACE FUNCTION cleanup_expired_invite_tokens()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM invite_tokens
  WHERE expires_at < now() AND used_at IS NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 13. RLS on new tables
-- ============================================================================
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_comments ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 14. RLS policies (use IF NOT EXISTS via DO blocks)
-- ============================================================================

-- Activity events
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can read own activities' AND tablename = 'activity_events') THEN
    CREATE POLICY "Users can read own activities" ON activity_events FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own activities' AND tablename = 'activity_events') THEN
    CREATE POLICY "Users can insert own activities" ON activity_events FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own activities' AND tablename = 'activity_events') THEN
    CREATE POLICY "Users can delete own activities" ON activity_events FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- Connected accounts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can manage own accounts' AND tablename = 'connected_accounts') THEN
    CREATE POLICY "Users can manage own accounts" ON connected_accounts FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- Encrypted API keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own API keys' AND tablename = 'encrypted_api_keys') THEN
    CREATE POLICY "Users can view their own API keys" ON encrypted_api_keys FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert their own API keys' AND tablename = 'encrypted_api_keys') THEN
    CREATE POLICY "Users can insert their own API keys" ON encrypted_api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update their own API keys' AND tablename = 'encrypted_api_keys') THEN
    CREATE POLICY "Users can update their own API keys" ON encrypted_api_keys FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete their own API keys' AND tablename = 'encrypted_api_keys') THEN
    CREATE POLICY "Users can delete their own API keys" ON encrypted_api_keys FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Teams
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Team members can view teams' AND tablename = 'teams') THEN
    CREATE POLICY "Team members can view teams" ON teams FOR SELECT USING (user_is_team_member(id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can create teams' AND tablename = 'teams') THEN
    CREATE POLICY "Users can create teams" ON teams FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Owners/admins can update teams' AND tablename = 'teams') THEN
    CREATE POLICY "Owners/admins can update teams" ON teams FOR UPDATE USING (user_can_manage_team(id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Owners can delete teams' AND tablename = 'teams') THEN
    CREATE POLICY "Owners can delete teams" ON teams FOR DELETE USING (
      EXISTS (SELECT 1 FROM team_members WHERE team_id = teams.id AND user_id = auth.uid() AND role = 'owner')
    );
  END IF;
END $$;

-- Team members
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Team members can view team membership' AND tablename = 'team_members') THEN
    CREATE POLICY "Team members can view team membership" ON team_members FOR SELECT USING (user_is_team_member(team_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Owners/admins can add members' AND tablename = 'team_members') THEN
    CREATE POLICY "Owners/admins can add members" ON team_members FOR INSERT WITH CHECK (
      user_can_manage_team(team_id) OR (user_id = auth.uid() AND role = 'owner')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Owners/admins can update member roles' AND tablename = 'team_members') THEN
    CREATE POLICY "Owners/admins can update member roles" ON team_members FOR UPDATE USING (user_can_manage_team(team_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Owners/admins can remove members' AND tablename = 'team_members') THEN
    CREATE POLICY "Owners/admins can remove members" ON team_members FOR DELETE USING (user_can_manage_team(team_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'team_members_insert_via_invite' AND tablename = 'team_members') THEN
    CREATE POLICY "team_members_insert_via_invite" ON team_members FOR INSERT WITH CHECK (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM invite_tokens
        WHERE invite_tokens.team_id = team_members.team_id
          AND invite_tokens.email = (SELECT email FROM user_profiles WHERE id = auth.uid())
          AND invite_tokens.used_at IS NULL
          AND invite_tokens.expires_at > now()
      )
    );
  END IF;
END $$;

-- Invite tokens
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invite_tokens_insert_policy' AND tablename = 'invite_tokens') THEN
    CREATE POLICY "invite_tokens_insert_policy" ON invite_tokens FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM team_members WHERE team_members.team_id = invite_tokens.team_id AND team_members.user_id = auth.uid() AND team_members.role IN ('owner', 'admin'))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invite_tokens_select_policy' AND tablename = 'invite_tokens') THEN
    CREATE POLICY "invite_tokens_select_policy" ON invite_tokens FOR SELECT USING (
      EXISTS (SELECT 1 FROM team_members WHERE team_members.team_id = invite_tokens.team_id AND team_members.user_id = auth.uid() AND team_members.role IN ('owner', 'admin'))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invite_tokens_select_by_email_policy' AND tablename = 'invite_tokens') THEN
    CREATE POLICY "invite_tokens_select_by_email_policy" ON invite_tokens FOR SELECT USING (
      email = (SELECT email FROM user_profiles WHERE id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invite_tokens_delete_policy' AND tablename = 'invite_tokens') THEN
    CREATE POLICY "invite_tokens_delete_policy" ON invite_tokens FOR DELETE USING (
      EXISTS (SELECT 1 FROM team_members WHERE team_members.team_id = invite_tokens.team_id AND team_members.user_id = auth.uid() AND team_members.role IN ('owner', 'admin'))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invite_tokens_update_policy' AND tablename = 'invite_tokens') THEN
    CREATE POLICY "invite_tokens_update_policy" ON invite_tokens FOR UPDATE USING (
      email = (SELECT email FROM user_profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- Registered machines: update policies for team access
DO $$ BEGIN
  -- Drop old policies and recreate with team support
  DROP POLICY IF EXISTS "Users can view own machines" ON registered_machines;
  DROP POLICY IF EXISTS "Users can register machines" ON registered_machines;
  DROP POLICY IF EXISTS "Users can update own machines" ON registered_machines;
  DROP POLICY IF EXISTS "Users can delete own machines" ON registered_machines;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view accessible machines' AND tablename = 'registered_machines') THEN
    CREATE POLICY "Users can view accessible machines" ON registered_machines FOR SELECT USING (
      user_id = auth.uid() OR user_can_access_machine(id)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can register machines' AND tablename = 'registered_machines') THEN
    CREATE POLICY "Users can register machines" ON registered_machines FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own machines' AND tablename = 'registered_machines') THEN
    CREATE POLICY "Users can update own machines" ON registered_machines FOR UPDATE USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own machines' AND tablename = 'registered_machines') THEN
    CREATE POLICY "Users can delete own machines" ON registered_machines FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- Machine usage logs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view machine usage logs' AND tablename = 'machine_usage_logs') THEN
    CREATE POLICY "Users can view machine usage logs" ON machine_usage_logs FOR SELECT USING (user_can_access_machine(machine_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role can insert usage logs' AND tablename = 'machine_usage_logs') THEN
    CREATE POLICY "Service role can insert usage logs" ON machine_usage_logs FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Blobs: open read, owner write
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read blobs' AND tablename = 'blobs') THEN
    CREATE POLICY "Anyone can read blobs" ON blobs FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own blobs' AND tablename = 'blobs') THEN
    CREATE POLICY "Users can insert own blobs" ON blobs FOR INSERT WITH CHECK (owner_id = auth.uid());
  END IF;
END $$;

-- Node comments
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can read project comments' AND tablename = 'node_comments') THEN
    CREATE POLICY "Users can read project comments" ON node_comments FOR SELECT USING (user_has_project_access(project_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert comments' AND tablename = 'node_comments') THEN
    CREATE POLICY "Users can insert comments" ON node_comments FOR INSERT WITH CHECK (user_has_project_access(project_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own comments' AND tablename = 'node_comments') THEN
    CREATE POLICY "Users can update own comments" ON node_comments FOR UPDATE USING (author_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own comments' AND tablename = 'node_comments') THEN
    CREATE POLICY "Users can delete own comments" ON node_comments FOR DELETE USING (author_id = auth.uid());
  END IF;
END $$;

-- ============================================================================
-- 15. Realtime subscriptions for new tables
-- ============================================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE teams;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE team_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE machine_usage_logs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 16. Backfill display numbers
-- ============================================================================
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at) AS rn
  FROM plan_nodes WHERE number IS NULL
)
UPDATE plan_nodes SET number = numbered.rn FROM numbered WHERE plan_nodes.id = numbered.id;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY COALESCE(team_id, owner_id) ORDER BY created_at
  ) AS rn
  FROM projects WHERE number IS NULL
)
UPDATE projects SET number = numbered.rn FROM numbered WHERE projects.id = numbered.id;
