ALTER TABLE "shared_plans" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "shared_plans_featured_idx" ON "shared_plans" USING btree ("featured");