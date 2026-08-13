CREATE TABLE "transition_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"osf_user_id" text NOT NULL,
	"terms_version" text NOT NULL,
	"scope" text NOT NULL,
	"job_id" text,
	"typed_phrase" text,
	"item_count" integer,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transition_consents" ADD CONSTRAINT "transition_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transition_consents_osf_user_idx" ON "transition_consents" USING btree ("osf_user_id","accepted_at");--> statement-breakpoint
CREATE INDEX "transition_consents_scope_idx" ON "transition_consents" USING btree ("osf_user_id","scope","terms_version");