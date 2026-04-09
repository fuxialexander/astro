-- Add discovery_mode flag to projects for directory-scoped scientific discovery workflows
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discovery_mode BOOLEAN DEFAULT false;
