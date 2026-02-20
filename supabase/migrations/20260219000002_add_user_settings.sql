-- Add settings column to user_profiles
-- Settings: JSONB object for model, defaultProvider, and future settings
-- sidebar_config: already added by 20260216000001 migration, but ensure it exists

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
