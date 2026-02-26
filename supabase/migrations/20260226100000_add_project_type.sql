-- Add project_type column to distinguish playground sessions from regular projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type text DEFAULT 'default';
