CREATE TABLE "transition_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"osf_user_id" text NOT NULL,
	"osf_file_id" text NOT NULL,
	"path" text NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"local_sha256" text,
	"local_md5" text,
	"remote_md5" text,
	"shard_index" integer DEFAULT 0 NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transition_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"osf_user_id" text NOT NULL,
	"guid" text NOT NULL,
	"destination" text NOT NULL,
	"env" text NOT NULL,
	"status" text NOT NULL,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"bytes_total" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transition_items" ADD CONSTRAINT "transition_items_job_id_transition_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."transition_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_jobs" ADD CONSTRAINT "transition_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transition_items_job_file_uidx" ON "transition_items" USING btree ("job_id","osf_file_id");--> statement-breakpoint
CREATE INDEX "transition_items_job_idx" ON "transition_items" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "transition_jobs_user_updated_idx" ON "transition_jobs" USING btree ("osf_user_id","updated_at");