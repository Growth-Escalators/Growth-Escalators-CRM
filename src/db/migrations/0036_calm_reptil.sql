-- SEO Learning Loop — link seo_content_calendar rows to the seo_opportunities
-- row they were created from. Closes the outcome-measurement loop that
-- seoDigestService.ts already reads (published_url -> 14-day rank check) but
-- that could never fire, because nothing anywhere set published_url on
-- seo_opportunities.
--
-- seo_content_calendar already exists in production (created via
-- ensureContentCalendarTable()'s CREATE TABLE IF NOT EXISTS in
-- seoContentGapService.ts) — this migration is drizzle's first time tracking
-- it in schema.ts, so every statement is IF NOT EXISTS / idempotent, same
-- house style as 0013 and 0017.

CREATE TABLE IF NOT EXISTS "seo_content_calendar" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001',
	"client_domain" text NOT NULL,
	"keyword" text NOT NULL,
	"content_type" text DEFAULT 'blog' NOT NULL,
	"title" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"priority" text DEFAULT 'medium',
	"source" text,
	"source_id" text,
	"opportunity_id" uuid,
	"target_publish_date" date,
	"published_url" text,
	"assigned_to" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
-- Table already exists in production without this column — CREATE TABLE IF
-- NOT EXISTS above is a no-op there, so add the column directly too.
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "opportunity_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "seo_content_calendar" ADD CONSTRAINT "seo_content_calendar_opportunity_id_seo_opportunities_id_fk"
		FOREIGN KEY ("opportunity_id") REFERENCES "public"."seo_opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seo_content_calendar_unique_idx" ON "seo_content_calendar" USING btree ("client_domain","keyword","content_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_calendar_status_idx" ON "seo_content_calendar" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_calendar_client_idx" ON "seo_content_calendar" USING btree ("client_domain");
