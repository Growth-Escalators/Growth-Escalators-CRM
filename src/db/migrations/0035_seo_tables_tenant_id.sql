-- H18 (Fable review) — 10 SEO automation tables (keyword_rankings,
-- backlink_data, content_gap_analysis, seo_opportunities,
-- site_health_metrics, brand_mentions, client_pages, client_knowledge_base,
-- seo_weekly_metrics, seo_alerts_log) had no tenant_id at all. None of these
-- tables are ever touched through the Drizzle query builder — every
-- touch-point across the codebase is raw SQL (pool.query / db.execute) keyed
-- on `project_name` / `client_domain`, not tenant_id. The moment a second
-- real tenant exists, any of those raw queries (and the unauthenticated
-- GET /api/system/health/seo-data route) can read or mutate another
-- tenant's SEO data.
--
-- Same shape as 0033 (prospects): add nullable first, backfill from the
-- single existing tenant (today every SEO "client" is a project under the
-- one Growth Escalators tenant — this is a low-risk backfill, not a real
-- multi-tenant migration), THEN set NOT NULL. A plain `ADD COLUMN ... NOT
-- NULL` fails outright against these non-empty tables.
--
-- Unlike 0033, this migration uses IF NOT EXISTS / IF EXISTS / DO-block
-- guards throughout (rather than bare statements) because two of these
-- tables (seo_weekly_metrics, seo_alerts_log) only exist today via
-- `ensureSeoTables()`'s own `CREATE TABLE IF NOT EXISTS` (src/services/
-- seoWorkflowHealthService.ts) — never through a Drizzle migration — so
-- their live shape may or may not already be present in any given
-- environment. The guards make this migration safe to re-run if it's ever
-- partially applied. This migration also folds in schema.ts column-drift
-- reconciliation: ensureSeoTables()/ensureClientPagesTable() have been
-- silently ALTER TABLE ... ADD COLUMN IF NOT EXISTS-ing extra columns onto
-- these tables for years (client_domain, checked_at, clickup_task_id, etc.)
-- that schema.ts never knew about — those are added here too, guarded the
-- same way, since they already exist live in any environment that has
-- booted the app.
--
-- Deliberately NOT done here (explicit, documented follow-up): retiring the
-- now-redundant ensure*() ALTER/CREATE calls. That happens in a later PR,
-- after this migration has been merged and deployed everywhere — removing
-- them now would strip the only thing keeping these columns/tables present
-- on any environment that hasn't yet run migration 0035.
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- client_knowledge_base
-- ---------------------------------------------------------------------------
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "brand_name" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "industry" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "target_audience" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "unique_value_prop" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "primary_keywords" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "tone_of_voice" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "competitors" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "content_themes" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "cta_style" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "ga4_property_id" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "gsc_domain" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "wordpress_url" text;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "target_monthly_traffic" integer;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "client_knowledge_base" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_knowledge_base" ADD CONSTRAINT "client_knowledge_base_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_knowledge_base_tenant_id_idx" ON "client_knowledge_base" USING btree ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- client_pages
-- ---------------------------------------------------------------------------
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "page_slug" text;--> statement-breakpoint
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "page_type" text DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "meta_description" text;--> statement-breakpoint
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "content" text;--> statement-breakpoint
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "client_pages" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "client_pages" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_pages" ADD CONSTRAINT "client_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_pages_tenant_id_idx" ON "client_pages" USING btree ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- keyword_rankings
-- ---------------------------------------------------------------------------
ALTER TABLE "keyword_rankings" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
ALTER TABLE "keyword_rankings" ADD COLUMN IF NOT EXISTS "checked_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "keyword_rankings" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "keyword_rankings" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "keyword_rankings" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "keyword_rankings" ADD CONSTRAINT "keyword_rankings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keyword_rankings_tenant_id_idx" ON "keyword_rankings" USING btree ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- backlink_data
-- ---------------------------------------------------------------------------
ALTER TABLE "backlink_data" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
ALTER TABLE "backlink_data" ADD COLUMN IF NOT EXISTS "checked_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "backlink_data" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "backlink_data" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "backlink_data" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "backlink_data" ADD CONSTRAINT "backlink_data_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backlink_data_tenant_id_idx" ON "backlink_data" USING btree ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- content_gap_analysis
-- ---------------------------------------------------------------------------
ALTER TABLE "content_gap_analysis" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
ALTER TABLE "content_gap_analysis" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "content_gap_analysis" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "content_gap_analysis" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "content_gap_analysis" ADD CONSTRAINT "content_gap_analysis_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_gap_analysis_tenant_id_idx" ON "content_gap_analysis" USING btree ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- seo_opportunities
-- ---------------------------------------------------------------------------
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "clickup_task_id" text;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "clickup_task_url" text;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "priority_score" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "published_url" text;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "outcome" text;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "outcome_measured_at" timestamp;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "keyword" text;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "seo_opportunities" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "seo_opportunities" ADD CONSTRAINT "seo_opportunities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_opportunities_tenant_id_idx" ON "seo_opportunities" USING btree ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- site_health_metrics
-- ---------------------------------------------------------------------------
ALTER TABLE "site_health_metrics" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
ALTER TABLE "site_health_metrics" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "site_health_metrics" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "site_health_metrics" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_health_metrics" ADD CONSTRAINT "site_health_metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_health_metrics_tenant_id_idx" ON "site_health_metrics" USING btree ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- brand_mentions — no client_domain drift column (ensureSeoTables() never
-- added one) and zero code touch-points anywhere; tenant_id only.
-- ---------------------------------------------------------------------------
ALTER TABLE "brand_mentions" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "brand_mentions" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "brand_mentions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "brand_mentions" ADD CONSTRAINT "brand_mentions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_mentions_tenant_id_idx" ON "brand_mentions" USING btree ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- seo_weekly_metrics — not previously Drizzle-tracked; only ever existed via
-- ensureSeoTables()'s CREATE TABLE IF NOT EXISTS. Create it here (matching
-- the exact live shape) so this migration is the source of truth going
-- forward, then apply the same tenant_id treatment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "seo_weekly_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_name" text,
  "client_domain" text,
  "client_name" text,
  "week_start" date,
  "week_start_date" date,
  "total_clicks" integer DEFAULT 0,
  "total_impressions" integer DEFAULT 0,
  "avg_position" numeric,
  "avg_ctr" numeric,
  "total_sessions" integer DEFAULT 0,
  "ga4_sessions" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now()
);--> statement-breakpoint
-- HOTFIX (post-merge production failure): CREATE TABLE IF NOT EXISTS is a
-- no-op against a table that already exists — and it already does, created
-- long ago by an earlier version of ensureSeoTables()'s literal, before
-- several of these columns were added to it. That earlier version never got
-- retrofitted with ALTER statements for client_domain (only week_start has
-- one, at ensureSeoTables():98), so the live table was missing client_domain
-- when the next line's CREATE INDEX ran, and the whole migration transaction
-- rolled back with `column "client_domain" does not exist`. Defensively
-- ALTER every column of this table (matching the CREATE TABLE list exactly)
-- so this is correct regardless of which subset actually exists live.
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "project_name" text;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "client_name" text;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "week_start" date;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "week_start_date" date;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "total_clicks" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "total_impressions" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "avg_position" numeric;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "avg_ctr" numeric;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "total_sessions" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "ga4_sessions" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_weekly_metrics_domain_week_idx" ON "seo_weekly_metrics" USING btree ("client_domain","week_start");--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "seo_weekly_metrics" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "seo_weekly_metrics" ADD CONSTRAINT "seo_weekly_metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_weekly_metrics_tenant_id_idx" ON "seo_weekly_metrics" USING btree ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- seo_alerts_log — same story as seo_weekly_metrics: only ever existed via
-- ensureSeoTables()'s CREATE TABLE IF NOT EXISTS, no Drizzle migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "seo_alerts_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_name" text NOT NULL,
  "alert_type" text,
  "message" text,
  "severity" text DEFAULT 'info',
  "resolved" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now(),
  "client_domain" text
);--> statement-breakpoint
-- Same defensive treatment as seo_weekly_metrics above (see hotfix note
-- there) — this table also predates this CREATE TABLE literal in production,
-- so CREATE TABLE IF NOT EXISTS is a no-op against it. Applying these
-- defensively regardless of which columns are actually already present.
ALTER TABLE "seo_alerts_log" ADD COLUMN IF NOT EXISTS "alert_type" text;--> statement-breakpoint
ALTER TABLE "seo_alerts_log" ADD COLUMN IF NOT EXISTS "message" text;--> statement-breakpoint
ALTER TABLE "seo_alerts_log" ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'info';--> statement-breakpoint
ALTER TABLE "seo_alerts_log" ADD COLUMN IF NOT EXISTS "resolved" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "seo_alerts_log" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "seo_alerts_log" ADD COLUMN IF NOT EXISTS "client_domain" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_alerts_log_created_idx" ON "seo_alerts_log" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "seo_alerts_log" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "seo_alerts_log" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "seo_alerts_log" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "seo_alerts_log" ADD CONSTRAINT "seo_alerts_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_alerts_log_tenant_id_idx" ON "seo_alerts_log" USING btree ("tenant_id");
