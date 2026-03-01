-- Use Case Templates
-- Reusable planning templates that encapsulate domain-specific prompts,
-- parameter schemas, output format specs, and dispatch configuration.
-- Builtin templates are defined as TypeScript constants (not stored here).
-- Custom/community templates are persisted in this table.

CREATE TABLE IF NOT EXISTS use_case_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  icon TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  parameters JSONB NOT NULL DEFAULT '[]',
  prompts JSONB NOT NULL,
  output_format JSONB,
  parallelization JSONB,
  skills JSONB,
  examples JSONB DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'custom',
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_use_case_templates_owner ON use_case_templates(owner_id);
CREATE INDEX idx_use_case_templates_team ON use_case_templates(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX idx_use_case_templates_category ON use_case_templates(category);
CREATE INDEX idx_use_case_templates_slug ON use_case_templates(slug);
CREATE INDEX idx_use_case_templates_enabled ON use_case_templates(enabled) WHERE enabled = true;

-- RLS policies
ALTER TABLE use_case_templates ENABLE ROW LEVEL SECURITY;

-- Users can read their own templates + team templates + enabled community templates
CREATE POLICY "Users can read own and team templates"
  ON use_case_templates FOR SELECT
  USING (
    owner_id = auth.uid()
    OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
    OR (source = 'community' AND enabled = true)
  );

-- Users can insert their own templates
CREATE POLICY "Users can create templates"
  ON use_case_templates FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Users can update their own templates
CREATE POLICY "Users can update own templates"
  ON use_case_templates FOR UPDATE
  USING (owner_id = auth.uid());

-- Users can delete their own templates
CREATE POLICY "Users can delete own templates"
  ON use_case_templates FOR DELETE
  USING (owner_id = auth.uid());
