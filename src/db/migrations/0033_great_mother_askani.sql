-- H18 (Fable review) — prospects had no tenant_id at all; the moment a
-- second real tenant exists, any authenticated admin/team_lead can read and
-- mutate the first tenant's outbound prospects/signals/replies data (routes
-- are role-gated but were not tenant-gated). signals/replies/outbound_events
-- don't get their own tenant_id column — they're only ever reached through
-- a prospect_id that application code now tenant-checks against this column
-- first (see src/routes/outbound.ts).
--
-- Added nullable first + backfilled from the first tenant, THEN set NOT
-- NULL — a plain `ADD COLUMN ... NOT NULL` (what `db:generate` produced by
-- default) fails outright against a non-empty prospects table.
ALTER TABLE "prospects" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "prospects" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1) WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "prospects" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospects_tenant_id_idx" ON "prospects" USING btree ("tenant_id");
