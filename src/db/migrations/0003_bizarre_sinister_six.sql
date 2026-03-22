CREATE TABLE "contact_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_by" text DEFAULT 'jatin' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"type" text DEFAULT 'sequence',
	"subject" text NOT NULL,
	"from_name" text DEFAULT 'Jatin from Growth Escalators',
	"body_html" text,
	"body_text" text,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"brevo_template_id" integer,
	"brevo_synced" boolean DEFAULT false,
	"brevo_synced_at" timestamp,
	"is_active" boolean DEFAULT true,
	"open_rate" real,
	"sent_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "won_notes" text;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_templates_tenant_idx" ON "email_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_tenant_name_idx" ON "email_templates" USING btree ("tenant_id","name");