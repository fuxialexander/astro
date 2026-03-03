ALTER TABLE "skills" ADD CONSTRAINT "skills_builtin_null_ownership" CHECK ("skills"."source" != 'builtin' OR ("skills"."team_id" IS NULL AND "skills"."author_id" IS NULL));
