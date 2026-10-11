CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"display_name" text,
	"industry" text,
	"employee_count" integer,
	"size_range" text,
	"revenue" text,
	"founded_year" integer,
	"website" text,
	"linkedin_url" text,
	"location" text,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_lower_idx" ON "companies" USING btree (lower("name"));