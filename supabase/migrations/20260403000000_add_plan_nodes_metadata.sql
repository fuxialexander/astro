-- Add metadata JSONB column to plan_nodes for structured flags (e.g., pushToGithub).
-- Replaces fragile regex-based title matching for special node detection.
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
