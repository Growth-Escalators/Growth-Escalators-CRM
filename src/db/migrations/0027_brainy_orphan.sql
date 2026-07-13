CREATE TABLE "wizmatch_candidate_requirement_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"score_version" text DEFAULT 'gate-b-v1' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"human_decision" text DEFAULT 'unreviewed' NOT NULL,
	"decision_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"recalculated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_candidate_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"experience_years" integer,
	"last_used_at" date,
	"evidence" text,
	"confidence" integer,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_match_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"score_version" text NOT NULL,
	"input_evidence" jsonb NOT NULL,
	"output_evidence" jsonb NOT NULL,
	"score" integer NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_requirement_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"importance" text DEFAULT 'mandatory' NOT NULL,
	"minimum_years" integer,
	"evidence" text,
	"allow_broad_family" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_skill_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"raw_alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"provenance" text DEFAULT 'manual' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizmatch_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"family" text NOT NULL,
	"specialization" text NOT NULL,
	"platform_version" text,
	"canonical_label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wizmatch_candidates" ADD COLUMN "rate_period" text DEFAULT 'hourly';--> statement-breakpoint
ALTER TABLE "wizmatch_candidates" ADD COLUMN "normalized_annual_rate" integer;--> statement-breakpoint
ALTER TABLE "wizmatch_candidates" ADD COLUMN "normalization_currency" text;--> statement-breakpoint
ALTER TABLE "wizmatch_candidates" ADD COLUMN "conversion_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "wizmatch_candidates" ADD COLUMN "conversion_source" text;--> statement-breakpoint
ALTER TABLE "wizmatch_candidates" ADD COLUMN "conversion_date" date;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "normalized_budget_min_annual" integer;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "normalized_budget_max_annual" integer;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "normalization_currency" text;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "conversion_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "conversion_source" text;--> statement-breakpoint
ALTER TABLE "wizmatch_requirements" ADD COLUMN "conversion_date" date;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_requirement_matches" ADD CONSTRAINT "wizmatch_candidate_requirement_matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_requirement_matches" ADD CONSTRAINT "wizmatch_candidate_requirement_matches_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_requirement_matches" ADD CONSTRAINT "wizmatch_candidate_requirement_matches_candidate_id_wizmatch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."wizmatch_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_requirement_matches" ADD CONSTRAINT "wizmatch_candidate_requirement_matches_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_skills" ADD CONSTRAINT "wizmatch_candidate_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_skills" ADD CONSTRAINT "wizmatch_candidate_skills_candidate_id_wizmatch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."wizmatch_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_skills" ADD CONSTRAINT "wizmatch_candidate_skills_skill_id_wizmatch_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."wizmatch_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_candidate_skills" ADD CONSTRAINT "wizmatch_candidate_skills_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_match_snapshots" ADD CONSTRAINT "wizmatch_match_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_match_snapshots" ADD CONSTRAINT "wizmatch_match_snapshots_match_id_wizmatch_candidate_requirement_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."wizmatch_candidate_requirement_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_match_snapshots" ADD CONSTRAINT "wizmatch_match_snapshots_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_match_snapshots" ADD CONSTRAINT "wizmatch_match_snapshots_candidate_id_wizmatch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."wizmatch_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_match_snapshots" ADD CONSTRAINT "wizmatch_match_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_skills" ADD CONSTRAINT "wizmatch_requirement_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_skills" ADD CONSTRAINT "wizmatch_requirement_skills_requirement_id_wizmatch_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."wizmatch_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_skills" ADD CONSTRAINT "wizmatch_requirement_skills_skill_id_wizmatch_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."wizmatch_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_requirement_skills" ADD CONSTRAINT "wizmatch_requirement_skills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_skill_aliases" ADD CONSTRAINT "wizmatch_skill_aliases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_skill_aliases" ADD CONSTRAINT "wizmatch_skill_aliases_skill_id_wizmatch_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."wizmatch_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_skill_aliases" ADD CONSTRAINT "wizmatch_skill_aliases_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_skills" ADD CONSTRAINT "wizmatch_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizmatch_skills" ADD CONSTRAINT "wizmatch_skills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_matches_pair_idx" ON "wizmatch_candidate_requirement_matches" USING btree ("tenant_id","requirement_id","candidate_id");--> statement-breakpoint
CREATE INDEX "wizmatch_matches_requirement_score_idx" ON "wizmatch_candidate_requirement_matches" USING btree ("tenant_id","requirement_id","score");--> statement-breakpoint
CREATE INDEX "wizmatch_matches_candidate_idx" ON "wizmatch_candidate_requirement_matches" USING btree ("tenant_id","candidate_id");--> statement-breakpoint
CREATE INDEX "wizmatch_candidate_skills_candidate_idx" ON "wizmatch_candidate_skills" USING btree ("tenant_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_candidate_skills_unique_idx" ON "wizmatch_candidate_skills" USING btree ("tenant_id","candidate_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_match_snapshots_version_idx" ON "wizmatch_match_snapshots" USING btree ("tenant_id","match_id","version");--> statement-breakpoint
CREATE INDEX "wizmatch_match_snapshots_pair_idx" ON "wizmatch_match_snapshots" USING btree ("tenant_id","requirement_id","candidate_id");--> statement-breakpoint
CREATE INDEX "wizmatch_requirement_skills_requirement_idx" ON "wizmatch_requirement_skills" USING btree ("tenant_id","requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_requirement_skills_unique_idx" ON "wizmatch_requirement_skills" USING btree ("tenant_id","requirement_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_skill_aliases_tenant_alias_idx" ON "wizmatch_skill_aliases" USING btree ("tenant_id","normalized_alias");--> statement-breakpoint
CREATE INDEX "wizmatch_skill_aliases_skill_idx" ON "wizmatch_skill_aliases" USING btree ("tenant_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wizmatch_skills_tenant_label_idx" ON "wizmatch_skills" USING btree ("tenant_id","canonical_label");--> statement-breakpoint
CREATE INDEX "wizmatch_skills_family_idx" ON "wizmatch_skills" USING btree ("tenant_id","family","specialization");