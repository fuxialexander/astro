CREATE TABLE "reference_collection_items" (
	"collection_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_collection_items_collection_id_reference_id_pk" PRIMARY KEY("collection_id","reference_id")
);
--> statement-breakpoint
CREATE TABLE "reference_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid,
	"csl_json" jsonb NOT NULL,
	"csl_type" text NOT NULL,
	"title" text NOT NULL,
	"doi" text,
	"pmid" text,
	"arxiv_id" text,
	"pdf_path" text,
	"pdf_url" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"zotero_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reference_collection_items" ADD CONSTRAINT "reference_collection_items_collection_id_reference_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."reference_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_collection_items" ADD CONSTRAINT "reference_collection_items_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_collections" ADD CONSTRAINT "reference_collections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reference_collections_team_id_idx" ON "reference_collections" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "reference_collections_parent_id_idx" ON "reference_collections" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "references_team_id_idx" ON "references" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "references_project_id_idx" ON "references" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "references_title_idx" ON "references" USING btree ("title");--> statement-breakpoint
CREATE INDEX "references_doi_idx" ON "references" USING btree ("doi");--> statement-breakpoint
CREATE INDEX "references_csl_type_idx" ON "references" USING btree ("csl_type");