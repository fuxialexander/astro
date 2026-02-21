-- Add auto_pr column to plan_nodes table
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS auto_pr BOOLEAN DEFAULT false;
