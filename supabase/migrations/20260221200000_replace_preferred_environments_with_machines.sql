-- Migration: Replace preferred_environments with preferred_machines
-- This migration changes the user profile preference from environment types to machine IDs

-- Add the new preferred_machines column
ALTER TABLE user_profiles ADD COLUMN preferred_machines text[] NOT NULL DEFAULT '{}';

-- Data migration: Convert existing environment preferences to empty array
-- Note: Existing preferences cannot be automatically mapped to machines since this requires
-- looking up actual registered machines. Users will need to re-select their preferences.
-- The empty default is intentional to prompt users to configure their machine preferences.

-- Drop the old preferred_environments column
ALTER TABLE user_profiles DROP COLUMN preferred_environments;

-- Add comment for documentation
COMMENT ON COLUMN user_profiles.preferred_machines IS 'Array of registered machine IDs that the user prefers for task execution';
