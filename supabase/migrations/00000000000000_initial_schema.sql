-- Nexus: Complete Initial Schema
-- Clean database initialization with all required tables and data

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists "pgcrypto";

-- ============================================================================
-- Custom Types
-- ============================================================================
create type project_status as enum ('active', 'archived');
create type project_health as enum ('on_track', 'at_risk', 'off_track');
create type initiative_status as enum ('active', 'on_hold', 'completed', 'cancelled');
create type node_type as enum ('milestone', 'task', 'branch', 'decision');
create type node_status as enum (
  'planned', 'dispatched', 'in_progress',
  'auto_verified', 'awaiting_judgment', 'completed', 'pruned'
);
create type edge_type as enum ('dependency', 'branch');
create type priority_level as enum ('urgent', 'high', 'medium', 'low', 'none');
create type estimate_size as enum ('XS', 'S', 'M', 'L', 'XL');
-- Include 'remote' from the start
create type environment_type as enum ('local', 'hpc', 'cloud', 'remote');
create type verification_type as enum ('auto', 'human');
create type execution_status as enum ('pending', 'running', 'success', 'failure', 'cancelled');
create type file_action as enum ('create', 'modify', 'delete');
create type chat_role as enum ('user', 'assistant');
create type project_member_role as enum ('owner', 'editor', 'viewer');

-- ============================================================================
-- Helper Functions (utility functions that don't depend on tables)
-- ============================================================================

-- Auto-update updated_at column
create or replace function update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Tables
-- ============================================================================

-- User profiles (extends auth.users)
create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  avatar_url text,
  bio text default '',
  domains text[] not null default '{}',
  experience_level text not null default 'intermediate',
  preferred_machines text[] not null default '{}',
  notifications_enabled boolean not null default true,
  email_notifications boolean not null default false,
  default_machine_id text,
  default_provider text,
  api_keys jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_profiles_updated_at
  before update on user_profiles
  for each row execute function update_updated_at();

-- Audit logs table (for security and compliance)
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb default '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_user_id on audit_logs(user_id);
create index idx_audit_logs_action on audit_logs(action);
create index idx_audit_logs_resource_type on audit_logs(resource_type);
create index idx_audit_logs_created_at on audit_logs(created_at);

-- Projects (includes repository column from start)
create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  vision_doc text not null default '',
  status project_status not null default 'active',
  start_date date,
  target_date date,
  lead text,
  health project_health,
  initiative_id uuid,
  progress integer default 0 check (progress >= 0 and progress <= 100),
  labels jsonb not null default '[]',
  color text default '#3b82f6',  -- Hex color for visual identification
  icon text default '📋',  -- Emoji icon for visual identification
  working_directory text,
  repository text,  -- Added from 20260210000000_add_project_repository.sql
  default_environment text,  -- Default environment for task execution
  default_machine_id text,   -- Default machine ID for task execution
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_projects_owner on projects(owner_id);
create index idx_projects_status on projects(status);

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

-- Initiatives (high-level organizational grouping)
create table initiatives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  goal text,
  status initiative_status not null default 'active',
  start_date date,
  target_date date,
  lead text,
  color text default '#3b82f6',  -- Hex color for visual grouping
  icon text default '🎯',  -- Emoji icon for visual identification
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_initiatives_owner on initiatives(owner_id);
create index idx_initiatives_status on initiatives(status);

create trigger initiatives_updated_at
  before update on initiatives
  for each row execute function update_updated_at();

-- Add foreign key constraint to projects.initiative_id
alter table projects add constraint projects_initiative_id_fkey
  foreign key (initiative_id) references initiatives(id) on delete set null;

create index idx_projects_initiative on projects(initiative_id);

-- Project members (for shared access)
create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role project_member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index idx_project_members_user on project_members(user_id);

-- Plan nodes
create table plan_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- Use text IDs to preserve compatibility with existing client-generated IDs
  client_id text not null,
  type node_type not null,
  title text not null,
  description text not null default '',
  status node_status not null default 'planned',
  parent_id text,
  environment environment_type,
  verification verification_type not null default 'auto',
  position_x real not null default 0,
  position_y real not null default 0,
  start_date date,
  end_date date,
  due_date date,
  priority priority_level,
  estimate estimate_size,
  milestone_id text,
  label_ids text[] not null default '{}',
  -- Execution metadata
  execution_id text,
  execution_output text,
  execution_error text,
  execution_started_at timestamptz,
  execution_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Unique constraint on (project_id, client_id)
  unique (project_id, client_id)
);

create index idx_plan_nodes_project on plan_nodes(project_id);
create index idx_plan_nodes_client_id on plan_nodes(project_id, client_id);
create index idx_plan_nodes_status on plan_nodes(status);

create trigger plan_nodes_updated_at
  before update on plan_nodes
  for each row execute function update_updated_at();

-- Plan node dependencies (junction table replacing dependencies[] array)
create table plan_node_dependencies (
  node_project_id uuid not null,
  node_client_id text not null,
  depends_on_client_id text not null,
  primary key (node_project_id, node_client_id, depends_on_client_id),
  foreign key (node_project_id, node_client_id)
    references plan_nodes(project_id, client_id) on delete cascade
);

-- Plan edges (React Flow graph edges)
create table plan_edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  client_id text not null,
  source_client_id text not null,
  target_client_id text not null,
  type edge_type not null default 'dependency',
  created_at timestamptz not null default now(),
  unique (project_id, client_id)
);

create index idx_plan_edges_project on plan_edges(project_id);

-- Task executions
create table task_executions (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null unique,
  node_client_id text not null,
  project_id uuid not null references projects(id) on delete cascade,
  status execution_status not null default 'pending',
  stream_text text not null default '',
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  session_id text,
  machine_id text,
  provider_id text,
  provider_name text,
  -- Usage metrics
  duration_ms integer,
  input_tokens integer,
  output_tokens integer,
  tokens_used integer,
  estimated_cost_usd real,
  model text,
  turns_used integer,
  markdown_summary text,
  created_at timestamptz not null default now()
);

create index idx_executions_project on task_executions(project_id);
create index idx_executions_node on task_executions(node_client_id);
create index idx_executions_execution_id on task_executions(execution_id);

-- Tool traces (per execution)
create table tool_traces (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null references task_executions(execution_id) on delete cascade,
  tool_name text not null,
  tool_input jsonb,
  tool_result jsonb,
  success boolean,
  duration integer,
  timestamp timestamptz not null default now()
);

create index idx_tool_traces_execution on tool_traces(execution_id);

-- File changes (per execution)
create table file_changes (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null references task_executions(execution_id) on delete cascade,
  path text not null,
  action file_action not null,
  lines_added integer,
  lines_removed integer,
  timestamp timestamptz not null default now()
);

create index idx_file_changes_execution on file_changes(execution_id);

-- Task chat sessions
create table task_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (node_id, user_id)
);

create index idx_chat_sessions_user on task_chat_sessions(user_id);

create trigger task_chat_sessions_updated_at
  before update on task_chat_sessions
  for each row execute function update_updated_at();

-- Task chat messages
create table task_chat_messages (
  id text primary key,
  session_id uuid not null references task_chat_sessions(id) on delete cascade,
  role chat_role not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_chat_messages_session on task_chat_messages(session_id);

-- Registered machines
create table registered_machines (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  hostname text not null,
  platform text not null,
  environment_type environment_type not null default 'local',
  providers text[] not null default '{}',
  workspace_id text,
  is_connected boolean not null default false,
  is_revoked boolean not null default false,
  refresh_token_hash text not null,
  metadata jsonb,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index idx_machines_user on registered_machines(user_id);

-- ============================================================================
-- Helper Functions (that depend on tables)
-- ============================================================================

-- Check if current user has access to a project (owner or member)
create or replace function user_has_project_access(p_project_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from projects where id = p_project_id and owner_id = auth.uid()
    union all
    select 1 from project_members where project_id = p_project_id and user_id = auth.uid()
  );
$$;

-- Refresh tokens
create table refresh_tokens (
  token_hash text primary key,
  machine_id text not null references registered_machines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text,
  scopes text[] not null default '{}',
  is_revoked boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index idx_refresh_tokens_machine on refresh_tokens(machine_id);
create index idx_refresh_tokens_user on refresh_tokens(user_id);

-- Display settings (per user per view)
create table display_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  view_key text not null,
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, view_key)
);

create trigger display_settings_updated_at
  before update on display_settings
  for each row execute function update_updated_at();

-- Usage metrics (daily aggregates)
create table usage_metrics (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_date date not null default current_date,
  total_cost_usd real not null default 0,
  total_input_tokens integer not null default 0,
  total_output_tokens integer not null default 0,
  tasks_completed integer not null default 0,
  tasks_failed integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_date)
);

create trigger usage_metrics_updated_at
  before update on usage_metrics
  for each row execute function update_updated_at();

-- Passkey credentials (WebAuthn) - public_key as text from start
create table passkey_credentials (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  public_key text not null,  -- Changed from bytea to text (from 20260214000000_passkey_public_key_to_text.sql)
  counter bigint not null default 0,
  transports text[],
  device_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index idx_passkeys_user on passkey_credentials(user_id);

-- ============================================================================
-- Row Level Security Policies
-- ============================================================================

-- Enable RLS on all tables
alter table user_profiles enable row level security;
alter table initiatives enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table plan_nodes enable row level security;
alter table plan_node_dependencies enable row level security;
alter table plan_edges enable row level security;
alter table task_executions enable row level security;
alter table tool_traces enable row level security;
alter table file_changes enable row level security;
alter table task_chat_sessions enable row level security;
alter table task_chat_messages enable row level security;
alter table registered_machines enable row level security;
alter table refresh_tokens enable row level security;
alter table display_settings enable row level security;
alter table usage_metrics enable row level security;
alter table passkey_credentials enable row level security;

-- User profiles: users can only access their own
create policy "Users can view own profile"
  on user_profiles for select using (id = auth.uid());
create policy "Users can update own profile"
  on user_profiles for update using (id = auth.uid());
create policy "Users can insert own profile"
  on user_profiles for insert with check (id = auth.uid());

-- Initiatives: owner or project member access
create policy "Users can view own/accessible initiatives"
  on initiatives for select using (
    owner_id = auth.uid() OR
    exists (
      select 1 from projects p
      where p.initiative_id = initiatives.id
      and user_has_project_access(p.id)
    )
  );
create policy "Users can create initiatives"
  on initiatives for insert with check (owner_id = auth.uid());
create policy "Owners can update initiatives"
  on initiatives for update using (owner_id = auth.uid());
create policy "Owners can delete initiatives"
  on initiatives for delete using (owner_id = auth.uid());

-- Projects: owner or member access
create policy "Users can view own/member projects"
  on projects for select using (user_has_project_access(id));
create policy "Users can create projects"
  on projects for insert with check (owner_id = auth.uid());
create policy "Users can update own/member projects"
  on projects for update using (user_has_project_access(id));
create policy "Owners can delete projects"
  on projects for delete using (owner_id = auth.uid());

-- Project members: project access
create policy "Members visible to project participants"
  on project_members for select using (user_has_project_access(project_id));
create policy "Owners can manage members"
  on project_members for insert with check (
    exists (select 1 from projects where id = project_id and owner_id = auth.uid())
  );
create policy "Owners can remove members"
  on project_members for delete using (
    exists (select 1 from projects where id = project_id and owner_id = auth.uid())
  );

-- Plan nodes: project access
create policy "Plan nodes visible to project participants"
  on plan_nodes for select using (user_has_project_access(project_id));
create policy "Project participants can create nodes"
  on plan_nodes for insert with check (user_has_project_access(project_id));
create policy "Project participants can update nodes"
  on plan_nodes for update using (user_has_project_access(project_id));
create policy "Project participants can delete nodes"
  on plan_nodes for delete using (user_has_project_access(project_id));

-- Plan node dependencies: project access
create policy "Dependencies visible to project participants"
  on plan_node_dependencies for select using (user_has_project_access(node_project_id));
create policy "Project participants can manage dependencies"
  on plan_node_dependencies for insert with check (user_has_project_access(node_project_id));
create policy "Project participants can delete dependencies"
  on plan_node_dependencies for delete using (user_has_project_access(node_project_id));

-- Plan edges: project access
create policy "Edges visible to project participants"
  on plan_edges for select using (user_has_project_access(project_id));
create policy "Project participants can create edges"
  on plan_edges for insert with check (user_has_project_access(project_id));
create policy "Project participants can update edges"
  on plan_edges for update using (user_has_project_access(project_id));
create policy "Project participants can delete edges"
  on plan_edges for delete using (user_has_project_access(project_id));

-- Task executions: project access
create policy "Executions visible to project participants"
  on task_executions for select using (user_has_project_access(project_id));
create policy "Service role can insert executions"
  on task_executions for insert with check (true);
create policy "Service role can update executions"
  on task_executions for update using (true);

-- Tool traces: via execution project access
create policy "Tool traces visible via execution"
  on tool_traces for select using (
    exists (
      select 1 from task_executions te
      where te.execution_id = tool_traces.execution_id
      and user_has_project_access(te.project_id)
    )
  );
create policy "Service role can insert tool traces"
  on tool_traces for insert with check (true);

-- File changes: via execution project access
create policy "File changes visible via execution"
  on file_changes for select using (
    exists (
      select 1 from task_executions te
      where te.execution_id = file_changes.execution_id
      and user_has_project_access(te.project_id)
    )
  );
create policy "Service role can insert file changes"
  on file_changes for insert with check (true);

-- Task chat: user + project access
create policy "Chat sessions visible to owner"
  on task_chat_sessions for select using (user_id = auth.uid());
create policy "Users can create chat sessions"
  on task_chat_sessions for insert with check (user_id = auth.uid() and user_has_project_access(project_id));
create policy "Users can update own chat sessions"
  on task_chat_sessions for update using (user_id = auth.uid());
create policy "Users can delete own chat sessions"
  on task_chat_sessions for delete using (user_id = auth.uid());

create policy "Chat messages visible via session"
  on task_chat_messages for select using (
    exists (
      select 1 from task_chat_sessions s
      where s.id = task_chat_messages.session_id
      and s.user_id = auth.uid()
    )
  );
create policy "Users can insert chat messages"
  on task_chat_messages for insert with check (
    exists (
      select 1 from task_chat_sessions s
      where s.id = task_chat_messages.session_id
      and s.user_id = auth.uid()
    )
  );
create policy "Users can update own chat messages"
  on task_chat_messages for update using (
    exists (
      select 1 from task_chat_sessions s
      where s.id = task_chat_messages.session_id
      and s.user_id = auth.uid()
    )
  );

-- Registered machines: user-scoped
create policy "Users can view own machines"
  on registered_machines for select using (user_id = auth.uid());
create policy "Users can register machines"
  on registered_machines for insert with check (user_id = auth.uid());
create policy "Users can update own machines"
  on registered_machines for update using (user_id = auth.uid());
create policy "Users can delete own machines"
  on registered_machines for delete using (user_id = auth.uid());

-- Refresh tokens: user-scoped
create policy "Users can view own tokens"
  on refresh_tokens for select using (user_id = auth.uid());
create policy "Service can manage tokens"
  on refresh_tokens for insert with check (true);
create policy "Service can update tokens"
  on refresh_tokens for update using (true);
create policy "Users can delete own tokens"
  on refresh_tokens for delete using (user_id = auth.uid());

-- Display settings: user-scoped
create policy "Users can view own display settings"
  on display_settings for select using (user_id = auth.uid());
create policy "Users can upsert display settings"
  on display_settings for insert with check (user_id = auth.uid());
create policy "Users can update display settings"
  on display_settings for update using (user_id = auth.uid());

-- Usage metrics: user-scoped
create policy "Users can view own usage"
  on usage_metrics for select using (user_id = auth.uid());
create policy "Service can manage usage"
  on usage_metrics for insert with check (true);
create policy "Service can update usage"
  on usage_metrics for update using (true);

-- Passkey credentials: user-scoped
create policy "Users can view own passkeys"
  on passkey_credentials for select using (user_id = auth.uid());
create policy "Service can manage passkeys"
  on passkey_credentials for insert with check (true);
create policy "Users can delete own passkeys"
  on passkey_credentials for delete using (user_id = auth.uid());

-- ============================================================================
-- Sessions Table (unified session store)
-- ============================================================================
create table sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null, -- 'plan-chat' | 'task-chat' | 'steer' | 'execution' | 'plan-generation'
  status text not null default 'active', -- 'active' | 'streaming' | 'completed' | 'error' | 'cancelled'
  project_id uuid not null references projects(id) on delete cascade,
  node_id text,
  provider_session_id text,
  provider_id text,
  model text,
  messages jsonb not null default '[]',
  activity_events jsonb default '[]',
  tool_traces jsonb default '[]',
  file_changes jsonb default '[]',
  stream_text text default '',
  summary jsonb,
  metrics jsonb,
  steer_messages jsonb default '[]',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_sessions_user on sessions(user_id);
create index idx_sessions_project on sessions(project_id);
create index idx_sessions_node on sessions(node_id);
create index idx_sessions_type on sessions(type);

create trigger sessions_updated_at
  before update on sessions
  for each row execute function update_updated_at();

alter table sessions enable row level security;

create policy "Users can view own sessions"
  on sessions for select using (user_id = auth.uid());
create policy "Users can create sessions"
  on sessions for insert with check (user_id = auth.uid());
create policy "Users can update own sessions"
  on sessions for update using (user_id = auth.uid());
create policy "Users can delete own sessions"
  on sessions for delete using (user_id = auth.uid());

-- ============================================================================
-- Realtime Subscriptions
-- ============================================================================
-- Enable realtime on tables that need cross-device sync
alter publication supabase_realtime add table initiatives;
alter publication supabase_realtime add table projects;
alter publication supabase_realtime add table plan_nodes;
alter publication supabase_realtime add table plan_edges;
alter publication supabase_realtime add table task_executions;
alter publication supabase_realtime add table registered_machines;
alter publication supabase_realtime add table user_profiles;
alter publication supabase_realtime add table display_settings;
alter publication supabase_realtime add table task_chat_sessions;
alter publication supabase_realtime add table task_chat_messages;
alter publication supabase_realtime add table sessions;

-- ============================================================================
-- Auto-create user profile on signup
-- ============================================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.email, '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- RPC Functions
-- ============================================================================

-- Atomically increment usage metrics for a user on a given date
create or replace function increment_usage_metrics(
  p_user_id uuid,
  p_session_date date,
  p_cost real default 0,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_completed integer default 0,
  p_failed integer default 0
)
returns void
language plpgsql
security definer
as $$
begin
  insert into usage_metrics (user_id, session_date, total_cost_usd, total_input_tokens, total_output_tokens, tasks_completed, tasks_failed)
  values (p_user_id, p_session_date, p_cost, p_input_tokens, p_output_tokens, p_completed, p_failed)
  on conflict (user_id, session_date) do update set
    total_cost_usd = usage_metrics.total_cost_usd + excluded.total_cost_usd,
    total_input_tokens = usage_metrics.total_input_tokens + excluded.total_input_tokens,
    total_output_tokens = usage_metrics.total_output_tokens + excluded.total_output_tokens,
    tasks_completed = usage_metrics.tasks_completed + excluded.tasks_completed,
    tasks_failed = usage_metrics.tasks_failed + excluded.tasks_failed,
    updated_at = now();
end;
$$;

-- ============================================================================
-- Seed Data for IndexedDB Mode
-- ============================================================================
-- Create dev-user for IndexedDB-only mode testing (from 20260215000001_create_dev_user.sql)
-- This user allows the system to work in development mode without authentication

-- Create dev-user in auth.users if it doesn't exist
INSERT INTO auth.users (id, email, email_confirmed_at, created_at, updated_at, instance_id, aud, role)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'dev@localhost',
    NOW(),
    NOW(),
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated'
)
ON CONFLICT (id) DO NOTHING;

-- Create user profile for dev-user
INSERT INTO user_profiles (id, name, email, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'Dev User',
    'dev@localhost',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, email = EXCLUDED.email;
