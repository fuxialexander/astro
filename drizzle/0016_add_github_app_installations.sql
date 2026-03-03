-- Add github_app_installations table for GitHub App integration
-- Stores installation records linked to users and optionally teams.

CREATE TABLE IF NOT EXISTS "github_app_installations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" integer NOT NULL UNIQUE,
  "user_id" uuid NOT NULL,
  "team_id" uuid,
  "account_login" text NOT NULL,
  "account_type" text DEFAULT 'Organization' NOT NULL,
  "account_avatar_url" text,
  "app_id" integer,
  "repository_selection" text DEFAULT 'all' NOT NULL,
  "repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "github_app_installations_user_id_idx" ON "github_app_installations" ("user_id");
CREATE INDEX IF NOT EXISTS "github_app_installations_team_id_idx" ON "github_app_installations" ("team_id");
