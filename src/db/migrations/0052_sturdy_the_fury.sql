-- seo_page_metrics — per-URL Search Console performance.
--
-- HAND-TRIMMED, deliberately. drizzle-kit generated this file with FIVE extra
-- statements on top of the one intended table: CREATE TABLE for roles,
-- role_permissions, user_invites and user_permission_overrides, plus
-- ALTER TABLE users ADD COLUMN role_id. All five already exist in production —
-- they shipped in main's own migrations 0045 and 0046. Running them would abort
-- the boot migration with 42P07 (relation already exists) and take the deploy
-- down, which is exactly how the #163 deploy failed.
--
-- They were emitted because the five SEO migrations were generated as 0045-0049
-- off 0044's snapshot and later renumbered to 0047-0051 without rebasing the
-- SNAPSHOTS, so meta/0051_snapshot.json still describes a schema that has never
-- heard of main's roles/RBAC work. db:generate diffs schema.ts against that
-- stale snapshot and honestly reports those tables as missing.
--
-- This is self-healing from here: meta/0052_snapshot.json is written from
-- schema.ts directly, not from 0051, so it is a complete and correct picture and
-- every future db:generate diffs against it. The stale 0047-0050 snapshots are
-- inert — `migrate` reads the .sql files and the journal, never the snapshots.
CREATE TABLE "seo_page_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"page_url" text NOT NULL,
	"recorded_date" date NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"avg_position" numeric,
	"avg_ctr" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seo_page_metrics" ADD CONSTRAINT "seo_page_metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_page_metrics" ADD CONSTRAINT "seo_page_metrics_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seo_page_metrics_site_url_date_unique" ON "seo_page_metrics" USING btree ("tenant_id","site_id","recorded_date","page_url");--> statement-breakpoint
CREATE INDEX "seo_page_metrics_site_date_impressions_idx" ON "seo_page_metrics" USING btree ("tenant_id","site_id","recorded_date","impressions");
