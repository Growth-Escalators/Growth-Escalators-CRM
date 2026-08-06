-- ---------------------------------------------------------------------------
-- 0045 — SEO tenant hardening (Phase 1)
--
-- WHY THIS IS HAND-EDITED (same lesson as 0035/0036):
--
-- 1. drizzle-kit generated `ALTER COLUMN tenant_id SET NOT NULL` and the FK to
--    tenants(id) with NO backfill. `seo_content_calendar.tenant_id` previously
--    defaulted to the sentinel '00000000-0000-0000-0000-000000000001', which is
--    NOT a real row in `tenants` (verified). Every pre-0045 row therefore points
--    at a tenant that does not exist, so both the NOT NULL and the FK would
--    abort. Railway applies migrations on boot, so an aborted migration means
--    the API does not start. The backfill below MUST run first.
--
-- 2. `ensure*` hooks (ensureSeoTables / ensureContentCalendarTable /
--    ensureClientPagesTable) create and drift these tables at runtime, so
--    CREATE ... IF NOT EXISTS silently no-ops and a later CREATE INDEX on a
--    "new" column aborts the whole transaction. Hence: ADD COLUMN IF NOT
--    EXISTS on every column, CREATE INDEX IF NOT EXISTS, and every constraint
--    add wrapped in an exception-swallowing DO block.
--
-- DELIBERATELY NOT IN THIS MIGRATION:
--   * DROP of `seo_content_calendar_unique_idx` (the 3-column unique index).
--     Running code still does ON CONFLICT (client_domain, keyword,
--     content_type); dropping it here would make every in-flight POST throw
--     `no unique or exclusion constraint matching`. Drop it in a later
--     migration, after the conflict target has moved to 4 columns.
--   * UNIQUE (tenant_id, client_domain, page_slug) on `client_pages`.
--     Duplicates demonstrably exist in prod (publishPendingToWordPress()
--     dedupes in JS for exactly this reason), so the index would abort the
--     migration. It needs a DELETE-dedupe first = irreversible data loss on a
--     database with no backups. Deferred to its own migration + sign-off.
-- ---------------------------------------------------------------------------

-- --- 1. client_pages: approval metadata (additive, safe) -------------------
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "client_pages" ADD COLUMN IF NOT EXISTS "rejected_reason" text;--> statement-breakpoint

-- --- 2. seo_content_calendar: BACKFILL BEFORE constraining ------------------
-- Repoint every orphaned/NULL tenant_id at the growth-escalators tenant. All
-- SEO "clients" today are projects under that single tenant (see
-- seoTenantContext.ts), so this is the correct owner. Guarded so it is a no-op
-- if that tenant row is somehow absent, rather than writing NULLs.
UPDATE "seo_content_calendar"
SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'growth-escalators' LIMIT 1)
WHERE EXISTS (SELECT 1 FROM "tenants" WHERE "slug" = 'growth-escalators')
  AND (
    "tenant_id" IS NULL
    OR "tenant_id" NOT IN (SELECT "id" FROM "tenants")
  );--> statement-breakpoint

-- Fail loudly and early if anything is still unattributable, instead of
-- letting the NOT NULL below produce a confusing constraint error.
DO $$
DECLARE orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM "seo_content_calendar"
  WHERE "tenant_id" IS NULL OR "tenant_id" NOT IN (SELECT "id" FROM "tenants");
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      '0045: % seo_content_calendar row(s) still have no valid tenant_id — backfill did not resolve them; refusing to add NOT NULL/FK',
      orphan_count;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "seo_content_calendar" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "seo_content_calendar" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "seo_content_calendar"
    ADD CONSTRAINT "seo_content_calendar_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- New tenant-scoped unique index, created ALONGSIDE the old 3-column one so
-- both are valid while the code's ON CONFLICT target moves over.
CREATE UNIQUE INDEX IF NOT EXISTS "seo_content_calendar_tenant_unique_idx"
  ON "seo_content_calendar" USING btree ("tenant_id","client_domain","keyword","content_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_content_calendar_tenant_id_idx"
  ON "seo_content_calendar" USING btree ("tenant_id");--> statement-breakpoint

-- --- 3. seo_workflow_logs: tenant attribution ------------------------------
-- Raw-only table (created by ensureSeoWorkflowLogsTable(), never tracked in
-- schema.ts), so drizzle-kit cannot emit this. Both the write path
-- (logSeoWorkflowRun) and the read path (checkWorkflowHealth's GROUP BY
-- workflow_id) are tenant-blind today. Column is added nullable — backfilling
-- and constraining it belongs with the code change that starts writing it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'seo_workflow_logs') THEN
    ALTER TABLE "seo_workflow_logs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
    CREATE INDEX IF NOT EXISTS "seo_workflow_logs_tenant_id_idx"
      ON "seo_workflow_logs" USING btree ("tenant_id");
  END IF;
END $$;--> statement-breakpoint

-- --- 4. Drop the unused Looker views ---------------------------------------
-- These 4 views were rebuilt by ensureSeoTables() on EVERY boot and, worse, on
-- every hit to the unauthenticated GET /api/system/health/seo-data. None of
-- them select or filter tenant_id, so they are a cross-tenant export surface.
-- Confirmed with the product owner that no Looker Studio dashboard consumes
-- them, so they are dropped outright rather than recreated tenant-scoped.
-- Recreatable from this migration's history if a consumer ever appears.
DROP VIEW IF EXISTS "seo_looker_weekly";--> statement-breakpoint
DROP VIEW IF EXISTS "seo_looker_keywords";--> statement-breakpoint
DROP VIEW IF EXISTS "seo_looker_alerts";--> statement-breakpoint
DROP VIEW IF EXISTS "seo_looker_health";
