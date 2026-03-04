CREATE INDEX "skills_author_id_idx" ON "skills" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "skills_category_idx" ON "skills" USING btree ("category");--> statement-breakpoint
CREATE INDEX "skills_enabled_idx" ON "skills" USING btree ("enabled");