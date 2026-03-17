-- GitHub repo explorer cache: issues
CREATE TABLE IF NOT EXISTS github_issue_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL,
  url TEXT NOT NULL,
  author_login TEXT,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignees JSONB NOT NULL DEFAULT '[]'::jsonb,
  comments_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS github_issue_cache_project_issue_idx
  ON github_issue_cache(project_id, issue_number);
CREATE INDEX IF NOT EXISTS github_issue_cache_project_state_idx
  ON github_issue_cache(project_id, state);
CREATE INDEX IF NOT EXISTS github_issue_cache_project_updated_idx
  ON github_issue_cache(project_id, updated_at);

-- GitHub repo explorer cache: PRs
CREATE TABLE IF NOT EXISTS github_pr_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL,
  url TEXT NOT NULL,
  author_login TEXT,
  head_branch TEXT,
  base_branch TEXT,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  ci_status TEXT,
  review_decision TEXT,
  mergeable_state TEXT,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  changed_files INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  draft BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  merged_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS github_pr_cache_project_pr_idx
  ON github_pr_cache(project_id, pr_number);
CREATE INDEX IF NOT EXISTS github_pr_cache_project_state_idx
  ON github_pr_cache(project_id, state);
CREATE INDEX IF NOT EXISTS github_pr_cache_project_review_idx
  ON github_pr_cache(project_id, review_decision);

ALTER TABLE github_issue_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_pr_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'github_issue_cache' AND policyname = 'github_issue_cache_select_policy'
  ) THEN
    CREATE POLICY github_issue_cache_select_policy ON github_issue_cache
      FOR SELECT
      USING (
        project_id IN (
          SELECT id FROM projects WHERE owner_id = auth.uid()
          OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'github_issue_cache' AND policyname = 'github_issue_cache_service_role_policy'
  ) THEN
    CREATE POLICY github_issue_cache_service_role_policy ON github_issue_cache
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'github_pr_cache' AND policyname = 'github_pr_cache_select_policy'
  ) THEN
    CREATE POLICY github_pr_cache_select_policy ON github_pr_cache
      FOR SELECT
      USING (
        project_id IN (
          SELECT id FROM projects WHERE owner_id = auth.uid()
          OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'github_pr_cache' AND policyname = 'github_pr_cache_service_role_policy'
  ) THEN
    CREATE POLICY github_pr_cache_service_role_policy ON github_pr_cache
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;
