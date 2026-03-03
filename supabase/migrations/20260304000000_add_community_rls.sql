-- Community Marketplace: RLS policies for shared plans, stars, forks, and comments.
-- These tables store user-published plans and their social metadata.

-- ── shared_plans ──────────────────────────────────────────────────────────

ALTER TABLE shared_plans ENABLE ROW LEVEL SECURITY;

-- Users can read:
-- - Public plans
-- - Team plans where they're a member
-- - Their own unlisted plans
-- - Their own plans (regardless of visibility)
CREATE POLICY shared_plans_select ON shared_plans
  FOR SELECT USING (
    visibility = 'public'
    OR (visibility = 'team' AND team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()))
    OR (visibility = 'unlisted' AND author_id = auth.uid())
    OR author_id = auth.uid()
  );

-- Users can insert their own plans
CREATE POLICY shared_plans_insert ON shared_plans
  FOR INSERT WITH CHECK (
    (is_anonymous = true AND author_id IS NULL)
    OR (is_anonymous = false AND author_id = auth.uid())
  );

-- Users can update their own plans
CREATE POLICY shared_plans_update ON shared_plans
  FOR UPDATE USING (author_id = auth.uid());

-- Users can delete their own plans (soft delete via deletedAt)
CREATE POLICY shared_plans_delete ON shared_plans
  FOR DELETE USING (author_id = auth.uid());

-- ── shared_plan_stars ──────────────────────────────────────────────────────

ALTER TABLE shared_plan_stars ENABLE ROW LEVEL SECURITY;

-- Users can read stars for plans they have visibility to
CREATE POLICY shared_plan_stars_select ON shared_plan_stars
  FOR SELECT USING (
    plan_id IN (
      SELECT id FROM shared_plans
      WHERE visibility = 'public'
        OR (visibility = 'team' AND team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()))
        OR (visibility = 'unlisted' AND author_id = auth.uid())
        OR author_id = auth.uid()
    )
  );

-- Users can star plans (INSERT checks enforced at application level)
CREATE POLICY shared_plan_stars_insert ON shared_plan_stars
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can unstar their own stars
CREATE POLICY shared_plan_stars_delete ON shared_plan_stars
  FOR DELETE USING (user_id = auth.uid());

-- ── shared_plan_forks ──────────────────────────────────────────────────────

ALTER TABLE shared_plan_forks ENABLE ROW LEVEL SECURITY;

-- Users can read forks for plans they have visibility to
CREATE POLICY shared_plan_forks_select ON shared_plan_forks
  FOR SELECT USING (
    source_plan_id IN (
      SELECT id FROM shared_plans
      WHERE visibility = 'public'
        OR (visibility = 'team' AND team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()))
        OR (visibility = 'unlisted' AND author_id = auth.uid())
        OR author_id = auth.uid()
    )
    OR forked_by = auth.uid()
  );

-- Users can fork plans (INSERT checks enforced at application level)
CREATE POLICY shared_plan_forks_insert ON shared_plan_forks
  FOR INSERT WITH CHECK (forked_by = auth.uid());

-- Users cannot delete fork records
-- (forks are permanent historical records)

-- ── shared_plan_comments ───────────────────────────────────────────────────

ALTER TABLE shared_plan_comments ENABLE ROW LEVEL SECURITY;

-- Users can read comments for plans they have visibility to
CREATE POLICY shared_plan_comments_select ON shared_plan_comments
  FOR SELECT USING (
    plan_id IN (
      SELECT id FROM shared_plans
      WHERE visibility = 'public'
        OR (visibility = 'team' AND team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()))
        OR (visibility = 'unlisted' AND author_id = auth.uid())
        OR author_id = auth.uid()
    )
  );

-- Users can comment on plans they have visibility to (checked at application level)
CREATE POLICY shared_plan_comments_insert ON shared_plan_comments
  FOR INSERT WITH CHECK (author_id = auth.uid());

-- Users can update their own comments
CREATE POLICY shared_plan_comments_update ON shared_plan_comments
  FOR UPDATE USING (author_id = auth.uid());

-- Users can delete their own comments (soft delete via deletedAt)
CREATE POLICY shared_plan_comments_delete ON shared_plan_comments
  FOR DELETE USING (author_id = auth.uid());
