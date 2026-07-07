ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_email_unique"
  ON "users" ("tenant_id", "email");
--> statement-breakpoint
INSERT INTO "tenants" ("name", "slug", "plan", "settings", "is_active")
VALUES ('Wizmatch', 'wizmatch', 'wizmatch_internal', '{}'::jsonb, true)
ON CONFLICT ("slug") DO NOTHING;
