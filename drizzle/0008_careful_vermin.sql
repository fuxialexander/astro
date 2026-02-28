CREATE TABLE "streaming_events" (
	"seq" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "streaming_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"execution_id" text NOT NULL,
	"event_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
