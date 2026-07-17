CREATE TABLE "contract_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"consent_text" text NOT NULL,
	"consent_version" text NOT NULL,
	"electronic_transaction_consent" boolean DEFAULT false NOT NULL,
	"reviewed_document" boolean DEFAULT false NOT NULL,
	"intent_to_sign" boolean DEFAULT false NOT NULL,
	"authority_confirmed" boolean DEFAULT false NOT NULL,
	"document_hash_at_consent" text,
	"ip_address" text,
	"user_agent" text,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"recipient_id" uuid,
	"tenant_id" uuid NOT NULL,
	"external_event_id" text,
	"event_type" text NOT NULL,
	"event_source" text DEFAULT 'crm' NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_hash" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"crm_user_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company_name" text,
	"designation" text,
	"signing_role" text DEFAULT 'client_signer' NOT NULL,
	"signing_order" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"documenso_recipient_id" text,
	"signing_token_hash" text,
	"viewed_at" timestamp,
	"signed_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"source_type" text DEFAULT 'documenso_template' NOT NULL,
	"documenso_template_id" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_company_id" uuid,
	"template_id" uuid,
	"parent_contract_id" uuid,
	"title" text NOT NULL,
	"reference_number" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"provider" text DEFAULT 'documenso' NOT NULL,
	"documenso_document_id" text,
	"source_file_key" text,
	"generated_file_key" text,
	"completed_file_key" text,
	"audit_certificate_file_key" text,
	"source_document_hash" text,
	"generated_document_hash" text,
	"completed_document_hash" text,
	"audit_certificate_hash" text,
	"requires_countersignature" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp,
	"sent_by" uuid,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"expires_at" timestamp,
	"voided_at" timestamp,
	"void_reason" text,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_consents" ADD CONSTRAINT "contract_consents_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_consents" ADD CONSTRAINT "contract_consents_recipient_id_contract_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."contract_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_consents" ADD CONSTRAINT "contract_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_recipient_id_contract_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."contract_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_recipients" ADD CONSTRAINT "contract_recipients_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_recipients" ADD CONSTRAINT "contract_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_recipients" ADD CONSTRAINT "contract_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_recipients" ADD CONSTRAINT "contract_recipients_crm_user_id_users_id_fk" FOREIGN KEY ("crm_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_company_id_billing_clients_id_fk" FOREIGN KEY ("client_company_id") REFERENCES "public"."billing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_consents_contract_idx" ON "contract_consents" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_consents_recipient_idx" ON "contract_consents" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "contract_events_contract_idx" ON "contract_events" USING btree ("contract_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_events_external_uniq" ON "contract_events" USING btree ("event_source","external_event_id") WHERE "contract_events"."external_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "contract_recipients_contract_idx" ON "contract_recipients" USING btree ("contract_id","signing_order");--> statement-breakpoint
CREATE INDEX "contract_recipients_tenant_idx" ON "contract_recipients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "contract_recipients_documenso_idx" ON "contract_recipients" USING btree ("documenso_recipient_id");--> statement-breakpoint
CREATE INDEX "contract_templates_tenant_idx" ON "contract_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "contract_templates_active_idx" ON "contract_templates" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "contracts_tenant_status_idx" ON "contracts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "contracts_client_idx" ON "contracts" USING btree ("tenant_id","client_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_reference_number_uniq" ON "contracts" USING btree ("tenant_id","reference_number");--> statement-breakpoint
CREATE INDEX "contracts_documenso_doc_idx" ON "contracts" USING btree ("documenso_document_id");