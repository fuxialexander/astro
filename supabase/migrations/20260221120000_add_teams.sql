-- Add Teams Collaboration Schema
-- Enables team-based project organization with role-based access control

-- ============================================================================
-- Custom Types
-- ============================================================================
create type team_member_role as enum ('owner', 'admin', 'member');

-- ============================================================================
-- Teams Table
-- ============================================================================
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_teams_name on teams(name);

create trigger teams_updated_at
  before update on teams
  for each row execute function update_updated_at();

-- ============================================================================
-- Team Members Junction Table
-- ============================================================================
create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role team_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index idx_team_members_user on team_members(user_id);
create index idx_team_members_role on team_members(team_id, role);

-- ============================================================================
-- Add team_id to Projects Table
-- ============================================================================
alter table projects add column team_id uuid references teams(id) on delete set null;

create index idx_projects_team on projects(team_id);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Check if user is a member of a team
create or replace function user_is_team_member(p_team_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id
    and user_id = auth.uid()
  );
$$;

-- Check if user is owner or admin of a team
create or replace function user_can_manage_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id
    and user_id = auth.uid()
    and role in ('owner', 'admin')
  );
$$;

-- Update project access check to include team membership
create or replace function user_has_project_access(p_project_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    -- Owner access
    select 1 from projects where id = p_project_id and owner_id = auth.uid()
    union all
    -- Direct project member access
    select 1 from project_members where project_id = p_project_id and user_id = auth.uid()
    union all
    -- Team member access
    select 1 from projects p
    join team_members tm on tm.team_id = p.team_id
    where p.id = p_project_id and tm.user_id = auth.uid()
  );
$$;

-- ============================================================================
-- Row Level Security Policies
-- ============================================================================

alter table teams enable row level security;
alter table team_members enable row level security;

-- Teams: visible to team members
create policy "Team members can view teams"
  on teams for select using (user_is_team_member(id));

-- Any authenticated user can create a team (they become owner)
create policy "Users can create teams"
  on teams for insert with check (auth.uid() is not null);

-- Only owners/admins can update team settings
create policy "Owners/admins can update teams"
  on teams for update using (user_can_manage_team(id));

-- Only owners can delete teams (will cascade delete members)
create policy "Owners can delete teams"
  on teams for delete using (
    exists (
      select 1 from team_members
      where team_id = teams.id
      and user_id = auth.uid()
      and role = 'owner'
    )
  );

-- Team members: visible to team members
create policy "Team members can view team membership"
  on team_members for select using (user_is_team_member(team_id));

-- Only owners/admins can add members
create policy "Owners/admins can add members"
  on team_members for insert with check (
    user_can_manage_team(team_id) OR
    (user_id = auth.uid() AND role = 'owner') -- Allow creating team with self as owner
  );

-- Only owners/admins can update member roles
create policy "Owners/admins can update member roles"
  on team_members for update using (user_can_manage_team(team_id));

-- Only owners/admins can remove members
create policy "Owners/admins can remove members"
  on team_members for delete using (user_can_manage_team(team_id));

-- ============================================================================
-- Realtime Subscriptions
-- ============================================================================
alter publication supabase_realtime add table teams;
alter publication supabase_realtime add table team_members;

-- ============================================================================
-- Trigger: Auto-add creator as owner when team is created
-- ============================================================================
create or replace function add_team_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into team_members (team_id, user_id, role)
  values (new.id, auth.uid(), 'owner');
  return new;
end;
$$;

create trigger on_team_created
  after insert on teams
  for each row execute function add_team_creator_as_owner();
