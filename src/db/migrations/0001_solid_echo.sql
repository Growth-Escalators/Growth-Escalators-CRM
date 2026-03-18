CREATE TABLE "funnel_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"funnel_id" uuid NOT NULL,
	"funnel_member_id" uuid NOT NULL,
	"assigned_at" timestamp DEFAULT now(),
	"visitor_ip" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "funnel_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"funnel_id" uuid NOT NULL,
	"member_name" text NOT NULL,
	"calcom_url" text NOT NULL,
	"weight" integer DEFAULT 50,
	"total_assigned" integer DEFAULT 0,
	"last_assigned_at" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "funnels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "funnel_assignments" ADD CONSTRAINT "funnel_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_assignments" ADD CONSTRAINT "funnel_assignments_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_assignments" ADD CONSTRAINT "funnel_assignments_funnel_member_id_funnel_members_id_fk" FOREIGN KEY ("funnel_member_id") REFERENCES "public"."funnel_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_members" ADD CONSTRAINT "funnel_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_members" ADD CONSTRAINT "funnel_members_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funnel_assignments_funnel_idx" ON "funnel_assignments" USING btree ("funnel_id");--> statement-breakpoint
CREATE INDEX "funnel_members_funnel_idx" ON "funnel_members" USING btree ("funnel_id");--> statement-breakpoint
CREATE INDEX "funnels_tenant_idx" ON "funnels" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnels_tenant_slug_idx" ON "funnels" USING btree ("tenant_id","slug");