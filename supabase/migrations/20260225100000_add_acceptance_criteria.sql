ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb DEFAULT '[]'::jsonb;
