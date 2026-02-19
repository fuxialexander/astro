-- Add PR-related columns to plan_nodes
-- This enables tracking of GitHub PR URLs, branch names, and PR numbers for completed tasks

ALTER TABLE plan_nodes
ADD COLUMN branch_name text,
ADD COLUMN pr_url text,
ADD COLUMN pr_number integer;

-- Add indexes for efficient querying by PR metadata
CREATE INDEX idx_plan_nodes_pr_number ON plan_nodes(pr_number) WHERE pr_number IS NOT NULL;
CREATE INDEX idx_plan_nodes_branch_name ON plan_nodes(branch_name) WHERE branch_name IS NOT NULL;
