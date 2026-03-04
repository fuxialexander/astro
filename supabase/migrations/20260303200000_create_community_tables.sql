-- Create Community Marketplace tables: shared_plans, shared_plan_stars,
-- shared_plan_forks, shared_plan_comments.
-- These must exist before the RLS migration (20260304000000).

-- ── shared_plans ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  title text NOT NULL,
  description text,
  author_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  author_name text,
  is_anonymous boolean NOT NULL DEFAULT false,

  -- Content (the actual plan)
  vision_doc text,
  plan_data jsonb NOT NULL,
  template_id text,
  template_parameters jsonb,

  -- Customization guide
  customization_notes text,
  customizable_fields jsonb,

  -- Execution evidence
  execution_summary jsonb,
  execution_results text,

  -- Metadata
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,

  -- Community metrics
  stars_count integer NOT NULL DEFAULT 0,
  forks_count integer NOT NULL DEFAULT 0,
  comments_count integer NOT NULL DEFAULT 0,

  -- Visibility & curation
  visibility text NOT NULL DEFAULT 'public',
  featured boolean NOT NULL DEFAULT false,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS shared_plans_category_idx ON shared_plans(category);
CREATE INDEX IF NOT EXISTS shared_plans_stars_count_idx ON shared_plans(stars_count DESC);
CREATE INDEX IF NOT EXISTS shared_plans_created_at_idx ON shared_plans(created_at DESC);
CREATE INDEX IF NOT EXISTS shared_plans_author_id_idx ON shared_plans(author_id);
CREATE INDEX IF NOT EXISTS shared_plans_featured_idx ON shared_plans(featured);

-- ── shared_plan_stars ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared_plan_stars (
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES shared_plans(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, plan_id)
);

-- ── shared_plan_forks ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared_plan_forks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_plan_id uuid NOT NULL REFERENCES shared_plans(id) ON DELETE CASCADE,
  forked_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── shared_plan_comments ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared_plan_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES shared_plans(id) ON DELETE CASCADE,
  author_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  content text NOT NULL,
  parent_comment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS shared_plan_comments_plan_id_idx ON shared_plan_comments(plan_id);
