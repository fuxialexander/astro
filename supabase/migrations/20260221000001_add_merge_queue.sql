-- Add merge queue fields to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS merge_queue_enabled BOOLEAN DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS merge_queue_merge_method TEXT DEFAULT 'squash' CHECK (merge_queue_merge_method IN ('merge', 'squash', 'rebase'));

-- Add merge queue status to plan_nodes
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS merge_queue_status TEXT CHECK (merge_queue_status IN ('queued', 'testing', 'merged', 'failed'));
