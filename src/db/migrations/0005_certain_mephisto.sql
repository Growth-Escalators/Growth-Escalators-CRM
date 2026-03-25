CREATE TABLE "billing_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"email" text,
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"state_code" text,
	"pincode" text,
	"country" text DEFAULT 'India',
	"is_gst" boolean DEFAULT false,
	"gstin" text,
	"tax_type" text,
	"retainer_amount" integer,
	"service_description" text,
	"sac_code" text DEFAULT '9983',
	"invoice_day_of_month" integer DEFAULT 1,
	"currency" text DEFAULT 'INR',
	"is_active" boolean DEFAULT true,
	"notes" text,
	"crm_contact_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"sac_code" text DEFAULT '9983',
	"quantity" real DEFAULT 1,
	"unit" text DEFAULT 'Month',
	"rate" integer NOT NULL,
	"amount" integer NOT NULL,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "invoice_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"series_type" text NOT NULL,
	"financial_year" text NOT NULL,
	"last_number" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_type" text NOT NULL,
	"status" text DEFAULT 'draft',
	"invoice_date" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"sent_at" timestamp,
	"paid_at" timestamp,
	"subtotal" integer NOT NULL,
	"cgst_rate" real DEFAULT 0,
	"cgst_amount" integer DEFAULT 0,
	"sgst_rate" real DEFAULT 0,
	"sgst_amount" integer DEFAULT 0,
	"igst_rate" real DEFAULT 0,
	"igst_amount" integer DEFAULT 0,
	"total_amount" integer NOT NULL,
	"amount_paid" integer DEFAULT 0,
	"amount_due" integer NOT NULL,
	"amount_in_words" text,
	"client_gstin" text,
	"client_state" text,
	"client_state_code" text,
	"company_gstin" text,
	"tax_type" text,
	"service_description" text,
	"sac_code" text DEFAULT '9983',
	"notes" text,
	"payment_note" text,
	"is_recurring" boolean DEFAULT false,
	"recurring_source_id" uuid,
	"financial_year" text,
	"series_number" integer,
	"created_by" text DEFAULT 'jatin',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"payment_date" timestamp NOT NULL,
	"payment_mode" text,
	"reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contacts_view" boolean DEFAULT false,
	"contacts_create" boolean DEFAULT false,
	"contacts_edit" boolean DEFAULT false,
	"contacts_delete" boolean DEFAULT false,
	"contacts_export" boolean DEFAULT false,
	"contacts_bulk" boolean DEFAULT false,
	"pipeline_view" boolean DEFAULT false,
	"pipeline_create" boolean DEFAULT false,
	"pipeline_edit" boolean DEFAULT false,
	"pipeline_delete" boolean DEFAULT false,
	"pipeline_manage" boolean DEFAULT false,
	"billing_view" boolean DEFAULT false,
	"billing_create" boolean DEFAULT false,
	"billing_edit" boolean DEFAULT false,
	"billing_mark_paid" boolean DEFAULT false,
	"billing_view_mrr" boolean DEFAULT false,
	"billing_download" boolean DEFAULT false,
	"billing_manage_clients" boolean DEFAULT false,
	"automations_view" boolean DEFAULT false,
	"automations_trigger" boolean DEFAULT false,
	"reports_view" boolean DEFAULT false,
	"reports_meta_ads" boolean DEFAULT false,
	"settings_users" boolean DEFAULT false,
	"settings_pipelines" boolean DEFAULT false,
	"settings_templates" boolean DEFAULT false,
	"settings_billing" boolean DEFAULT false,
	"is_owner" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "billing_clients" ADD CONSTRAINT "billing_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_billing_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."billing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_billing_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."billing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;