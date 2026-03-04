-- User Achievements table for the dashboard gamification system
CREATE TABLE user_achievements (
  user_id    uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  slug       text        NOT NULL,
  earned_at  timestamptz NOT NULL DEFAULT NOW(),
  metadata   jsonb       NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, slug)
);

-- RLS policies
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own achievements"
  ON user_achievements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own achievements"
  ON user_achievements FOR INSERT
  WITH CHECK (auth.uid() = user_id);
