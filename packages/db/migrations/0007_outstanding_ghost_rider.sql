CREATE TABLE "park_digests" (
	"provider" text NOT NULL,
	"park_page_id" text NOT NULL,
	"as_of" timestamp with time zone,
	"digest" jsonb NOT NULL,
	"site_class" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "park_digests_provider_park_page_id_pk" PRIMARY KEY("provider","park_page_id")
);
--> statement-breakpoint
ALTER TABLE "park_digests" ADD CONSTRAINT "park_digests_provider_providers_provider_id_fk" FOREIGN KEY ("provider") REFERENCES "public"."providers"("provider_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "park_digests" ADD CONSTRAINT "park_digests_provider_park_page_id_parks_provider_id_park_page_id_fk" FOREIGN KEY ("provider","park_page_id") REFERENCES "public"."parks"("provider_id","park_page_id") ON DELETE cascade ON UPDATE no action;