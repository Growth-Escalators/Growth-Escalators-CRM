---
name: ge-prod-data-mutation
description: Use before making any one-off write to production data — offboarding a team member, unsticking a row, resetting a cooldown, flipping a flag, backfilling a column, deleting/merging records, or any manual UPDATE/DELETE/INSERT against live Postgres. Triggers include "remove <person> from the CRM", "reassign their contacts/deals", "unblock <company>", "reset the cooldown", "flip paid_provider", "backfill X", "fix this stuck row in prod", "run this SQL on production". Skips: schema changes (use ge-add-migration), read-only queries, local/dev seed scripts, ensure-hook table creation (use ge-add-ensure-table).
---

# Production data mutation — safe every time

Direct writes to live Postgres are the highest-consequence, least-reversible thing done in this
repo. One wrong `WHERE` can flip a flag on every row, orphan a deal, or bury a contact. This repo
already carries hand-rolled examples ([`src/scripts/removeVishal.ts`](../../../src/scripts/removeVishal.ts),
[`removeNimisha.ts`](../../../src/scripts/removeNimisha.ts),
[`scripts/onboarding/replace-tushar-with-kanishk.ts`](../../../scripts/onboarding/replace-tushar-with-kanishk.ts)) —
they re-invent `pool.query` each time with no shared safety rail. This skill **is** that rail.

**This is a pause-and-confirm operation.** Never run the mutating statement without an explicit human "go".

## Steps

1. **State the intent in one line.** What table, what rows, what change, why. If it touches
   `contacts` / Wizmatch tables, note the tenant.

2. **Read before you write — always `SELECT` first.** Run the exact same `WHERE` clause as a
   `SELECT COUNT(*)` and a `SELECT` of the affected rows. Show the user: "this matches N rows —
   here they are." If the count is different from what you expect, **stop** and re-check the filter.

3. **Reassign, don't orphan.** If removing a user/owner, move their `contacts`, `deals`, `tasks`,
   and outreach rows to another owner *before* deactivating them — mirror the reassignment order in
   `removeNimisha.ts`. Never delete a row that others point at (FK/logical orphans break the CRM UI).

4. **Wrap in a transaction.** `BEGIN; … ; COMMIT;` so a half-finished mutation rolls back cleanly.
   For a script, use a single pooled client with an explicit try/catch → `ROLLBACK`.

5. **Contact invariants** (if any contact row is written): email `.trim().toLowerCase()`, phone
   digits-only with `91` prefix, and **bump `lastActivityAt`**. See `ge-add-contact-path`.

6. **Show before/after.** After the change (still in the transaction if possible, or immediately
   after), `SELECT` the same rows again and show the diff. Get the user's confirmation before
   `COMMIT` where feasible.

7. **Leave a trail.** Note the mutation in `.ai/HANDOFF_LOG.md` (what, why, row count, date) so it's
   auditable later.

## Worked example — the Infosys cooldown unblock

Intent: Infosys is cooldown-locked by a free run mis-flagged `paid_provider=true`.

```sql
-- 1. READ FIRST (never skip)
SELECT id, company_id, cost_cents, paid_provider, status, created_at
FROM wizmatch_discovery_runs
WHERE company_id = '<infosys-id>' AND cost_cents = 0 AND paid_provider = true;
-- Expect exactly 1 row. If more/zero → STOP, re-check company_id.

-- 2. MUTATE (only on explicit go, in a transaction)
BEGIN;
UPDATE wizmatch_discovery_runs SET paid_provider = false
WHERE company_id = '<infosys-id>' AND cost_cents = 0 AND paid_provider = true;
-- 3. VERIFY the row now reads paid_provider=false, then:
COMMIT;
```

## Never
- Never run a bare `UPDATE`/`DELETE` without the matching `SELECT` shown first.
- Never `DELETE` a user/owner/contact that other rows reference — reassign first.
- Never touch guardrail tables (`src/db/migrations/`, applied SQL) as a "data fix".
- Never proceed without an explicit human "go" — this is a pause-and-confirm path.
