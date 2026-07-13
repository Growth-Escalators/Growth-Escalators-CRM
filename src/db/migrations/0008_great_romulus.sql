CREATE TABLE "discovery_api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month_year" text NOT NULL,
	"api_calls" integer DEFAULT 0,
	"cost_usd" numeric(8, 4) DEFAULT '0',
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "discovery_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"search_id" uuid NOT NULL,
	"place_id" text NOT NULL,
	"company_name" text NOT NULL,
	"website_url" text,
	"phone_number" text,
	"address" text,
	"rating" numeric(3, 1),
	"review_count" integer DEFAULT 0,
	"fit_score" integer DEFAULT 0,
	"qualification_status" text DEFAULT 'Review',
	"disqualification_reason" text,
	"imported" boolean DEFAULT false,
	"imported_contact_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "discovery_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"query" text NOT NULL,
	"location" text NOT NULL,
	"country" text DEFAULT 'UK' NOT NULL,
	"radius_meters" integer DEFAULT 10000,
	"max_results" integer DEFAULT 20,
	"total_found" integer DEFAULT 0,
	"qualified_count" integer DEFAULT 0,
	"imported_count" integer DEFAULT 0,
	"api_calls_used" integer DEFAULT 0,
	"cost_usd" numeric(8, 4) DEFAULT '0',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text NOT NULL,
	"access_token" text NOT NULL,
	"thumbnail_url" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"platform" text,
	"content" text NOT NULL,
	"media_urls" text[],
	"scheduled_at" timestamp,
	"status" text DEFAULT 'draft',
	"published_at" timestamp,
	"external_post_id" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN IF NOT EXISTS "meta_ad_account_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "message_type" text DEFAULT 'text';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "media_url" text;--> statement-breakpoint
ALTER TABLE "discovery_api_usage" ADD CONSTRAINT "discovery_api_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_search_id_discovery_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."discovery_searches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_searches" ADD CONSTRAINT "discovery_searches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_social_account_id_social_accounts_id_fk') THEN
    ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_usage_tenant_month_idx" ON "discovery_api_usage" USING btree ("tenant_id","month_year");--> statement-breakpoint
CREATE INDEX "discovery_results_search_idx" ON "discovery_results" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "discovery_results_tenant_idx" ON "discovery_results" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "discovery_searches_tenant_idx" ON "discovery_searches" USING btree ("tenant_id");