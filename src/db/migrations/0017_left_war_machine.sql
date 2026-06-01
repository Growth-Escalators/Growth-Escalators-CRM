-- 0017: Outbound lead-gen tables (Phase 1) + drift catch-up
--
-- New tables: prospects, signals, replies, outbound_events.
-- Catch-up: task_lists, task_checklist_items, billing_clients.services,
-- invoices.discount_*, tasks.list_id — these already landed via 0015 / 0016,
-- but drizzle's snapshot didn't track them; IF NOT EXISTS keeps prod safe.

-- ---------------------------------------------------------------------------
-- prospects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"company" text,
	"company_size" text,
	"linkedin_url" text,
	"email" text,
	"email_status" text DEFAULT 'unverified' NOT NULL,
	"icp_segment" text,
	"status" text DEFAULT 'new' NOT NULL,
	"channel" text,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Enum guards (kept out of drizzle schema.ts since CHECK constraints aren't
-- a first-class drizzle concept). Use DO blocks so re-runs are safe.
DO $$ BEGIN
	ALTER TABLE "prospects" ADD CONSTRAINT "prospects_icp_segment_chk"
		CHECK ("icp_segment" IS NULL OR "icp_segment" IN
			('dev_saas','dev_agency','marketing_d2c','marketing_agency'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "prospects" ADD CONSTRAINT "prospects_status_chk"
		CHECK ("status" IN
			('new','contacted','accepted','replied','meeting','pilot','client','recycled','suppressed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- signals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"signal_detail" text,
	"signal_date" timestamp,
	"is_fresh" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "signals" ADD CONSTRAINT "signals_signal_type_chk"
		CHECK ("signal_type" IN
			('open_roles','funding','new_exec','tech_match','content_post','agency_growth'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- replies (raw inbound responses; classification filled in a later phase)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"channel" text,
	"body" text,
	"classification" text,
	"received_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- outbound_events (status-transition audit; distinct from the CRM `events`
-- table which is for contact/deal channel activity)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "outbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Drift catch-up — already-applied tables/columns from 0015 + 0016
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"label" text NOT NULL,
	"is_done" boolean DEFAULT false,
	"position" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN IF NOT EXISTS "services" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_type" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_percent" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_amount" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_label" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "list_id" uuid;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Foreign keys (wrapped — re-runs no-op instead of erroring)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
	ALTER TABLE "outbound_events" ADD CONSTRAINT "outbound_events_prospect_id_prospects_id_fk"
		FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "replies" ADD CONSTRAINT "replies_prospect_id_prospects_id_fk"
		FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "signals" ADD CONSTRAINT "signals_prospect_id_prospects_id_fk"
		FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk"
		FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_tenant_id_tenants_id_fk"
		FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "outbound_events_prospect_id_idx" ON "outbound_events" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_events_created_at_idx" ON "outbound_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_status_idx" ON "prospects" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_icp_segment_idx" ON "prospects" USING btree ("icp_segment");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_created_at_idx" ON "prospects" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replies_prospect_id_idx" ON "replies" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replies_received_at_idx" ON "replies" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_prospect_id_idx" ON "signals" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_signal_type_idx" ON "signals" USING btree ("signal_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_is_fresh_idx" ON "signals" USING btree ("is_fresh");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_checklist_items_task_idx" ON "task_checklist_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_lists_tenant_owner_idx" ON "task_lists" USING btree ("tenant_id","owner_id");--> statement-breakpoint

-- Partial UNIQUE indexes for CSV dedup on linkedin_url + email (case-insensitive).
-- Not modeled in schema.ts because drizzle's uniqueIndex doesn't support WHERE.
CREATE UNIQUE INDEX IF NOT EXISTS "prospects_linkedin_url_uniq"
	ON "prospects" (lower("linkedin_url"))
	WHERE "linkedin_url" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospects_email_uniq"
	ON "prospects" (lower("email"))
	WHERE "email" IS NOT NULL;
