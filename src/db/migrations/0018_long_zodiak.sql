-- 0018: CRM bridge columns on prospects
--
-- Links an outbound prospect to the CRM contact + deal it was promoted into.
-- Both nullable — unconverted prospects keep them NULL. Idempotent so a
-- re-deploy on a partially-migrated DB is safe.

ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "crm_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "crm_deal_id"    uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_crm_contact_idx" ON "prospects" USING btree ("crm_contact_id");
