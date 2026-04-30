---
name: ge-add-migration
description: Use when adding a column, table, index, or constraint to the Postgres schema. Triggers include "add a status column to deals", "new table for X", "I need to track Y on contacts", "schema change for the new feature", or any edit that touches src/db/schema.ts. Skips: data backfills (write a one-off script), runtime ensure* fixups inside an existing service, anything that only changes Drizzle query code without altering the table.
---

# Adding a Drizzle migration

The schema lives in `src/db/schema.ts`. Migrations are generated (not hand-written) and applied automatically on every API boot. Hand-editing migrations or schema-without-regenerating breaks Postgres state across environments.

Reference: [`docs/DATABASE.md`](../../../docs/DATABASE.md) "Schema lifecycle".

## Steps

1. **Pause and confirm with the user before editing `src/db/schema.ts`.** This file is on the "don't touch without asking" list in [`CLAUDE.md`](../../../CLAUDE.md). Once they approve, proceed.

2. **Edit `src/db/schema.ts`** — add the column / table / index. New tables MUST include a `tenantId` column with the `tenants.id` foreign key — almost every query is tenant-scoped (see [`docs/DATABASE.md`](../../../docs/DATABASE.md) Multi-tenancy). Use existing tables as a template; match column naming (`snake_case` in DB, `camelCase` in Drizzle).

3. **Generate the migration:**
   ```bash
   npm run db:generate
   ```
   This diffs `schema.ts` against the last applied migration and emits SQL to `src/db/migrations/NNNN_<name>.sql` plus snapshot JSON in `src/db/migrations/meta/`. Drizzle picks the name; if it's nonsense (`silly_blue_shield`), that's fine — don't rename, the meta files reference it.

4. **Review the generated SQL.** Check for:
   - Unintended drops (a renamed column emits `DROP` + `ADD` — that's data loss). If you see one, revert the rename and instead add the new column + write a backfill in a separate step.
   - `NOT NULL` without a default on a non-empty table — will fail to apply. Either add a default or split into `ADD COLUMN` (nullable) → backfill → `ALTER ... SET NOT NULL`.
   - Foreign key direction matches the `references()` in schema.

5. **Stage the migration + schema together.** They're a single coherent unit — never commit one without the other. Commit message style: `feat(db): add X to Y` or `chore(db): index Z for query performance`.

6. **Don't run `db:migrate` against production from your machine.** Migrations apply automatically on Railway boot via `dist/scripts/migrate.js` (the API service `startCommand`). Local `db:migrate` only touches your local DB. If you need to verify the SQL, point at a scratch DB.

7. **Verify before commit:** `npm run build` (must exit 0 — schema TypeScript types are emitted on build) and `npm test` (any test that imports schema needs to compile).

## ensure* hooks — legacy pattern, preserve don't extend

Several services have `ensureXTable()` / `ensureXColumns()` functions called fire-and-forget from `src/index.ts` and `src/worker.ts` (e.g. `ensureGrowthOSTables`, `ensureFunnelWaitlistTable`, `ensurePipelineContactsTable`). These predate Drizzle adoption — they ALTER TABLE on boot to add columns that were never properly migrated.

**Rule**: new columns go through Drizzle. Don't add a new `ensureXColumns()` to dodge migration generation. **Exception**: if you're inheriting a service that already uses `ensure*`, keep that pattern within the service rather than mixing approaches mid-file.

If your migration adds a column the `ensure*` hook also tried to add, leave the `ensure*` in place — it's an idempotent `ADD COLUMN IF NOT EXISTS`, harmless after the migration runs. Don't rip it out in the same commit; do that as a follow-up cleanup once production has the column from the migration path.

## Common ways this goes wrong

- Edited `schema.ts`, didn't run `db:generate` → next CI run regenerates with the change anyway, or worse, a teammate's later change pulls yours into their migration.
- Edited a file in `src/db/migrations/` directly → already applied to prod; editing won't re-run, your change has no effect except confusing future readers.
- Added `NOT NULL` to a populated table without a default → migration fails on Railway boot, API doesn't start, prod is down.
- Forgot `tenantId` on a new table → cross-tenant data leak the first time the table is queried.
- Renamed a column instead of adding a new one → migration includes a destructive `DROP`. Always add-then-backfill-then-drop in three commits.

## Reference

- [`docs/DATABASE.md`](../../../docs/DATABASE.md) — full schema lifecycle, multi-tenancy rules, contact_channels gotcha
- [src/db/schema.ts](../../../src/db/schema.ts) — every table
- [src/db/migrations/](../../../src/db/migrations/) — applied SQL (read-only)
- `drizzle.config.ts` — Drizzle Kit config (paths, dialect)
