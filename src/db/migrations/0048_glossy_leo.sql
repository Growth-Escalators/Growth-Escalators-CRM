-- ---------------------------------------------------------------------------
-- 0046 — seo_sites registry + nullable site_id on the nine SEO tables
--
-- WHY THIS FILE IS HAND-WRITTEN (drizzle-kit generated the skeleton, a human
-- rewrote it):
--
-- 1. `ensureSeoTables()` in seoWorkflowHealthService.ts creates and alters
--    several of these tables at runtime, so the live schema drifts ahead of
--    the migration history. Every statement here is therefore idempotent
--    (IF NOT EXISTS / duplicate_object-swallowing DO blocks). Without that,
--    re-running against a drifted database aborts — and Railway applies
--    migrations on boot, so an aborted migration means the API does not start.
--
-- 2. drizzle-kit cannot express the seed + backfill in steps 3 and 4, which
--    are the actual point of the migration. An empty registry alongside nine
--    always-NULL columns would be dead weight; seeding from the domains the
--    system already works on is what makes site_id mean something.
--
-- SAFETY: every column added here is NULLABLE and nothing reads it yet. This
-- migration cannot break a running system the way 0045 could have — there is
-- no SET NOT NULL, no unique index over existing data, and no DROP.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The registry table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "seo_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid,
	"label" text NOT NULL,
	"domain" text NOT NULL,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"adapter_config" jsonb DEFAULT '{}'::jsonb,
	"credential_provider" text,
	"gsc_property" text,
	"ga4_property_id" text,
	"risk_profile" text DEFAULT 'standard' NOT NULL,
	"required_checks" text[] DEFAULT '{}',
	"auto_publish_allowed" boolean DEFAULT false NOT NULL,
	"observation_window_days" integer DEFAULT 21 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "seo_sites" ADD CONSTRAINT "seo_sites_tenant_id_tenants_id_fk"
		FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "seo_sites" ADD CONSTRAINT "seo_sites_client_id_clients_id_fk"
		FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "seo_sites_tenant_id_idx" ON "seo_sites" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seo_sites_tenant_id_domain_uniq" ON "seo_sites" USING btree ("tenant_id","domain");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Nullable site_id on every SEO table
--
-- Nullable, not NOT NULL: ~135 raw SQL statements across 22 files still read
-- project_name/client_domain, and those reads migrate service-by-service. A
-- NOT NULL here would require every one of them to be converted in this same
-- deploy. Tightening it is a later migration, once the last string read is gone.
-- ---------------------------------------------------------------------------
ALTER TABLE "backlink_data" ADD COLUMN IF NOT EXISTS "site_id" uuid;--> statement-breakpoint
ALTER TABLE "client_knowledge_base" ADD COLUMN IF NOT EXISTS "site_id" uuid;--> statement-breakpoint
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "site_id" uuid;--> statement-breakpoint
ALTER TABLE "keyword_rankings" ADD COLUMN IF NOT EXISTS "site_id" uuid;--> statement-breakpoint
ALTER TABLE "seo_alerts_log" ADD COLUMN IF NOT EXISTS "site_id" uuid;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ADD COLUMN IF NOT EXISTS "site_id" uuid;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD COLUMN IF NOT EXISTS "site_id" uuid;--> statement-breakpoint
ALTER TABLE "seo_weekly_metrics" ADD COLUMN IF NOT EXISTS "site_id" uuid;--> statement-breakpoint
ALTER TABLE "site_health_metrics" ADD COLUMN IF NOT EXISTS "site_id" uuid;--> statement-breakpoint

DO $$ BEGIN ALTER TABLE "backlink_data" ADD CONSTRAINT "backlink_data_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_knowledge_base" ADD CONSTRAINT "client_knowledge_base_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_pages" ADD CONSTRAINT "client_pages_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "keyword_rankings" ADD CONSTRAINT "keyword_rankings_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "seo_alerts_log" ADD CONSTRAINT "seo_alerts_log_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "seo_content_calendar" ADD CONSTRAINT "seo_content_calendar_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "seo_opportunities" ADD CONSTRAINT "seo_opportunities_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "seo_weekly_metrics" ADD CONSTRAINT "seo_weekly_metrics_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "site_health_metrics" ADD CONSTRAINT "site_health_metrics_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "backlink_data_site_id_idx" ON "backlink_data" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_knowledge_base_site_id_idx" ON "client_knowledge_base" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_pages_site_id_idx" ON "client_pages" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keyword_rankings_site_id_idx" ON "keyword_rankings" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_alerts_log_site_id_idx" ON "seo_alerts_log" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_content_calendar_site_id_idx" ON "seo_content_calendar" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_opportunities_site_id_idx" ON "seo_opportunities" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_weekly_metrics_site_id_idx" ON "seo_weekly_metrics" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_health_metrics_site_id_idx" ON "site_health_metrics" USING btree ("site_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Seed the registry from the domains the system already works on
--
-- Normalisation must match seoSiteRegistry.normaliseDomain() exactly, or the
-- backfill in step 4 silently matches nothing: lowercase, trim, strip
-- scheme, strip a leading `www.`, strip anything from the first `/` onward,
-- strip a trailing dot. Rows whose client_domain is null/blank, or which
-- normalise to something without a dot (a bare project name, not a domain),
-- are skipped — a junk registry row is worse than a missing one.
--
-- ON CONFLICT DO NOTHING makes this re-runnable and means a site an operator
-- has already registered by hand keeps its own label/platform/config.
-- ---------------------------------------------------------------------------
INSERT INTO "seo_sites" ("tenant_id", "label", "domain", "platform", "status")
SELECT
	d.tenant_id,
	d.domain AS label,
	d.domain,
	'unknown',
	'active'
FROM (
	SELECT DISTINCT
		t.tenant_id,
		regexp_replace(
			regexp_replace(
				split_part(regexp_replace(lower(btrim(t.client_domain)), '^[a-z][a-z0-9+.-]*:(//)?', ''), '/', 1),
				'^www\.', ''
			),
			'\.$', ''
		) AS domain
	FROM (
		SELECT tenant_id, client_domain FROM client_knowledge_base
		UNION ALL SELECT tenant_id, client_domain FROM client_pages
		UNION ALL SELECT tenant_id, client_domain FROM keyword_rankings
		UNION ALL SELECT tenant_id, client_domain FROM backlink_data
		UNION ALL SELECT tenant_id, client_domain FROM seo_opportunities
		UNION ALL SELECT tenant_id, client_domain FROM site_health_metrics
		UNION ALL SELECT tenant_id, client_domain FROM seo_weekly_metrics
		UNION ALL SELECT tenant_id, client_domain FROM seo_alerts_log
		UNION ALL SELECT tenant_id, client_domain FROM seo_content_calendar
	) t
	WHERE t.client_domain IS NOT NULL
	  AND btrim(t.client_domain) <> ''
	  AND t.tenant_id IS NOT NULL
) d
WHERE d.domain <> ''
  AND d.domain LIKE '%.%'
  AND EXISTS (SELECT 1 FROM tenants WHERE tenants.id = d.tenant_id)
ON CONFLICT ("tenant_id", "domain") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Backfill site_id on every SEO table
--
-- Joined on BOTH tenant_id and the normalised domain. Joining on domain alone
-- would cross-link two tenants that legitimately work on the same domain —
-- which is the exact failure this whole registry exists to prevent.
--
-- Rows whose client_domain is null or unresolvable keep site_id NULL. That is
-- expected and fine: the column is nullable and nothing reads it yet.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
	tbl text;
	updated bigint;
	total bigint := 0;
BEGIN
	FOREACH tbl IN ARRAY ARRAY[
		'client_knowledge_base', 'client_pages', 'keyword_rankings', 'backlink_data',
		'seo_opportunities', 'site_health_metrics', 'seo_weekly_metrics',
		'seo_alerts_log', 'seo_content_calendar'
	] LOOP
		EXECUTE format($fmt$
			UPDATE %I AS tgt
			SET site_id = s.id
			FROM seo_sites s
			WHERE tgt.site_id IS NULL
			  AND tgt.client_domain IS NOT NULL
			  AND s.tenant_id = tgt.tenant_id
			  AND s.domain = regexp_replace(
					regexp_replace(
						split_part(regexp_replace(lower(btrim(tgt.client_domain)), '^[a-z][a-z0-9+.-]*:(//)?', ''), '/', 1),
						'^www\.', ''
					),
					'\.$', ''
				)
		$fmt$, tbl);
		GET DIAGNOSTICS updated = ROW_COUNT;
		total := total + updated;
		RAISE NOTICE '[0046] backfilled site_id on % rows in %', updated, tbl;
	END LOOP;
	RAISE NOTICE '[0046] site_id backfill complete — % rows stamped across 9 tables', total;
END $$;
