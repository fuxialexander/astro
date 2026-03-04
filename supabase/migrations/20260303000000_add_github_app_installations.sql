-- Add github_app_installations table for GitHub App integration
-- Stores installation records linked to users and optionally teams.

create table github_app_installations (
  id uuid primary key default gen_random_uuid(),
  installation_id integer not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  account_login text not null,
  account_type text not null default 'Organization',
  account_avatar_url text,
  app_id integer,
  repository_selection text not null default 'all',
  repos jsonb not null default '[]'::jsonb,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-update updated_at
create trigger github_app_installations_updated_at
  before update on github_app_installations
  for each row execute function update_updated_at();

-- Enable Row Level Security
alter table github_app_installations enable row level security;

-- RLS: users can view installations they own or that belong to their team
create policy "Users can view their own GitHub App installations"
  on github_app_installations for select
  using (
    auth.uid() = user_id
    or team_id in (
      select team_id from team_members where user_id = auth.uid()
    )
  );

-- RLS: users can insert their own installations
create policy "Users can insert their own GitHub App installations"
  on github_app_installations for insert
  with check (auth.uid() = user_id);

-- RLS: users can update installations they own
create policy "Users can update their own GitHub App installations"
  on github_app_installations for update
  using (auth.uid() = user_id);

-- RLS: users can delete installations they own
create policy "Users can delete their own GitHub App installations"
  on github_app_installations for delete
  using (auth.uid() = user_id);

-- Index for fast lookups by user and team
create index github_app_installations_user_id_idx on github_app_installations(user_id);
create index github_app_installations_team_id_idx on github_app_installations(team_id);
