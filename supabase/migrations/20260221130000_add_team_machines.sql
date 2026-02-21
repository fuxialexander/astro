-- Add Team Machine Sharing
-- Enables machines to be shared with teams for multi-user execution environments

-- ============================================================================
-- Add team_id to registered_machines
-- ============================================================================
alter table registered_machines add column team_id uuid references teams(id) on delete set null;

create index idx_registered_machines_team on registered_machines(team_id);

-- ============================================================================
-- Machine Usage Tracking Table
-- ============================================================================
create table machine_usage_logs (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references registered_machines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  node_id text not null,
  execution_id text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  status text not null, -- 'success' | 'failure' | 'cancelled'
  created_at timestamptz not null default now()
);

create index idx_machine_usage_logs_machine on machine_usage_logs(machine_id);
create index idx_machine_usage_logs_user on machine_usage_logs(user_id);
create index idx_machine_usage_logs_project on machine_usage_logs(project_id);
create index idx_machine_usage_logs_started_at on machine_usage_logs(started_at desc);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Check if user can access a machine (owner or team member)
create or replace function user_can_access_machine(p_machine_id text)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    -- Machine owner access
    select 1 from registered_machines
    where id = p_machine_id and user_id = auth.uid()
    union all
    -- Team machine access (if machine is shared with a team the user is a member of)
    select 1 from registered_machines rm
    join team_members tm on tm.team_id = rm.team_id
    where rm.id = p_machine_id and tm.user_id = auth.uid()
  );
$$;

-- Get available machines for a user (owned + team machines)
create or replace function get_user_available_machines(p_user_id uuid)
returns table (
  id text,
  name text,
  hostname text,
  platform text,
  environment_type text,
  providers text[],
  is_connected boolean,
  is_team_machine boolean,
  team_id uuid,
  team_name text
)
language sql
security definer
stable
as $$
  -- User's own machines
  select
    rm.id,
    rm.name,
    rm.hostname,
    rm.platform,
    rm.environment_type,
    rm.providers,
    rm.is_connected,
    false as is_team_machine,
    null::uuid as team_id,
    null::text as team_name
  from registered_machines rm
  where rm.user_id = p_user_id
    and rm.is_revoked = false
  union all
  -- Team machines
  select
    rm.id,
    rm.name,
    rm.hostname,
    rm.platform,
    rm.environment_type,
    rm.providers,
    rm.is_connected,
    true as is_team_machine,
    rm.team_id,
    t.name as team_name
  from registered_machines rm
  join teams t on t.id = rm.team_id
  join team_members tm on tm.team_id = rm.team_id
  where tm.user_id = p_user_id
    and rm.is_revoked = false
    and rm.team_id is not null
  order by is_connected desc, name;
$$;

-- ============================================================================
-- Update RLS Policies for registered_machines
-- ============================================================================

-- Drop existing policies
drop policy if exists "Users can view own machines" on registered_machines;
drop policy if exists "Users can register machines" on registered_machines;
drop policy if exists "Users can update own machines" on registered_machines;
drop policy if exists "Users can delete own machines" on registered_machines;

-- Users can view their own machines + team machines
create policy "Users can view accessible machines"
  on registered_machines for select using (
    user_id = auth.uid() OR user_can_access_machine(id)
  );

-- Users can register their own machines
create policy "Users can register machines"
  on registered_machines for insert with check (user_id = auth.uid());

-- Users can only update their own machines (not team machines)
create policy "Users can update own machines"
  on registered_machines for update using (user_id = auth.uid());

-- Users can only delete their own machines (not team machines)
create policy "Users can delete own machines"
  on registered_machines for delete using (user_id = auth.uid());

-- ============================================================================
-- RLS Policies for machine_usage_logs
-- ============================================================================

alter table machine_usage_logs enable row level security;

-- Users can view logs for machines they have access to
create policy "Users can view machine usage logs"
  on machine_usage_logs for select using (
    user_can_access_machine(machine_id)
  );

-- Service role can insert usage logs
create policy "Service role can insert usage logs"
  on machine_usage_logs for insert with check (auth.role() = 'service_role');

-- ============================================================================
-- Realtime Subscriptions
-- ============================================================================
alter publication supabase_realtime add table machine_usage_logs;

-- ============================================================================
-- Comments
-- ============================================================================
comment on column registered_machines.team_id is 'If set, this machine is shared with the team';
comment on table machine_usage_logs is 'Tracks machine usage for capacity planning and billing';
comment on function user_can_access_machine is 'Returns true if user owns machine or is member of team that owns it';
comment on function get_user_available_machines is 'Returns all machines available to a user (owned + team shared)';
