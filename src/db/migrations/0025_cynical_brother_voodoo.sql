CREATE TABLE "wizmatch_company_contact_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_contact_id" uuid NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"added_by" uuid,
	"added_at" timestamp DEFAULT now(),
	"deactivated_by" uuid,
	"deactivated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "wizmatch_company_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"relationship_stage" text DEFAULT 'active' NOT NULL,
	"business_unit" text,
	"seniority" text,
	"owner_user_id" uuid,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"source_confidence" integer,
	"last_activity_at" timestamp DEFAULT now(),
	"next_action" text,
	"next_action_due_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wizmatch_requirement_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp DEFAULT now(),
	"unassigned_by" uuid,
	"unassigned_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "wizmatch_requirement_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"company_contact_id" uuid NOT NULL,
	"role" text DEFAULT 'source' NOT NULL,
	"is_primary_source" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"received_channel" text,
	"notes" text,
	"attributed_by" uuid,
	"attributed_at" timestamp DEFAULT now(),
	"deactivated_by" uuid,
	"deactivated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "wizmatch_staffing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"channel" text,
	"direction" text,
	"source" text DEFAULT 'staffing_os' NOT NULL,
	"source_id" text,
	"company_id" uuid,
	"contact_id" uuid,
	"company_contact_id" uuid,
	"requirement_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"company_id" uuid,
	"contact_id" uuid,
	"company_contact_id" uuid,
	"requirement_id" uuid,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "attribution_status" text DEFAULT 'needs_attribution' NOT NULL;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "stage" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "stage_entered_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "received_at" timestamp;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "last_activity_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "next_action" text;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "next_action_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "sla_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "closure_reason" text;--> statement-breakpoint
ALTER TABLE "wizmatch_company_contact_roles" ADD CONSTRAINT "wizmatch_company_contact_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_contact_roles" ADD CONSTRAINT "wizmatch_company_contact_roles_company_contact_id_wizmatch_company_contacts_id_fk" FOREIGN KEY ("company_contact_id") REFERENCES "public"."wizmatch_company_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_contact_roles" ADD CONSTRAINT "wizmatch_company_contact_roles_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_contact_roles" ADD CONSTRAINT "wizmatch_company_contact_roles_deactivated_by_users_id_fk" FOREIGN KEY ("deactivated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_contacts" ADD CONSTRAINT "wizmatch_company_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_contacts" ADD CONSTRAINT "wizmatch_company_contacts_company_id_wizmatch_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."wizmatch_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_contacts" ADD CONSTRAINT "wizmatch_company_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_company_contacts" ADD CONSTRAINT "wizmatch_company_contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_assignments" ADD CONSTRAINT "wizmatch_requirement_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_assignments" ADD CONSTRAINT "wizmatch_requirement_assignments_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_assignments" ADD CONSTRAINT "wizmatch_requirement_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_assignments" ADD CONSTRAINT "wizmatch_requirement_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_assignments" ADD CONSTRAINT "wizmatch_requirement_assignments_unassigned_by_users_id_fk" FOREIGN KEY ("unassigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_contacts" ADD CONSTRAINT "wizmatch_requirement_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_contacts" ADD CONSTRAINT "wizmatch_requirement_contacts_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_contacts" ADD CONSTRAINT "wizmatch_requirement_contacts_company_contact_id_wizmatch_company_contacts_id_fk" FOREIGN KEY ("company_contact_id") REFERENCES "public"."wizmatch_company_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_contacts" ADD CONSTRAINT "wizmatch_requirement_contacts_attributed_by_users_id_fk" FOREIGN KEY ("attributed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_contacts" ADD CONSTRAINT "wizmatch_requirement_contacts_deactivated_by_users_id_fk" FOREIGN KEY ("deactivated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_company_id_wizmatch_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."wizmatch_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_company_contact_id_wizmatch_company_contacts_id_fk" FOREIGN KEY ("company_contact_id") REFERENCES "public"."wizmatch_company_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_staffing_events" ADD CONSTRAINT "wizmatch_staffing_events_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD CONSTRAINT "wizmatch_task_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD CONSTRAINT "wizmatch_task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD CONSTRAINT "wizmatch_task_links_company_id_wizmatch_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."wizmatch_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD CONSTRAINT "wizmatch_task_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD CONSTRAINT "wizmatch_task_links_company_contact_id_wizmatch_company_contacts_id_fk" FOREIGN KEY ("company_contact_id") REFERENCES "public"."wizmatch_company_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_task_links" ADD CONSTRAINT "wizmatch_task_links_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wizmatch_company_contact_roles_relationship_idx" ON "wizmatch_company_contact_roles" USING btree ("tenant_id","company_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_company_contact_roles_unique_idx" ON "wizmatch_company_contact_roles" USING btree ("tenant_id","company_contact_id","role");--> statement-breakpoint
CREATE INDEX "wizmatch_company_contacts_tenant_company_idx" ON "wizmatch_company_contacts" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "wizmatch_company_contacts_tenant_contact_idx" ON "wizmatch_company_contacts" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "wizmatch_company_contacts_next_action_idx" ON "wizmatch_company_contacts" USING btree ("tenant_id","next_action_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_company_contacts_relationship_idx" ON "wizmatch_company_contacts" USING btree ("tenant_id","company_id","contact_id");--> statement-breakpoint
CREATE INDEX "wizmatch_requirement_assignments_requirement_idx" ON "wizmatch_requirement_assignments" USING btree ("tenant_id","requirement_id");--> statement-breakpoint
CREATE INDEX "wizmatch_requirement_assignments_user_idx" ON "wizmatch_requirement_assignments" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_requirement_assignments_active_idx" ON "wizmatch_requirement_assignments" USING btree ("tenant_id","requirement_id","user_id","role") WHERE "wizmatch_requirement_assignments"."active" = true;--> statement-breakpoint
CREATE INDEX "wizmatch_requirement_contacts_requirement_idx" ON "wizmatch_requirement_contacts" USING btree ("tenant_id","requirement_id");--> statement-breakpoint
CREATE INDEX "wizmatch_requirement_contacts_company_contact_idx" ON "wizmatch_requirement_contacts" USING btree ("company_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_requirement_contacts_unique_idx" ON "wizmatch_requirement_contacts" USING btree ("tenant_id","requirement_id","company_contact_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_requirement_contacts_primary_idx" ON "wizmatch_requirement_contacts" USING btree ("tenant_id","requirement_id") WHERE "wizmatch_requirement_contacts"."active" = true AND "wizmatch_requirement_contacts"."is_primary_source" = true;--> statement-breakpoint
CREATE INDEX "wizmatch_staffing_events_occurred_idx" ON "wizmatch_staffing_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "wizmatch_staffing_events_requirement_idx" ON "wizmatch_staffing_events" USING btree ("tenant_id","requirement_id","occurred_at");--> statement-breakpoint
CREATE INDEX "wizmatch_staffing_events_company_idx" ON "wizmatch_staffing_events" USING btree ("tenant_id","company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "wizmatch_staffing_events_company_contact_idx" ON "wizmatch_staffing_events" USING btree ("tenant_id","company_contact_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_task_links_task_idx" ON "wizmatch_task_links" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "wizmatch_task_links_requirement_idx" ON "wizmatch_task_links" USING btree ("tenant_id","requirement_id");--> statement-breakpoint
CREATE INDEX "wizmatch_task_links_company_idx" ON "wizmatch_task_links" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "wizmatch_requirements_stage_idx" ON "wizmatch_requirements" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE INDEX "wizmatch_requirements_next_action_idx" ON "wizmatch_requirements" USING btree ("tenant_id","next_action_due_at");