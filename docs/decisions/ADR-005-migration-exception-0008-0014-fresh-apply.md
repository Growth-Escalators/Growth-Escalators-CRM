# ADR-005 — One-time migration-owner exception: idempotency edits to historical migrations 0008/0014

- **Status:** Accepted — one-time exception approved 2026-07-14
- **Date:** 2026-07-13
- **Deciders:** Jatin (migration owner) — approved through the Final Hardening and Production Launch plan; Claude — implemented/analysed
- **Supersedes/related:** review at
  [`../reviews/wizmatch-migration-guardrail-review-2026-07-13.md`](../reviews/wizmatch-migration-guardrail-review-2026-07-13.md);
  guardrail in `AGENTS.md` (`src/db/migrations/` = "Already-applied SQL — editing breaks prod Postgres state").
- **Commit under exception:** `a810d08 fix(migrations): make 0008/0014 idempotent for fresh-database apply` (UNPUSHED).

## Context

`AGENTS.md`/`CLAUDE.md` list `src/db/migrations/` as a guardrail path: already-applied SQL must not be
hand-edited without explicit human confirmation, because editing applied migrations can break the
production Postgres migration state.

While standing up an **isolated Railway staging** environment for the Gate A–C pilot, the complete
migration journal (`0000`–`0028`) had to be applied to a **fresh, empty** database. It failed,
because two historical migrations are not replayable from scratch:

- **`0008_great_romulus.sql`** re-creates `social_accounts`/`social_posts`, the `billing_clients`/
  `messages` columns and 3 social FK constraints with **bare** statements, but `0007_ads_social_inbox.sql`
  (an idempotent retrofit superset) already creates them — so a fresh apply hits `already exists`.
- **`0014_brevo_email_templates_seed.sql`** used `ON CONFLICT ON CONSTRAINT
  email_templates_tenant_name_idx`, but that name is a unique **index** (from `0003`), not a
  constraint — `ON CONFLICT ON CONSTRAINT` therefore fails from scratch.

Production was migrated **incrementally** over time and never performed a from-scratch replay, so it
was unaffected; but no fresh clone / staging / new environment could apply the chain.

## Decision

Approve a **one-time, documented exception** to the historical-migration guardrail to keep commit
`a810d08`, which makes those statements idempotent. This decision is not approval to push:

- `0008`: `CREATE TABLE IF NOT EXISTS` (×2), `ADD COLUMN IF NOT EXISTS` (×3), and
  `DO $$ … pg_constraint …$$` guards on the 3 social FK constraints (matching `0009`'s own pattern).
- `0014`: all 5 occurrences switched to `ON CONFLICT (tenant_id, name)` — the column-inference form
  the file's own comment already documented.

`a810d08` remains **local and UNPUSHED**; pushing any branch (and thus `main` auto-deploy) is a
separate approval and out of scope for this ADR.

## Production-safety analysis

The deploy migrator is `drizzle-orm/node-postgres` (`src/scripts/migrate.ts` → `node
dist/scripts/migrate.js` at deploy). For an existing production database:

1. It applies only journal entries whose `when` timestamp is **greater than the single most-recent
   applied migration's `created_at`**. `0008`/`0014` are far older than the latest applied (`0028`),
   so they **will not re-run** on a production deploy.
2. It does **not** re-hash or integrity-check already-applied migrations, so the changed file
   content does not trigger re-application or an error.
3. Even if they re-ran, the edits are **idempotent** — `IF NOT EXISTS`, `DO … pg_constraint`,
   `ON CONFLICT (cols)` — and are no-ops on the existing production schema.
4. No **resulting schema shape** changes; no `meta/*_snapshot.json` change; `db:generate` is
   unaffected.

## Fresh-database verification

Applying the full journal (`0000`–`0028`) with the real deployment migrator to a **fresh Railway
staging Postgres** succeeded: `drizzle.__drizzle_migrations` = 29 rows, 81 public base tables, 31
`wizmatch_*` tables, all Gate A/B/C tables present. `0009` and `0020_wizmatch_gin_indexes` were
confirmed already-idempotent and left untouched; a full static scan (CREATE TABLE / ADD COLUMN /
ADD CONSTRAINT / CREATE INDEX / CREATE TYPE) found no other from-scratch duplicate conflicts.

## Residual risks to accept if approved

- It rewrites the committed content of already-applied migrations — the exact class of change the
  guardrail exists to prevent.
- It relies on drizzle's current **timestamp-only** comparison; a future migrator that adds
  per-migration hash-integrity checks could flag the drift.
- Any environment or tool that records migration file hashes would see a mismatch.

The proposal is to accept these risks because the change is prod-safe by the analysis above,
verified on a fresh DB, and makes the chain replayable for fresh installs/staging.

## Scope limit — NOT a general precedent

This exception applies **only** to commit `a810d08` (the specific `0008`/`0014` idempotency edits).
It does **not** authorize any other edit to `src/db/migrations/`. Every future change to an
already-applied migration still requires:

1. explicit migration-owner (human) approval, and
2. a new dated review + ADR with an equivalent prod-safety analysis and fresh-DB verification.

New schema changes must continue to go through `schema.ts` → `db:generate` → a **new additive**
migration, never a hand-edit of applied SQL. A future, cleaner alternative (baseline schema dump +
journal stamp for fresh installs, leaving history byte-frozen) may retire this exception later.

## Consequences

- `a810d08` may be committed/kept on the branch; it stays UNPUSHED until a separate push approval.
- Fresh databases (staging, new clones) can now apply the full journal cleanly.
- The guardrail remains in force for all other migrations; this ADR is the audit record of the
  single exception.
