CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_views_tenant_page_idx" ON "saved_views" USING btree ("tenant_id","page_id");--> statement-breakpoint
CREATE INDEX "saved_views_owner_idx" ON "saved_views" USING btree ("tenant_id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_owner_page_name_uniq" ON "saved_views" USING btree ("tenant_id","owner_user_id","page_id","name");