CREATE TABLE "references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"zotero_key" text,
	"zotero_library_id" text,
	"zotero_version" integer,
	"csl_json" jsonb NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"authors" text DEFAULT '' NOT NULL,
	"year" text,
	"doi" text,
	"abstract" text,
	"item_type" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zotero_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"library_type" text NOT NULL,
	"library_id" text NOT NULL,
	"library_name" text DEFAULT '' NOT NULL,
	"last_sync_version" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "zotero_sync_state_user_library_unique" UNIQUE("user_id","library_type","library_id")
);
--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "references_user_id_idx" ON "references" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "references_team_id_idx" ON "references" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "references_source_idx" ON "references" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "references_zotero_key_library_user_idx" ON "references" USING btree ("user_id","zotero_key","zotero_library_id") WHERE "references"."zotero_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "references_doi_idx" ON "references" USING btree ("doi");--> statement-breakpoint
CREATE INDEX "zotero_sync_state_user_id_idx" ON "zotero_sync_state" USING btree ("user_id");