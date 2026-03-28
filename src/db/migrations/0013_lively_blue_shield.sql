CREATE TABLE "ads_insights_cache" (
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
CREATE TABLE "audit_events" (
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
CREATE TABLE "backlink_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"source_url" text,
	"target_url" text,
	"domain_authority" numeric DEFAULT '0',
	"anchor_text" text,
	"link_type" text,
	"first_seen" date,
	"last_seen" date,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "brand_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"mention_url" text,
	"mention_text" text,
	"has_link" boolean DEFAULT false,
	"domain_authority" numeric DEFAULT '0',
	"discovered_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "client_knowledge_base" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"brand_summary" text,
	"ideal_customer" text,
	"unique_value_proposition" text,
	"key_differentiators" jsonb DEFAULT '[]'::jsonb,
	"proof_points" jsonb DEFAULT '[]'::jsonb,
	"brand_voice" text,
	"words_always_use" jsonb DEFAULT '[]'::jsonb,
	"words_never_use" jsonb DEFAULT '[]'::jsonb,
	"credentials" jsonb DEFAULT '[]'::jsonb,
	"top_services" jsonb DEFAULT '[]'::jsonb,
	"competitor_domains" jsonb DEFAULT '[]'::jsonb,
	"target_keywords_priority" jsonb DEFAULT '[]'::jsonb,
	"content_examples" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "client_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"page_url" text NOT NULL,
	"page_title" text,
	"target_keyword" text,
	"word_count" integer DEFAULT 0,
	"internal_links_in" jsonb DEFAULT '[]'::jsonb,
	"internal_links_out" jsonb DEFAULT '[]'::jsonb,
	"published_date" timestamp,
	"last_updated" timestamp,
	"wp_post_id" integer,
	"indexed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "content_gap_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"target_keyword" text NOT NULL,
	"our_url" text,
	"our_position" numeric,
	"competitor_urls" jsonb DEFAULT '[]'::jsonb,
	"topics_missing" jsonb DEFAULT '[]'::jsonb,
	"questions_missing" jsonb DEFAULT '[]'::jsonb,
	"entities_missing" jsonb DEFAULT '[]'::jsonb,
	"word_count_gap" integer DEFAULT 0,
	"priority_score" numeric DEFAULT '0',
	"status" text DEFAULT 'pending',
	"analysed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "keyword_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"keyword" text NOT NULL,
	"current_position" numeric,
	"previous_position" numeric,
	"position_change" numeric,
	"search_volume" integer DEFAULT 0,
	"url_ranking" text,
	"featured_snippet" boolean DEFAULT false,
	"recorded_date" date NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketing_accounts" (
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
	"last_alert_sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "seo_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"opportunity_type" text,
	"description" text,
	"estimated_impact" text,
	"effort_level" text,
	"status" text DEFAULT 'open',
	"identified_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "site_health_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"pagespeed_mobile" numeric,
	"pagespeed_desktop" numeric,
	"lcp" numeric,
	"fid" numeric,
	"cls" numeric,
	"broken_links_count" integer DEFAULT 0,
	"indexed_pages_count" integer DEFAULT 0,
	"crawl_errors_count" integer DEFAULT 0,
	"checked_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'staff';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "ads_insights_cache" ADD CONSTRAINT "ads_insights_cache_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_accounts" ADD CONSTRAINT "marketing_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ads_cache_account_range_level_idx" ON "ads_insights_cache" USING btree ("account_id","date_range","level");--> statement-breakpoint
CREATE INDEX "audit_events_tenant_idx" ON "audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_events_user_idx" ON "audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "backlink_data_project_idx" ON "backlink_data" USING btree ("project_name");--> statement-breakpoint
CREATE INDEX "backlink_data_status_idx" ON "backlink_data" USING btree ("status");--> statement-breakpoint
CREATE INDEX "brand_mentions_project_idx" ON "brand_mentions" USING btree ("project_name");--> statement-breakpoint
CREATE INDEX "content_gap_project_keyword_idx" ON "content_gap_analysis" USING btree ("project_name","target_keyword");--> statement-breakpoint
CREATE INDEX "content_gap_priority_score_idx" ON "content_gap_analysis" USING btree ("priority_score");--> statement-breakpoint
CREATE INDEX "keyword_rankings_project_keyword_idx" ON "keyword_rankings" USING btree ("project_name","keyword");--> statement-breakpoint
CREATE INDEX "keyword_rankings_recorded_date_idx" ON "keyword_rankings" USING btree ("recorded_date");--> statement-breakpoint
CREATE INDEX "seo_opportunities_project_status_idx" ON "seo_opportunities" USING btree ("project_name","status");--> statement-breakpoint
CREATE INDEX "site_health_project_checked_at_idx" ON "site_health_metrics" USING btree ("project_name","checked_at");