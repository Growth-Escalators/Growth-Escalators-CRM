# SEO client data purge — aarohaom.com, blackpandaenterprises.com, ageddentistry.org

**Status: NOT RUN. Plan + dry-run/execute script only. Nothing has been deleted.**

This document and [`scripts/seo-client-purge.ts`](../../scripts/seo-client-purge.ts) are the
deliverable for [`OWNER_ACTION_LIST.md`](./OWNER_ACTION_LIST.md) item 4. That list, and
[`.ai/CURRENT_TASK.md`](../../.ai/CURRENT_TASK.md), already reference these two files by name —
this plan fills them in.

A prior planning pass claimed a `DELETION-PLAN.md` existed with a row manifest of ~1,130 rows
across 10 tables. **That document does not exist in this repo** (checked both `~/repo-comparison/v2`
and `~/repo-comparison/v2-outbound-os`). Do not go looking for it and do not cite its numbers.
Everything below is derived fresh from `src/db/schema.ts` and the local dev database. The real
table count is **15, not 10** — migrations `0046`–`0049` added `seo_sites`, `site_changes`,
`seo_site_snapshots` and `seo_api_usage` after whatever the ~1,130 figure was based on.

---

## Preconditions — do not run the execute path until ALL of these hold

This matches `OWNER_ACTION_LIST.md` item 4 exactly:

1. **A backup exists and has been restore-tested.** As of this writing, production Postgres
   (`GE-Backend-Server` / `production` / service `Postgres`, volume `postgres-volume`) has **zero
   backups configured** — see [`RAILWAY_BACKUP_PLAN.md`](./RAILWAY_BACKUP_PLAN.md). Enabling a
   schedule is not enough on its own: restore one backup into a scratch database and confirm the
   row counts before touching production. A backup nobody has restored from is not a backup.
2. **A dry run has been reviewed.** `scripts/seo-client-purge.ts` counts and prints by default and
   is structurally incapable of deleting anything until an explicit flag and a typed confirmation
   string are both supplied (see "Running it" below). Run the dry run against production first —
   read-only `SELECT COUNT`s are safe against any environment — and read its output before deciding
   to proceed.
3. **The owner's explicit second confirmation**, separate from the confirmation string the script
   itself demands. The typed string in the script proves the *command* was deliberate; this is the
   human decision that today is the right day to run it.

This is **irreversible**. There is no soft-delete path here — see "What is deliberately NOT
deleted" below for why a hard delete is still the right call, but be clear-eyed that it is one.

---

## Migration-state caveat (read before running against any environment)

As of this writing (branch `fix/wizmatch-scoring-pipeline`, nothing pushed to `main`), migrations
`0046`–`0049` — which add `seo_sites`, `site_changes`, `seo_site_snapshots`, `seo_api_usage` — exist
**only on this local branch**. Production has not received them. By the time this purge is actually
run, the branch will presumably have merged and deployed, so production should have all 15 tables.
But the script does not assume that: it checks each table's existence
(`to_regclass('public.<table>')`) before querying it and skips — rather than crashes on — any table
that isn't there yet. If a dry run shows the four registry-era tables as "not present in this
database," that is expected on an unmigrated environment, not a bug.

---

## The two identity systems these tables use

Every one of the 15 tables below keys client identity one of two ways:

- **Legacy string keys** — `project_name` and/or `client_domain`, free text, present since SEO was
  single-tenant with three hand-maintained domains hardcoded across the codebase. These columns have
  **column drift**: `ensureSeoTables()` / `ensureClientPagesTable()`
  (`src/services/seoWorkflowHealthService.ts`, `programmaticSeoService.ts`) have been
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`-ing extra columns onto these live tables for years
  without `schema.ts` ever knowing — migration `0035`'s header is the fullest account of this.
- **`seo_sites.id` registry keys** — `site_id`, added by migration `0046` as a nullable FK on every
  legacy table, NOT NULL on the two tables created after the registry existed
  (`site_changes`, `seo_site_snapshots`). This is the tenant-isolation boundary: two tenants can each
  register `example.com`, and only a `site_id` FK — not a domain string — can tell their rows apart.

**Known alias risk.** `scripts/test-seo-system.ts:117` (an old, still-present test/audit script)
expects `client_knowledge_base.project_name` to historically hold the **short form** —
`aarohaom`, `ageddentistry`, `blackpanda` — not the full domain. The local dev database (seeded by
`scripts/dev/seed-local.ts`) uses the full-domain form consistently for all three clients, so this
could not be confirmed against real data. **Production may have rows keyed by the short form that a
domain-only match would miss.** `scripts/seo-client-purge.ts` matches against both forms (see
`LEGACY_ALIASES` in the script) and, in dry-run mode, prints every distinct `project_name` /
`client_domain` value it finds in the tenant's SEO tables next to a ✓/· marker for whether it's in
the match set — **read that list before running execute**, so a variant the alias list didn't
anticipate is caught by eye rather than silently orphaned.

---

## Tenant scoping

All three domains are registered under the **`growth-escalators`** tenant (confirmed live in local
dev: `seo_sites` rows for all three domains, `status='active'`, all under one tenant id). The script
resolves this tenant by **slug**, not by hardcoding a UUID — `growth-escalators`'s tenant id is a
different UUID in every database (local dev, staging, production each generate their own), and
hardcoding the local dev value into a script that's meant to run against production would be exactly
the kind of mistake this whole exercise exists to prevent. Every `COUNT`/`DELETE` binds
`tenant_id = <resolved id>` — a domain-only predicate would delete another tenant's rows if a
reseller ever registers a site with a domain string that happens to collide (unlikely today with
only two tenants, `growth-escalators` and `wizmatch`, but the schema was built to prevent exactly
this, see the `seo_sites` docblock, and the script should not undo that by matching on domain alone).

---

## Table-by-table: what holds this data, and the row count in local dev

Local dev database: `postgresql://<you>@localhost:5432/ge_local_dev`, seeded via `npm run dev:seed`.
**These counts are local dev, not production.** Local dev is a thin synthetic seed for clicking
through the admin UI — it is not a copy of production history, so most tables read `0` here even
though production (with years of real crawl/rank/publish history) will not. Only the owner can
obtain the real production counts, by running this script's dry run against production.

| # | Table | Match columns | Has `site_id`? | Local dev count (3 domains) |
|---|---|---|---|---|
| 1 | `client_knowledge_base` | `project_name`, `client_domain` | yes (nullable) | 3 |
| 2 | `client_pages` | `project_name`, `client_domain` | yes (nullable) | 0 |
| 3 | `keyword_rankings` | `project_name`, `client_domain` | yes (nullable) | 0 |
| 4 | `backlink_data` | `project_name`, `client_domain` | yes (nullable) | 0 |
| 5 | `content_gap_analysis` | `project_name`, `client_domain` | **no** | 0 |
| 6 | `seo_opportunities` | `project_name`, `client_domain` | yes (nullable) | 0 |
| 7 | `site_health_metrics` | `project_name`, `client_domain` | yes (nullable) | 0 |
| 8 | `brand_mentions` | `project_name` only (**no `client_domain` column at all**) | **no** | 0 |
| 9 | `seo_weekly_metrics` | `project_name` (nullable), `client_domain` | yes (nullable) | 0 |
| 10 | `seo_alerts_log` | `project_name`, `client_domain` | yes (nullable) | 0 |
| 11 | `seo_content_calendar` | `client_domain` only (**no `project_name` column**) | yes (nullable) | 0 |
| 12 | `seo_site_snapshots` | — | yes (**not null**) | 0 |
| 13 | `site_changes` | — | yes (**not null**) | 0 |
| 14 | `seo_api_usage` | — | yes (nullable — some rows are tenant-level, not site-level, and correctly excluded) | 0 |
| 15 | `seo_sites` | `domain` (this table *is* the registry row) | — (this is the parent) | 3 |

Total local dev rows matched: **6** (3 in `client_knowledge_base`, 3 in `seo_sites`). This is far
below the ~1,130 figure the earlier (nonexistent) plan claimed — expected, since local dev is a
synthetic seed, not a production copy. Production's real count must come from the owner running the
dry run there.

Verified in local dev, read-only, and worth re-running against production before executing:

- **Zero rows** matched by `site_id` that were *not* also matched by the domain/alias string
  predicate, across every legacy table that has both — i.e. the two identity systems agree on this
  dataset. This should be re-checked on production; if it disagrees there, the script's dry-run
  output will show it (see "cross-check" section of its output).
- **Zero** `seo_content_calendar` rows (for any domain) reference a `seo_opportunities` row that
  belongs to one of these three domains — i.e. deleting these opportunities will not orphan another
  domain's calendar entry. The script re-checks this live before deleting, and aborts rather than
  relying on the FK constraint to catch it.
- **Zero** `site_changes` / `seo_site_snapshots` self- or cross-references point outside this
  site-id set (`superseded_by_change_id`, `matched_change_id`). Also re-checked live by the script.
- All three `seo_sites.client_id` values are `NULL` in local dev — these are GE's own SEO clients,
  not reseller `clients` rows with billing history behind them. If production differs (a `clients`
  row *is* linked), that is exactly the kind of row this purge must not touch — see below.

---

## Deletion order, and why

Postgres enforces foreign keys with `NO ACTION`/`RESTRICT` semantics on every one of these tables —
**none** of the 15 has `ON DELETE CASCADE` (confirmed: `grep -n "onDelete" src/db/schema.ts` shows
no hits inside any SEO table's definition). Nothing cascades automatically; the script must delete
children before parents or the parent `DELETE` fails outright.

The dependency graph (only one non-`seo_sites` edge exists — confirmed by grepping every
`references(() => seoOpportunities...)` / `references(() => seoContentCalendar...)` / etc. call in
`schema.ts`; `seo_opportunities` is the only target table any *other* target table points at):

```
seo_site_snapshots ─┬─▶ site_changes ─┬─▶ seo_sites
                     └────────────────┘      ▲
seo_content_calendar ─▶ seo_opportunities ────┤
                                               │
seo_api_usage ─────────────────────────────────┤
client_knowledge_base, client_pages, keyword_rankings,
backlink_data, site_health_metrics, seo_weekly_metrics,
seo_alerts_log ─────────────────────────────────┘
content_gap_analysis, brand_mentions  (no FK at all — string-keyed only)
```

Deletion order (children first):

1. **`seo_site_snapshots`** — `matched_change_id` → `site_changes.id`, `site_id` → `seo_sites.id`.
2. **`seo_content_calendar`** — `opportunity_id` → `seo_opportunities.id`, `site_id` → `seo_sites.id`.
3. **`site_changes`** — `site_id` → `seo_sites.id`, plus a **self**-reference
   (`superseded_by_change_id` → `site_changes.id`). Safe to delete all matching rows in one
   statement: Postgres checks FK constraints after the statement completes, and since every row a
   surviving row could point at is being removed in the same `DELETE`, there is no dangling
   reference at the end — *provided* no row **outside** this site's set points in, which the script
   checks explicitly rather than trusting that assumption.
4. **`seo_opportunities`** — now safe; the one table that referenced it (`seo_content_calendar`) is
   already clear for these domains.
5. **`seo_api_usage`**, **`client_knowledge_base`**, **`client_pages`**, **`keyword_rankings`**,
   **`backlink_data`**, **`site_health_metrics`**, **`seo_weekly_metrics`**, **`seo_alerts_log`** —
   each only references `seo_sites`; order among these eight doesn't matter, they're grouped here
   for one transaction pass.
6. **`content_gap_analysis`**, **`brand_mentions`** — no FK at all; could run anytime, grouped here.
7. **`seo_sites`** — **last**. Every other table in this list points at it; nothing may reference a
   row here that hasn't already been cleared in steps 1–6.

---

## What is deliberately NOT deleted, and why

- **The `clients` (CRM) table.** Nothing here is touched. `seo_sites.client_id` is nullable and, for
  all three domains in local dev, is `NULL` — they were never linked to a billing/CRM client row (GE
  ran these as its own SEO properties, not resold client accounts). **If production shows a non-null
  `client_id` for any of the three**, the script will report it in dry-run output as a named
  warning, and the linked `clients` row must not be deleted by anyone — deleting a `clients` row also
  touches `contactId`/`dealId` FKs and billing history that are out of scope for an SEO data purge
  entirely. This plan does not authorize touching `clients`, `deals`, `contacts`, `invoices`, or any
  billing table under any circumstance.
- **`discovery_searches` / `discovery_results` / `discovery_api_usage`.** These are a *different*
  discovery system (outbound lead-gen prospecting), unrelated to SEO client sites despite the
  similar naming — confirmed by reading their schema (keyed on search queries, not
  `project_name`/`client_domain`/`site_id`). Not in scope.
- **Audit/event tables** (`audit_events`, anything with an explicit "append only, never
  delete/update" comment in `schema.ts`) — none of the 15 target tables are one of these, and this
  plan does not touch any table outside the 15 listed above.
- **The `WP_AGEDDENTISTRY_*` Railway env vars and the hardcoded `ageddentistry.org` fallback in
  `src/routes/seo.ts` / `src/services/programmaticSeoService.ts`.** Those are *code*, not data, and
  are explicitly out of scope for this purge (per the brief: two exclusive files, no `src/` edits).
  They are lower-risk than they look, though, for two independent reasons already shipped on this
  branch:
  - `assertOwnsWordPressTarget()` (`src/routes/seo.ts:296`) gates the on-demand
    `/api/seo/generate-local-pages` and `/api/seo/regenerate-pages` routes on
    `getSeoSiteByDomain(tenantId, wpTarget)` returning a row. Once step 7 deletes the
    `ageddentistry.org` row from `seo_sites`, that lookup returns `null` and both routes
    **fail closed with a 409** — the purge cannot be silently undone through those endpoints even
    though their env-var target string still says `ageddentistry.org`.
  - The old startup hook that regenerated `ageddentistry.org` pages on every boot has already been
    **removed** (`src/index.ts:976-994`, with the comment explicitly citing this purge as the
    reason), and `seedClientKnowledgeBase()` — which used to upsert all three retired clients' brand
    copy on every boot — is now a no-op (per `.ai/HANDOFF_LOG.md`). Both of these used to mean the
    purge would "fight" the app's own boot sequence and resurrect rows on the next deploy; that is
    no longer true.
  - Rotating/removing the `WP_AGEDDENTISTRY_*` credentials themselves is covered separately by
    `OWNER_ACTION_LIST.md` item 3 (credential rotation) — not this purge.

---

## Verification — how to confirm exactly the right rows went, and nothing else

1. **Re-run the dry run** immediately after execute completes. Every one of the 15 tables should
   report `0` matching rows for all three domains/aliases/site-ids.
2. **Read the script's own before/after/deleted counts**, printed per table during the execute run,
   and its closing JSON summary — paste that summary into `.ai/HANDOFF_LOG.md` as the audit trail
   (see `ge-prod-data-mutation`'s "leave a trail" step).
3. **Sibling check**: the script also prints, per table, the tenant's **total** row count before and
   after. `total_after` should equal `total_before − deleted` for every table — if it's anything
   else, rows outside the three target domains moved, which should never happen and means STOP,
   don't trust the run, restore from backup.
4. **`seo_sites` count for the tenant** should be exactly 3 lower than before, and every *other*
   registered site's row (if any exist by then) should be untouched — spot-check by domain name.
5. **Admin UI**: the three domains should no longer appear in any SEO site picker/dropdown once the
   `seo_sites` rows are gone (they're driven by `listSeoSiteDomains()`, which reads `seo_sites`
   directly).
6. **API spot check**: `GET` whichever route lists `client_knowledge_base`/`client_pages` for the
   tenant should return nothing for these three domains.

---

## Running it

See `scripts/seo-client-purge.ts --help` for the authoritative usage text. Summary:

```bash
# 1. Dry run — safe against any environment, including production. No flags needed.
DATABASE_URL=... npx tsx scripts/seo-client-purge.ts

# 2. Only after every precondition above is met, from the owner, explicitly:
DATABASE_URL=... npx tsx scripts/seo-client-purge.ts \
  --execute \
  --confirm="DELETE aarohaom.com blackpandaenterprises.com ageddentistry.org PERMANENTLY" \
  --allow-non-local   # required whenever DATABASE_URL does not resolve to localhost/127.0.0.1/::1
```

- No flags → dry run. The script cannot delete anything in this mode; the mutating code path is
  gated behind the flag/confirm/allow-non-local checks before any transaction is opened.
- `--execute` alone, or `--confirm` alone, or a `--confirm` string that doesn't match exactly →
  refused, nothing runs.
- Omitting `--allow-non-local` when `DATABASE_URL` isn't `localhost`/`127.0.0.1`/`::1` → refused,
  even with `--execute` and a correct `--confirm`. This is what makes "looks like it could be
  production" a hard stop rather than a warning — production almost certainly *is* what
  `DATABASE_URL` points at when this is finally run for real, so the flag exists to make that
  moment deliberate, not a safety net that's expected to fire.
- The entire deletion runs inside **one transaction** (`BEGIN` … `COMMIT`, one pooled client) — any
  failure at any step (including the pre-flight FK sanity checks in step 3/step 4 above) rolls the
  whole thing back. A partial purge cannot happen.
