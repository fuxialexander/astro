-- Add use_worktree column to projects table
-- Controls whether tasks use git worktree isolation (default: true)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS use_worktree BOOLEAN DEFAULT true;
