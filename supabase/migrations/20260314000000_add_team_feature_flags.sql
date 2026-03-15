-- Add feature_flags JSONB column to teams table for team-level feature gating.
-- Empty object = use global defaults. Per-team overrides take precedence.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}';
