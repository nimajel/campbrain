CREATE TABLE "calendar_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"scope" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"target_id" text NOT NULL,
	"key" text NOT NULL,
	"google_event_id" text NOT NULL,
	"summary" text NOT NULL,
	"start_time_iso" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_sync_state" ADD CONSTRAINT "calendar_sync_state_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calendar_conn_user_provider" ON "calendar_connections" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calendar_sync_user_key" ON "calendar_sync_state" USING btree ("user_id","key");