CREATE TABLE "hits" (
	"id" text PRIMARY KEY NOT NULL,
	"saved_search_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"park_page_id" text NOT NULL,
	"park_name" text NOT NULL,
	"campground_name" text NOT NULL,
	"site_name" text NOT NULL,
	"arrival_date" date NOT NULL,
	"nights" integer NOT NULL,
	"booking_url" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"disappeared_at" timestamp with time zone,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"searches_scanned" integer,
	"hits_new" integer,
	"hits_current" integer,
	"emails_sent" integer,
	"parks_scanned" integer,
	"errors" integer
);
--> statement-breakpoint
ALTER TABLE "hits" ADD CONSTRAINT "hits_saved_search_id_saved_searches_id_fk" FOREIGN KEY ("saved_search_id") REFERENCES "public"."saved_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hits_search_site_arrival" ON "hits" USING btree ("saved_search_id","site_name","arrival_date");--> statement-breakpoint
CREATE INDEX "idx_hits_user" ON "hits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_hits_unnotified" ON "hits" USING btree ("saved_search_id") WHERE notified_at IS NULL;