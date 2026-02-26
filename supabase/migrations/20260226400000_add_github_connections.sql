-- Add github_connections table for persisted GitHub OAuth connections
-- Replaces the in-memory GitHubStore with database-backed persistence

create table github_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  scope text not null default '',
  connected_at timestamptz not null default now(),
  gh_user_id integer,
  gh_login text,
  gh_name text,
  gh_email text,
  gh_avatar_url text,
  selected_repo_ids jsonb not null default '[]'::jsonb,
  repos jsonb not null default '[]'::jsonb,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Auto-update updated_at
create trigger github_connections_updated_at
  before update on github_connections
  for each row execute function update_updated_at();

-- Enable Row Level Security
alter table github_connections enable row level security;

-- RLS: users can only manage their own connection
create policy "Users can view their own GitHub connection"
  on github_connections for select
  using (auth.uid() = user_id);

create policy "Users can insert their own GitHub connection"
  on github_connections for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own GitHub connection"
  on github_connections for update
  using (auth.uid() = user_id);

create policy "Users can delete their own GitHub connection"
  on github_connections for delete
  using (auth.uid() = user_id);
