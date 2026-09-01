CREATE TABLE "wa_lead_acks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"message_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wa_monthly_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_consent_text_version" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_consent_source" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_opt_out_at" timestamp;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_opt_out_reason" text;--> statement-breakpoint
ALTER TABLE "wa_lead_acks" ADD CONSTRAINT "wa_lead_acks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_monthly_usage" ADD CONSTRAINT "wa_monthly_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_lead_acks_event_id_idx" ON "wa_lead_acks" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "wa_lead_acks_status_idx" ON "wa_lead_acks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "wa_lead_acks_message_id_idx" ON "wa_lead_acks" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_monthly_usage_tenant_month_idx" ON "wa_monthly_usage" USING btree ("tenant_id","year_month");--> statement-breakpoint
-- Hand-added, not generated: drizzle-kit does not emit partial indexes.
--
-- The WhatsApp webhook updates delivery status by external_id and inserts
-- inbound messages with onConflictDoNothing() — but there is no unique
-- constraint for that conflict clause to bite on, so a replayed webhook can
-- insert a duplicate row. Partial (external_id IS NOT NULL) keeps it small.
--
-- PRE-FLIGHT — fails if duplicates already exist. Run first:
--   SELECT external_id, COUNT(*) FROM messages
--    WHERE external_id IS NOT NULL
--    GROUP BY external_id HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "messages_external_id_unique_idx"
  ON "messages" ("external_id")
  WHERE "external_id" IS NOT NULL;
