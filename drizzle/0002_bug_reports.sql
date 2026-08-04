-- Bug reports / feedback inbox (2026-08-04).
--
-- Written by hand rather than shipped as drizzle-kit generated it. The
-- generated file also contained `CREATE TABLE email_events`, because the
-- committed snapshot predates the hand-applied 0001_email_events.sql migration
-- and drizzle therefore believed that table did not exist. Applying it verbatim
-- would have failed against the live database (email_events is already there),
-- so this migration adds ONLY the genuinely new table.
--
-- IF NOT EXISTS throughout so re-running is safe.

CREATE TABLE IF NOT EXISTS "bug_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text DEFAULT 'bug' NOT NULL,
	"message" text NOT NULL,
	"contact_email" text,
	"page_url" text,
	"app_version" text,
	"user_agent" text,
	"user_id" text,
	"osf_user_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"admin_notes" text
);

DO $$ BEGIN
	ALTER TABLE "bug_reports"
		ADD CONSTRAINT "bug_reports_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
		ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "bug_reports_created_idx"
	ON "bug_reports" USING btree ("created_at");

CREATE INDEX IF NOT EXISTS "bug_reports_status_created_idx"
	ON "bug_reports" USING btree ("status","created_at");
