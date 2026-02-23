# Row-Level Security (RLS) Policies

Supabase RLS policies for multi-user data isolation and access control.

## Overview

RLS policies enforce data access rules at the database level. All tables except `auth.users` have RLS enabled in production (Server Mode).

**Key Principles:**
1. Users can only access their own data by default
2. Project members can access shared project data based on role
3. Service role bypasses RLS for internal operations
4. Local Mode disables RLS (single-user, no auth)

## User Data Tables

These tables are user-scoped with simple owner-based policies.

### user_profiles

```sql
-- Users can read their own profile
CREATE POLICY "Users can view own profile"
ON user_profiles FOR SELECT
USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
ON user_profiles FOR UPDATE
USING (auth.uid() = id);

-- Users can insert their own profile (on signup)
CREATE POLICY "Users can insert own profile"
ON user_profiles FOR INSERT
WITH CHECK (auth.uid() = id);
```

### display_settings

```sql
CREATE POLICY "Users can manage own display settings"
ON display_settings FOR ALL
USING (auth.uid() = user_id);
```

### usage_metrics

```sql
CREATE POLICY "Users can view own usage metrics"
ON usage_metrics FOR SELECT
USING (auth.uid() = user_id);

-- Only service role can insert/update
CREATE POLICY "Service role can manage usage metrics"
ON usage_metrics FOR ALL
USING (auth.role() = 'service_role');
```

### push_tokens

```sql
CREATE POLICY "Users can manage own push tokens"
ON push_tokens FOR ALL
USING (auth.uid() = user_id);
```

### registered_machines

```sql
CREATE POLICY "Users can view own machines"
ON registered_machines FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can register machines"
ON registered_machines FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own machines"
ON registered_machines FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own machines"
ON registered_machines FOR DELETE
USING (auth.uid() = user_id);
```

## Project-Scoped Tables

These tables use helper function `user_has_project_access(project_id, min_role)` for role-based access.

### Helper Function

```sql
CREATE OR REPLACE FUNCTION user_has_project_access(
  project_id uuid,
  min_role text DEFAULT 'viewer'
)
RETURNS boolean AS $$
BEGIN
  -- Owner check
  IF EXISTS (
    SELECT 1 FROM projects
    WHERE id = project_id AND owner_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  -- Member check
  IF min_role = 'viewer' THEN
    RETURN EXISTS (
      SELECT 1 FROM project_members
      WHERE project_id = $1 AND user_id = auth.uid()
    );
  ELSIF min_role = 'editor' THEN
    RETURN EXISTS (
      SELECT 1 FROM project_members
      WHERE project_id = $1 AND user_id = auth.uid()
        AND role IN ('owner', 'editor')
    );
  ELSIF min_role = 'owner' THEN
    RETURN EXISTS (
      SELECT 1 FROM projects
      WHERE id = $1 AND owner_id = auth.uid()
    );
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### projects

```sql
-- Users can view projects they own or are members of
CREATE POLICY "Users can view accessible projects"
ON projects FOR SELECT
USING (
  auth.uid() = owner_id
  OR EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = projects.id AND user_id = auth.uid()
  )
);

-- Users can create projects
CREATE POLICY "Users can create projects"
ON projects FOR INSERT
WITH CHECK (auth.uid() = owner_id);

-- Owners and editors can update projects
CREATE POLICY "Owners and editors can update projects"
ON projects FOR UPDATE
USING (user_has_project_access(id, 'editor'));

-- Only owners can delete projects
CREATE POLICY "Only owners can delete projects"
ON projects FOR DELETE
USING (auth.uid() = owner_id);
```

### initiatives

```sql
-- Same pattern as projects
CREATE POLICY "Users can view accessible initiatives"
ON initiatives FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create initiatives"
ON initiatives FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own initiatives"
ON initiatives FOR UPDATE
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own initiatives"
ON initiatives FOR DELETE
USING (auth.uid() = owner_id);
```

### plan_nodes

```sql
-- Users can view nodes for accessible projects
CREATE POLICY "Users can view plan nodes"
ON plan_nodes FOR SELECT
USING (user_has_project_access(project_id, 'viewer'));

-- Editors can create nodes
CREATE POLICY "Editors can create plan nodes"
ON plan_nodes FOR INSERT
WITH CHECK (user_has_project_access(project_id, 'editor'));

-- Editors can update nodes
CREATE POLICY "Editors can update plan nodes"
ON plan_nodes FOR UPDATE
USING (user_has_project_access(project_id, 'editor'));

-- Editors can delete nodes
CREATE POLICY "Editors can delete plan nodes"
ON plan_nodes FOR DELETE
USING (user_has_project_access(project_id, 'editor'));
```

### plan_node_dependencies

```sql
CREATE POLICY "Users can view dependencies"
ON plan_node_dependencies FOR SELECT
USING (user_has_project_access(node_project_id, 'viewer'));

CREATE POLICY "Editors can manage dependencies"
ON plan_node_dependencies FOR ALL
USING (user_has_project_access(node_project_id, 'editor'));
```

### plan_edges

```sql
-- Same pattern as plan_nodes
CREATE POLICY "Users can view plan edges"
ON plan_edges FOR SELECT
USING (user_has_project_access(project_id, 'viewer'));

CREATE POLICY "Editors can manage plan edges"
ON plan_edges FOR ALL
USING (user_has_project_access(project_id, 'editor'));
```

### sessions

```sql
CREATE POLICY "Users can view own sessions"
ON sessions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create sessions"
ON sessions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
ON sessions FOR UPDATE
USING (auth.uid() = user_id);

-- Service role can update any session (for execution results)
CREATE POLICY "Service role can update sessions"
ON sessions FOR UPDATE
USING (auth.role() = 'service_role');
```

### task_executions

```sql
CREATE POLICY "Users can view task executions"
ON task_executions FOR SELECT
USING (user_has_project_access(project_id, 'viewer'));

CREATE POLICY "Editors can create task executions"
ON task_executions FOR INSERT
WITH CHECK (user_has_project_access(project_id, 'editor'));

-- Service role can update executions (for results)
CREATE POLICY "Service role can update task executions"
ON task_executions FOR UPDATE
USING (auth.role() = 'service_role');
```

### tool_traces, file_changes

```sql
-- Read-only for users, service role can insert
CREATE POLICY "Users can view tool traces"
ON tool_traces FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM task_executions te
    WHERE te.execution_id = tool_traces.execution_id
      AND user_has_project_access(te.project_id, 'viewer')
  )
);

CREATE POLICY "Service role can insert tool traces"
ON tool_traces FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- Same for file_changes
CREATE POLICY "Users can view file changes"
ON file_changes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM task_executions te
    WHERE te.execution_id = file_changes.execution_id
      AND user_has_project_access(te.project_id, 'viewer')
  )
);

CREATE POLICY "Service role can insert file changes"
ON file_changes FOR INSERT
WITH CHECK (auth.role() = 'service_role');
```

### activity_events

```sql
CREATE POLICY "Users can view project activity"
ON activity_events FOR SELECT
USING (user_has_project_access(project_id, 'viewer'));

CREATE POLICY "Service role can create activity events"
ON activity_events FOR INSERT
WITH CHECK (auth.role() = 'service_role');
```

### project_members

```sql
-- Members can view other members of the same project
CREATE POLICY "Members can view project members"
ON project_members FOR SELECT
USING (user_has_project_access(project_id, 'viewer'));

-- Only owners can add/remove members
CREATE POLICY "Owners can manage project members"
ON project_members FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM projects
    WHERE id = project_id AND owner_id = auth.uid()
  )
);
```

### audit_logs

```sql
-- Users can only view their own audit logs
CREATE POLICY "Users can view own audit logs"
ON audit_logs FOR SELECT
USING (auth.uid() = user_id);

-- Only service role can insert
CREATE POLICY "Service role can insert audit logs"
ON audit_logs FOR INSERT
WITH CHECK (auth.role() = 'service_role');
```

### observation_events

```sql
-- Users can view observations for accessible projects
CREATE POLICY "Users can view observations"
ON observation_events FOR SELECT
USING (
  project_id IS NULL
  OR user_has_project_access(project_id, 'viewer')
);

-- Service role can insert
CREATE POLICY "Service role can insert observations"
ON observation_events FOR INSERT
WITH CHECK (auth.role() = 'service_role');
```

### connected_accounts

```sql
CREATE POLICY "Users can manage own connected accounts"
ON connected_accounts FOR ALL
USING (auth.uid() = user_id);
```

## Encrypted API Keys

### encrypted_api_keys

```sql
-- Users can only access their own encrypted API keys
CREATE POLICY "Users can view their own API keys"
ON encrypted_api_keys FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own API keys"
ON encrypted_api_keys FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own API keys"
ON encrypted_api_keys FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own API keys"
ON encrypted_api_keys FOR DELETE
USING (auth.uid() = user_id);
```

## Team-Based Access

Team policies use two helper functions to check team membership and management rights.

### Helper Functions

```sql
-- Check if user is a member of a team
CREATE OR REPLACE FUNCTION user_is_team_member(p_team_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
    AND user_id = auth.uid()
  );
$$;

-- Check if user is owner or admin of a team
CREATE OR REPLACE FUNCTION user_can_manage_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'admin')
  );
$$;
```

**Note:** The `user_has_project_access()` function is updated when teams are enabled to also grant access via team membership:

```sql
CREATE OR REPLACE FUNCTION user_has_project_access(p_project_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    -- Owner access
    SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = auth.uid()
    UNION ALL
    -- Direct project member access
    SELECT 1 FROM project_members WHERE project_id = p_project_id AND user_id = auth.uid()
    UNION ALL
    -- Team member access
    SELECT 1 FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    WHERE p.id = p_project_id AND tm.user_id = auth.uid()
  );
$$;
```

### teams

```sql
-- Teams: visible to team members
CREATE POLICY "Team members can view teams"
ON teams FOR SELECT
USING (user_is_team_member(id));

-- Any authenticated user can create a team (they become owner)
CREATE POLICY "Users can create teams"
ON teams FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Only owners/admins can update team settings
CREATE POLICY "Owners/admins can update teams"
ON teams FOR UPDATE
USING (user_can_manage_team(id));

-- Only owners can delete teams (will cascade delete members)
CREATE POLICY "Owners can delete teams"
ON teams FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = teams.id
    AND user_id = auth.uid()
    AND role = 'owner'
  )
);
```

### team_members

```sql
-- Team members can view team membership
CREATE POLICY "Team members can view team membership"
ON team_members FOR SELECT
USING (user_is_team_member(team_id));

-- Only owners/admins can add members
CREATE POLICY "Owners/admins can add members"
ON team_members FOR INSERT
WITH CHECK (
  user_can_manage_team(team_id) OR
  (user_id = auth.uid() AND role = 'owner') -- Allow creating team with self as owner
);

-- Users can insert themselves via invite tokens
CREATE POLICY "team_members_insert_via_invite"
ON team_members FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM invite_tokens
    WHERE invite_tokens.team_id = team_members.team_id
      AND invite_tokens.email = (SELECT email FROM user_profiles WHERE id = auth.uid())
      AND invite_tokens.used_at IS NULL
      AND invite_tokens.expires_at > now()
  )
);

-- Only owners/admins can update member roles
CREATE POLICY "Owners/admins can update member roles"
ON team_members FOR UPDATE
USING (user_can_manage_team(team_id));

-- Only owners/admins can remove members
CREATE POLICY "Owners/admins can remove members"
ON team_members FOR DELETE
USING (user_can_manage_team(team_id));
```

### invite_tokens

```sql
-- Team admins/owners can create invites for their teams
CREATE POLICY "invite_tokens_insert_policy"
ON invite_tokens FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM team_members
    WHERE team_members.team_id = invite_tokens.team_id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
  )
);

-- Team admins/owners can view invites for their teams
CREATE POLICY "invite_tokens_select_policy"
ON invite_tokens FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM team_members
    WHERE team_members.team_id = invite_tokens.team_id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
  )
);

-- Anyone can view invites sent to their email (needed for acceptance flow)
CREATE POLICY "invite_tokens_select_by_email_policy"
ON invite_tokens FOR SELECT
USING (
  email = (SELECT email FROM user_profiles WHERE id = auth.uid())
);

-- Team admins/owners can delete (revoke) invites for their teams
CREATE POLICY "invite_tokens_delete_policy"
ON invite_tokens FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM team_members
    WHERE team_members.team_id = invite_tokens.team_id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
  )
);

-- Anyone can update invites sent to their email (to mark as used)
CREATE POLICY "invite_tokens_update_policy"
ON invite_tokens FOR UPDATE
USING (
  email = (SELECT email FROM user_profiles WHERE id = auth.uid())
);
```

### registered_machines (updated for teams)

When teams are enabled, machine RLS policies are updated to support team-based access via the `user_can_access_machine()` helper:

```sql
-- Helper: Check if user can access a machine (owner or team member)
CREATE OR REPLACE FUNCTION user_can_access_machine(p_machine_id text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    -- Machine owner access
    SELECT 1 FROM registered_machines
    WHERE id = p_machine_id AND user_id = auth.uid()
    UNION ALL
    -- Team machine access
    SELECT 1 FROM registered_machines rm
    JOIN team_members tm ON tm.team_id = rm.team_id
    WHERE rm.id = p_machine_id AND tm.user_id = auth.uid()
  );
$$;

-- Users can view their own machines + team machines
CREATE POLICY "Users can view accessible machines"
ON registered_machines FOR SELECT
USING (user_id = auth.uid() OR user_can_access_machine(id));

-- Users can register their own machines
CREATE POLICY "Users can register machines"
ON registered_machines FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Users can only update their own machines (not team machines)
CREATE POLICY "Users can update own machines"
ON registered_machines FOR UPDATE
USING (user_id = auth.uid());

-- Users can only delete their own machines (not team machines)
CREATE POLICY "Users can delete own machines"
ON registered_machines FOR DELETE
USING (user_id = auth.uid());
```

### machine_usage_logs

```sql
-- Users can view logs for machines they have access to
CREATE POLICY "Users can view machine usage logs"
ON machine_usage_logs FOR SELECT
USING (user_can_access_machine(machine_id));

-- Service role can insert usage logs
CREATE POLICY "Service role can insert usage logs"
ON machine_usage_logs FOR INSERT
WITH CHECK (auth.role() = 'service_role');
```

## Refresh Tokens & Passkeys

### refresh_tokens

```sql
-- Only service role can query (machine auth is handled server-side)
CREATE POLICY "Service role can manage refresh tokens"
ON refresh_tokens FOR ALL
USING (auth.role() = 'service_role');
```

### passkey_credentials

```sql
-- Users can view their own passkeys
CREATE POLICY "Users can view own passkeys"
ON passkey_credentials FOR SELECT
USING (auth.uid() = user_id);

-- Service role manages passkeys (registration/verification)
CREATE POLICY "Service role can manage passkeys"
ON passkey_credentials FOR ALL
USING (auth.role() = 'service_role');
```

## Realtime Subscriptions

RLS policies automatically apply to Supabase Realtime. Users only receive real-time updates for data they have access to.

**Example:**
```typescript
// User only receives updates for their projects
supabase
  .channel('projects')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'projects'
  }, (payload) => {
    // Only projects where user is owner/member
    console.log(payload.new)
  })
  .subscribe()
```

## Service Role Usage

The service role bypasses RLS and is used for:
1. Writing execution results from agent runners
2. Creating activity events
3. Creating observation events
4. Updating usage metrics
5. Managing machine authentication

**Security Note:** Service role credentials (`SUPABASE_SERVICE_ROLE_KEY`) must never be exposed to the client. Only use on backend.

## Testing RLS Policies

```sql
-- Set user context for testing
SET request.jwt.claims.sub = '<user-uuid>';

-- Test queries
SELECT * FROM projects; -- Should only return user's projects
SELECT * FROM plan_nodes WHERE project_id = '<project-uuid>'; -- Should fail if not a member

-- Reset
RESET request.jwt.claims.sub;
```

## Disabling RLS (Local Mode)

In local mode, RLS is disabled:

```sql
-- Disable RLS for development (DO NOT use in production!)
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE plan_nodes DISABLE ROW LEVEL SECURITY;
-- ... etc for all tables
```

**Local Mode Detection:**
- No Supabase env vars → RLS disabled
- `ASTRO_LOCAL_MODE=true` → RLS disabled
- Single-user only, no authentication

## Related Documentation

- [Database Schema](./database-schema.md) - Table definitions
- [Authentication](./authentication.md) - Auth flow
- [Data Flows](./data-flows.md) - How policies affect data access
- [Server Mode Setup](../setup/server-mode.md) - Enabling RLS in production
