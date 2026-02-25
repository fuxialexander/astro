-- Backfill null numbers on plan_nodes (per-project, ordered by created_at)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at) AS rn
  FROM plan_nodes WHERE number IS NULL
)
UPDATE plan_nodes SET number = numbered.rn FROM numbered WHERE plan_nodes.id = numbered.id;

-- Backfill null numbers on projects (per-team or per-owner, ordered by created_at)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY COALESCE(team_id, owner_id) ORDER BY created_at
  ) AS rn
  FROM projects WHERE number IS NULL
)
UPDATE projects SET number = numbered.rn FROM numbered WHERE projects.id = numbered.id;
