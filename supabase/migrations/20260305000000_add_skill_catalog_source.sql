-- Add 'catalog' source type to skills table
-- Catalog skills are curated collections shipped with the server

-- 1. Update the source CHECK constraint to include 'catalog'
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_source_check;
ALTER TABLE skills ADD CONSTRAINT skills_source_check
  CHECK (source IN ('builtin', 'workspace', 'clawhub', 'plugin', 'user', 'catalog'));

-- 2. Add partial unique index for catalog skill names (same pattern as builtin)
CREATE UNIQUE INDEX IF NOT EXISTS skills_catalog_name_unique
  ON skills (name) WHERE source = 'catalog';

-- 3. Catalog skills must have null ownership (same pattern as builtin)
DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT skills_catalog_null_ownership
    CHECK (source != 'catalog' OR (team_id IS NULL AND author_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. RLS: Allow all authenticated users to SELECT catalog skills (same as builtin)
DO $$ BEGIN
  CREATE POLICY "catalog_skills_select" ON skills
    FOR SELECT TO authenticated
    USING (source = 'catalog');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Clean up old plugin celltype rows (will be re-created as catalog)
DELETE FROM skills WHERE source = 'plugin' AND name LIKE 'celltype-%';

-- 6. Clean up deleted builtin skills (moved to catalog or removed entirely)
DELETE FROM skills WHERE source = 'builtin' AND name IN (
  'pdf', 'dspy-rag-pipeline', 'dspy-react-agent-builder',
  'dspy-signature-designer', 'skill-onboarder'
);
