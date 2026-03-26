-- Add role + tokenVersion to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'staff';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" integer DEFAULT 1;
--> statement-breakpoint
-- Create marketing_accounts
CREATE TABLE IF NOT EXISTS "marketing_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text NOT NULL,
	"client_name" text,
	"is_active" boolean DEFAULT true,
	"removal_requested_at" timestamp,
	"removal_requested_by" uuid,
	"removal_approved_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "marketing_accounts" ADD CONSTRAINT "marketing_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Seed default marketing accounts
INSERT INTO marketing_accounts (tenant_id, account_id, account_name, client_name, is_active)
SELECT t.id, 'act_323237510625803', 'GE Agency', 'Growth Escalators', true
FROM tenants t WHERE t.slug = 'growth-escalators'
AND NOT EXISTS (SELECT 1 FROM marketing_accounts WHERE account_id = 'act_323237510625803');
--> statement-breakpoint
INSERT INTO marketing_accounts (tenant_id, account_id, account_name, client_name, is_active)
SELECT t.id, 'act_689363376592426', 'Paraiso', 'Paraiso Comfortwear', true
FROM tenants t WHERE t.slug = 'growth-escalators'
AND NOT EXISTS (SELECT 1 FROM marketing_accounts WHERE account_id = 'act_689363376592426');
--> statement-breakpoint
-- Create ads_insights_cache
CREATE TABLE IF NOT EXISTS "ads_insights_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"date_range" text NOT NULL,
	"level" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"fetched_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ads_insights_cache" ADD CONSTRAINT "ads_cache_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ads_cache_account_range_level_idx" ON "ads_insights_cache" ("account_id", "date_range", "level");
--> statement-breakpoint
-- Create audit_events
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_tenant_idx" ON "audit_events" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_user_idx" ON "audit_events" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_action_idx" ON "audit_events" ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events" ("created_at");
--> statement-breakpoint
-- Performance indexes
CREATE INDEX IF NOT EXISTS "contacts_tenant_email_idx" ON "contacts" ("tenant_id", "first_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_tenant_created_idx" ON "contacts" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_tenant_assigned_idx" ON "contacts" ("tenant_id", "assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_channels_value_idx" ON "contact_channels" ("channel_value");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_contact_created_idx" ON "messages" ("contact_id", "sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_direction_status_idx" ON "messages" ("direction", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_tenant_stage_idx" ON "deals" ("tenant_id", "stage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_tenant_assigned_idx" ON "deals" ("tenant_id", "assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_status_scheduled_idx" ON "social_posts" ("status", "scheduled_at");
