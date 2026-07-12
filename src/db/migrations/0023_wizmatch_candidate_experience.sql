-- Adds a nullable years-of-experience column to wizmatch_candidates.
-- Hand-written (not drizzle-generated) on purpose: the drizzle snapshots in
-- meta/ stop at 0019 while the SQL/journal run through 0022, so `db:generate`
-- diffs against a stale baseline and emits a destructive migration. This single
-- additive, idempotent statement is the safe path. Metadata-only in Postgres
-- (no table rewrite, no lock beyond a brief catalog update).
ALTER TABLE "wizmatch_candidates" ADD COLUMN IF NOT EXISTS "experience_years" integer;
