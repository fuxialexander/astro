-- Fix: add_team_creator_as_owner trigger fails when auth.uid() is null
-- This happens when teams are created via the backend (direct Postgres connection)
-- rather than through the Supabase client. The backend already manually inserts
-- the team member, so the trigger should be a no-op when auth.uid() is null.

create or replace function add_team_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only auto-add when called via Supabase client (auth.uid() is set).
  -- Backend creates team members explicitly via drizzle, so skip when null.
  if auth.uid() is not null then
    insert into team_members (team_id, user_id, role)
    values (new.id, auth.uid(), 'owner');
  end if;
  return new;
end;
$$;
