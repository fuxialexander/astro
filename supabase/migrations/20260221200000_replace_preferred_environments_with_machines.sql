-- Migration: Replace preferred_environments with preferred_machines
-- This migration changes the user profile preference from environment types to machine IDs

-- Add the new preferred_machines column (skip if already exists in initial schema)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_machines text[] NOT NULL DEFAULT '{}';

-- Drop the old preferred_environments column if it still exists
ALTER TABLE user_profiles DROP COLUMN IF EXISTS preferred_environments;

-- Add comment for documentation
COMMENT ON COLUMN user_profiles.preferred_machines IS 'Array of registered machine IDs that the user prefers for task execution';
