CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"type" text NOT NULL,
	"channel" text,
	"summary" text,
	"meta" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"found" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"reposts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'craigslist' NOT NULL,
	"search_id" integer,
	"url" text NOT NULL,
	"post_id" text,
	"area" text,
	"category" text,
	"title" text NOT NULL,
	"company" text,
	"job_title" text,
	"compensation" text,
	"employment_type" text,
	"location" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"body" text,
	"posted_at" timestamp with time zone,
	"valid_through" timestamp with time zone,
	"content_hash" text NOT NULL,
	"repost_count" integer DEFAULT 0 NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"website" text,
	"notes" text,
	"next_follow_up_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source" text DEFAULT 'craigslist' NOT NULL,
	"area" text NOT NULL,
	"category" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"exclude_terms" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD CONSTRAINT "fetch_runs_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_listing_idx" ON "activities" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "activities_type_at_idx" ON "activities" USING btree ("type","at");--> statement-breakpoint
CREATE INDEX "listings_stage_idx" ON "listings" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "listings_hash_idx" ON "listings" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "listings_posted_idx" ON "listings" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "listings_follow_up_idx" ON "listings" USING btree ("next_follow_up_at");