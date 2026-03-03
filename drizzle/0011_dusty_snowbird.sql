CREATE INDEX "skills_team_id_idx" ON "skills" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "skills_team_enabled_idx" ON "skills" USING btree ("team_id","enabled");--> statement-breakpoint
CREATE INDEX "skills_name_source_idx" ON "skills" USING btree ("name","source");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_builtin_name_unique" ON "skills" USING btree ("name") WHERE "skills"."source" = 'builtin';--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_source_check" CHECK ("skills"."source" IN ('builtin', 'workspace', 'clawhub', 'plugin', 'user'));