-- Soft-delete support: add 'deleted' to the project_status enum.
-- Must be run outside a transaction (Postgres requirement for ADD VALUE).

ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'deleted';

COMMENT ON COLUMN projects.status IS 'active | archived | deleted  (deleted = soft-deleted, hidden from all queries but data preserved)';

CREATE INDEX IF NOT EXISTS idx_projects_active ON projects (owner_id) WHERE status != 'deleted';
