# WizMatch G1 — runtime read-only production evidence

- **Performed:** 2026-07-27 → 2026-07-28 (UTC). **Read-only throughout.**
- **Branch:** `ge/outbound-08b-g3-pilot-completion` @ `85c9dd09`; final reviewed code commit `0d330269`.
- **Companion to:** [`WIZMATCH_G1_PRODUCTION_PREFLIGHT_FINAL.md`](WIZMATCH_G1_PRODUCTION_PREFLIGHT_FINAL.md).
  That document was written with **no database access**. This one is the first session that actually
  connected to the production database, and it resolves several of that document's open blockers.
- **Access owner:** the main session alone. No subagent held Railway, SSH or database access.

> ## VERDICT: **G1 NO-GO**
>
> Two hard blockers remain, and one of them is **new and worse than anything the preflight
> anticipated**: the production database has **no backups and no backup schedule at all**.
>
> **No approval token for migration `0037` is requested.** The next safe action requires
> `APPROVE_G1_CLONE_PROVISIONING` — and, separately and more urgently, a decision on production
> backups.

---

## 1. What was and was not done

**Done (all read-only):** Railway CLI metadata discovery; five `railway ssh -s web -e production`
non-interactive command executions; five read-only Postgres sessions inside the production `web`
container; read-only Railway GraphQL queries for backup state.

**Method disclosure.** Four repository-only Explore subagents were launched for the code-side
analysis. **None returned a report before the main session had completed that scope itself from
source**, so every finding here was independently derived and is cited to source. Two of the four
(R2 — drift-query design; R3 — user/identity model) reported afterwards; their late findings were
reconciled against the completed work and **materially improved it**: R2 identified that the
index-name collision check was missing (§5.1.1 — a real gap, now closed by measurement with a
negative result), and R3 corrected the framing of the two unmodelled `users` columns (§5.1.2) and
supplied the roster and sync-client details in §7.2 and §8. Both corrections are folded in above.
This mirrors a pattern already recorded on this stack: subagents returning late, and each pass
catching what the other missed.

**Not done:** no migration; no database write; no `dist/scripts/migrate.js` execution; no drizzle
migration; no backfill `--apply`; no database or service created, restored or deleted; no Railway
variable, role or roster change; no push, merge, deploy or PR state change; no secret printed;
`DATABASE_PUBLIC_URL` never used; `railway variables` never run; `railway run` never used against
the production database.

**Every database session ran with:**

```sql
SET default_transaction_read_only = on;
SET statement_timeout = '15s';
SET lock_timeout = '2s';
SET idle_in_transaction_session_timeout = '30s';
BEGIN READ ONLY;
```

`SHOW transaction_read_only` returned `on` inside every transaction, and every transaction ended in
an explicit `ROLLBACK` followed by a clean connection close. All four sessions logged
`Z_ROLLBACK OK` / `Z_CLOSED OK`. Temporary scripts written to the container's `/tmp` were deleted at
the end of the last session (`CLEANUP_OK`).

### 1.1 The earlier `railway run` failure — did it touch production?

**No.** The previously-recorded failure

```
railway run node dist/scripts/migrate.js
→ getaddrinfo ENOTFOUND postgres.railway.internal
```

is a **DNS resolution failure on the local workstation**. `postgres.railway.internal` is a Railway
*private-network* name that resolves only from inside a Railway container; a local process cannot
resolve it. The failure occurred **before any TCP connection was attempted**, so no Postgres
connection was opened, no authentication happened, and no migration statement was sent.

This is now **positively corroborated from the production side**: the production migration journal
contains **no row for `0037`** and **none of `0037`'s 21 database objects exists** (§4, §5). Had the
command reached the database, `0037` would have been applied in full — drizzle applies all pending
migrations in one transaction. It did not.

---

## 2. Railway context — verified

| Item | Value | Source |
|---|---|---|
| Workspace | `jatin-ge's Projects` | `railway status` |
| Project | `GE-Backend-Server` | `railway status` |
| Project ID | `eef927aa-8e3a-4515-85fd-781b7d1d95c1` | `railway status` |
| Environment | `production` (`81b087de-6c7d-493c-94f0-50c8180c47da`) | `railway status` |
| Application service | `web` (`0ee1b243-97c1-4239-9016-fb7e1578b3d6`) | `railway status --json` |
| Deployed source | `Growth-Escalators/Growth-Escalators-CRM`, branch `main` | `railway status --json` |
| Deployed commit | `1e748125` — **byte-equal to `origin/main`** | `railway status --json` + in-container `RAILWAY_GIT_COMMIT_SHA=1e748125b41f773f46ebb8e4740383aa723eade0` |
| Deployment ID | `1d0dda9d-3ee2-4d66-9b77-5da2c4c36e6c` | in-container `RAILWAY_DEPLOYMENT_ID` |
| Working directory | `/app` | in-container `process.cwd()` |
| `NODE_ENV` | `production` | in-container (settles PR 8A **H-4**) |

**Production topology is a single application service.** The production environment contains exactly
one service built from this repository (`web`). There is **no separate `worker` service**, and
`DISABLE_BACKGROUND_JOBS=false` — so `web` runs the HTTP API *and* every `node-cron` job in the same
process. Any statement elsewhere in the docs implying a web/worker split is wrong for production.

Other production services: `Redis`, `Postgres`, `Postgres-K0lx`, `Documenso`.

---

## 3. Production Postgres service identity — **VERIFIED**

**The production `web` service uses the Railway service displayed as `Postgres`**
(service ID `0c31ec38-0433-46c6-9fbb-5dd2859d1a08`, volume `postgres-volume`,
volume instance `144db25d-1d4a-4dbc-abe5-3abd5e132893`).

It is **not** `Postgres-K0lx`.

This is **not** an inference from the hostname. Three independent lines of evidence agree, and one of
them is decisive:

1. **Server major version (decisive).** The connection made from inside the production `web`
   container reports `server_version = 18.3 (Debian 18.3-1.pgdg13+1)`, `server_version_num = 180003`.
   The two production Postgres services run different images:
   - `Postgres` → `ghcr.io/railwayapp-templates/postgres-ssl:**18**`
   - `Postgres-K0lx` → `ghcr.io/railwayapp-templates/postgres-ssl:**17**`

   A container running the 17 image cannot report 18.3. The connection therefore terminates at
   `Postgres`.

2. **Private hostname.** `DATABASE_URL` parses to hostname `postgres.railway.internal`, port `5432`,
   database `railway`, no query string. The hostname ends in `.railway.internal` and resolves to 2
   addresses from inside the container. Consistent with `Postgres`, but treated as *corroborating*
   only, since a private hostname can be customised.

3. **Size consistency.** `pg_database_size` = **52 MB**; `Postgres`'s volume reports 189.8 MB used of
   500 MB (data + WAL + system databases). `Postgres-K0lx`'s volume reports 230.3 MB used of 5000 MB
   — a different service with a different footprint and a different disk allocation.

**No secret was used or printed to establish this.** `DATABASE_URL` was parsed inside the container
with `new URL()` and only hostname / port / database-name / `.railway.internal` suffix were emitted.
Username, password, protocol, the full URL and query parameters were never printed.

**Optional belt-and-braces dashboard confirmation** (not required — the version discriminator is
conclusive): Railway → `GE-Backend-Server` → `production` → `web` → Variables → `DATABASE_URL` → read
only the referenced service name inside `${{SERVICE_NAME.DATABASE_URL}}`. Do **not** reveal the
resolved value.

---

## 4. Migration journal — reviewed

`drizzle.__drizzle_migrations` exists. Schema (drizzle-orm 0.45.2): `id SERIAL PK`, `hash text`,
`created_at bigint`. `hash` is `sha256` of the **raw migration file bytes**; `created_at` is the
journal entry's `when` (epoch ms).

| Metric | Value |
|---|---|
| Applied rows | **35** |
| `max(id)` | 36 |
| `max(created_at)` | `1784464092263` |
| Newest row | `id=36, created_at=1784464092263, hash=f7c20080314bfafc…` |
| Journal entries in the deployed container | 37 |
| Journal entries on the reviewed branch | 38 |

**The journal head is byte-identical to this repository.** The three newest applied hashes match the
reviewed branch exactly:

| DB row | `created_at` | DB hash (16) | Repo file | Repo sha256 (16) |
|---|---|---|---|---|
| 36 | 1784464092263 | `f7c20080314bfafc` | `0036_seo_content_calendar_link.sql` | `f7c20080314bfafc` ✅ |
| 35 | 1784434366650 | `a0e6d6603710bf7a` | `0035_seo_tables_tenant_id.sql` | `a0e6d6603710bf7a` ✅ |
| 34 | 1784257950015 | `268155e26ef1b812` | `0034_lame_proemial_gods.sql` | `268155e26ef1b812` ✅ |

**Journal `idx` is NOT the filename number** — verified, not assumed. e.g. `idx 4` → `0005_update_wa_template_names`,
`idx 20` → `0022_tenant_scoped_user_emails`, `idx 21` → `0020_wizmatch_gin_indexes`. The mapping was
read from `meta/_journal.json` in both the repository and the deployed container.

### 4.1 Pre-existing journal anomalies (NOT caused by `0037`, NOT blockers for it)

Reconciling all 37 container journal entries against the 35 applied rows:

- **`0003_bizarre_sinister_six` is applied**, but under a *different* `created_at`
  (`1774150190000` in the DB vs `1774149925597` in the journal). Its content hash `7f4010b0747c`
  matches the repo exactly, so the file is applied; only the recorded timestamp differs — an artefact
  of the historical baseline repair.
- **One applied row has no corresponding journal entry at all**: `id=5, created_at=1774280451000,
  hash=66282396728e…`. A migration applied to production whose journal entry no longer exists in the
  repo (removed or renamed during the baseline repair).
- **The arithmetic, spelled out** (it confused one reviewer, so here it is explicitly). The
  **deployed container** journal has **37** entries — not the 38 on this branch, because the
  container is built from `main` and `main` has no `0037`. Of those 37: 33 match an applied row by
  timestamp; `0003` matches by hash under a different `created_at` (below); `0008`/`0013`/`0014` have
  no applied row at all. `33 + 1 = 34`, plus the one orphan row (`id=5`) that matches no journal
  entry `= 35 applied rows`. ✅ Closes exactly.
- **Three migrations have never been applied and never will be by this mechanism:**
  `0008_great_romulus` (idx 8), `0013_lively_blue_shield` (idx 13),
  `0014_brevo_email_templates_seed` (idx 14).

  **Cause:** drizzle's migrator decides pending work *solely* by
  `Number(lastDbMigration.created_at) < migration.folderMillis`
  (`drizzle-orm/pg-core/dialect.js`). Those three entries carry `when` values **lower** than an
  already-applied predecessor, so they are permanently skipped. This is a pre-existing condition of
  this database, unrelated to this branch.

  **Consequence for `0037` — and it is a favourable one:** because those three are skipped by the
  timestamp rule and `0037`'s `when` (`1785039545644`) is strictly greater than `max(created_at)`,
  running the migrator will apply **`0037` and nothing else**. It will not sweep in three ancient,
  unreviewed migrations.

---

## 5. Is migration `0037` applied? — **NO. Definitively not.**

Three independent proofs:

1. **Journal:** `select count(*) from drizzle.__drizzle_migrations where created_at >= 1785039545644`
   → `0`.
2. **Objects:** every one of `0037`'s 21 probed database objects is **absent** (§5.1).
3. **Deployed artefact:** the running container does not even contain the file. `/app/src/db/migrations`
   holds **37** `.sql` files ending at `0036_seo_content_calendar_link.sql`;
   `0037_unknown_siren.sql` is **not present**; the container's `meta/_journal.json` has **37**
   entries ending at `0036`. This is expected and correct — the container is built from `main`, and
   `0037` exists only on this branch. It must **not** be "fixed" at this stage.

`dist/scripts/migrate.js` **is** present in the container.

### 5.1 Pre-`0037` schema drift — CLEAN

Probed against the expected object matrix derived from `0037_unknown_siren.sql` (372 lines) and the
`0036 → 0037` snapshot delta:

| Object class | Expected pre-`0037` | Found | Verdict |
|---|---|---|---|
| 8 new tables (`wizmatch_company_duplicates`, `…_company_policies`, `…_company_policy_events`, `…_outreach_batches`, `…_outreach_enrolments`, `…_outreach_events`, `…_reply_mailboxes`, `…_suppression_events`) | absent | all **absent** | ✅ |
| 7 new indexes (`users_tenant_id_id_uniq`, `contacts_tenant_id_id_uniq`, `contact_channels_tenant_id_id_uniq`, `wizmatch_companies_tenant_id_id_uniq`, `wizmatch_job_signals_tenant_id_id_uniq`, `wizmatch_requirements_tenant_id_id_uniq`, `wizmatch_suppression_tenant_lower_email_idx`) | absent | all **absent** | ✅ |
| 3 new columns (`wizmatch_companies.account_owner_user_id`, `wizmatch_suppression_list.contact_channel_id`, `wizmatch_suppression_list.channel_invalid`) | absent | all **absent** | ✅ |
| 2 guarded FKs (`wizmatch_companies_account_owner_fk`, `wizmatch_suppression_list_contact_channel_fk`) | absent | both **absent** | ✅ |
| Trigger `wizmatch_company_policies_immutability_trg` + function `wizmatch_company_policies_enforce_immutability` | absent | both **absent** | ✅ |

**No partial application. No unexpected `0037` objects.** The database is in a clean, fully
pre-`0037` state.

#### 5.1.1 Schema-wide relation-name collision probe — 0 collisions

The object-by-object probe above is **not sufficient on its own**, and the gap is worth stating
plainly because the first pass got it wrong. "The parent table is absent, therefore its indexes are
absent" is valid for **constraint** names (scoped per table) but **invalid for index names**, which
live in `pg_class` and are unique **per schema**. `0037` creates 8 tables with **no**
`IF NOT EXISTS` and 32 indexes of which only 7 carry `IF NOT EXISTS` — so **25 unguarded index
creates**. Any pre-existing relation of *any* kind (table, view, matview, sequence, or an index on an
unrelated table) occupying one of those names raises `42P07 relation already exists`, and because
drizzle wraps the whole migration in one transaction (§11), that aborts **all** of `0037` mid-deploy.
`pg_tables`, used in the first pass, also cannot see a colliding *view*.

Closed with a direct probe of all **40** relation names `0037` creates, extracted programmatically
from the migration file rather than hand-listed:

```sql
SELECT c.relname, c.relkind, n.nspname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = ANY($1);
-- and the same across every non-system schema
```

| Probe | Result |
|---|---|
| Names probed | 40 |
| Collisions in `public` | **0** |
| Collisions in **any** non-system schema | **0** |

The 37 runtime `ensure*` hooks in this repo create objects outside the migration journal, so this was
a real hazard rather than a theoretical one. It is now excluded by measurement, not by inference.

#### 5.1.2 The two unmodelled `users` columns — repo-originated, not mystery drift

Production `users` carries `is_active boolean` and `is_test_account boolean`, neither of which is in
`src/db/schema.ts`, and `created_at` is `timestamp without time zone`. Full production column list:
`id, tenant_id, name, email, password_hash, created_at, role, token_version, is_active, is_test_account`.

Both columns are created by **repo code at runtime**, not by an unexplained hand-edit:

- `is_active` — `src/routes/permissions.ts`:
  ``db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true`).catch(() => {})``
  executed at module import (that router is imported from `src/index.ts`). The deliberate `ensure*`
  pattern this repo uses instead of a migration.
- `is_test_account` — `scripts/meta-app-review/seed-reviewer-user.ts` uses the same
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS` form, by explicit plan ("no migration").

**Do not "fix" this by adding either column to `schema.ts`** — that would make `db:generate` emit a
migration for a column that already exists.

**But note the sharp edge:** `is_active` is **load-bearing for login**. `src/routes/auth.ts:83-84`,
`:169-170`, `:258-259` all gate authentication on
`(u.is_active IS NULL OR u.is_active = true) AND (t.is_active IS NULL OR t.is_active = true)`
(NULL means active). The ensure-hook that creates the column swallows its own failure with
`.catch(() => {})`. On any database where that hook silently failed, **every login would 500** on a
missing column. Mid-session revocation runs through `users.token_version`
(`src/middleware/auth.ts`), not through `is_active`; `requireAuth`/`requireRole` never read it.

`0037` touches none of this. Recorded, not actioned.

### 5.2 Existing indexes on the three U-7 target tables

No redundancy with, or conflict against, the three additive `(tenant_id, id)` indexes:

- **`users` — 3 indexes:** `users_pkey (id)`, `users_tenant_email_unique (tenant_id, email)`,
  `users_tenant_id_idx (tenant_id)`.
- **`contacts` — 9 indexes:** `contacts_pkey (id)`, `contacts_tenant_id_idx`,
  `contacts_tenant_status_idx`, `contacts_tenant_created_idx`, `contacts_tenant_assigned_idx`,
  `contacts_assigned_to_idx`, `contacts_status_idx`, `contacts_last_activity_idx`,
  and `contacts_tenant_email_idx` — **which is actually `(tenant_id, first_name)`**, a misleadingly
  named pre-existing index. Recorded; not this branch's to change.
- **`contact_channels` — 4 indexes:** `contact_channels_pkey (id)`,
  `contact_channels_unique_idx (contact_id, channel_type, channel_value)`,
  `contact_channels_contact_id_idx`, `contact_channels_value_idx`.

---

## 6. Table sizes and row estimates — the U-7 lock question re-scoped

| Table | Total size | Heap | `reltuples` | `n_live_tup` |
|---|---|---|---|---|
| `users` | 64 kB | 8192 B | 15 | 15 |
| `contacts` | 1480 kB | 728 kB | 2 813 | 2 813 |
| `contact_channels` | 1600 kB | 568 kB | 4 550 | 4 719 |
| `wizmatch_companies` | 152 kB | 24 kB | 144 | 183 |
| `wizmatch_job_signals` | 7008 kB | 4560 kB | 6 686 | 6 743 |
| `wizmatch_requirements` | 128 kB | 8192 B | 1 | 4 |
| `wizmatch_suppression_list` | 40 kB | 0 B | −1 | 0 |
| **Whole database** | **52 MB** | | | |

**This materially re-scopes U-7, though it does not discharge it.** The three shared tables the owner
was asked to sign off on are *tiny*: 15 rows, 2 813 rows and 4 719 rows. A non-`CONCURRENTLY`
`CREATE UNIQUE INDEX` on tables of this size completes in single-digit milliseconds.

**What still must be measured, and why it is not a formality:** drizzle applies **all pending
migrations inside one transaction** (`session.transaction(...)` wrapping the statement loop, in
`drizzle-orm/pg-core/dialect.js`). Every lock `0037` takes — including the `SHARE` locks on `users`,
`contacts` and `contact_channels` from the three index builds — is held **until the entire migration
commits**, not just for that statement. So the number that matters is the *total wall-clock duration
of the whole of `0037`*, not the cost of any single index. On a 52 MB database that is expected to be
well under a second, but "expected" is exactly what the owner's conditional approval refuses to
accept. It must be measured on a real-sized clone.

The owner's condition also has a second limb — **a verified backup/rollback plan** — and that limb
has now failed outright (§9).

---

## 7. The three approved pilot users — **2 of 3 resolved, 1 MISSING**

Resolved case-insensitively against `users`. The WizMatch tenant is
`4b3dd3e2-69e3-4718-95ce-e3ace41779f2` (`slug=wizmatch`); the Growth CRM tenant is
`3ff1e516-7612-477b-a778-4b84659767fa` (`slug=growth-escalators`). A third tenant, `city-clinic`
(`01e7e5b7-…`), also exists.

| Email | Match result | WizMatch-tenant user ID | Role | Required | `is_active` | `is_test_account` |
|---|---|---|---|---|---|---|
| `jatin@growthescalators.com` | **2 rows** (one per tenant — by design) | `427e6b95-68f7-42b6-83b0-ced1799139b2` | `admin` | `admin` ✅ | `true` | `false` |
| `kanishk.khandelwal@growthescalators.com` | **2 rows** (one per tenant — by design) | `115f2251-cf72-417e-bdbb-b63cd23415b3` | `admin` | `admin` ✅ | `true` | `false` |
| `itika.khandelwal@growthescalators.com` | **0 rows — NO ACCOUNT EXISTS** | — | — | `team_lead` ❌ | — | — |

**On the "2 rows" result:** this is not ambiguity. `users` carries
`UNIQUE (tenant_id, email)` (`users_tenant_email_unique`), so one human legitimately holds one row
per tenant. Scoped to the WizMatch tenant, each of Jatin and Kanishk resolves to **exactly one** row.
Their Growth-tenant counterparts (`e480cc54-…` and `b49f78bb-…`) are correctly *not* the pilot IDs.

**Itika is a hard G3 blocker.** Exact match returns 0 rows; a fuzzy `%itika%` search returns 0 rows;
`%khandelwal%` returns only Kanishk's two rows. There is no account under a variant spelling. She
cannot be added to the roster because there is nothing to add. **Creating the account is a production
write and was not performed** — it needs a separate, explicitly approved action.

> **When that account is created, create it with a lower-cased email.** `users_tenant_email_unique`
> is on the **raw** `email` text, while login matches `u.email = <lowercased input>` exactly
> (`src/routes/auth.ts`). An account stored with any uppercase character would exist, satisfy the
> unique index, and be **permanently unable to log in**. Her required role `team_lead` is already in
> `PILOT_ELIGIBLE_ROLES`, so no role-model change is needed.

### 7.1 Current pilot roster state — correct as far as it goes

`WIZMATCH_STAFFING_PILOT_USER_IDS` is **set** on the production `web` service and contains **exactly
2 entries**, both well-formed UUIDs. Verified by **set membership only — the variable's value was
never printed**:

- contains Jatin's WizMatch ID → **true**
- contains Kanishk's WizMatch ID → **true**
- contains either `deck-sync` machine ID → **false** ✅
- contains any unrecognised entry → **false**

`WIZMATCH_STAFFING_PILOT_ALL_USERS=false` — the open-deployment override is off. **No roster change
was made.** The roster is correct for the two humans who exist; it is missing only the user who does
not.

### 7.2 Two latent roster risks — not currently biting, but they will if the roster is edited

Both verified in `src/services/wizmatchStaffingAccess.ts`. Neither is a defect today; both are traps
for whoever adds Itika's ID.

1. **Roster matching is case-sensitive; the readiness checker validates case-INSENSITIVELY.**
   `pilotIds()` splits on `/[\s,]+/` and trims each entry into a `Set<string>`; admission is
   `ids.has(actor.userId)` — plain, case-sensitive string equality. But
   `src/services/wizmatchPilotReadiness.ts`'s `UUID_SHAPE` regex carries the `i` flag. **An
   upper-case UUID would therefore pass the readiness check as well-formed and silently never match**
   the lower-case UUID Postgres returns — a pilot user locked out with a green readiness report.
   Not currently a problem: the live roster entries were confirmed to match the lower-case IDs
   exactly (verified by set membership, without printing the value). Paste new IDs lower-case.
2. **The roster is not tenant-scoped.** `resolveStaffingAccess` never reads `actor.tenantId` at all —
   admission is role + ID only. A Growth-tenant user ID placed in the roster would pass the gate on
   `/api/wizmatch` routes. Data would still be scoped by `req.user.tenantId` downstream, so this is
   not a data-leak path, but the containment comes from the handlers, not from the gate. What makes
   the current configuration safe is that **both roster IDs are the WizMatch-tenant rows** — note
   that Jatin and Kanishk each also have a Growth-tenant row, and those are the wrong IDs to use.

---

## 8. Machine-sync principal — **VERIFIED**

Exactly **two** `viewer` accounts exist in production, created within 1.5 s of each other on
2026-07-13 — one per product tenant. Local part `deck-sync` in both cases.

| Which | User ID | Tenant | Role | `is_active` | `is_test_account` |
|---|---|---|---|---|---|
| **WizMatch (the relevant one)** | `acdab2ee-7e02-4e7d-b2c1-4bcabd4f2579` | `4b3dd3e2-…` (`wizmatch`) | `viewer` | `true` | `false` |
| Growth CRM counterpart | `8ffb87eb-edff-457f-93c2-81975606c60d` | `3ff1e516-…` (`growth-escalators`) | `viewer` | `true` | `false` |

**This settles the one thing the PR 8B review explicitly could not verify from the repository:**
the live Command Deck sync account really is `role = 'viewer'`. The F-A lane
(`src/middleware/wizmatchMachineSyncLane.ts`) engages only for `req.user.role === 'viewer'`, so the
lane is correctly targeted and is not dead code.

The principal is **outside** `WIZMATCH_STAFFING_PILOT_USER_IDS` (§7.1) and is **not** a fourth human
pilot user. Nothing about it was changed.

Full production role histogram (counts only, no identities): `admin`=6, `team_lead`=2, `staff`=2,
`creative_assistant`=2, `manager_ads`=1, `viewer`=2.

**The eight frozen GET paths** the lane admits (`WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST`,
`src/middleware/wizmatchMachineSyncLane.ts`), exact-match only, mount-relative under
`/api/wizmatch`:

`/dashboard` · `/command-center` · `/candidate-intelligence/queue` · `/client-discovery/queue` ·
`/review-workbench` · `/guardrails` · `/placements` · `/candidates`

**Only 7 of the 8 actually return data.** The recorded pre-existing limitation stands and is worth
stating precisely: the lane admits `/placements`, but the handler then self-rejects a `viewer` via its
own `['admin','team_lead']` check (`src/routes/wizmatch.ts`), returning 403
`commercial_access_requires_lead`. Deliberate, and pinned by
`src/__tests__/wizmatchMachineSyncLane.test.ts`. Consequence for the operator: the sync will cache a
403 for placements indefinitely — if any Command Deck tile is ever expected to show placements, it
never will until that handler check changes. Predates this branch; not this branch's to change.

**Two facts about the sync client itself** (`~/GE-Brain/scripts/crm-sync.mjs`, outside this repo),
relevant to anyone debugging a sync outage:

- **Its credentials are not in Railway.** Base URL and both JWTs load from `~/.ge-crm/config.json` on
  the machine that runs the sync. Nothing in the Railway environment controls it, and rotation is a
  manual step on that host.
- **The JWT carries a 7-day expiry and is checked against `users.token_version` on every request.**
  Any password reset on the `deck-sync` account silently 401s the entire sync.

Its own service-account detection (`role === 'viewer'` or an email/name matching
`reviewer|deck.?sync|no-?reply`) is consistent with the `deck-sync` row found in production, and its
path list is byte-identical to `WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST` — zero drift.

---

## 9. Backup / PITR — **VERIFIED UNAVAILABLE. This is the new blocker.**

Queried read-only through Railway's own public GraphQL API against the production Postgres volume
instance `144db25d-1d4a-4dbc-abe5-3abd5e132893`:

```graphql
query { volumeInstanceBackupList(volumeInstanceId: "144db25d-…") { id name createdAt expiresAt referencedMB scheduleId } }
→ { "data": { "volumeInstanceBackupList": [] } }

query { volumeInstanceBackupScheduleList(volumeInstanceId: "144db25d-…") { id kind retentionSeconds } }
→ { "data": { "volumeInstanceBackupScheduleList": [] } }
```

| Item | Result |
|---|---|
| Backups of the production CRM database | **ZERO. None exist.** |
| Backup schedule configured | **NONE.** |
| Newest backup age | n/a — there is no backup |
| Restore-to-new-service capability | Exists as a Railway feature (`volumeInstanceBackupRestore`), but **there is nothing to restore from** |
| PITR | **Not available** — no backup lineage exists |

The same two queries return `[]` for `Postgres-K0lx` and for the Redis volume as well, so this is not
an artefact of one misconfigured volume: **no volume in this project has any backup or any backup
schedule.**

> ### This is bigger than G1.
>
> Independently of migration `0037`, the production Growth Escalators CRM database — customers,
> contacts, deals, payments, WizMatch pipeline — currently has **no backup of any kind and no
> schedule to create one**. That is a standing data-loss exposure that exists today, whether or not
> this branch ever merges.
>
> It also **fails the owner's own U-7 condition outright**: that approval was made conditional on
> *"a verified backup/rollback plan"*. There is no rollback path for `0037` beyond hand-writing
> reversal DDL.
>
> **Recommended before anything else:** enable a Railway backup schedule on the `Postgres` volume and
> take one manual backup. Both are production-configuration changes and were **not** performed by
> this session. Confirm in the dashboard: Railway → `GE-Backend-Server` → `production` → `Postgres` →
> Data / Backups → verify the schedule and the first completed backup, and report back only the
> schedule kind and the newest backup timestamp.

---

## 10. Current dangerous-feature safety state

Read inside the production container. Non-secret operational flags show their value; credentials
show **presence only** — no credential value was read into any output.

### Safe — as expected

| Flag | Value | Meaning |
|---|---|---|
| `NODE_ENV` | `production` | ✅ settles PR 8A **H-4**; the pilot roster's fail-closed branch is live |
| `WIZMATCH_SENDING_ENABLED` | `false` | ✅ sending off |
| `WIZMATCH_POLICY_ENFORCEMENT_MODE` | *(unset)* | ✅ → defaults to `shadow` (`outreachGate.ts:181`) |
| `WIZMATCH_AUTO_PREP_ENABLED` | *(unset)* | ✅ preparation off |
| `WIZMATCH_OUTREACH_ADAPTER_ENABLED` | *(unset)* | ✅ adapter off |
| `OUTREACH_PROVIDER` | *(unset)* | ✅ no provider selected |
| `WIZMATCH_STAFFING_PILOT_ALL_USERS` | `false` | ✅ no open deployment |
| `WIZMATCH_COMPANY_POLICY_ENABLED` | *(unset)* | off — must be enabled at G3 |
| `WIZMATCH_DECISION_WORKBENCH_ENABLED` | *(unset)* | off — must be enabled at G3 |
| `WIZMATCH_ENABLE_APOLLO` | *(unset)* | ✅ Apollo off |
| `WIZMATCH_ENABLE_SNOV` | *(unset)* | ✅ Snov off |
| `WIZMATCH_LEGACY_AUTOMATION_ENABLED` | `false` | ✅ |

**Smartlead: absent.** All eleven credential aliases checked — `SMARTLEAD_API_KEY`,
`SMARTLEAD_API_TOKEN`, `SMARTLEAD_TOKEN`, `SMARTLEAD_KEY`, `SMARTLEAD_SECRET`,
`SMARTLEAD_CLIENT_SECRET`, `SMARTLEAD_WORKSPACE_TOKEN`, `SL_API_KEY`, `SL_API_TOKEN`, `SL_TOKEN`,
`SL_SECRET` — **every one absent.** ✅

### ⚠️ NOT as expected — paid discovery is **live**, not disabled

| Flag / credential | State |
|---|---|
| `WIZMATCH_PAID_DISCOVERY_ENABLED` | **`true`** |
| `WIZMATCH_GOOGLE_FALLBACK_ENABLED` | **`true`** |
| `SERPER_API_KEY` | **present** |
| `APOLLO_API_KEY` | **present** |
| `SNOV_CLIENT_ID` | **present** |
| `SNOV_CLIENT_SECRET` | **present** |
| `SNOV_API_KEY` | absent |

The per-provider switches for Apollo and Snov are off, so those two rungs cannot fire. But the
**master paid-discovery switch is on and the Google/Serper fallback rung is both enabled and
credentialed** — meaning a spending path is currently reachable in production. This contradicts the
"paid discovery disabled" precondition assumed elsewhere in the go-live documentation.

This session **did not change it.** It is recorded for an owner decision. It does not block `0037`
(the migration spends nothing), but it must be settled before G3/G4 and before any statement that
"paid discovery is off" is repeated.

### Also observed

`WIZMATCH_STAFFING_AUTOMATION_ENABLED=true`, `WIZMATCH_ATS_POLLING_ENABLED=true`,
`WIZMATCH_POC_DISCOVERY_ENABLED=true`, `DISABLE_BACKGROUND_JOBS=false` — the single `web` process is
running the WizMatch cron workload in production.

---

## 11. Migration execution mechanism — verified, and it is coupled

```json
// railway.json
"deploy": { "startCommand": "node dist/scripts/migrate.js && node dist/index.js" }
```

**Migrations run automatically at container start.** Merging this branch to `main` auto-deploys and
therefore **auto-applies `0037`**. G1 and G3 are coupled by construction unless `0037` is applied
out-of-band first, which is the owner-ratified plan.

Mechanism details verified from source:

- **Entry point:** `src/scripts/migrate.ts` → `dist/scripts/migrate.js`. It takes a **blocking**
  `pg_advisory_lock(847291003)` before calling drizzle's `migrate()`, releases it in `finally`,
  ends the pool, and `process.exit(exitCode)` — `0` on success, `1` on failure. Exit status is
  therefore observable.
- **Migration folder:** resolved as `__dirname/../../src/db/migrations` — i.e. the migrator reads the
  **raw `.sql` source files**, which must be present in the deployed image. They are.
- **One transaction for everything pending.** `drizzle-orm/pg-core/dialect.js` wraps the whole
  pending-migration loop in a single `session.transaction(...)`. All of `0037` commits or none of it
  does — and all its locks are held for the full duration.
- **Pending detection is timestamp-only:** `Number(lastDbMigration.created_at) < migration.folderMillis`.
  With production at `max(created_at) = 1784464092263` and `0037` at `1785039545644`, **exactly one
  migration will run.**
- **Byte identity is provable after the fact.** `hash` = `sha256` of the raw file
  (`drizzle-orm/migrator.js`). The reviewed `0037_unknown_siren.sql` at branch HEAD hashes to
  `76729b609e2981f272a18f26ce032fee1978f3f0b3cc60ba53ab57c1c5937db5`. After application, the newest
  `__drizzle_migrations` row must show exactly that hash and `created_at = 1785039545644`. Anything
  else means a different file ran.
- **Preventing app startup during an out-of-band run:** invoke `node dist/scripts/migrate.js` alone.
  Because the start command is `migrate && index`, running only the first half never boots the
  server, never registers a cron, and never touches any backfill — no backfill script is invoked from
  any startup path.

---

## 12. Clone procedure — prepared, **NOT executed**

### Option A — PITR / backup restore to a new service: **UNAVAILABLE**

Railway does expose `volumeInstanceBackupRestore`, but §9 establishes there are **zero backups and no
schedule**. There is nothing to restore from. Option A is ruled out on evidence, not on preference.

*(If a backup schedule is enabled and a first backup completes, Option A becomes available and would
then be the preferred route: it produces an exact-size, exact-content copy with no read load on
production. Revisit after §9 is actioned.)*

### Option B — in-Railway logical clone — **RECOMMENDED**

Rationale: it is the only option available today, and at **52 MB** it is cheap, fast and low-impact.

**Shape (nothing here has been executed):**

1. Create **one** disposable Postgres service in the `production` environment of
   `GE-Backend-Server`, named `wizmatch-g1-locktest-<UTC yyyymmdd-hhmm>`, matching the production
   image `ghcr.io/railwayapp-templates/postgres-ssl:18` so the engine version is identical.
   **No public domain. No TCP proxy. No `DATABASE_PUBLIC_URL`.**
2. Create **one** temporary execution context inside the same Railway private network (a Railway
   sandbox, or a one-off command run on the disposable service). Credentials reach it **only** as
   Railway reference variables — `${{Postgres.DATABASE_URL}}` for the source and
   `${{wizmatch-g1-locktest-….DATABASE_URL}}` for the target — so no secret is ever typed, echoed or
   logged.
3. Dump and restore **entirely inside Railway private networking**, streamed, never touching the
   local workstation:

   ```sh
   # DO NOT EXECUTE — requires APPROVE_G1_CLONE_PROVISIONING
   pg_dump --no-owner --no-acl --format=custom "$SOURCE_URL" \
     | pg_restore --no-owner --no-acl --dbname "$TARGET_URL"
   ```

   `pg_dump` takes only `ACCESS SHARE` locks: it does **not** block reads, inserts, updates or
   deletes on production. It blocks only DDL (`ALTER`/`DROP`) for its duration. At 52 MB the
   expected duration is **seconds**.
   **A full-data dump is required** — a schema-only clone would make the lock measurement meaningless,
   which is the entire point of the exercise.
4. Run the reviewed migration against the clone, timed, capturing `pg_locks` samples and total
   wall-clock: verify `0037` and only `0037` runs, confirm exit code `0`, and confirm the resulting
   `__drizzle_migrations` row shows hash `76729b609e2981f2…` and `created_at 1785039545644`.
5. **Cleanup, in order:** delete the disposable Postgres service → delete its volume → terminate the
   temporary execution context → re-run `railway status --json` and `railway volume list` and confirm
   the production service and volume list are byte-identical to §2/§9 apart from the removals.

**Privacy:** the clone contains a full copy of production PII (2 813 contacts, 4 719 contact channels,
15 users). Mitigations: no public networking of any kind, lifetime measured in minutes, deleted
immediately after the measurement, and never connected to any application service.

**Cost:** one short-lived Postgres service plus ~52 MB of storage for a few minutes. Negligible.

---

## 13. Remaining G1 blockers

| # | Blocker | State after this session |
|---|---|---|
| 1 | Production Postgres service positively identified | ✅ **RESOLVED** — `Postgres` (`0c31ec38-…`), §3 |
| 2 | Production schema drift reviewed | ✅ **RESOLVED** — clean pre-`0037`, §5.1 |
| 3 | Migration journal reviewed | ✅ **RESOLVED** — §4, incl. three pre-existing never-applied migrations |
| 4 | Migration execution mechanism verified | ✅ **RESOLVED** — §11 |
| 5 | Three approved pilot users resolved | ⚠️ **PARTIAL** — 2 of 3; **Itika has no account**, §7 |
| 6 | Machine-sync principal verified | ✅ **RESOLVED** — `viewer`, §8 |
| 7 | **Backup / rollback verified** | ❌ **FAILED — no backups exist at all**, §9 |
| 8 | Production-sized clone exists | ❌ **NOT DONE** — requires `APPROVE_G1_CLONE_PROVISIONING` |
| 9 | `0037` tested on that clone, lock measurements taken | ❌ **NOT DONE** — depends on 8 |
| 10 | U-7 conditional approval satisfied | ❌ **NOT SATISFIED** — depends on 7 **and** 9 |

**G1 = NO-GO.** `APPROVE_G1_MIGRATION_0037` is **not** requested and must not be granted.

**Next safe action:** `APPROVE_G1_CLONE_PROVISIONING` — authorising *only* creation of the disposable
clone and the production-sized migration/lock test. It does **not** authorise applying `0037` to
production.

**Recommended in parallel, and arguably ahead of it:** enable Railway backups on the production
`Postgres` volume (§9). Blocker 7 cannot be closed any other way, and blocker 10 depends on it.
