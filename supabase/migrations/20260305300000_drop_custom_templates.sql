-- Drop custom_templates table
-- Table has 0 rows, no foreign key references, no triggers.
-- All CRUD code was removed in PR #648. Safe to drop.

-- Drop RLS policies first
DROP POLICY IF EXISTS custom_templates_select ON custom_templates;
DROP POLICY IF EXISTS custom_templates_insert ON custom_templates;
DROP POLICY IF EXISTS custom_templates_update ON custom_templates;
DROP POLICY IF EXISTS custom_templates_delete ON custom_templates;

-- Drop the table (cascades indexes and constraints)
DROP TABLE IF EXISTS custom_templates;
