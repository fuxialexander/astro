-- Add custom_templates table for user-created templates
CREATE TABLE IF NOT EXISTS custom_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  icon TEXT DEFAULT '📋',
  tags TEXT[] NOT NULL DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '1.0.0',
  enabled BOOLEAN NOT NULL DEFAULT true,
  template_data JSONB NOT NULL,
  owner_id UUID NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Indexes for custom_templates
CREATE INDEX IF NOT EXISTS custom_templates_owner_id_idx ON custom_templates(owner_id);
CREATE INDEX IF NOT EXISTS custom_templates_team_id_idx ON custom_templates(team_id);
CREATE INDEX IF NOT EXISTS custom_templates_category_idx ON custom_templates(category);
CREATE INDEX IF NOT EXISTS custom_templates_enabled_idx ON custom_templates(enabled);

-- RLS policies for custom_templates
ALTER TABLE custom_templates ENABLE ROW LEVEL SECURITY;

-- Users can view custom templates they own or their team owns
CREATE POLICY "Users can view own and team custom templates"
  ON custom_templates FOR SELECT
  USING (
    owner_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Users can insert their own custom templates
CREATE POLICY "Users can insert own custom templates"
  ON custom_templates FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Users can update custom templates they own
CREATE POLICY "Users can update own custom templates"
  ON custom_templates FOR UPDATE
  USING (owner_id = auth.uid());

-- Users can delete custom templates they own
CREATE POLICY "Users can delete own custom templates"
  ON custom_templates FOR DELETE
  USING (owner_id = auth.uid());
