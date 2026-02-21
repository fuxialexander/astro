-- Add default machine and provider preferences to user profiles
-- These preferences are used when creating/editing tasks in the node inspector

alter table user_profiles
  add column if not exists default_machine_id text,
  add column if not exists default_provider text;

comment on column user_profiles.default_machine_id is 'Default machine ID for task execution (references machines.machine_id)';
comment on column user_profiles.default_provider is 'Default agent provider ID for task execution (e.g., claude-code, codex)';
