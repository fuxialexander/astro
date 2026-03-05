-- Add onboarding_progress column to user_profiles table.
-- Stores per-user onboarding state (tier completion, quickstart step, dismissed hints, etc.)
-- Defaults to '{}' so existing users are unaffected.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS onboarding_progress jsonb NOT NULL DEFAULT '{}';
