---
name: ge-add-ensure-table
description: Use when adding a new table for a feature or tenant module (Wizmatch, outreach, SEO, funnel, finance, intelligence) that should NOT go through Drizzle migrations. Triggers include "new table for the wizmatch X", "store Y for this feature", "add a table for the outreach templates/logs", "persist Z without a migration", or any table that belongs to a service rather than core CRM. Skips: core CRM entities like contacts/deals/users (use ge-add-migration + schema.ts), adding a column to an existing schema.ts table (ge-add-migration), one-off data writes (ge-prod-data-mutation).
---

# Adding an ensure-hook table

This repo has **two ways to create a table** — picking the wrong one is a real mistake.

| Table kind | Pattern | Skill |
|---|---|---|
| Core CRM entity (contacts, deals, users, sequences) | `src/db/schema.ts` + generated migration | `ge-add-migration` |
| Feature / tenant / Wizmatch table | `CREATE TABLE IF NOT EXISTS` ensure-hook inside the service | **this skill** |

There are 20+ `ensure*Table` helpers already (e.g. `ensureOutreachTemplatesTable`,
`ensureSeoTable`, `ensureFinanceTable`) and all ~12 Wizmatch tables use this pattern deliberately —
so a feature table can ship without touching the guardrail `schema.ts` / `migrations/` paths.

## When to use ensure-hook (not schema.ts)
- The table is owned by one service / feature, not the shared CRM core.
- It's tenant- or product-scoped (Wizmatch, SEO client, outreach).
- You want it created idempotently at runtime, no migration file.

## Steps

1. **Copy the shape from a real one.** See
   [`src/services/wizmatchOutreachTemplates.ts`](../../../src/services/wizmatchOutreachTemplates.ts)
   `ensureOutreachTemplatesTable`. The pattern:
   ```ts
   export async function ensureMyThingTable(pool: Pool): Promise<void> {
     await pool.query(`
       CREATE TABLE IF NOT EXISTS my_thing (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         tenant_id uuid NOT NULL,
         ...,
         created_at timestamp DEFAULT NOW(),
         updated_at timestamp DEFAULT NOW()
       )
     `);
     await pool.query(`CREATE INDEX IF NOT EXISTS my_thing_tenant_idx ON my_thing (tenant_id)`);
   }
   ```
2. **Always `IF NOT EXISTS`** on both table and indexes — the hook runs on every boot; it must be
   safe to run repeatedly.
3. **Include `tenant_id`** and index it — these tables are multi-tenant.
4. **Call the ensure fn before first use** (at service init or at the top of the route handler that
   reads/writes it), same as the existing services do.
5. **Adding a column later?** Use a separate `ensure*Columns` helper with
   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — never edit an applied migration.

## Never
- Never put a feature/tenant table into `schema.ts` (forces an unwanted migration; pollutes core).
- Never hand-write a file under `src/db/migrations/` for these.
- Never omit `IF NOT EXISTS` — a second boot will crash on "table already exists".
