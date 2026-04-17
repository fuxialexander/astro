-- Add the one-time "Import from history" provenance column.
-- JSONB array of ProjectImportManifestEntry. NULL for projects not created
-- via the inbox "Import from history" action. Existing RLS on `projects`
-- already covers this column; no policy change needed.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS imported_from_sessions JSONB;
