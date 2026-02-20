-- Activity Events table
-- Stores project-level activity feed (task created, plan refined, etc.)
-- Previously stored only in IndexedDB; this enables multi-device sync.

CREATE TABLE IF NOT EXISTS activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- e.g. 'task.created', 'plan.refined', 'vision.updated'
  title TEXT NOT NULL,
  description TEXT,
  node_id TEXT, -- optional link to a plan node
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast per-project lookups
CREATE INDEX IF NOT EXISTS idx_activity_events_project ON activity_events(project_id, created_at DESC);

-- Index for per-user lookups
CREATE INDEX IF NOT EXISTS idx_activity_events_user ON activity_events(user_id, created_at DESC);

-- RLS policies
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own activities"
  ON activity_events FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own activities"
  ON activity_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own activities"
  ON activity_events FOR DELETE
  USING (user_id = auth.uid());
