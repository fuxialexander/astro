-- Migration: Add color and icon fields to projects and initiatives
-- This migration adds visual customization fields to both projects and initiatives tables

-- Add icon column to projects table
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS icon text DEFAULT '📋',
ADD COLUMN IF NOT EXISTS color text DEFAULT '#3b82f6';

-- Add icon column to initiatives table (color already exists)
ALTER TABLE initiatives
ADD COLUMN IF NOT EXISTS icon text DEFAULT '🎯';

-- Update existing rows to have default values if they're null
UPDATE projects SET color = '#3b82f6' WHERE color IS NULL;
UPDATE projects SET icon = '📋' WHERE icon IS NULL;
UPDATE initiatives SET icon = '🎯' WHERE icon IS NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN projects.icon IS 'Emoji icon for visual identification';
COMMENT ON COLUMN projects.color IS 'Hex color code for visual grouping';
COMMENT ON COLUMN initiatives.icon IS 'Emoji icon for visual identification';
COMMENT ON COLUMN initiatives.color IS 'Hex color code for visual grouping';
