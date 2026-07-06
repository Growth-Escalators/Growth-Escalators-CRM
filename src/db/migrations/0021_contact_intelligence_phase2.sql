CREATE TABLE "wizmatch_company_intelligence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"qualification_tier" text DEFAULT 'C',
	"qualification_score" integer DEFAULT 0,
	"target_region" text DEFAULT 'india',
	"is_it_staffing_fit" boolean DEFAULT false,
	"status" text DEFAULT 'new',
	"review_status" text DEFAULT 'needs_review',
	"review_action" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"review_notes" text,
	"last_qualified_at" timestamp,
	"last_discovered_at" timestamp,
	"next_refresh_at" timestamp,
	"cost_cents_total" integer DEFAULT 0,
	"source_summary" jsonb DEFAULT '{}',
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wizmatch_contact_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_intelligence_id" uuid,
	"company_id" uuid NOT NULL,
	"crm_contact_id" uuid,
	"name" text NOT NULL,
	"title" text,
	"role_category" text,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"location" text,
	"region" text DEFAULT 'india',
	"source" text DEFAULT 'internal_crm',
	"source_url" text,
	"deliverability_status" text DEFAULT 'unverified',
	"ranking_score" integer DEFAULT 0,
	"relationship_score" integer DEFAULT 0,
	"confidence_score" integer DEFAULT 0,
	"status" text DEFAULT 'needs_review',
	"approved_by" uuid,
	"approved_at" timestamp,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wizmatch_discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_intelligence_id" uuid,
	"company_id" uuid NOT NULL,
	"run_type" text DEFAULT 'internal_reuse',
	"source" text DEFAULT 'internal_crm',
	"status" text DEFAULT 'queued',
	"cost_cents" integer DEFAULT 0,
	"paid_provider" boolean DEFAULT false,
	"requested_by" uuid,
	"started_at" timestamp,
	"finished_at" timestamp,
	"input_snapshot" jsonb DEFAULT '{}',
	"result_counts" jsonb DEFAULT '{}',
	"error_message" text,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "wizmatch_company_intelligence" ADD CONSTRAINT "wizmatch_company_intelligence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_intelligence" ADD CONSTRAINT "wizmatch_company_intelligence_company_id_wizmatch_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."wizmatch_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_intelligence" ADD CONSTRAINT "wizmatch_company_intelligence_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_contact_candidates" ADD CONSTRAINT "wizmatch_contact_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_contact_candidates" ADD CONSTRAINT "wizmatch_contact_candidates_company_intelligence_id_wizmatch_company_intelligence_id_fk" FOREIGN KEY ("company_intelligence_id") REFERENCES "public"."wizmatch_company_intelligence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_contact_candidates" ADD CONSTRAINT "wizmatch_contact_candidates_company_id_wizmatch_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."wizmatch_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_contact_candidates" ADD CONSTRAINT "wizmatch_contact_candidates_crm_contact_id_contacts_id_fk" FOREIGN KEY ("crm_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_contact_candidates" ADD CONSTRAINT "wizmatch_contact_candidates_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_contact_candidates" ADD CONSTRAINT "wizmatch_contact_candidates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_discovery_runs" ADD CONSTRAINT "wizmatch_discovery_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_discovery_runs" ADD CONSTRAINT "wizmatch_discovery_runs_company_intelligence_id_wizmatch_company_intelligence_id_fk" FOREIGN KEY ("company_intelligence_id") REFERENCES "public"."wizmatch_company_intelligence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_discovery_runs" ADD CONSTRAINT "wizmatch_discovery_runs_company_id_wizmatch_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."wizmatch_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_discovery_runs" ADD CONSTRAINT "wizmatch_discovery_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wizmatch_ci_tenant_status_idx" ON "wizmatch_company_intelligence" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "wizmatch_ci_tenant_review_idx" ON "wizmatch_company_intelligence" USING btree ("tenant_id","review_status");--> statement-breakpoint
CREATE INDEX "wizmatch_ci_tier_idx" ON "wizmatch_company_intelligence" USING btree ("qualification_tier");--> statement-breakpoint
CREATE INDEX "wizmatch_ci_next_refresh_idx" ON "wizmatch_company_intelligence" USING btree ("next_refresh_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_ci_tenant_company_idx" ON "wizmatch_company_intelligence" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "wizmatch_cc_tenant_status_idx" ON "wizmatch_contact_candidates" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "wizmatch_cc_company_status_idx" ON "wizmatch_contact_candidates" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "wizmatch_cc_intelligence_idx" ON "wizmatch_contact_candidates" USING btree ("company_intelligence_id");--> statement-breakpoint
CREATE INDEX "wizmatch_cc_crm_contact_idx" ON "wizmatch_contact_candidates" USING btree ("crm_contact_id");--> statement-breakpoint
CREATE INDEX "wizmatch_cc_score_idx" ON "wizmatch_contact_candidates" USING btree ("ranking_score");--> statement-breakpoint
CREATE INDEX "wizmatch_dr_tenant_status_idx" ON "wizmatch_discovery_runs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "wizmatch_dr_company_idx" ON "wizmatch_discovery_runs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "wizmatch_dr_intelligence_idx" ON "wizmatch_discovery_runs" USING btree ("company_intelligence_id");--> statement-breakpoint
CREATE INDEX "wizmatch_dr_source_idx" ON "wizmatch_discovery_runs" USING btree ("source");--> statement-breakpoint
CREATE INDEX "wizmatch_dr_created_at_idx" ON "wizmatch_discovery_runs" USING btree ("created_at");
