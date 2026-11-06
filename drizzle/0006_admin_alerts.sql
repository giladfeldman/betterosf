CREATE TABLE "admin_alerts" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"priority" text NOT NULL,
	"event" text NOT NULL,
	"summary" text NOT NULL,
	"sample" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"count_since_alert" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_alerted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
