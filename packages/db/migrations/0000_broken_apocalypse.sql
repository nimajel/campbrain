CREATE TABLE "access_allowlist" (
	"email" text PRIMARY KEY NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability" (
	"site_id" integer NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "availability_site_id_date_pk" PRIMARY KEY("site_id","date"),
	CONSTRAINT "availability_status_check" CHECK (status IN ('available', 'unavailable', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "campgrounds" (
	"provider_id" text NOT NULL,
	"park_page_id" text NOT NULL,
	"campground_name" text NOT NULL,
	"campground_id" text NOT NULL,
	"nightly_fee" numeric(8, 2),
	"booking_url" text,
	CONSTRAINT "campgrounds_provider_id_park_page_id_campground_name_pk" PRIMARY KEY("provider_id","park_page_id","campground_name")
);
--> statement-breakpoint
CREATE TABLE "parks" (
	"provider_id" text NOT NULL,
	"park_page_id" text NOT NULL,
	"park_name" text NOT NULL,
	CONSTRAINT "parks_provider_id_park_page_id_pk" PRIMARY KEY("provider_id","park_page_id")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"base_url" text
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"provider" text DEFAULT 'california-parks' NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"alert_enabled" boolean DEFAULT false NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_windows" (
	"provider_id" text NOT NULL,
	"park_page_id" text NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"source_url" text NOT NULL,
	CONSTRAINT "scan_windows_provider_id_park_page_id_window_start_pk" PRIMARY KEY("provider_id","park_page_id","window_start")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"site_id" serial PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"park_page_id" text NOT NULL,
	"campground_name" text NOT NULL,
	"site_name" text NOT NULL,
	"access" text DEFAULT 'drive_in' NOT NULL,
	"site_kind" text,
	"is_group" boolean DEFAULT false NOT NULL,
	"is_equestrian" boolean DEFAULT false NOT NULL,
	"is_walk_up" boolean DEFAULT false NOT NULL,
	"is_day_use" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sites_provider_id_park_page_id_campground_name_site_name_unique" UNIQUE("provider_id","park_page_id","campground_name","site_name")
);
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campgrounds" ADD CONSTRAINT "campgrounds_provider_id_park_page_id_parks_provider_id_park_page_id_fk" FOREIGN KEY ("provider_id","park_page_id") REFERENCES "public"."parks"("provider_id","park_page_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parks" ADD CONSTRAINT "parks_provider_id_providers_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("provider_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_provider_providers_provider_id_fk" FOREIGN KEY ("provider") REFERENCES "public"."providers"("provider_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_windows" ADD CONSTRAINT "scan_windows_provider_id_park_page_id_parks_provider_id_park_page_id_fk" FOREIGN KEY ("provider_id","park_page_id") REFERENCES "public"."parks"("provider_id","park_page_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_provider_id_park_page_id_campground_name_campgrounds_provider_id_park_page_id_campground_name_fk" FOREIGN KEY ("provider_id","park_page_id","campground_name") REFERENCES "public"."campgrounds"("provider_id","park_page_id","campground_name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_availability_date" ON "availability" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_availability_available" ON "availability" USING btree ("date") WHERE status = 'available';--> statement-breakpoint
CREATE INDEX "idx_saved_searches_user" ON "saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_saved_searches_alert_enabled" ON "saved_searches" USING btree ("alert_enabled") WHERE alert_enabled = true;--> statement-breakpoint
CREATE INDEX "idx_scan_windows_end" ON "scan_windows" USING btree ("window_end");--> statement-breakpoint
CREATE INDEX "idx_sites_park" ON "sites" USING btree ("provider_id","park_page_id");