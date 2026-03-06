-- Project Knowledge table
-- Key-value knowledge entries extracted during task execution.
-- Supports upsert semantics via unique(project_id, key).

CREATE TABLE IF NOT EXISTS project_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source_node_id TEXT,
  source_task_title TEXT,
  milestone_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_knowledge_project_id_key_unique UNIQUE (project_id, key)
);

CREATE INDEX IF NOT EXISTS project_knowledge_project_id_idx ON project_knowledge(project_id);

-- Enable RLS
ALTER TABLE project_knowledge ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can access knowledge for projects they own or are members of
CREATE POLICY "Users can view project knowledge for their projects"
  ON project_knowledge FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert project knowledge for their projects"
  ON project_knowledge FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update project knowledge for their projects"
  ON project_knowledge FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete project knowledge for their projects"
  ON project_knowledge FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );
