# WizMatch G1 — production preflight, FINAL

- **Performed:** 2026-07-27. Read-only throughout. No database was connected to.
- **Branch:** `ge/outbound-08b-g3-pilot-completion` @ `033d1aa7`; final reviewed code commit `0d330269`.
- **Supersedes:** `WIZMATCH_G1_PRODUCTION_PREFLIGHT.md` (which referenced the stale pre-remediation
  commit `7a0cea20`). Its five blockers are re-tested here against current reality.

> ## VERDICT: **NO-GO** (updated 2026-07-27 after the owner response)
>
> Migration `0037` must **not** be applied. **No approval token is requested.**
>
> This is a NO-GO on *evidence availability*, not on any defect in the migration. Everything
> examinable from code says `0037` is additive and safe.
>
> **The owner response resolved two of the six blockers and closed the CI gap** (see §0). **Three
> hard blockers remain, and they are mutually entangled:** the production Postgres was left as an
> unfilled template placeholder, so it is still unidentified; the production-sized lock measurement
> is now explicitly *required with no waiver*, but no mechanism to produce one exists and building
> one requires knowing the database first; and the three pilot users still cannot be resolved.

---

## 0. Owner response of 2026-07-27 — what it resolved, and what it did not

### 0.1 RESOLVED — U-7 shared-index sign-off (was Blocker C)

The owner approved the three additive `(tenant_id, id)` indexes on `users`, `contacts`,
`contact_channels`, **conditionally**:

- conditional on the production-sized lock measurement **and** a verified backup/rollback plan;
- `CONCURRENTLY` is **not** mandated in advance — but if the measurement shows material write
  blocking, lock waiting, or unacceptable operational impact, the instruction is explicit: **return
  G1 NO-GO, do not apply, and prepare a reviewed concurrent-index/out-of-transaction migration plan.
  Do not improvise on production.**

So U-7 is signed off *as a decision*, but it **cannot take effect** until the measurement exists.

### 0.2 RESOLVED — migration mechanism (was Blocker 5 / the coupling decision)

**Out-of-band execution, separate from the application merge and deployment.** G1 and G3 must not be
combined for convenience. Preferred command: `node dist/scripts/migrate.js`, run only through the
confirmed production Railway application service or a repository-approved migration execution
context.

> **Distinction the owner should be aware of before execution.** The mechanism previously proposed
> in analysis was `railway run node dist/scripts/migrate.js`, which injects the production service's
> environment — **including `DATABASE_URL`** — into a process on a *local* machine. That is
> materially different from executing inside the Railway service container, and it places a
> production credential on a developer workstation. The owner's wording ("through the confirmed
> production Railway application service") points at in-service execution, which is the safer
> reading and the one recorded here.

### 0.3 RESOLVED — the CI gap is now closed

Owner-authorised CI-only actions were performed (see `WIZMATCH_GITHUB_RELEASE_STATUS.md` §3 for the
full record). Result:

| | |
|---|---|
| Workflow run | `30290407423`, event `pull_request`, **conclusion `success`** |
| Head SHA tested | `af6d0438b800cbc679f2f62c41f9f3c3f6c84400` |
| Steps | checkout · node 20 · `npm ci` · admin `npm ci` · **Build (tsc) success** · **Test + coverage success** |
| Result | **132 test files passed**; coverage 49.36 / 45.44 / 49.64 / 50.99 — identical to the local run |
| PR #89 | OPEN, **still DRAFT**, base **`main`**, `MERGEABLE` / `CLEAN`, `build-and-test` **pass** |

**This is the first time the full 72-commit stack has ever been exercised by CI**, and it is green.
PRs #81–#89 had never run `build-and-test`; only #80 had.

> **Mechanism note — a deviation worth disclosing.** Retargeting alone did **not** trigger CI.
> The push landed while the PR still targeted the 8A branch (so `synchronize` was filtered out by
> `branches: [main]`), and changing a base fires `pull_request.edited`, which is not a default
> activity type. The authorised outcome was therefore unreachable by the enumerated steps alone.
> The two available means were (a) fabricating a commit to fire `synchronize`, or (b) a
> close/reopen cycle to fire `reopened`. **(b) was chosen** — it changes no commit, preserves draft
> status, and is reversible in seconds, whereas (a) would have permanently polluted the reviewed
> branch history that this whole effort exists to protect. PR state was verified restored
> immediately afterwards: `state=OPEN draft=true base=main head=af6d0438`.

### 0.4 NOT RESOLVED — the production database is still unidentified (blocking)

The owner response's §1 reads, literally:

```
The exact Railway Postgres service backing the production web service is:

<INSERT EXACT RAILWAY POSTGRES SERVICE NAME>
```

**The template placeholder was never filled in.** No service name was supplied. The two candidates in
the `production` environment remain `Postgres` and `Postgres-K0lx`, and **no guess has been made.**

This blocks, transitively: the reference verification the owner asked for, the schema drift review,
the migration-journal read, the backup verification, the user-ID resolution, the machine-sync
principal check, and the proof that the migrate command targets the right database.

### 0.5 NOT RESOLVED — production-sized lock measurement (blocking, no waiver)

The owner explicitly granted **no waiver** and restricted the evidence to an approved disposable
production-sized clone, an approved restored backup copy, or another repository-approved disposable
database at representative scale — and forbade calling a small fixture production-sized.

**No such mechanism exists in this repository** (verified exhaustively — see Blocker B). Producing
one requires, in order: knowing which database to clone (§0.4, unresolved), an owner-approved
backup/restore procedure that must first be *written and reviewed*, and provisioning a disposable
instance. None of that is read-only work and none of it can proceed until §0.4 is answered.

### 0.6 Out-of-band migrate command — what is proven, and what cannot be

The owner asked for six properties to be proven before requesting G1. Five are proven from code; the
sixth is blocked on §0.4.

| Required proof | Status | Evidence |
|---|---|---|
| Targets the confirmed production Postgres | **CANNOT BE PROVEN** | Depends on `DATABASE_URL`; database unidentified (§0.4) |
| Uses the final reviewed migration `0037` | **PROVEN** | `git diff 0d330269..HEAD -- src/db/migrations/` is **empty** — migrations byte-identical to the reviewed commit. `sha256(0037_unknown_siren.sql)` = `76729b609e2981f272a18f26ce032fee1978f3f0b3cc60ba53ab57c1c5937db5`. `git diff --name-only origin/main HEAD -- src/db/migrations/` lists **exactly one** file, so exactly one migration would apply |
| Does not deploy the application | **PROVEN** | `src/scripts/migrate.ts` imports only `dotenv`, `path`, drizzle's `migrator`, and `../db/index`; that module imports only `dotenv`, `drizzle`, `pg.Pool`, `schema`. No `express`, no `listen`, no server, no cron anywhere in the transitive top-level graph |
| Does not enable a feature | **PROVEN** | Zero references to `WIZMATCH_SENDING_ENABLED`, `AUTO_PREP`, `OUTREACH_ADAPTER`, `PAID_DISCOVERY` or any flag; the script writes no environment variable |
| Does not run the policy backfill / `--apply` | **PROVEN** | Zero references to `backfill` of any kind; the backfill lives in `scripts/onboarding/wizmatch-policy-backfill.ts` and is never imported |
| Can be observed and stopped safely on failure | **PROVEN** | Blocking `pg_advisory_lock(847291003)` serialises concurrent runs; progress logged (`[migrate] Migration started` → `Lock acquired` → `Migration complete`); failure logs `[migrate] Migration failed:` and sets exit code 1; the lock is released and the client returned in a `finally` block before `pool.end()` |

Path resolution confirmed: the compiled `dist/scripts/migrate.js` resolves
`path.join(__dirname,'..','..','src','db','migrations')` → repo-root `src/db/migrations`, matching
the `/app/src/db/migrations` seen in real production deploy logs.

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
| Full-stack CI green | **YES** — run `30290407423` success on `af6d0438` (§0.3) |
| U-7 / shared-index owner sign-off recorded | **YES, conditionally** — conditional on the measurement + backup/rollback (§0.1) |
| Migration/deployment choreography decided | **YES** — out-of-band, decoupled from the merge (§0.2) |
| Out-of-band command proven safe | **5 of 6 proven**; target-database proof blocked (§0.6) |
| `0037` is the reviewed migration, and the only one pending | **YES** — byte-identical to `0d330269`; exactly one `.sql` differs from `main` |
| **Production database positively identified** | **NO — placeholder never filled (§0.4)** |
| **Production-sized migration/lock evidence** | **NO — no mechanism exists, no waiver granted (§0.5)** |
| Schema drift understood and acceptable | **NO** — blocked on §0.4 |
| `0037` confirmed unapplied *in production* | **NO** — inferred from the code tree only; blocked on §0.4 |
| Backup verified | **NO** — blocked on §0.4 |
| Rollback verified | **PARTIAL** — code rollback yes; backup unverified |
| User accounts resolved to UUIDs | **NO** — blocked on §0.4 |
| Machine-sync compatibility understood | **Code: YES. Production principal: NO** — blocked on §0.4 |

**Three hard blockers remain (§0.4, §0.5, and everything downstream of them). G1 is NO-GO.**

Note the dependency shape: **§0.4 is the root.** Answering it unblocks the drift review, journal
read, backup check, user resolution, machine-sync check, and the target-database proof. §0.5 then
becomes the last remaining item — and it is real work (write and review a restore procedure,
provision a disposable instance, measure), not a lookup.

---

## 5. Exactly what is needed to re-attempt G1

Items 2, 3 and the CI gap are now **closed**. What remains:

1. **Supply the production Postgres service name** — the one thing that unblocks everything else.
   `Postgres` or `Postgres-K0lx`, read from the Railway dashboard. **Do not paste a connection
   string.** Once supplied, the reference verification the owner asked for can be attempted
   secret-safely, and items 3–5 below become possible.
2. **Produce the production-sized lock measurement.** No waiver was granted, so this is mandatory.
   It is not a lookup — it requires:
   a. an owner-approved backup/restore or clone procedure, **written and reviewed** (none exists);
   b. a disposable instance at representative scale on `users`, `contacts`, `contact_channels`;
   c. timing the three `CREATE UNIQUE INDEX` builds against it;
   d. applying the owner's own stated rule to the number — material write blocking or lock waiting
      means **NO-GO plus a reviewed concurrent-index plan**, not a judgement call at apply time.
3. **Read-only production evidence** (needs item 1): `information_schema` drift diff,
   `__drizzle_migrations` ledger state, and row counts for `users`, `contacts`, `contact_channels`,
   `wizmatch_companies`, `wizmatch_suppression_list` (the last two also feed item 2's sizing).
4. **Backup state confirmed** — enabled, schedule, retention, last successful snapshot.
5. **Resolve the three pilot users** to UUID application IDs with tenant and active status, plus the
   machine-sync principal's account/tenant/role. Read-only; **no role or roster change is to be made
   at this stage**, per the owner's instruction.

Items 1 and 2 are owner/production actions. Nothing in a coding session advances them.

---

## 6. Confirmations — nothing was changed

- **No database write has occurred.** No database was connected to at all.
- **No migration applied.** `0037` remains unapplied by this session; **no `0038` exists**.
- **No backfill run** — not even a dry run (it requires a database connection).
- **No role changed. No pilot roster changed.** No user account created or invited.
- **No PR merged and none marked ready.** PR #89 was **retargeted to `main` and its body replaced
  under explicit owner authorisation for CI evidence only** (owner response §5), and briefly
  closed/reopened as the only non-destructive way to fire the workflow (§0.3). It remains **OPEN and
  DRAFT**, head `af6d0438`, `MERGEABLE`/`CLEAN`. **Not merged. Not marked ready.**
- **Nothing deployed.** No production variable changed. No service restarted or redeployed.
  Retargeting and CI cannot deploy — independently confirmed in the deploy-trigger table.
- **Two docs-only commits pushed** (`d4a0619c`, `af6d0438`) under the same authorisation;
  fast-forward, no force. `git diff --name-only 0d330269..af6d0438` touches only `.ai/` and `docs/`.
- **No secret value read or printed.** `mcp__railway__list_variables` was never called.
- Only the positively-identified project/environment/service was accessed, read-only.
- Sending, automated emails, preparation, the outreach adapter and paid discovery all remain
  disabled; enforcement remains `shadow`; Smartlead remains absent.
- The **only** mutation performed anywhere this session: PR #89's description was replaced with an
  accurate one (backed up first). See `WIZMATCH_GITHUB_RELEASE_STATUS.md`.
