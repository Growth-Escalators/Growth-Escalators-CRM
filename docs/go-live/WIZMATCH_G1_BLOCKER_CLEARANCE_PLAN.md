# WizMatch G1 — Blocker Clearance Plan (Tracks A, B, C)

**Status:** PREPARED, NOT EXECUTED. Nothing in this document has been applied.
**Date prepared:** 2026-07-28 (UTC)
**Branch:** `ge/outbound-08b-g3-pilot-completion`
**Supersedes:** the single combined `APPROVE_G1_CLONE_PROVISIONING` token proposed in
`WIZMATCH_G1_RUNTIME_READONLY_EVIDENCE.md` §12. That token is **withdrawn** by owner decision
and replaced by the five separate gates below.

This document is the execution plan for clearing the three G1 blockers. It is a companion to
[`WIZMATCH_G1_RUNTIME_READONLY_EVIDENCE.md`](WIZMATCH_G1_RUNTIME_READONLY_EVIDENCE.md), which
holds the read-only production evidence this plan is built on. Production facts newly captured
for this plan are in §5.

---

## 0. What has and has not happened

**Done (read-only only):**
- Railway GraphQL schema inspected for the backup/PITR surface (queries and mutation signatures only).
- Railway documentation read for backup and PITR semantics.
- Two read-only production database sessions (`SET default_transaction_read_only = on`,
  `statement_timeout=15s`, `lock_timeout=2s`, `idle_in_transaction_session_timeout=30s`,
  `BEGIN READ ONLY`, `ROLLBACK` before disconnect).
- Read-only Railway API queries for services, volumes, volume instances, deployments and repo triggers.

**Not done, and not authorised:**
- No backup enabled, created, or restored.
- No account created or modified.
- No service created, modified, or deleted.
- No production variable changed.
- Migration `0037` not applied. No backfill. No merge, push, deploy, or PR state change.
- No production row data copied anywhere.

**Still true after today's reads:** G1 is **NO-GO**.

---

## 1. Mandatory ordering (owner decision, not negotiable)

Migration `0037` must be applied **and verified** before the PR 8B application code deploys.

The reason is concrete and was established in
[`WIZMATCH_G1_RUNTIME_READONLY_EVIDENCE.md`](WIZMATCH_G1_RUNTIME_READONLY_EVIDENCE.md) §11.1:
two currently-enabled production crons reach code that writes to `wizmatch_company_policies`,
a table `0037` creates —
`src/worker.ts:1709-1712` (TheirStack, `'35 1 * * 1,4'`) and `src/worker.ts:1722-1725`
(ATS, `'40 0 * * *'`) → `src/services/wizmatchSourcing.ts:3` →
`src/modules/outreach/companyBootstrap.ts:87,:119`. Deploying the code first makes those crons
throw on a schedule against a missing table. Feature flags do not protect these paths.

**The order is:**

1. Verified backup (Track A)
2. Production-sized synthetic clone + lock test (Track C)
3. Migration `0037` applied out-of-band
4. Migration journal and schema verification
5. G2 backfill
6. Application merge and shadow deployment

**Exit code 0 from the migration process is not proof of application.** `src/scripts/migrate.ts`
prints `[migrate] Migration complete` and exits 0 identically when nothing was pending. Success is
proven only by the journal row and the post-migration schema.

---

## 2. TRACK A — Production backup

### 2.1 Current state (verified read-only today)

| Fact | Value |
|---|---|
| Project | `GE-Backend-Server` (`eef927aa-…`) |
| Environment | `production` (`81b087de-6c7d-493c-94f0-50c8180c47da`) |
| Production Postgres service | `Postgres` — `0c31ec38-0433-46c6-9fbb-5dd2859d1a08` |
| Volume | `postgres-volume` — `3c413aaa-49e0-4258-a308-a2cf6b2ac055` |
| **Volume instance (the backup target)** | **`144db25d-1d4a-4dbc-abe5-3abd5e132893`** |
| Volume used / allocated | 189.83 MB / 500 MB |
| Image | `ghcr.io/railwayapp-templates/postgres-ssl:18` (major tag) |
| Last deployment | `SUCCESS`, 2026-03-17, 1 replica |
| `volumeInstanceBackupScheduleList` | `[]` — **no schedule** |
| `volumeInstanceBackupList` | `[]` — **no backups** |
| `archive_mode` | `off` |
| `wal_level` | `replica` |
| `archive_timeout` | `0` |
| `WAL_ARCHIVE_*` env vars | none present |

**Conclusion: PITR is not enabled and no backup of any kind exists.** This is a live data-loss
exposure independent of G1.

### 2.2 What Railway offers

Two independent mechanisms exist, with materially different restore semantics.

**(a) Volume backups** — `volumeInstanceBackupCreate`, `volumeInstanceBackupScheduleUpdate(kinds, volumeInstanceId)`.
`kinds` is an enum: `DAILY`, `WEEKLY`, `MONTHLY`; multiple may be set at once.
Retention is fixed by Railway per kind and is **not** independently configurable:

| Kind | Frequency | Retention |
|---|---|---|
| `DAILY` | every 24 h | 6 days |
| `WEEKLY` | every 7 days | 1 month |
| `MONTHLY` | every 30 days | 3 months |

Restore semantics (per Railway docs, `volumes/backups`): a restore mounts a **new volume** at the
same path, retains the old volume unmounted, and is delivered as a **staged change** that a human
must review and click **Deploy** on; the service then redeploys. Restoring **deletes all backups
newer than the one restored**. Backups can only be restored into the same project + environment.
Manual backups are capped at 50% of volume size — 189.83 MB against a 500 MB volume is inside that
cap, so an immediate manual backup is possible today.

**(b) Point-in-time recovery** — `volumeInstancePITRRestore(targetTimestamp, volumeInstanceId)`.
Continuous WAL archiving to a Railway bucket via pgBackRest; weekly full + daily incremental base
backups; last 4 fulls retained, giving roughly a 4-week restore window. Restore provisions a
**brand-new sibling Postgres service** and leaves the source **online and untouched**.

### 2.3 Recommendation

**Enable PITR, plus a `DAILY` + `WEEKLY` volume-backup schedule as a second, independent copy.**

Why PITR is the right primary control here: Railway's own documentation names "a faulty migration"
as the case PITR exists for, which is precisely the risk `0037` carries. It also restores to a
*sibling* service without touching the source — so a bad `0037` outcome is recoverable **without**
taking production down, which is not true of a volume-backup restore. The image is pinned to a
major tag (`postgres-ssl:18`), which is the configuration PITR requires; a minor pin would be
rejected.

Why also keep volume backups: PITR's restore window **starts at the first post-enable base backup
and is not retroactive**, and the WAL archive shares a failure domain with the bucket. A `DAILY`
volume backup is a cheap, independent artifact.

### 2.4 The one real cost of enabling PITR

Enabling PITR **redeploys the Postgres service** (Railway creates the `Postgres-PITR` bucket, sets
`WAL_ARCHIVE_*` on the service, and redeploys). That is a brief production database interruption
and must be scheduled deliberately.

It is, however, **safe with respect to the §1 ordering**: only the `web` service has a repo trigger
(`Growth-Escalators/Growth-Escalators-CRM @ main`); `Postgres` has none. Redeploying `Postgres`
therefore cannot run `dist/scripts/migrate.js` and cannot apply `0037`. Verified read-only today.

### 2.5 The plan, as the owner's checklist requires it

| Item | Answer |
|---|---|
| Production service | `Postgres` (`0c31ec38-0433-46c6-9fbb-5dd2859d1a08`), volume instance `144db25d-1d4a-4dbc-abe5-3abd5e132893` |
| Frequency | PITR: continuous WAL + weekly full / daily incremental. Volume backups: `DAILY` + `WEEKLY` |
| Retention | PITR: ~4 weeks (last 4 fulls). Volume: 6 days (daily), 1 month (weekly) |
| Immediate backup possible? | **Yes** — a manual volume backup, 189.83 MB against a 250 MB cap. Recommended as the very first action, since it needs no redeploy |
| Restore: new service or volume replace? | **Both exist.** PITR → brand-new sibling service, source untouched. Volume backup → new volume on the same service, staged change + redeploy |
| Restore procedure | PITR: Backups tab → pick timestamp → *Restore to this moment* → new service `Postgres-restored-YYYYMMDD-HHMM` boots and replays WAL → verify → cut over manually. Volume: Backups tab → *Restore* on a dated backup → review staged change → *Deploy* |
| Expected restore time | Minutes. The database is 52 MB and the volume 189.83 MB |
| Person responsible for recovery | Jatin Agrawal (sole Railway owner on this project) |
| Proof of success | `volumeInstanceBackupList(volumeInstanceId)` returns ≥ 1 backup; for PITR, `archive_mode=on` in `pg_settings` and the datetime picker showing a non-empty restore window |

### 2.6 Execution steps after approval

1. Manual volume backup first (`volumeInstanceBackupCreate`) — no redeploy, immediate restore point.
2. Verify it appears in `volumeInstanceBackupList`.
3. Set the schedule (`volumeInstanceBackupScheduleUpdate`, `kinds: [DAILY, WEEKLY]`).
4. Enable PITR from the Backups tab; accept the Postgres redeploy.
5. Verify `archive_mode=on` and a non-empty restore window.
6. **Do not restore.** Do not create a clone from it.
7. Update the G1 evidence document.

> **STOP — approval required.** Nothing in Track A proceeds without exactly:
>
> **`APPROVE_PRODUCTION_BACKUP_ENABLE`**

---

## 3. TRACK B — Itika's account

### 3.1 Current state (verified read-only today)

- **Itika has no account.** A case-insensitive search across all tenants for `%itika%` returns
  **zero** rows. (A `%khandelwal%` search returns only Kanishk's two accounts.)
- The `wizmatch` tenant contains exactly **three** users: `deck-sync@wizmatch` (`viewer`),
  Jatin (`admin`), Kanishk (`admin`).
- `team_lead` is an established, in-use role: 2 users already hold it.
- The pilot roster env var currently holds exactly **2** entries — Jatin's and Kanishk's
  wizmatch-tenant UUIDs — all lowercase, with `deck-sync` correctly excluded. Verified by
  set-membership booleans only; the value was never printed.

### 3.2 A tenant ambiguity that must not be got wrong

The instruction "the same tenant as Jatin and Kanishk" is **ambiguous on its face**, because
**both of them hold an account in two different tenants**:

| Tenant | Slug | Users | Jatin | Kanishk |
|---|---|---|---|---|
| `4b3dd3e2-69e3-4718-95ce-e3ace41779f2` | **`wizmatch`** | 3 | `427e6b95-68f7-42b6-83b0-ced1799139b2` | `115f2251-cf72-417e-bdbb-b63cd23415b3` |
| `3ff1e516-7612-477b-a778-4b84659767fa` | `growth-escalators` | 12 | `e480cc54-730a-4587-9374-33b681b6bbf0` | `b49f78bb-20de-44ff-be64-1e01ebae80eb` |

A third tenant, `city-clinic` (`01e7e5b7-…`), is unrelated.

This is legitimate — `users` is uniquely keyed on `(tenant_id, email)`, so one person holds one row
per tenant. **The correct target is `4b3dd3e2-…` (`wizmatch`).** Two independent confirmations:
the production `WIZMATCH_TENANT_ID` variable is set and equals that UUID (verified by boolean
comparison, value not printed), and the two UUIDs already in the pilot roster are the
wizmatch-tenant pair, not the growth-escalators pair.

Creating Itika in `growth-escalators` would produce an account that looks correct in the CRM and
is silently invisible to the WizMatch pilot.

### 3.3 Column contract for `users` (from production `information_schema`)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NO | **yes** |
| `tenant_id` | uuid | NO | no |
| `name` | text | NO | no |
| `email` | text | NO | no |
| `password_hash` | text | NO | no |
| `created_at` | timestamp | NO | yes |
| `role` | text | YES | yes |
| `token_version` | integer | YES | yes |
| `is_active` | boolean | YES | yes |
| `is_test_account` | boolean | YES | yes |

Four columns must be supplied: `tenant_id`, `name`, `email`, `password_hash`. `id` is
DB-generated. This is why a hand-written partial `INSERT` is the wrong tool — `password_hash` is
`NOT NULL` with no default, so a row created without a properly hashed password is either
impossible or unusable.

### 3.4 The approved provisioning mechanism

**`POST /api/permissions/users`** — `src/routes/permissions.ts:173`. This is the supported path and
the one to use; no hand-written `INSERT`.

What it does, verified line by line:

| Behaviour | Line | Detail |
|---|---|---|
| Authorisation | `:177-180` | caller needs the `isOwner` permission **or** `role === 'admin'` |
| **Tenant** | **`:175`** | **`const tenantId = req.user!.tenantId` — taken from the caller's session, not the request body** |
| Email normalisation | `:200` | `email.toLowerCase().trim()` — lowercase is guaranteed |
| Duplicate guard | `:201-207` | tenant-scoped `SELECT`; returns `409` if the email already exists in that tenant |
| Role validation | `:191`, `:11` | `VALID_ROLES` = `admin, manager_ops, manager_ads, team_lead, sales, staff, creative_assistant, viewer`. **`team_lead` is valid.** Omitting `role` silently defaults to `staff` (`:190`) — it must be passed explicitly |
| Insert | `:218-222` | sets `tenant_id, name, email, password_hash, role, token_version=1`; leaves `id` and `is_active` to their DB defaults, which is correct |
| Password | `:210-211`, `:13-17` | auto-generates a 12-char password if none supplied, and stores only the hash |
| Permissions row | `:230-235` | seeds an empty `user_permissions` row so the user appears in list filters |
| Response | `:236-241` | returns the new user **and the plaintext temporary password, once** |

> **Credential hygiene.** The endpoint returns a plaintext temporary password in its response body.
> Per `AGENTS.md`, that value must never be written into any source file, document, screenshot,
> `.ai/` context or handoff log. Share it with Itika over a secure channel; she can rotate it via
> `/auth/forgot-password`.

#### The tenant trap — the single most likely way to get this wrong

Because the endpoint takes the tenant from the **caller's session**, the acting admin must be
logged in **as their `wizmatch`-tenant account**. Login resolves the tenant by slug
(`src/routes/auth.ts:36-43`): an explicit `tenantSlug`/`product` in the body, else an
`x-tenant-slug`/`x-product` header, else a hostname containing `wizmatch` — **otherwise it falls
back to `DEFAULT_TENANT_SLUG`, which is `growth-escalators`** (`src/config/constants.ts:37`).

So an ordinary login, with no slug supplied, yields a `growth-escalators` session — and creating
Itika from that session would put her in the wrong tenant with no error raised, because the
duplicate check at `:201` is tenant-scoped and would find nothing to complain about.

**Therefore: Jatin must authenticate as `427e6b95-68f7-42b6-83b0-ced1799139b2` (tenant
`4b3dd3e2-…`, slug `wizmatch`) before calling the endpoint,** and this must be confirmed before
the call, not after.

Note that login is itself tenant-scoped the same way (`src/routes/auth.ts:71-84` joins `tenants`
and filters on `t.slug`), so Itika will likewise need to sign in on the `wizmatch` surface, not
the default one.

### 3.5 Plan

1. Re-run the case-insensitive duplicate check immediately before creation (§3.6), and abort if it
   returns anything.
2. Confirm the acting session's tenant is `wizmatch` **before** calling the endpoint.
3. `POST /api/permissions/users` with:
   - `email: "itika.khandelwal@growthescalators.com"` (the handler lowercases regardless)
   - `role: "team_lead"` — explicitly, never omitted
   - `name: "Itika Khandelwal"`
   - no `password` — let the endpoint generate one
4. Verify: row exists; `email = lower(email)`; `role = 'team_lead'`; `is_active = true`;
   `tenant_id = 4b3dd3e2-…`; capture the lowercase UUID.
5. Verify login eligibility against the auth conditions
   (`src/routes/auth.ts:83-84, :169-170, :258-259` require `is_active IS NULL OR is_active = true`,
   plus a matching active tenant slug).
6. **Do not** add the UUID to `WIZMATCH_STAFFING_PILOT_USER_IDS` yet.
7. **Do not** modify Jatin or Kanishk, in either tenant.

Case sensitivity is load-bearing twice over: `users` is `UNIQUE (tenant_id, email)` and that
comparison is case-**sensitive**, so a mixed-case row would be a silent duplicate rather than a
rejected one; and `src/services/wizmatchStaffingAccess.ts` matches roster UUIDs with a
case-sensitive `Set.has`.

### 3.6 Read-only SQL

Duplicate / ambiguity check — run first, expect **0 rows**:

```sql
SELECT u.id, u.tenant_id, t.slug, u.email, u.role, u.is_active,
       (u.email = lower(u.email)) AS email_is_lower
FROM users u JOIN tenants t ON t.id = u.tenant_id
WHERE lower(u.email) = 'itika.khandelwal@growthescalators.com'
   OR lower(u.email) LIKE '%itika%';
```

Post-creation verification — expect exactly **1 row**, all flags true:

```sql
SELECT u.id, u.tenant_id, t.slug, u.email, u.role, u.is_active,
       (u.email = lower(u.email))                        AS email_is_lower,
       (u.role = 'team_lead')                            AS role_ok,
       (u.tenant_id = '4b3dd3e2-69e3-4718-95ce-e3ace41779f2') AS tenant_ok,
       (u.password_hash IS NOT NULL)                     AS has_password,
       (u.id = lower(u.id::text)::uuid)                  AS uuid_lower
FROM users u JOIN tenants t ON t.id = u.tenant_id
WHERE lower(u.email) = 'itika.khandelwal@growthescalators.com';
```

Confirm the other two pilots are unchanged — expect the same two UUIDs, both `admin`, both active:

```sql
SELECT id, email, role, is_active FROM users
WHERE tenant_id = '4b3dd3e2-69e3-4718-95ce-e3ace41779f2'
ORDER BY email;
```

> **STOP — approval required.** Nothing in Track B proceeds without exactly:
>
> **`APPROVE_ITIKA_ACCOUNT_PROVISIONING`**

---

## 4. TRACK C — Zero-PII production-sized clone

The clone carries **no production row data**. Production metadata is used only to derive shape
and scale. Names, emails, phone numbers, addresses, notes, message content, credentials and any
personal or commercial row value are never copied.

### 4.1 Cardinality mapping — derived, not assumed

The owner's brief supplied three numbers (2,813 / 4,719 / 15) without a table mapping. Derived
from today's read-only `count(*)`:

| Table | **Exact rows** | Total size | Heap | Indexes |
|---|---|---|---|---|
| `contacts` | **2,813** | 1,515,520 B | 745,472 B | 729,088 B |
| `contact_channels` | **4,719** | 1,638,400 B | 581,632 B | 1,015,808 B |
| `users` | **15** | 65,536 B | 8,192 B | 49,152 B |
| `wizmatch_job_signals` | 6,743 | 7,176,192 B | 4,669,440 B | 2,220,032 B |
| `wizmatch_companies` | 183 | 155,648 B | 24,576 B | 98,304 B |
| `wizmatch_requirements` | 4 | 131,072 B | 8,192 B | 98,304 B |
| `wizmatch_suppression_list` | **0** | 40,960 B | 0 B | 32,768 B |

So: **2,813 = `contacts`, 4,719 = `contact_channels`, 15 = `users`.** These are the three tables
carrying the U-7 shared `(tenant_id, id)` unique indexes at `0037_unknown_siren.sql:215-217`.

Note `contact_channels` `reltuples` was 4,550 against an exact 4,719 — the estimate is stale;
the exact count is authoritative and is what the clone must reproduce.

### 4.2 The complete set of tables `0037` touches

**Creates 8 tables** (all unguarded — no `IF NOT EXISTS`):
`wizmatch_company_duplicates`, `wizmatch_company_policies`, `wizmatch_company_policy_events`,
`wizmatch_outreach_batches`, `wizmatch_outreach_enrolments`, `wizmatch_outreach_events`,
`wizmatch_reply_mailboxes`, `wizmatch_suppression_events`.

**Touches 7 pre-existing tables** — these are the ones whose cardinality and row width must be
reproduced:

| Table | What `0037` does | Line |
|---|---|---|
| `contact_channels` | `CREATE UNIQUE INDEX … (tenant_id,id)` | 215 |
| `contacts` | `CREATE UNIQUE INDEX … (tenant_id,id)` | 216 |
| `users` | `CREATE UNIQUE INDEX … (tenant_id,id)` | 217 |
| `wizmatch_companies` | `ADD COLUMN account_owner_user_id uuid`; unique index; composite FK | 192, 218, 284 |
| `wizmatch_job_signals` | `CREATE UNIQUE INDEX … (tenant_id,id)` | 219 |
| `wizmatch_requirements` | `CREATE UNIQUE INDEX … (tenant_id,id)` | 220 |
| `wizmatch_suppression_list` | `ADD COLUMN contact_channel_id uuid`; `ADD COLUMN channel_invalid boolean DEFAULT false NOT NULL`; composite FK; expression index on `(tenant_id, lower(email))` | 193, 194, 290, 305 |

Both `ADD COLUMN`s are metadata-only in Postgres 11+ (a non-volatile `DEFAULT` no longer rewrites
the table), so neither forces a heap rewrite — but both still take `ACCESS EXCLUSIVE`, held to
commit.

### 4.3 Statistics the synthetic generator must reproduce

From production `pg_stats` (read-only):

| Column | `avg_width` | `null_frac` | `n_distinct` |
|---|---|---|---|
| `contact_channels.channel_value` | 18 | 0 | −0.998 (near-unique) |
| `contact_channels.channel_type` | 7 | 0 | 3 |
| `contact_channels.contact_id` | 16 | 0 | −0.580 |
| `contact_channels.tenant_id` | 16 | 0 | 2 |
| `contacts.tenant_id` | 16 | 0 | 2 |
| `users.email` | 31 | 0 | −0.867 |
| `users.tenant_id` | 16 | 0 | −0.133 |
| `wizmatch_companies.tenant_id` | 16 | 0 | 1 |
| `wizmatch_job_signals.tenant_id` | 16 | 0 | 1 |
| `wizmatch_job_signals.contact_id` | 16 | **0.99985** | −0.00015 |
| all `.id` columns | 16 | 0 | −1 (unique) |

Whole-row widths, for generating realistic heap sizes:

| Table | Σ `avg_width` | Columns | `NOT NULL` w/o default |
|---|---|---|---|
| `contact_channels` | 88 | 9 | 4 |
| `contacts` | 293 | 21 | 2 |
| `users` | 198 | 10 | 4 |
| `wizmatch_companies` | 315 | 20 | 2 |
| `wizmatch_job_signals` | 961 | 25 (23 analysed) | 3 |
| `wizmatch_requirements` | n/a — never analysed | 44 | 2 |
| `wizmatch_suppression_list` | n/a — 0 rows | 8 | 2 |

**Two `tenant_id` values** must exist in `contacts`/`contact_channels`/`users`, matching production's
`n_distinct = 2`; a single-tenant clone would give the `(tenant_id, id)` indexes an unrepresentative
key distribution.

Other environment facts the clone must match: **only the `plpgsql` extension is installed** — so no
extension provisioning is needed; and **there are zero triggers on all seven touched tables**, so
synthetic inserts fire nothing.

`pg_stats` has **no rows at all** for `wizmatch_requirements` and `wizmatch_suppression_list`
(never analysed / empty). Reproducing 4 rows and 0 rows respectively is sufficient and faithful.

### 4.4 Freeze requirement

During any production schema export or metadata capture that holds `ACCESS SHARE`, deployments
must be frozen. Verified read-only today: **only `web` has a repo trigger**
(`Growth-Escalators/Growth-Escalators-CRM @ main`); `Postgres` has none. The freeze is therefore
achievable without touching deployment configuration, and consists of:

- no merge to `main`;
- no manual Railway redeploy of `web`;
- no variable change on `web` (a variable change triggers a redeploy);
- no `railway up`.

The running production application may keep serving traffic throughout.

### 4.5 CLONE GATE 1 — create the empty service

**Plan:**

| Item | Value |
|---|---|
| Service name | `wizmatch-g1-locktest-<UTC timestamp>` (e.g. `wizmatch-g1-locktest-20260728T1400Z`) |
| Image | `ghcr.io/railwayapp-templates/postgres-ssl:18` — matches production's major version (server reports 18.3) |
| Project / environment | `GE-Backend-Server` / `production` (volume backups and services are project+environment scoped) |
| Volume | 500 MB, matching production's allocation |
| References | none — no `web`, `worker`, or cron service may reference it; no reference variable pointing at it |
| Owner | Jatin Agrawal |
| Expiry | destroy same day, at Gate 3 |
| Checkpointing | **none** — no Railway sandbox checkpoint, no durable image |
| Cleanup rule | per `docs/build/WIZMATCH_DATA_SAFETY.md`: synthetic rows carry the prefix `E2E_WIZMATCH_G1_<timestamp>`, and teardown deletes the whole service and volume |
| Expected cost | negligible — a ~190 MB volume and one small container for a few hours |

**After approval:** create only the empty service; read back its identity; verify production is
untouched; verify nothing references it; **stop before loading schema or data.**

> **STOP — approval required:** **`APPROVE_G1_CLONE_CREATE`**

### 4.6 CLONE GATE 2 — load schema and synthetic scale

**Why a production schema-only dump, rather than replaying repo migrations.** Replaying
`0000..0036` locally does **not** reproduce production. Three known divergences:

1. Migrations `0008`, `0013` and `0014` were **permanently skipped** in production by Drizzle's
   timestamp-only pending rule and will never apply.
2. The repo's runtime `ensure*` pattern adds columns no migration contains — e.g.
   `src/routes/permissions.ts` runs
   `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true`, and
   `is_test_account` originates from `scripts/meta-app-review/seed-reviewer-user.ts`. Both columns
   are present in production `users` and in no migration.
3. The production journal holds 35 rows against 37 file entries, including one orphan.

A `pg_dump --schema-only` of production is therefore the only faithful reproduction of the
pre-`0037` schema.

**Secret-safe transport — no dump or credential passes through the workstation.**
Set a Railway **reference variable** on the *disposable* service only:
`SRC_DATABASE_URL = ${{Postgres.DATABASE_URL}}`. Railway resolves it inside the container; the
value is never rendered to the operator. Then, from inside the clone container:

```
pg_dump "$SRC_DATABASE_URL" --schema-only --no-owner --no-privileges | psql "$DATABASE_URL"
```

This sets no variable on any production service. **Immediately after the schema loads, remove
`SRC_DATABASE_URL` from the disposable service** so it holds no production reachability while
synthetic data is generated. The dump is schema-only and carries no rows.

**Then:**
- Generate synthetic rows to the exact cardinalities in §4.1, honouring the widths, null fractions
  and distinct counts in §4.3, and the two-tenant distribution.
- Reproduce the journal state so Drizzle sees exactly `0037` as pending — 35 rows with
  `max(created_at) = 1784464092263`. This comes across in the schema-only dump's
  `drizzle.__drizzle_migrations` table structure and must then be populated to match.
- Verify counts and approximate relation/index sizes against §4.1.
- **Privacy proof:** assert zero production row content — no row in the clone matches any
  production email, name, phone, domain or free-text value; every synthetic row carries the
  `E2E_WIZMATCH_G1_` prefix where a text column allows it.
- Record counts alongside every timing.

> **STOP — approval required:** **`APPROVE_G1_CLONE_LOAD_SYNTHETIC`**

### 4.7 Clone migration and lock test

Once the synthetic clone is ready, four **clone-only** agents run in parallel. None of them may
touch production.

**C1 — scale parity.** Schema parity against production; table cardinalities; average row widths;
table sizes; index sizes; migration journal; overall representativeness verdict.

**C2 — migration execution.** Apply **only** `0037` to the disposable clone. Record: the exact
reviewed migration hash
(`sha256 = 76729b609e2981f272a18f26ce032fee1978f3f0b3cc60ba53ab57c1c5937db5`); start and end in UTC;
total duration; each shared-index duration; constraint/trigger duration; the journal result; and
the resulting pending-migration state.

**C3 — locks and representative traffic.** Thresholds are fixed **now, before measuring**:

| Metric | Pass | Fail |
|---|---|---|
| Total migration transaction duration | ≤ 5,000 ms | > 5,000 ms |
| Longest single statement | ≤ 1,000 ms | > 1,000 ms |
| Max write-lock wait on `users` / `contacts` / `contact_channels` | ≤ 500 ms | > 500 ms |
| Blocked reads | **0** | any |
| p99 representative write latency during the migration | ≤ 1,000 ms | > 1,000 ms |
| `lock_timeout` errors at `lock_timeout = 2s` | **0** | any |
| Deadlocks | **0** | any |

Rationale for the 500 ms write-stall line: below it the stall is invisible to a user; approaching
2 s it starts tripping request timeouts and the healthcheck.

Measure lock types, lock wait time, blocked reads, blocked writes, transaction latency, and
application-style representative writes against synthetic records, with specific attention to
`users`, `contacts` and `contact_channels`.

**If any threshold is crossed:** G1 stays NO-GO; prepare a separately reviewed
`CREATE INDEX CONCURRENTLY` plan; do not casually rewrite `0037`; do not apply it to production.

**C4 — post-migration validation.** Verify: the journal proves `0037` applied; all 8 new tables;
every new schema-wide relation and index name; the three shared U-7 indexes; the `scope_type`
`CHECK`; the composite tenant foreign keys; the suppression expression index at line 305; the
policy-immutability function and trigger (lines 333–372); no unexplained drift; no migration
`0038`; and that no backfill occurred.

**Wait for all four reports. Do not form a verdict while any agent is pending.**

### 4.8 CLONE GATE 3 — destroy

Checklist before deletion: confirm the exact disposable service name and ID; confirm no
application references it; confirm all evidence is recorded in this repo; confirm it is **not**
production (`0c31ec38-…`) and not another team's sandbox; then delete its volume and service;
then verify deletion.

> **STOP — approval required:** **`APPROVE_G1_CLONE_DESTROY`**

---

## 5. Production evidence captured for this plan (read-only, 2026-07-28)

- `server_version` = `18.3 (Debian 18.3-1.pgdg13+1)`; database `railway`.
- Journal: **35 rows**, `max(created_at)` = `1784464092263`.
- `0037` still unapplied — **0 of 8** new tables present, **0 of 6** `%_tenant_id_id_uniq`
  indexes present.
- Cardinalities, sizes, per-index sizes, `pg_stats` widths/null fractions/distinct counts:
  §4.1 and §4.3.
- Extensions: `plpgsql 1.0` only.
- Triggers on the seven touched tables: **0**.
- `archive_mode=off`, `wal_level=replica`, `archive_timeout=0`, no `WAL_ARCHIVE_*` vars.
- Backup schedules: `[]`. Backups: `[]`.
- Tenants: `wizmatch 4b3dd3e2-…`, `growth-escalators 3ff1e516-…`, `city-clinic 01e7e5b7-…`.
- `WIZMATCH_TENANT_ID` is set and equals the `wizmatch` tenant (boolean comparison; value not printed).
- Roster: 2 entries, both wizmatch-tenant UUIDs, all lowercase, `deck-sync` excluded.
- Itika: **absent** — 0 case-insensitive matches across all tenants.
- Repo triggers: only `web` ← `main`. `Postgres` has none.

All sessions ran read-only and were rolled back before disconnect. No secret value was printed at
any point; environment variables were tested for presence or equality only.

---

## 6. Approval tokens, in order

| # | Token | Unblocks |
|---|---|---|
| 1 | `APPROVE_PRODUCTION_BACKUP_ENABLE` | Track A — manual backup, schedule, PITR |
| 2 | `APPROVE_ITIKA_ACCOUNT_PROVISIONING` | Track B — create and verify one account |
| 3 | `APPROVE_G1_CLONE_CREATE` | Gate 1 — empty disposable service only |
| 4 | `APPROVE_G1_CLONE_LOAD_SYNTHETIC` | Gate 2 — schema + synthetic rows |
| 5 | `APPROVE_G1_CLONE_DESTROY` | Gate 3 — teardown |
| 6 | `APPROVE_G1_MIGRATION_0037` | **Only** once every G1 condition passes |

Tracks A and B are independent of each other and of Track C, and may be approved in any order or
in parallel. Gates 3–5 are strictly sequential.

`APPROVE_G1_MIGRATION_0037` will not be requested until: a successful restorable production backup
exists and its restore procedure is verified; Itika's lowercase account exists, active, `team_lead`,
in the `wizmatch` tenant; Jatin and Kanishk remain correct; the three exact lowercase UUIDs are
known; synthetic clone scale parity passes; `0037` succeeds on the clone; every lock threshold in
§4.7 passes; the U-7 conditional approval becomes effective; the namespace-collision query remains
clean; journal reconciliation is complete; the production migration mechanism is verified; and the
migrate-before-deploy ordering in §1 is documented.
