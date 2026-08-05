-- ---------------------------------------------------------------------------
-- 0049 — seo_api_usage
--
-- The per-tenant/per-site spend ledger behind seoCostGuard.ts, which has
-- carried an explicit "INTENTIONALLY MISSING — needs a migration, which is a
-- guarded path" note since Phase 1 for exactly this table.
--
-- HAND-WRITTEN for the same reason as 0046-0048: Railway applies migrations on
-- boot, so a statement that aborts on re-run means the API does not start.
-- Every statement below is idempotent.
--
-- ---------------------------------------------------------------------------
-- TWO GENERATED STATEMENTS WERE DELETED FROM THIS FILE. READ BEFORE REGENERATING.
--
-- drizzle-kit emitted, unasked:
--
--   ALTER TABLE "site_changes" DROP CONSTRAINT "site_changes_approved_requires_approver";
--   ... (this migration's real work) ...
--   ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_approved_requires_approver" CHECK (...);
--
-- with CHECK text byte-identical to what 0048 already created. It emits this
-- because 0048 hand-moved that constraint out of the inline CREATE TABLE into
-- its own duplicate_object-guarded DO block (so a pre-existing table could not
-- silently skip it), which the snapshot represents differently from an inline
-- declaration.
--
-- Both statements are deleted. Dropping and re-adding the human-approval hard
-- stop achieves exactly nothing and opens a window in which it does not exist:
-- the constraint that prevents the system publishing to a client's live
-- website with nobody's approval on record. It is not worth one nanosecond of
-- absence for a no-op rewrite.
--
-- If a future `db:generate` re-emits this pair, delete it again. If it ever
-- emits a DROP with a genuinely DIFFERENT CHECK body, that is a real change to
-- the hard stop and needs a human decision, not a regeneration.
-- ---------------------------------------------------------------------------
--
-- SAFETY: purely additive. One new table, no ALTER of an existing table, no
-- DROP, no SET NOT NULL over existing data, no unique index over rows that
-- already exist. Nothing reads it until the cost guard's usage fetch does.
--
-- `site_id` is NULLABLE on purpose: some spend is genuinely tenant-level and
-- not attributable to one site (a GSC token refresh, an account-wide quota
-- probe). Recording those against an arbitrary site would corrupt per-site
-- cost, which is the number the per-site pricing rests on.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "seo_api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"calls" integer DEFAULT 1 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "seo_api_usage" ADD CONSTRAINT "seo_api_usage_tenant_id_tenants_id_fk"
		FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "seo_api_usage" ADD CONSTRAINT "seo_api_usage_site_id_seo_sites_id_fk"
		FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Every aggregate in SeoCostGuardUsage is served by one of these three.
CREATE INDEX IF NOT EXISTS "seo_api_usage_tenant_created_idx" ON "seo_api_usage" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_api_usage_site_created_idx" ON "seo_api_usage" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_api_usage_tenant_provider_created_idx" ON "seo_api_usage" USING btree ("tenant_id","provider","created_at");
