-- Add display number columns to projects and plan_nodes
-- These are auto-incrementing per-scope display numbers (e.g., #1, #2, #3)
-- UUIDs remain the internal primary keys.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS number integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_directory text;

ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS number integer;

-- Backfill: assign display numbers to existing projects (ordered by created_at)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM projects
  WHERE number IS NULL
)
UPDATE projects SET number = numbered.rn
FROM numbered WHERE projects.id = numbered.id;

-- Backfill: assign display numbers to existing plan_nodes per project (ordered by created_at)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at) AS rn
  FROM plan_nodes
  WHERE number IS NULL
)
UPDATE plan_nodes SET number = numbered.rn
FROM numbered WHERE plan_nodes.id = numbered.id;
