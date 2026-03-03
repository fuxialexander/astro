-- Prevent source field from being changed after creation.
-- Defense-in-depth: the API also rejects source changes, but this trigger
-- protects against direct DB access (Supabase Dashboard, PostgREST).
CREATE OR REPLACE FUNCTION prevent_skills_source_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.source IS DISTINCT FROM NEW.source THEN
    RAISE EXCEPTION 'source field is immutable after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER skills_prevent_source_change
  BEFORE UPDATE ON skills
  FOR EACH ROW
  EXECUTE FUNCTION prevent_skills_source_change();
