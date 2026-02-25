-- Rich content fields on plan_nodes
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS links jsonb DEFAULT '[]'::jsonb;

-- Blobs table (image/file storage as base64)
CREATE TABLE IF NOT EXISTS blobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  team_id uuid,
  mime_type text NOT NULL,
  size integer NOT NULL,
  data text NOT NULL,
  filename text NOT NULL,
  node_id text,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Node comments table
CREATE TABLE IF NOT EXISTS node_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_name text NOT NULL,
  author_type text NOT NULL DEFAULT 'user',
  content text NOT NULL,
  parent_comment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_blobs_project_id ON blobs(project_id);
CREATE INDEX IF NOT EXISTS idx_blobs_node_id ON blobs(node_id);
CREATE INDEX IF NOT EXISTS idx_node_comments_node_id ON node_comments(node_id);
CREATE INDEX IF NOT EXISTS idx_node_comments_project_id ON node_comments(project_id);
