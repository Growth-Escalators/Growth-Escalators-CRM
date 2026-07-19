-- seo-learning-loop (PR #69) — brings seo_content_calendar into schema.ts
-- (previously only existed via ensureContentCalendarTable()'s CREATE TABLE
-- IF NOT EXISTS in seoContentGapService.ts) and adds the opportunity_id FK
-- link that lets a calendar row's "published" status propagate back to the
-- seo_opportunities row it was created from — this is what makes the
-- existing 14-day outcome check in seoDigestService.ts able to fire.
--
-- Lesson learned the hard way from migration 0035 failing in production
-- (seo_weekly_metrics/seo_alerts_log had drifted incrementally in prod,
-- so CREATE TABLE IF NOT EXISTS silently no-op'd and later statements
-- referencing "new" columns failed): defensively ALTER ADD COLUMN IF NOT
-- EXISTS every column here too, even though ensureContentCalendarTable()'s
-- current DDL already includes all of these except opportunity_id — don't
-- trust that the live table matches the current ensure* literal exactly.
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
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "tenant_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001';--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "keyword" text;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "content_type" text DEFAULT 'blog';--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "title" text;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'planned';--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "source" text;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "source_id" text;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "opportunity_id" uuid;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "target_publish_date" date;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "published_url" text;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "assigned_to" text;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "seo_content_calendar" ADD CONSTRAINT "seo_content_calendar_opportunity_id_seo_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."seo_opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seo_content_calendar_unique_idx" ON "seo_content_calendar" USING btree ("client_domain","keyword","content_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_calendar_status_idx" ON "seo_content_calendar" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_calendar_client_idx" ON "seo_content_calendar" USING btree ("client_domain");
