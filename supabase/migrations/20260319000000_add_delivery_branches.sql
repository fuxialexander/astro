-- Delivery branches: per-connected-component accumulation branches
-- Each independent group of tasks gets its own branch and PR.

CREATE TABLE IF NOT EXISTS delivery_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  is_singleton BOOLEAN NOT NULL DEFAULT false,
  node_ids TEXT[] NOT NULL DEFAULT '{}',
  pr_url TEXT,
  pr_number INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE delivery_branches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delivery_branches_select') THEN
    CREATE POLICY delivery_branches_select ON delivery_branches
      FOR SELECT USING (project_id IN (
        SELECT p.id FROM projects p
        JOIN team_members tm ON tm.team_id = p.team_id
        WHERE tm.user_id = auth.uid()
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delivery_branches_write') THEN
    CREATE POLICY delivery_branches_write ON delivery_branches
      FOR ALL USING (project_id IN (
        SELECT p.id FROM projects p
        JOIN team_members tm ON tm.team_id = p.team_id
        WHERE tm.user_id = auth.uid()
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_delivery_branches_project ON delivery_branches USING btree (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_branches_project_branch ON delivery_branches USING btree (project_id, branch_name) WHERE deleted_at IS NULL;

-- Add delivery_branch_id FK to plan_nodes (SET NULL on delete so project cascade doesn't break)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plan_nodes' AND column_name = 'delivery_branch_id'
  ) THEN
    ALTER TABLE plan_nodes ADD COLUMN delivery_branch_id UUID REFERENCES delivery_branches(id) ON DELETE SET NULL;
  END IF;
END $$;
