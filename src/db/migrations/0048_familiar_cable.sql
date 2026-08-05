-- ---------------------------------------------------------------------------
-- 0048 — site_changes + seo_site_snapshots
--
-- The two tables behind Phase 3: staged, human-approved edits to live client
-- websites (site_changes) and the append-only record of what each tracked URL
-- actually looked like on each sweep (seo_site_snapshots).
--
-- WHY THIS FILE IS HAND-WRITTEN (drizzle-kit generated the skeleton, a human
-- rewrote it): same reason as 0046/0047 — Railway applies migrations on boot,
-- so a statement that aborts on re-run means the API does not start. Every
-- statement here is idempotent (IF NOT EXISTS / duplicate_object-swallowing DO
-- blocks), including the CHECK constraint, which drizzle-kit emitted inline in
-- CREATE TABLE where a pre-existing table would silently skip it.
--
-- SAFETY: purely additive. Two new tables, no ALTER of an existing table, no
-- DROP, no SET NOT NULL over existing data, no unique index over rows that
-- already exist. Nothing reads these tables until the Phase 3 service does.
--
-- THE ONE CONSTRAINT THAT MATTERS: site_changes_approved_requires_approver.
-- It is the database-level half of the human-approval hard stop — no row can
-- sit in 'approved'/'publishing'/'published'/'handoff_required' without both a
-- recorded approver and a recorded approval time. assertSiteChangeApproved()
-- in src/services/siteChangeService.ts is the application-level half. Two
-- independent enforcement points, deliberately, because the failure mode this
-- guards against is the system editing a client's live website with nobody's
-- consent.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. site_changes — one row per proposed edit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "site_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"change_kind" text DEFAULT 'page_update' NOT NULL,
	"page_url" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"staged_ref" text,
	"preview_url" text,
	"diff" text,
	"staged_at" timestamp,
	"verify_passed" boolean,
	"verify_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp,
	"approved_by" uuid,
	"approved_at" timestamp,
	"rejected_by" uuid,
	"rejected_at" timestamp,
	"decision_reason" text,
	"publish_request_id" uuid,
	"published_at" timestamp,
	"live_url" text,
	"external_ref" text,
	"publish_result" jsonb,
	"last_error" text,
	"last_error_at" timestamp,
	"verified_live_at" timestamp,
	"superseded_by_change_id" uuid,
	"source" text DEFAULT 'admin' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. seo_site_snapshots — append-only drift record
--
-- `elements` holds the extracted SEO surface only, never the page HTML. See
-- the docblock on seoSiteSnapshots in src/db/schema.ts for the sizing that
-- makes that a hard rule rather than a preference.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "seo_site_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"page_url" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"http_status" integer NOT NULL,
	"content_hash" text NOT NULL,
	"elements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"drift_kind" text,
	"drift_severity" text,
	"changed_fields" text[] DEFAULT '{}',
	"matched_change_id" uuid,
	"alerted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Foreign keys
--
-- Added after both CREATE TABLEs because seo_site_snapshots.matched_change_id
-- points at site_changes and site_changes.superseded_by_change_id points at
-- itself.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
	ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_tenant_id_tenants_id_fk"
		FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_site_id_seo_sites_id_fk"
		FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_approved_by_users_id_fk"
		FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_rejected_by_users_id_fk"
		FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_created_by_users_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_superseded_by_change_id_fkey"
		FOREIGN KEY ("superseded_by_change_id") REFERENCES "public"."site_changes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "seo_site_snapshots" ADD CONSTRAINT "seo_site_snapshots_tenant_id_tenants_id_fk"
		FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "seo_site_snapshots" ADD CONSTRAINT "seo_site_snapshots_site_id_seo_sites_id_fk"
		FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "seo_site_snapshots" ADD CONSTRAINT "seo_site_snapshots_matched_change_id_site_changes_id_fk"
		FOREIGN KEY ("matched_change_id") REFERENCES "public"."site_changes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. The hard stop, in the database
--
-- Pulled out of the inline CREATE TABLE that drizzle-kit generated: inline, it
-- would be skipped entirely against a table that already exists (the
-- IF NOT EXISTS path), which is precisely the case where a half-applied
-- migration would otherwise leave the most important constraint in this file
-- silently absent.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
	ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_approved_requires_approver"
		CHECK ("site_changes"."status" NOT IN ('approved', 'publishing', 'published', 'handoff_required', 'publish_failed')
			OR ("site_changes"."approved_by" IS NOT NULL AND "site_changes"."approved_at" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "site_changes_tenant_id_idx" ON "site_changes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_changes_site_id_idx" ON "site_changes" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_changes_tenant_status_idx" ON "site_changes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_changes_site_page_idx" ON "site_changes" USING btree ("site_id","page_url");--> statement-breakpoint
-- Nullable-unique: Postgres treats NULLs as distinct, so every un-published
-- change can hold NULL here while two concurrent publish attempts cannot claim
-- the same request id.
CREATE UNIQUE INDEX IF NOT EXISTS "site_changes_publish_request_id_uniq" ON "site_changes" USING btree ("publish_request_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "seo_site_snapshots_tenant_id_idx" ON "seo_site_snapshots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_site_snapshots_site_id_idx" ON "seo_site_snapshots" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_site_snapshots_site_page_fetched_idx" ON "seo_site_snapshots" USING btree ("site_id","page_url","fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_site_snapshots_tenant_drift_idx" ON "seo_site_snapshots" USING btree ("tenant_id","drift_kind");
