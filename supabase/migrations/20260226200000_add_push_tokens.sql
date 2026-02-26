-- Add push_tokens table for APNs device token registration
-- Stores device tokens and per-user notification preferences

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token text not null,
  platform text not null default 'ios',
  preferences jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast lookups by user
create index idx_push_tokens_user_id on push_tokens(user_id);

-- Prevent duplicate registrations of the same device for the same user
create unique index idx_push_tokens_user_device on push_tokens(user_id, device_token);

-- Auto-update updated_at
create trigger push_tokens_updated_at
  before update on push_tokens
  for each row execute function update_updated_at();

-- Enable Row Level Security
alter table push_tokens enable row level security;

-- RLS: users can only manage their own push tokens
create policy "Users can view their own push tokens"
  on push_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert their own push tokens"
  on push_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own push tokens"
  on push_tokens for update
  using (auth.uid() = user_id);

create policy "Users can delete their own push tokens"
  on push_tokens for delete
  using (auth.uid() = user_id);
