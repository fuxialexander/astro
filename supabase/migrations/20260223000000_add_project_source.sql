-- Add structured source, delivery mode, and references to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_mode text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS "references" jsonb DEFAULT '[]';
