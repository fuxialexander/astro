-- Add sidebar_config to user_profiles table for multi-device sync
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS sidebar_config JSONB DEFAULT NULL;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_sidebar_config
ON user_profiles USING GIN (sidebar_config);

-- Add comment
COMMENT ON COLUMN user_profiles.sidebar_config IS 'User sidebar navigation customization (items, visibility, order)';
