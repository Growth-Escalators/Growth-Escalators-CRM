CREATE TABLE "wizmatch_company_duplicates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_a_id" uuid NOT NULL,
	"company_b_id" uuid NOT NULL,
	"similarity" numeric(5, 4),
	"detection_rule" text NOT NULL,
	"resolution" text DEFAULT 'pending' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wizmatch_company_duplicates_ordered_pair_chk" CHECK (company_a_id < company_b_id),
	CONSTRAINT "wizmatch_company_duplicates_detection_rule_chk" CHECK (detection_rule IN ('domain','normalised_name')),
	CONSTRAINT "wizmatch_company_duplicates_resolution_chk" CHECK (resolution IN ('pending','merged','confirmed_separate'))
);
--> statement-breakpoint
CREATE TABLE "wizmatch_company_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_key" text NOT NULL,
	"signal_id" uuid,
	"requirement_id" uuid,
	"scope_ref_label" text,
	"outreach_eligibility" text,
	"external_hiring_policy" text,
	"relationship_type" text,
	"reason_code" text,
	"reason" text,
	"evidence_kind" text,
	"evidence_text" text,
	"evidence_url" text,
	"evidence_ref" text,
	"source" text NOT NULL,
	"actor_user_id" uuid,
	"is_permanent" boolean DEFAULT false NOT NULL,
	"block_class" text DEFAULT 'standard' NOT NULL,
	"is_non_overridable" boolean DEFAULT false NOT NULL,
	"review_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by_policy_id" uuid,
	CONSTRAINT "wizmatch_company_policies_scope_key_root_chk" CHECK ((scope_type = 'entire_company') = (scope_key = 'entire_company')),
	CONSTRAINT "wizmatch_company_policies_signal_ref_chk" CHECK ((scope_type = 'specific_signal') = (signal_id IS NOT NULL)),
	CONSTRAINT "wizmatch_company_policies_requirement_ref_chk" CHECK ((scope_type = 'specific_requirement') = (requirement_id IS NOT NULL)),
	CONSTRAINT "wizmatch_company_policies_label_ref_chk" CHECK ((scope_type IN ('region','business_unit','location')) = (scope_ref_label IS NOT NULL)),
	CONSTRAINT "wizmatch_company_policies_scope_key_prefix_chk" CHECK (scope_type = 'entire_company' OR scope_key LIKE scope_type || ':%'),
	CONSTRAINT "wizmatch_company_policies_scope_key_signal_agreement_chk" CHECK (scope_type <> 'specific_signal' OR scope_key = 'specific_signal:' || signal_id::text),
	CONSTRAINT "wizmatch_company_policies_scope_key_requirement_agreement_chk" CHECK (scope_type <> 'specific_requirement' OR scope_key = 'specific_requirement:' || requirement_id::text),
	CONSTRAINT "wizmatch_company_policies_scope_key_label_agreement_chk" CHECK (scope_type NOT IN ('region','business_unit','location') OR scope_key = scope_type || ':' || scope_ref_label),
	CONSTRAINT "wizmatch_company_policies_paused_review_date_chk" CHECK (outreach_eligibility <> 'paused' OR review_date IS NOT NULL),
	CONSTRAINT "wizmatch_company_policies_region_label_chk" CHECK (scope_type <> 'region' OR scope_ref_label IN ('india','us')),
	CONSTRAINT "wizmatch_company_policies_root_defines_all_chk" CHECK (scope_type <> 'entire_company' OR (outreach_eligibility IS NOT NULL AND external_hiring_policy IS NOT NULL AND relationship_type IS NOT NULL)),
	CONSTRAINT "wizmatch_company_policies_scoped_overrides_one_chk" CHECK (scope_type = 'entire_company' OR (outreach_eligibility IS NOT NULL OR external_hiring_policy IS NOT NULL OR relationship_type IS NOT NULL)),
	CONSTRAINT "wizmatch_company_policies_non_overridable_on_blocked_chk" CHECK (is_non_overridable = false OR outreach_eligibility = 'blocked'),
	CONSTRAINT "wizmatch_company_policies_block_class_on_blocked_chk" CHECK (block_class = 'standard' OR outreach_eligibility = 'blocked'),
	CONSTRAINT "wizmatch_company_policies_block_class_override_chk" CHECK (block_class = 'standard' OR is_non_overridable = true),
	CONSTRAINT "wizmatch_company_policies_evidence_required_chk" CHECK ((is_permanent = false AND is_non_overridable = false) OR (evidence_kind IS NOT NULL AND (evidence_text IS NOT NULL OR evidence_url IS NOT NULL OR evidence_ref IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "wizmatch_company_policy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"previous_policy_id" uuid,
	"from_state" jsonb,
	"to_state" jsonb,
	"reason_code" text NOT NULL,
	"reason" text,
	"evidence_kind" text,
	"evidence_text" text,
	"evidence_url" text,
	"evidence_ref" text,
	"actor_user_id" uuid,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_outreach_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'smartlead_csv' NOT NULL,
	"campaign_family" text NOT NULL,
	"campaign_type" text NOT NULL,
	"outreach_mode" text NOT NULL,
	"external_campaign_ref" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"exported_at" timestamp with time zone,
	"exported_row_count" integer,
	"omitted_row_count" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wizmatch_outreach_batches_campaign_family_chk" CHECK (campaign_family IN ('fte_permanent','contract_c2h','vendor_empanelment','msp_vms','reengagement')),
	CONSTRAINT "wizmatch_outreach_batches_campaign_type_chk" CHECK (campaign_type IN ('fte_permanent','contract','c2h','vendor_empanelment','msp_vms','reengagement')),
	CONSTRAINT "wizmatch_outreach_batches_outreach_mode_chk" CHECK (outreach_mode IN ('cold_email','account_managed','research_only')),
	CONSTRAINT "wizmatch_outreach_batches_status_chk" CHECK (status IN ('draft','exported','importing','closed'))
);
--> statement-breakpoint
CREATE TABLE "wizmatch_outreach_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"enrolment_email_key" text,
	"batch_id" uuid NOT NULL,
	"campaign_family" text NOT NULL,
	"campaign_type" text NOT NULL,
	"outreach_mode" text NOT NULL,
	"external_lead_ref" text,
	"state" text NOT NULL,
	"state_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by_user_id" uuid,
	"release_reason" text,
	"policy_snapshot" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wizmatch_outreach_enrolments_state_chk" CHECK (state IN ('queued','exported','sent','replied','awaiting_action','positive_reply','referral_received','conversation_open','completed','closed','disqualified','company_blocked','unsubscribed','contact_invalid','manually_released')),
	CONSTRAINT "wizmatch_outreach_enrolments_manually_released_chk" CHECK (state <> 'manually_released' OR (released_by_user_id IS NOT NULL AND release_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "wizmatch_outreach_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"actor_user_id" uuid,
	"external_event_id" text,
	"external_message_id" text,
	"external_lead_ref" text,
	"idempotency_key" text NOT NULL,
	"key_source" text NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wizmatch_outreach_events_event_type_chk" CHECK (event_type IN (
        'sent','bounced','replied','unsubscribed','completed',
        'awaiting_action','positive_reply','referral_received','conversation_open',
        'closed','disqualified','company_blocked','contact_invalid','manually_released',
        'gate_denied'
      )),
	CONSTRAINT "wizmatch_outreach_events_manually_released_actor_chk" CHECK (event_type <> 'manually_released' OR actor_user_id IS NOT NULL),
	CONSTRAINT "wizmatch_outreach_events_key_source_chk" CHECK (key_source IN ('provider_event_id','provider_message_id','lead_ref_composite','fallback_hash','internal_transition'))
);
--> statement-breakpoint
CREATE TABLE "wizmatch_reply_mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"address" text NOT NULL,
	"domain" text,
	"provider_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ref" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wizmatch_reply_mailboxes_provider_chk" CHECK (provider IN ('imap','ms365','google'))
);
--> statement-breakpoint
CREATE TABLE "wizmatch_suppression_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grain" text NOT NULL,
	"email" text,
	"contact_id" uuid,
	"contact_channel_id" uuid,
	"company_id" uuid,
	"enrolment_id" uuid,
	"reason_code" text NOT NULL,
	"evidence_kind" text,
	"evidence_text" text,
	"evidence_url" text,
	"evidence_ref" text,
	"source" text NOT NULL,
	"actor_user_id" uuid,
	"external_event_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wizmatch_suppression_events_grain_chk" CHECK (grain IN ('email','contact','company')),
	CONSTRAINT "wizmatch_suppression_events_grain_email_chk" CHECK (grain <> 'email' OR email IS NOT NULL),
	CONSTRAINT "wizmatch_suppression_events_grain_contact_chk" CHECK (grain <> 'contact' OR contact_id IS NOT NULL),
	CONSTRAINT "wizmatch_suppression_events_grain_company_chk" CHECK (grain <> 'company' OR company_id IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "wizmatch_companies" ADD COLUMN IF NOT EXISTS "account_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_suppression_list" ADD COLUMN IF NOT EXISTS "contact_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "wizmatch_suppression_list" ADD COLUMN IF NOT EXISTS "channel_invalid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- >>> BEGIN MANUAL REORDER (0037) — statement ORDER only, no statement rewritten
-- Reason: every composite FK below references a parent on ("tenant_id","id").
-- PostgreSQL resolves the referenced unique index at ADD CONSTRAINT time, not
-- at COMMIT (tablecmds.c transformFkeyCheckAttrs); a missing one raises
-- SQLSTATE 42830 "there is no unique constraint matching given keys for
-- referenced table" and aborts the migration. drizzle-kit emits every
-- CREATE INDEX after every ADD CONSTRAINT, which cannot satisfy that
-- ordering, so these nine CREATE UNIQUE INDEX statements are MOVED here from
-- their generated positions further down. No statement text is altered and
-- no statement is added or removed — running db:generate again reproduces the
-- same set, only in the unusable order (PRD-005 §10.11.2 guard-block process).
CREATE UNIQUE INDEX "wizmatch_company_policies_tenant_id_id_uniq" ON "wizmatch_company_policies" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_outreach_batches_tenant_id_id_uniq" ON "wizmatch_outreach_batches" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_outreach_enrolments_tenant_id_id_uniq" ON "wizmatch_outreach_enrolments" USING btree ("tenant_id","id");--> statement-breakpoint
-- Six additive, non-partial (tenant_id, id) unique indexes (PRD-005 §10.10.1).
-- IF NOT EXISTS on every one — three are on core CRM tables shared with the
-- Growth tenant (users, contacts, contact_channels) and none can fail or
-- reject a write, since `id` is already the primary key on every one of
-- these tables. Owner sign-off on the shared-table three is U-7, gating G1
-- (applying this migration to production), not PR 2.
CREATE UNIQUE INDEX IF NOT EXISTS "contact_channels_tenant_id_id_uniq" ON "contact_channels" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_tenant_id_id_uniq" ON "contacts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_id_id_uniq" ON "users" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wizmatch_companies_tenant_id_id_uniq" ON "wizmatch_companies" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wizmatch_job_signals_tenant_id_id_uniq" ON "wizmatch_job_signals" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wizmatch_requirements_tenant_id_id_uniq" ON "wizmatch_requirements" USING btree ("tenant_id","id");--> statement-breakpoint
-- <<< END MANUAL REORDER (0037)
ALTER TABLE "wizmatch_company_duplicates" ADD CONSTRAINT "wizmatch_company_duplicates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_duplicates" ADD CONSTRAINT "wizmatch_company_duplicates_company_a_fk" FOREIGN KEY ("tenant_id","company_a_id") REFERENCES "public"."wizmatch_companies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_duplicates" ADD CONSTRAINT "wizmatch_company_duplicates_company_b_fk" FOREIGN KEY ("tenant_id","company_b_id") REFERENCES "public"."wizmatch_companies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_duplicates" ADD CONSTRAINT "wizmatch_company_duplicates_resolved_by_fk" FOREIGN KEY ("tenant_id","resolved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policies" ADD CONSTRAINT "wizmatch_company_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policies" ADD CONSTRAINT "wizmatch_company_policies_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."wizmatch_companies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policies" ADD CONSTRAINT "wizmatch_company_policies_signal_fk" FOREIGN KEY ("tenant_id","signal_id") REFERENCES "public"."wizmatch_job_signals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policies" ADD CONSTRAINT "wizmatch_company_policies_requirement_fk" FOREIGN KEY ("tenant_id","requirement_id") REFERENCES "public"."wizmatch_requirements"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policies" ADD CONSTRAINT "wizmatch_company_policies_actor_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policies" ADD CONSTRAINT "wizmatch_company_policies_superseded_by_fk" FOREIGN KEY ("tenant_id","superseded_by_policy_id") REFERENCES "public"."wizmatch_company_policies"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policy_events" ADD CONSTRAINT "wizmatch_company_policy_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policy_events" ADD CONSTRAINT "wizmatch_company_policy_events_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."wizmatch_companies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policy_events" ADD CONSTRAINT "wizmatch_company_policy_events_policy_fk" FOREIGN KEY ("tenant_id","policy_id") REFERENCES "public"."wizmatch_company_policies"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policy_events" ADD CONSTRAINT "wizmatch_company_policy_events_previous_policy_fk" FOREIGN KEY ("tenant_id","previous_policy_id") REFERENCES "public"."wizmatch_company_policies"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_policy_events" ADD CONSTRAINT "wizmatch_company_policy_events_actor_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_batches" ADD CONSTRAINT "wizmatch_outreach_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_batches" ADD CONSTRAINT "wizmatch_outreach_batches_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_batches" ADD CONSTRAINT "wizmatch_outreach_batches_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_enrolments" ADD CONSTRAINT "wizmatch_outreach_enrolments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_enrolments" ADD CONSTRAINT "wizmatch_outreach_enrolments_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."wizmatch_companies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_enrolments" ADD CONSTRAINT "wizmatch_outreach_enrolments_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_enrolments" ADD CONSTRAINT "wizmatch_outreach_enrolments_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."wizmatch_outreach_batches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_enrolments" ADD CONSTRAINT "wizmatch_outreach_enrolments_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_enrolments" ADD CONSTRAINT "wizmatch_outreach_enrolments_released_by_fk" FOREIGN KEY ("tenant_id","released_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_events" ADD CONSTRAINT "wizmatch_outreach_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_events" ADD CONSTRAINT "wizmatch_outreach_events_enrolment_fk" FOREIGN KEY ("tenant_id","enrolment_id") REFERENCES "public"."wizmatch_outreach_enrolments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_events" ADD CONSTRAINT "wizmatch_outreach_events_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."wizmatch_outreach_batches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_outreach_events" ADD CONSTRAINT "wizmatch_outreach_events_actor_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_reply_mailboxes" ADD CONSTRAINT "wizmatch_reply_mailboxes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_suppression_events" ADD CONSTRAINT "wizmatch_suppression_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_suppression_events" ADD CONSTRAINT "wizmatch_suppression_events_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_suppression_events" ADD CONSTRAINT "wizmatch_suppression_events_contact_channel_fk" FOREIGN KEY ("tenant_id","contact_channel_id") REFERENCES "public"."contact_channels"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_suppression_events" ADD CONSTRAINT "wizmatch_suppression_events_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."wizmatch_companies"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_suppression_events" ADD CONSTRAINT "wizmatch_suppression_events_enrolment_fk" FOREIGN KEY ("tenant_id","enrolment_id") REFERENCES "public"."wizmatch_outreach_enrolments"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_suppression_events" ADD CONSTRAINT "wizmatch_suppression_events_actor_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wizmatch_company_duplicates_tenant_resolution_idx" ON "wizmatch_company_duplicates" USING btree ("tenant_id","resolution");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_company_duplicates_pair_uniq" ON "wizmatch_company_duplicates" USING btree ("tenant_id","company_a_id","company_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_company_policies_active_scope_uniq" ON "wizmatch_company_policies" USING btree ("tenant_id","company_id","scope_key") WHERE "wizmatch_company_policies"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "wizmatch_company_policies_tenant_eligibility_idx" ON "wizmatch_company_policies" USING btree ("tenant_id","outreach_eligibility") WHERE "wizmatch_company_policies"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "wizmatch_company_policies_tenant_company_idx" ON "wizmatch_company_policies" USING btree ("tenant_id","company_id") WHERE "wizmatch_company_policies"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "wizmatch_company_policies_review_date_idx" ON "wizmatch_company_policies" USING btree ("tenant_id","review_date") WHERE "wizmatch_company_policies"."review_date" IS NOT NULL AND "wizmatch_company_policies"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "wizmatch_company_policy_events_tenant_company_idx" ON "wizmatch_company_policy_events" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "wizmatch_company_policy_events_tenant_policy_idx" ON "wizmatch_company_policy_events" USING btree ("tenant_id","policy_id");--> statement-breakpoint
CREATE INDEX "wizmatch_outreach_batches_tenant_status_idx" ON "wizmatch_outreach_batches" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "wizmatch_outreach_enrolments_tenant_company_idx" ON "wizmatch_outreach_enrolments" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "wizmatch_outreach_enrolments_tenant_state_idx" ON "wizmatch_outreach_enrolments" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_outreach_enrolments_batch_contact_uniq" ON "wizmatch_outreach_enrolments" USING btree ("tenant_id","batch_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_outreach_enrolments_company_cold_email_lock_uniq" ON "wizmatch_outreach_enrolments" USING btree ("tenant_id","company_id") WHERE outreach_mode = 'cold_email' AND state IN ('queued','exported','sent','replied','awaiting_action','positive_reply','referral_received','conversation_open');--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_outreach_enrolments_contact_live_uniq" ON "wizmatch_outreach_enrolments" USING btree ("tenant_id","contact_id") WHERE contact_id IS NOT NULL AND state IN ('queued','exported','sent','replied','awaiting_action','positive_reply','referral_received','conversation_open');--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_outreach_enrolments_email_key_live_uniq" ON "wizmatch_outreach_enrolments" USING btree ("tenant_id","enrolment_email_key") WHERE enrolment_email_key IS NOT NULL AND state IN ('queued','exported','sent','replied','awaiting_action','positive_reply','referral_received','conversation_open');--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_outreach_enrolments_company_family_mode_live_uniq" ON "wizmatch_outreach_enrolments" USING btree ("tenant_id","company_id","campaign_family","outreach_mode") WHERE state IN ('queued','exported','sent','replied','awaiting_action','positive_reply','referral_received','conversation_open');--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_outreach_events_idempotency_uniq" ON "wizmatch_outreach_events" USING btree ("tenant_id","provider","idempotency_key");--> statement-breakpoint
CREATE INDEX "wizmatch_outreach_events_tenant_enrolment_idx" ON "wizmatch_outreach_events" USING btree ("tenant_id","enrolment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_reply_mailboxes_tenant_address_uniq" ON "wizmatch_reply_mailboxes" USING btree ("tenant_id","address");--> statement-breakpoint
CREATE INDEX "wizmatch_suppression_events_tenant_grain_idx" ON "wizmatch_suppression_events" USING btree ("tenant_id","grain");--> statement-breakpoint
CREATE INDEX "wizmatch_suppression_events_tenant_email_idx" ON "wizmatch_suppression_events" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "wizmatch_suppression_events_tenant_company_idx" ON "wizmatch_suppression_events" USING btree ("tenant_id","company_id");--> statement-breakpoint
-- Guarded — wizmatch_companies and wizmatch_suppression_list are long-lived,
-- previously-altered tables (PRD-005 §10.11.3, H-11: the 0035 lesson). Wrapped
-- so a re-run or prior partial application no-ops instead of erroring,
-- matching the existing 0017 precedent for standalone FK additions.
DO $$ BEGIN
  ALTER TABLE "wizmatch_companies" ADD CONSTRAINT "wizmatch_companies_account_owner_fk" FOREIGN KEY ("tenant_id","account_owner_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wizmatch_suppression_list" ADD CONSTRAINT "wizmatch_suppression_list_contact_channel_fk" FOREIGN KEY ("tenant_id","contact_channel_id") REFERENCES "public"."contact_channels"("tenant_id","id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- M-6 fix (PR 2 review): non-unique, case-insensitive lookup index. The gate's
-- suppression read (outreachGate.ts) lowercases the stored column at query
-- time to match rows written by any path that bypasses normalizeChannelValue,
-- which defeats the existing UNIQUE (tenant_id, email) btree and forces a
-- sequential scan. This index does NOT replace, drop or narrow the
-- pre-existing UNIQUE (tenant_id, email) index (§22.2 #7), which is defined
-- in an earlier migration and stays untouched. The suppression grain (D-4)
-- and the hard-bounce/unsubscribe split are unaffected by this change. Not a
-- unique index, so it cannot itself prevent more than one row per email —
-- that invariant is already carried by the untouched unique index.
CREATE INDEX IF NOT EXISTS "wizmatch_suppression_tenant_lower_email_idx" ON "wizmatch_suppression_list" USING btree ("tenant_id", lower("email"));--> statement-breakpoint
-- The six additive (tenant_id, id) unique indexes of PRD-005 §10.10.1, and the
-- three (tenant_id, id) unique indexes on this migration's own new tables, are
-- created ABOVE the FK block — see MANUAL REORDER (0037). They are FK targets,
-- so they cannot be emitted here in drizzle-kit's generated position.
--> statement-breakpoint
-- >>> BEGIN MANUAL GUARD BLOCK (0037) — NOT GENERATED BY drizzle-kit
-- Reason: drizzle-kit 0.31.10 has no trigger primitive (PRD-005 §10.11.1) —
-- verified: zero `CREATE TRIGGER` / `CREATE OR REPLACE FUNCTION` across all
-- 37 prior migrations, and drizzle-orm's pg-core has no trigger builder.
-- Scope: policy-immutability trigger only (ADR-006 D-10). No DDL below this
-- line touches any object other than wizmatch_company_policies.
--
-- Six-step process followed (PRD-005 §10.11.2):
--   1. Generated via `npm run db:generate` (everything above this block).
--   2. This is the minimum required raw SQL — one function, one trigger.
--   3. Placed in this marked guard block.
--   4. Tested via a fresh 0000->0037 replay (§10.11.4 requirement 1).
--   5. Verified to contain no destructive statement (function replace +
--      trigger create/replace only — no DROP, no data DML).
--   6. Documented here and in the PR description, citing §10.11.1.
--
-- What it does: policy *decision content* is immutable (ADR-006 D-10). A
-- change is a new superseding row, never an in-place update. The only two
-- columns a service update path may ever touch are superseded_at and
-- superseded_by_policy_id. This trigger raises on any UPDATE that touches
-- any other column, so immutability is enforced at the database layer, not
-- only by service-layer convention.
CREATE OR REPLACE FUNCTION wizmatch_company_policies_enforce_immutability()
RETURNS TRIGGER AS $trigger$
BEGIN
  IF (
    NEW.tenant_id               IS DISTINCT FROM OLD.tenant_id OR
    NEW.company_id              IS DISTINCT FROM OLD.company_id OR
    NEW.scope_type               IS DISTINCT FROM OLD.scope_type OR
    NEW.scope_key                IS DISTINCT FROM OLD.scope_key OR
    NEW.signal_id                IS DISTINCT FROM OLD.signal_id OR
    NEW.requirement_id           IS DISTINCT FROM OLD.requirement_id OR
    NEW.scope_ref_label          IS DISTINCT FROM OLD.scope_ref_label OR
    NEW.outreach_eligibility     IS DISTINCT FROM OLD.outreach_eligibility OR
    NEW.external_hiring_policy   IS DISTINCT FROM OLD.external_hiring_policy OR
    NEW.relationship_type        IS DISTINCT FROM OLD.relationship_type OR
    NEW.reason_code              IS DISTINCT FROM OLD.reason_code OR
    NEW.reason                   IS DISTINCT FROM OLD.reason OR
    NEW.evidence_kind            IS DISTINCT FROM OLD.evidence_kind OR
    NEW.evidence_text            IS DISTINCT FROM OLD.evidence_text OR
    NEW.evidence_url             IS DISTINCT FROM OLD.evidence_url OR
    NEW.evidence_ref             IS DISTINCT FROM OLD.evidence_ref OR
    NEW.source                   IS DISTINCT FROM OLD.source OR
    NEW.actor_user_id            IS DISTINCT FROM OLD.actor_user_id OR
    NEW.is_permanent             IS DISTINCT FROM OLD.is_permanent OR
    NEW.block_class              IS DISTINCT FROM OLD.block_class OR
    NEW.is_non_overridable       IS DISTINCT FROM OLD.is_non_overridable OR
    NEW.review_date              IS DISTINCT FROM OLD.review_date OR
    NEW.created_at               IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'wizmatch_company_policies is immutable except superseded_at/superseded_by_policy_id (id=%)', OLD.id;
  END IF;
  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS wizmatch_company_policies_immutability_trg ON wizmatch_company_policies;
--> statement-breakpoint
CREATE TRIGGER wizmatch_company_policies_immutability_trg
BEFORE UPDATE ON wizmatch_company_policies
FOR EACH ROW
EXECUTE FUNCTION wizmatch_company_policies_enforce_immutability();
-- <<< END MANUAL GUARD BLOCK (0037)