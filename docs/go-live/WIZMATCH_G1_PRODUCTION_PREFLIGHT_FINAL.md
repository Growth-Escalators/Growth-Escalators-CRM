# WizMatch G1 — production preflight, FINAL

- **Performed:** 2026-07-27. Read-only throughout. No database was connected to.
- **Branch:** `ge/outbound-08b-g3-pilot-completion` @ `033d1aa7`; final reviewed code commit `0d330269`.
- **Supersedes:** `WIZMATCH_G1_PRODUCTION_PREFLIGHT.md` (which referenced the stale pre-remediation
  commit `7a0cea20`). Its five blockers are re-tested here against current reality.

> ## VERDICT: **NO-GO**
>
> Migration `0037` must **not** be applied. **No approval token is requested.**
>
> This is a NO-GO on *evidence availability*, not on any defect in the migration. Everything
> examinable from code says `0037` is additive and safe. The checks that would prove it safe
> **against production** cannot be run from an agent session, and one of them — a production-sized
> lock measurement — has no mechanism in this repository at all.

---

## 1. Production target

| Attribute | Value | Status |
|---|---|---|
| Railway project | **GE-Backend-Server** (`eef927aa-8e3a-4515-85fd-781b7d1d95c1`) | Identified |
| Environment | **production** (`81b087de-6c7d-493c-94f0-50c8180c47da`) | Identified |
| Application service | **`web`** (`0ee1b243-97c1-4239-9016-fb7e1578b3d6`) | Identified |
| Source repo | `Growth-Escalators/Growth-Escalators-CRM` | Matches this repo |
| Public URL | `api.growthescalators.com` | Confirmed healthy |
| Deploy trigger | auto-deploy on push to `main` | Confirmed |
| **PostgreSQL service** | **NOT POSITIVELY IDENTIFIED** | **Blocker A** |

### Current deployed state — verified

- **Deployed commit `1e748125b41f773f46ebb8e4740383aa723eade0`** (deployment `1d0dda9d`, SUCCESS,
  2026-07-23 08:44:39 UTC). This is **exactly `origin/main` HEAD** — zero drift.
- `GET /health` → `status: healthy`, **`env: "production"`**, uptime ≈ 4.35 days (consistent).
  `NODE_ENV=production` is therefore **verified at runtime, not assumed**.
- `get_service_config` reports `Variables defined: 157` — a **count only, no values**. This tool is
  secret-safe; `mcp__railway__list_variables` was **not called** (it returns plaintext secrets).

### Services in the production environment

`web`, `Redis`, `Postgres`, `Postgres-K0lx`, `Documenso`.

`Postgres-Bhky` and `web-staging` exist in the project but **not in the `production` environment**.
There is **no worker service** — `docs/DEPLOYMENT.md`'s "two Railway services" claim and
`railway.worker.json` are stale/absent. Any WizMatch cron runs inside `web`.

---

## 2. Blockers

### Blocker A — the production database cannot be positively identified (HARD)

Two Postgres services run in the `production` environment: **`Postgres`** and **`Postgres-K0lx`**.
Determining which one `web` uses requires resolving `DATABASE_URL`, and the only tool that does so
returns plaintext secrets.

Every secret-safe avenue was tried and none resolves it:

- `get_service_config` → returns a variable **count**, not names or references.
- `environment_status` / `list_services` / `list_deployments` → no service-linkage data.
- `GET /health` → reports DB connectivity, not which service.
- `/api/wizmatch/env-check` → presence-only, needs an authenticated session, reports variables not
  service identity.

Circumstantial signals exist (`Postgres` was deployed 2026-03-17, the oldest; `Postgres-K0lx` shares
a deploy timestamp to the millisecond with `Redis`, suggesting it was provisioned with a different
stack). **That is inference, not proof, and this project has a documented history of Postgres
services whose names do not indicate their owner.** Applying a migration to the wrong database would
corrupt an unrelated product.

**Resolution required:** the owner confirms, by name, which Postgres service backs `web` — read from
the Railway dashboard. **Do not paste a connection string into this session.**

### Blocker B — no production-sized lock measurement is possible (HARD)

`0037` builds three unique indexes on **core CRM tables shared with the Growth tenant**:

```
CREATE UNIQUE INDEX IF NOT EXISTS "contact_channels_tenant_id_id_uniq" ON "contact_channels" (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_tenant_id_id_uniq"         ON "contacts"         (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_id_id_uniq"            ON "users"            (tenant_id, id);
```

**`CONCURRENTLY` appears zero times in the entire migration.** A plain `CREATE INDEX` takes a `SHARE`
lock, which **blocks all writes** (INSERT/UPDATE/DELETE) to those tables for the duration of the
build while allowing reads. On `users`, `contacts` and `contact_channels` that means the Growth
tenant's CRM cannot accept writes for an unmeasured period.

The indexes cannot *fail* — `id` is already each table's primary key, so `(tenant_id, id)` is unique
by construction — but the duration is the risk, and it is unmeasured.

**A dedicated agent searched the repository exhaustively and found no mechanism** for creating or
restoring a disposable production-sized database: no backup/restore/clone/anonymisation tooling in
`scripts/`, `package.json` (`db:generate|migrate|studio|seed|import|sizes` only), `docs/DATABASE.md`,
`docs/DEPLOYMENT.md`, workflows, docker-compose or Makefile.

`0037` was previously verified **only against disposable, empty-schema local PostgreSQL 16** — full
replay ≈0.8s, isolated 0037 ≈0.47s. The PR 2 reviewers themselves flagged these as "close to
tool-startup noise floor" and said they say **nothing** about index-build lock duration on
production-sized tables.

Per this gate's own rule, an empty local fixture **must not** be substituted for a production-sized
measurement. **Absent that evidence, G1 is NO-GO.**

### Blocker C — U-7 shared-index owner sign-off outstanding (HARD)

Open since PR 2. The three indexes above touch another product's tables. No code change can close
this; it needs an explicit owner decision to accept the write-lock, ideally with a maintenance
window. Related and still open: whether to rewrite those three statements as
`CREATE UNIQUE INDEX CONCURRENTLY` (which cannot run inside the migration's transaction and so would
need a different apply mechanism).

### Blocker D — no production schema/journal access (HARD)

No `information_schema` drift review, no confirmation that `0037` is genuinely unapplied, no
verification of post-apply objects. From code I can establish the *expected* state but not the
*actual* one:

- `0037_unknown_siren.sql` is **absent from `origin/main`**; main's journal ends at
  **`idx=36 / 0036_seo_content_calendar_link`**.
- Production runs `1e748125` == `origin/main`, and auto-migrates on every deploy, so production
  *should* be at `0036` and `0037` *should* be the only pending migration.
- **This is inference from the code tree, not a read of `__drizzle_migrations`.** It must be
  confirmed by someone with database access before any apply.

### Blocker E — backup state not verified (HARD)

Whether Railway Postgres backups are enabled, their schedule, retention, and last successful
snapshot were **not confirmed** — doing so requires resolving Blocker A first. **Must be confirmed
before any apply.**

### Blocker F — the three pilot users cannot be resolved

`jatin@growthescalators.com`, `kanishk.khandelwal@growthescalators.com` and
`itika.khandelwal@growthescalators.com` **cannot be resolved to application user IDs** without
production database access. No IDs were invented, no account created, no invitation sent.

The readiness CLI independently confirms the roster must contain **UUID-shaped** ids — a
non-UUID entry is reported as `DANGER`. So the eventual `WIZMATCH_STAFFING_PILOT_USER_IDS` value
must be three real UUIDs, which only a database read can supply.

Likewise, the **production machine-sync principal** (its actual account, tenant, role and
authentication method) could not be verified.

---

## 3. What IS established — and is genuinely reassuring

### Migration 0037 is additive and logically safe

Full statement inventory (372 lines):

| Category | Finding |
|---|---|
| New tables | 7 (`wizmatch_company_duplicates`, `wizmatch_company_policies`, `wizmatch_company_policy_events`, `wizmatch_outreach_batches`, `wizmatch_outreach_enrolments`, `wizmatch_outreach_events`, `wizmatch_reply_mailboxes`, `wizmatch_suppression_events`) |
| **CHECK constraints** | **All are inline on newly-created tables** — including the H-4 `scope_type` CHECK. **None can reject a pre-existing row.** |
| Changes to pre-existing tables | Only `ADD COLUMN IF NOT EXISTS` ×3. `channel_invalid boolean DEFAULT false NOT NULL` is a metadata-only operation on PG 11+ (no table rewrite) |
| Destructive statements | **None.** The single `DROP` is `DROP TRIGGER IF EXISTS … ` immediately before recreating it — idempotency, not destruction |
| Guarding | `IF NOT EXISTS` / `DO $$ EXCEPTION` throughout; re-runnable |
| `CONCURRENTLY` | **Zero uses** — see Blocker B |

### Migration mechanism

`src/scripts/migrate.ts` is a standalone script taking a **blocking `pg_advisory_lock`** (key
`847_291_003`) so concurrent rolling-deploy instances serialise rather than race. It applies **all**
pending migrations via Drizzle's `migrate()`, then `process.exit()`s.

`railway.json` couples it to boot:
`"startCommand": "node dist/scripts/migrate.js && node dist/index.js"`.

### Compatibility — both directions analysed

**Old app (`1e748125`) AFTER `0037` is applied: SAFE.** None of the 7 new tables, 3 new columns or
the new trigger is referenced anywhere in the currently-deployed code. New nullable/DEFAULT columns
don't affect INSERTs that don't name them; the new `(tenant_id,id)` unique indexes can't conflict
because `id` is already the PK; new FKs target only the two new nullable columns (always NULL for the
old app, so auto-satisfied); the new trigger fires only on `wizmatch_company_policies`, which the old
app never touches. **The gap between migration and code deploy can be arbitrarily long.**

**New app (`033d1aa7`) BEFORE `0037` is applied: BREAKS — and worse than previously documented.**
The known issue was that `suppress()` writes `wizmatch_suppression_events` in the same transaction as
the pre-existing `wizmatch_suppression_list`, so `GET /unsubscribe`, `POST /suppression` and
`/classify-reply` would 500 outright. **New finding this session:**
`insertWizmatchCompanyRootPolicy()` / `wizmatchRootPolicyBootstrapCte()`
(`src/modules/outreach/companyBootstrap.ts:81-127`) insert into `wizmatch_company_policies` **inside
the same transaction as company-row creation**, used by
`wizmatchContactIntelligenceRepo.ts:1197-1215` and `wizmatchSourcing.ts:165`. Without `0037`, those
transactions fail atomically and **new WizMatch companies are never created at all** — silently
breaking the sourcing cron and contact-intelligence enrichment, far beyond the three compliance
routes. This strengthens PR 3's prerequisite B-1: `0037` must land **before or with** the new code,
never after.

### Migration/deployment choreography

**An out-of-band path exists** — `railway run node dist/scripts/migrate.js` injects the linked
production service's environment into a *local* process without triggering a deploy. It would apply
only `0037` and exit, leaving `1e748125` running untouched.

Two caveats the owner must weigh:

1. It requires Railway CLI authenticated and linked to production, and **must be executed by a
   human** — it is a guarded production action under `AGENTS.md`.
2. It injects `DATABASE_URL` into a local shell, i.e. **production credentials reach a local
   machine.** That is precisely what the earlier preflight declined to do from an agent session.

| Option | Steps | Risk |
|---|---|---|
| **(i) Out-of-band migrate, then merge** | build locally → `railway run node dist/scripts/migrate.js` → verify `[migrate] Migration complete` → merge to `main` (migrate step then no-ops) | Manual guarded prod operation; prod credentials on a local machine. **Gives a clean rollback boundary between "schema changed" and "new code live".** |
| **(ii) Coupled single-gate merge** | merge to `main`; Railway runs migrate-then-boot as one deploy | Migration itself is equally safe, but there is **no checkpoint** between the two. If the new app fails to boot for any unrelated reason, the schema is migrated with no working new app. An ops gap, not a data-safety one. |

Neither can be chosen by me. **This is the owner decision carried over as Blocker 5 in the previous
preflight, and it remains open.**

### Rollback

- **Application code:** well understood — Railway retains prior deployments; redeploying `1e748125`
  restores the old code.
- **Schema:** intentionally *not* a drop. Per ADR-004, `0037`'s tables are left in place and never
  dropped; rollback is an application-code revert. `0037` contains zero destructive statements and is
  re-runnable.
- **Backups:** **NOT VERIFIED** — blocked on Blocker A.

---

## 4. G1 sign-off matrix

| Required for G1 GO | Status |
|---|---|
| Production database positively identified | **NO — Blocker A** |
| Schema drift understood and acceptable | **NO — Blocker D** |
| `0037` confirmed unapplied | **NO** — inferred from the code tree only |
| U-7 / shared-index owner sign-off recorded | **NO — Blocker C** |
| Production-sized migration/lock evidence | **NO — Blocker B (no mechanism exists)** |
| Backup verified | **NO — Blocker E** |
| Rollback verified | **PARTIAL** — code rollback yes, backup no |
| Migration/deployment choreography safe | **ANALYSED, but owner decision open** |
| User accounts unambiguous | **NO — Blocker F** |
| Machine-sync compatibility understood | **Code: YES. Production principal: NO — Blocker F** |

**Six hard blockers. G1 is NO-GO.**

---

## 5. Exactly what is needed to re-attempt G1

1. **Owner confirms which Postgres service backs `web`**, by name, from the Railway dashboard.
   (Do not paste a connection string here.)
2. **Owner signs off U-7** — the three shared-table index builds on `users`, `contacts`,
   `contact_channels` — and decides whether to accept a plain `CREATE INDEX` write-lock or require
   `CONCURRENTLY` (which would need a different apply mechanism).
3. **Owner decides the migration mechanism** — out-of-band `railway run` (option i) vs. accepting
   G1+G3 as one combined gate (option ii).
4. **Someone with database access produces:** a production `information_schema` drift diff, the
   `__drizzle_migrations` ledger state, and row counts for `users`, `contacts`, `contact_channels`,
   `wizmatch_companies`, `wizmatch_suppression_list`.
5. **Backup state confirmed** — enabled, schedule, retention, recent snapshot.
6. **Either** a production-sized clone is created by a newly-written and reviewed procedure and the
   three index builds are timed against it, **or** the owner explicitly accepts the index-build lock
   without measurement, in writing.
7. **The three pilot users are resolved** to UUID application IDs, with tenant and active status
   confirmed, plus the machine-sync principal's account/tenant/role.

Items 1–3 and 6–7 are owner/production actions. Nothing in a coding session advances them.

---

## 6. Confirmations — nothing was changed

- **No database write has occurred.** No database was connected to at all.
- **No migration applied.** `0037` remains unapplied by this session; **no `0038` exists**.
- **No backfill run** — not even a dry run (it requires a database connection).
- **No role changed. No pilot roster changed.** No user account created or invited.
- **No PR merged, retargeted, or marked ready.** PR #89 remains OPEN, DRAFT, base
  `ge/outbound-08a-live-pilot-hardening`, head `033d1aa7`.
- **Nothing deployed.** No production variable changed. No service restarted or redeployed.
- **No secret value read or printed.** `mcp__railway__list_variables` was never called.
- Only the positively-identified project/environment/service was accessed, read-only.
- Sending, automated emails, preparation, the outreach adapter and paid discovery all remain
  disabled; enforcement remains `shadow`; Smartlead remains absent.
- The **only** mutation performed anywhere this session: PR #89's description was replaced with an
  accurate one (backed up first). See `WIZMATCH_GITHUB_RELEASE_STATUS.md`.
