CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color" text DEFAULT '#F97316',
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "last_activity_at" timestamp;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "pipeline_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "deal_value" integer;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipelines_tenant_id_idx" ON "pipelines" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_tenant_slug_idx" ON "pipelines" USING btree ("tenant_id","slug");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deals_pipeline_id_idx" ON "deals" USING btree ("pipeline_id");