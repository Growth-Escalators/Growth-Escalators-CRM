-- Discovery module tables (safe re-run with IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "discovery_searches" (
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
CREATE TABLE IF NOT EXISTS "discovery_results" (
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
CREATE TABLE IF NOT EXISTS "discovery_api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month_year" text NOT NULL,
	"api_calls" integer DEFAULT 0,
	"cost_usd" numeric(8, 4) DEFAULT '0',
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_searches_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "discovery_searches" ADD CONSTRAINT "discovery_searches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_results_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_results_search_id_discovery_searches_id_fk') THEN
    ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_search_id_discovery_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."discovery_searches"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_api_usage_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "discovery_api_usage" ADD CONSTRAINT "discovery_api_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_usage_tenant_month_idx" ON "discovery_api_usage" USING btree ("tenant_id","month_year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_results_search_idx" ON "discovery_results" USING btree ("search_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_results_tenant_idx" ON "discovery_results" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_searches_tenant_idx" ON "discovery_searches" USING btree ("tenant_id");
