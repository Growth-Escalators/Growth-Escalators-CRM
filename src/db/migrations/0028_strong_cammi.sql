CREATE TABLE "wizmatch_candidate_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"consent_type" text DEFAULT 'rtr' NOT NULL,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_reference" text,
	"requested_by" uuid,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"granted_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"revocation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_interview_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"interview_round_id" uuid NOT NULL,
	"company_contact_id" uuid,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'participant' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_interview_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"round_type" text DEFAULT 'client' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp,
	"timezone" text DEFAULT 'Asia/Kolkata',
	"feedback" text,
	"outcome" text,
	"next_action" text,
	"next_action_due_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"amount" integer,
	"currency" text DEFAULT 'INR' NOT NULL,
	"period" text DEFAULT 'annual' NOT NULL,
	"start_date" date,
	"expires_at" timestamp,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_staffing_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"invoice_id" uuid,
	"payment_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"amount" integer,
	"currency" text,
	"reason" text NOT NULL,
	"resolved_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_staffing_commercials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"model" text NOT NULL,
	"original_amount" integer,
	"original_currency" text NOT NULL,
	"original_period" text NOT NULL,
	"bill_amount" integer,
	"pay_amount" integer,
	"loaded_cost" integer,
	"gross_margin_amount" integer,
	"gross_margin_percent" numeric(7, 2),
	"normalized_currency" text,
	"conversion_rate" numeric(18, 6),
	"conversion_source" text,
	"conversion_date" date,
	"replacement_ends_at" date,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_submission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"version" integer NOT NULL,
	"actor_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_submission_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"company_contact_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'recipient' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"match_id" uuid,
	"consent_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"resend_count" integer DEFAULT 0 NOT NULL,
	"submission_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prepared_by" uuid,
	"prepared_at" timestamp DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp,
	"first_sent_at" timestamp,
	"last_sent_at" timestamp,
	"withdrawn_at" timestamp,
	"withdrawal_reason" text,
	"next_action" text,
	"next_action_due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD COLUMN "requirement_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD COLUMN "offer_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD COLUMN "billing_client_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD COLUMN "candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD COLUMN "match_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD COLUMN "placement_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD COLUMN "candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_consents" ADD CONSTRAINT "wizmatch_candidate_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_consents" ADD CONSTRAINT "wizmatch_candidate_consents_candidate_id_wizmatch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."wizmatch_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_consents" ADD CONSTRAINT "wizmatch_candidate_consents_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_consents" ADD CONSTRAINT "wizmatch_candidate_consents_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_interview_participants" ADD CONSTRAINT "wizmatch_interview_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_interview_participants" ADD CONSTRAINT "wizmatch_interview_participants_interview_round_id_wizmatch_interview_rounds_id_fk" FOREIGN KEY ("interview_round_id") REFERENCES "public"."wizmatch_interview_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_interview_participants" ADD CONSTRAINT "wizmatch_interview_participants_company_contact_id_wizmatch_company_contacts_id_fk" FOREIGN KEY ("company_contact_id") REFERENCES "public"."wizmatch_company_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_interview_participants" ADD CONSTRAINT "wizmatch_interview_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_interview_rounds" ADD CONSTRAINT "wizmatch_interview_rounds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_interview_rounds" ADD CONSTRAINT "wizmatch_interview_rounds_submission_id_wizmatch_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."wizmatch_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_interview_rounds" ADD CONSTRAINT "wizmatch_interview_rounds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_offers" ADD CONSTRAINT "wizmatch_offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_offers" ADD CONSTRAINT "wizmatch_offers_submission_id_wizmatch_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."wizmatch_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_offers" ADD CONSTRAINT "wizmatch_offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_offers" ADD CONSTRAINT "wizmatch_offers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_adjustments" ADD CONSTRAINT "wizmatch_staffing_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_adjustments" ADD CONSTRAINT "wizmatch_staffing_adjustments_placement_id_wizmatch_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."wizmatch_placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_adjustments" ADD CONSTRAINT "wizmatch_staffing_adjustments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_adjustments" ADD CONSTRAINT "wizmatch_staffing_adjustments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_adjustments" ADD CONSTRAINT "wizmatch_staffing_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_commercials" ADD CONSTRAINT "wizmatch_staffing_commercials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_commercials" ADD CONSTRAINT "wizmatch_staffing_commercials_placement_id_wizmatch_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."wizmatch_placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_commercials" ADD CONSTRAINT "wizmatch_staffing_commercials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submission_events" ADD CONSTRAINT "wizmatch_submission_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submission_events" ADD CONSTRAINT "wizmatch_submission_events_submission_id_wizmatch_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."wizmatch_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submission_events" ADD CONSTRAINT "wizmatch_submission_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submission_recipients" ADD CONSTRAINT "wizmatch_submission_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submission_recipients" ADD CONSTRAINT "wizmatch_submission_recipients_submission_id_wizmatch_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."wizmatch_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submission_recipients" ADD CONSTRAINT "wizmatch_submission_recipients_company_contact_id_wizmatch_company_contacts_id_fk" FOREIGN KEY ("company_contact_id") REFERENCES "public"."wizmatch_company_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submission_recipients" ADD CONSTRAINT "wizmatch_submission_recipients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submissions" ADD CONSTRAINT "wizmatch_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submissions" ADD CONSTRAINT "wizmatch_submissions_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submissions" ADD CONSTRAINT "wizmatch_submissions_candidate_id_wizmatch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."wizmatch_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submissions" ADD CONSTRAINT "wizmatch_submissions_match_id_wizmatch_candidate_requirement_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."wizmatch_candidate_requirement_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submissions" ADD CONSTRAINT "wizmatch_submissions_consent_id_wizmatch_candidate_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."wizmatch_candidate_consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submissions" ADD CONSTRAINT "wizmatch_submissions_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_submissions" ADD CONSTRAINT "wizmatch_submissions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wizmatch_consents_pair_idx" ON "wizmatch_candidate_consents" USING btree ("tenant_id","requirement_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_consents_active_idx" ON "wizmatch_candidate_consents" USING btree ("tenant_id","requirement_id","candidate_id") WHERE "wizmatch_candidate_consents"."status" IN ('requested','granted');--> statement-breakpoint
CREATE INDEX "wizmatch_interview_participants_round_idx" ON "wizmatch_interview_participants" USING btree ("tenant_id","interview_round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_interview_rounds_number_idx" ON "wizmatch_interview_rounds" USING btree ("tenant_id","submission_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_offers_revision_idx" ON "wizmatch_offers" USING btree ("tenant_id","submission_id","revision");--> statement-breakpoint
CREATE INDEX "wizmatch_staffing_adjustments_placement_idx" ON "wizmatch_staffing_adjustments" USING btree ("tenant_id","placement_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_staffing_commercials_placement_idx" ON "wizmatch_staffing_commercials" USING btree ("tenant_id","placement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_submission_events_version_idx" ON "wizmatch_submission_events" USING btree ("tenant_id","submission_id","version");--> statement-breakpoint
CREATE INDEX "wizmatch_submission_recipients_submission_idx" ON "wizmatch_submission_recipients" USING btree ("tenant_id","submission_id");--> statement-breakpoint
CREATE INDEX "wizmatch_submissions_requirement_idx" ON "wizmatch_submissions" USING btree ("tenant_id","requirement_id","status");--> statement-breakpoint
CREATE INDEX "wizmatch_submissions_candidate_idx" ON "wizmatch_submissions" USING btree ("tenant_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_submissions_active_pair_idx" ON "wizmatch_submissions" USING btree ("tenant_id","requirement_id","candidate_id") WHERE "wizmatch_submissions"."status" NOT IN ('withdrawn','rejected','closed');--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD CONSTRAINT "wizmatch_placements_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD CONSTRAINT "wizmatch_placements_submission_id_wizmatch_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."wizmatch_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD CONSTRAINT "wizmatch_placements_offer_id_wizmatch_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."wizmatch_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD CONSTRAINT "wizmatch_placements_billing_client_id_billing_clients_id_fk" FOREIGN KEY ("billing_client_id") REFERENCES "public"."billing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_placements" ADD CONSTRAINT "wizmatch_placements_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_candidate_id_wizmatch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."wizmatch_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_match_id_wizmatch_candidate_requirement_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."wizmatch_candidate_requirement_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_submission_id_wizmatch_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."wizmatch_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_placement_id_wizmatch_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."wizmatch_placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD CONSTRAINT "wizmatch_task_links_candidate_id_wizmatch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."wizmatch_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD CONSTRAINT "wizmatch_task_links_submission_id_wizmatch_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."wizmatch_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wizmatch_staffing_events_candidate_idx" ON "wizmatch_staffing_events" USING btree ("tenant_id","candidate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "wizmatch_staffing_events_submission_idx" ON "wizmatch_staffing_events" USING btree ("tenant_id","submission_id","occurred_at");--> statement-breakpoint
CREATE INDEX "wizmatch_staffing_events_placement_idx" ON "wizmatch_staffing_events" USING btree ("tenant_id","placement_id","occurred_at");--> statement-breakpoint
CREATE INDEX "wizmatch_task_links_candidate_idx" ON "wizmatch_task_links" USING btree ("tenant_id","candidate_id");--> statement-breakpoint
CREATE INDEX "wizmatch_task_links_submission_idx" ON "wizmatch_task_links" USING btree ("tenant_id","submission_id");