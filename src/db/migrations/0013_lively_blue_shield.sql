-- SEO Automation Phase 2 — 8 new tables
-- Migration 0013 — safe for production (all statements use IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS "client_knowledge_base" (
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
CREATE TABLE IF NOT EXISTS "client_pages" (
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
CREATE TABLE IF NOT EXISTS "keyword_rankings" (
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
CREATE TABLE IF NOT EXISTS "backlink_data" (
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
CREATE TABLE IF NOT EXISTS "content_gap_analysis" (
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
CREATE TABLE IF NOT EXISTS "seo_opportunities" (
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
CREATE TABLE IF NOT EXISTS "site_health_metrics" (
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
CREATE TABLE IF NOT EXISTS "brand_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"mention_url" text,
	"mention_text" text,
	"has_link" boolean DEFAULT false,
	"domain_authority" numeric DEFAULT '0',
	"discovered_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keyword_rankings_project_keyword_idx" ON "keyword_rankings" USING btree ("project_name","keyword");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keyword_rankings_recorded_date_idx" ON "keyword_rankings" USING btree ("recorded_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backlink_data_project_idx" ON "backlink_data" USING btree ("project_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backlink_data_status_idx" ON "backlink_data" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_gap_project_keyword_idx" ON "content_gap_analysis" USING btree ("project_name","target_keyword");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_gap_priority_score_idx" ON "content_gap_analysis" USING btree ("priority_score");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_opportunities_project_status_idx" ON "seo_opportunities" USING btree ("project_name","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_health_project_checked_at_idx" ON "site_health_metrics" USING btree ("project_name","checked_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_mentions_project_idx" ON "brand_mentions" USING btree ("project_name");
