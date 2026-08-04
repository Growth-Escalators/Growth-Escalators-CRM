CREATE TABLE "tenant_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_credentials" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_integrations_tenant_id_idx" ON "tenant_integrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_integrations_tenant_id_provider_uniq" ON "tenant_integrations" USING btree ("tenant_id","provider");