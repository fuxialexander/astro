-- Custom Templates: user-created templates for reusable project patterns.
-- Stores the full template definition including parameters, prompts, and execution config.

CREATE TABLE IF NOT EXISTS custom_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'custom',
  version text NOT NULL DEFAULT '1.0.0',
  icon text,
  tags text[] NOT NULL DEFAULT '{}',
  maturity text NOT NULL DEFAULT 'stable',
  enabled boolean NOT NULL DEFAULT true,

  -- Parameter schema (stored as JSONB arrays)
  required_parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  optional_parameters jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Prompt configuration
  prompts jsonb NOT NULL,

  -- Execution config
  execution jsonb,
  parallelization jsonb,
  plan_hints jsonb,

  -- Source project (for templates created from existing plans)
  source_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,

  -- Ownership
  author_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,

  -- Timestamps
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX custom_templates_author_id_idx ON custom_templates(author_id);
CREATE INDEX custom_templates_team_id_idx ON custom_templates(team_id);
CREATE INDEX custom_templates_category_idx ON custom_templates(category);
CREATE INDEX custom_templates_enabled_idx ON custom_templates(enabled);

-- Unique constraint: one template name per author
ALTER TABLE custom_templates ADD CONSTRAINT custom_templates_name_author_id_unique UNIQUE (name, author_id);

-- RLS
ALTER TABLE custom_templates ENABLE ROW LEVEL SECURITY;

-- Users can read their own templates and templates shared with their team
CREATE POLICY custom_templates_select ON custom_templates
  FOR SELECT USING (
    author_id = auth.uid()
    OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Users can insert their own templates
CREATE POLICY custom_templates_insert ON custom_templates
  FOR INSERT WITH CHECK (author_id = auth.uid());

-- Users can update their own templates
CREATE POLICY custom_templates_update ON custom_templates
  FOR UPDATE USING (author_id = auth.uid());

-- Users can delete their own templates
CREATE POLICY custom_templates_delete ON custom_templates
  FOR DELETE USING (author_id = auth.uid());
