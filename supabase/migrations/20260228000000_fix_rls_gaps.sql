-- Fix RLS gaps identified in user-scoping audit
-- 1. Enable RLS on audit_logs (was missing)
-- 2. Add policies to observation_events (RLS enabled but no policies)
-- 3. Enable RLS on system/transient tables for defense-in-depth

-- ============================================================================
-- 1. audit_logs — RLS was never enabled (CRITICAL: data exposure)
-- ============================================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own audit logs"
  ON audit_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 2. observation_events — RLS enabled but zero policies (blocked access)
-- ============================================================================
-- observation_events already has RLS enabled from the migration that created it,
-- but no policies were ever added. Add them now.

CREATE POLICY "Users can view observations from accessible projects"
  ON observation_events FOR SELECT
  USING (
    project_id IS NULL
    OR user_has_project_access(project_id)
  );

CREATE POLICY "Service role can insert observations"
  ON observation_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update observations"
  ON observation_events FOR UPDATE
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 3. streaming_events — contains execution output, should be project-scoped
-- ============================================================================
ALTER TABLE streaming_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view events from accessible executions"
  ON streaming_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM task_executions te
      WHERE te.execution_id = streaming_events.execution_id
      AND user_has_project_access(te.project_id)
    )
  );

CREATE POLICY "Service role can insert streaming events"
  ON streaming_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 4. System/transient tables — service-role-only for defense-in-depth
-- ============================================================================

-- chat_sessions (SDK session pool)
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages chat sessions"
  ON chat_sessions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- shared_bundles (export bundles — intentionally public for read, service for write)
ALTER TABLE shared_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view shared bundles"
  ON shared_bundles FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage shared bundles"
  ON shared_bundles FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can delete shared bundles"
  ON shared_bundles FOR DELETE
  USING (auth.role() = 'service_role');

-- dispatch_queue_entries (internal execution queue)
ALTER TABLE dispatch_queue_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages dispatch queue"
  ON dispatch_queue_entries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- webauthn_challenges (short-lived auth state)
ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages webauthn challenges"
  ON webauthn_challenges FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- device_codes (OAuth2 device auth state)
ALTER TABLE device_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages device codes"
  ON device_codes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
