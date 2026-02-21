-- Add encrypted API keys table for secure storage of service credentials
-- Keys are encrypted client-side using Web Crypto API before storage

create table encrypted_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_name text not null, -- e.g., 'openai-whisper', 'anthropic', 'openai'
  encrypted_key text not null, -- Base64-encoded encrypted key
  iv text not null, -- Base64-encoded initialization vector for AES-GCM
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Ensure one key per service per user
  unique(user_id, service_name)
);

-- Add index for faster lookups by user
create index idx_encrypted_api_keys_user_id on encrypted_api_keys(user_id);

-- Add trigger for updated_at
create trigger encrypted_api_keys_updated_at
  before update on encrypted_api_keys
  for each row execute function update_updated_at();

-- Enable Row Level Security
alter table encrypted_api_keys enable row level security;

-- RLS Policies: Users can only access their own API keys
create policy "Users can view their own API keys"
  on encrypted_api_keys
  for select
  using (auth.uid() = user_id);

create policy "Users can insert their own API keys"
  on encrypted_api_keys
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own API keys"
  on encrypted_api_keys
  for update
  using (auth.uid() = user_id);

create policy "Users can delete their own API keys"
  on encrypted_api_keys
  for delete
  using (auth.uid() = user_id);
