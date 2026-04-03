CREATE TABLE "machine_team_shares" (
	"machine_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"shared_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "machine_team_shares_machine_id_team_id_pk" PRIMARY KEY("machine_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "machine_team_shares" ADD CONSTRAINT "machine_team_shares_machine_id_registered_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."registered_machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_team_shares" ADD CONSTRAINT "machine_team_shares_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;