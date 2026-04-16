-- Add references column to projects for CSL-JSON bibliographic metadata.
-- "references" is a reserved keyword in PostgreSQL, so it must always be quoted.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS "references" JSONB DEFAULT '[]'::jsonb;
