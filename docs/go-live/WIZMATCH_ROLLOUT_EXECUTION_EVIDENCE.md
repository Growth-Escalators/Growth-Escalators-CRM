# WizMatch Outbound OS — MAIN rollout execution evidence

**Branch:** `ge/outbound-08b-g3-pilot-completion` · **PR:** #89 (draft, base `main`)
**Reviewed app code:** `0d330269` (unchanged throughout — all later commits are docs/context)
**Execution date:** 2026-07-28 (UTC)
**No secret value is printed anywhere in this document.** All hashes below are of
non-secret artifacts (migration SQL, encrypted archive) or are boolean presence checks.

This document records the executed Phase A–H work and the Phase I (G3) plan. It is the
companion to `WIZMATCH_G1_RUNTIME_READONLY_EVIDENCE.md` (which holds the prior read-only
production evidence).

---

## Owner decisions that reshaped the plan (2026-07-28)

1. **Railway managed backup/PITR abandoned** as an accepted operational limitation
   (plan + cost). Replaced by a one-time **encrypted logical `pg_dump`** (Phase A–D).
2. **Itika deferred.** Initial pilot roster = exactly two humans (Jatin, Kanishk, both
   `admin`). No Itika, no `viewer`, no machine principal in the human roster.
3. **G1 clone = the restored local PostgreSQL 18 DB** (no paid Railway clone).

Accepted limitations (must be restated at declaration):
- No Railway managed backup/PITR. Rollback recovery point = the dump timestamp
  `2026-07-28T05:59:17Z`. Post-dump changes could be lost if a full logical restore
  becomes necessary. Encrypted backup retained ≥ 7 days after stable rollout.
- Itika deferred to a post-launch onboarding action.

---

## Phase A — local capability check (PASS)

| Check | Result |
|---|---|
| macOS FileVault | **On** |
| Free disk | 149 GB |
| Railway CLI / auth | v5.29.0, logged in as Jatin@growthescalators.com |
| Local pg tools | PostgreSQL **16.13** (Homebrew) — too old for prod 18.3 |
| Installed for PG18 tooling | Homebrew `postgresql@18` (18.4) from `homebrew/core` (trusted) — gives `pg_dump`/`pg_restore`/`initdb` 18.4 |
| Docker | installed but daemon down → used local PG18 instead |
| Keychain | available |
| `input-data/` | gitignored (`.git/info/exclude`) + untracked |
| Prod health / 0037 unapplied / PR draft | all confirmed |

Dump host decision: the **`Postgres` service** (not `web`) — it allows SSH, carries
`pg_dump 18.3` (exact server match), and has `DATABASE_URL` in-container (the URL never
reaches the local shell). `web` has **no** `pg_dump`/`psql`. `railway ssh` does **not**
allocate a PTY for commands (`tty` → `not a tty`), so raw binary streaming is safe.

## Phase B — encrypted logical backup (PASS)

Dump streamed from inside the `Postgres` container to local, no PTY, fail-on-non-zero:

- `pg_dump --format=custom --no-owner --no-acl --verbose "$DATABASE_URL"` inside container.
- Duration ~8 s. Archive **3,424,933 bytes**, magic `PGDMP`, zero restore warnings.
- `pg_restore --list` (PG18) → 1064 entries.
- **Plaintext archive SHA-256:** `d07474f8116c376c6ef596657f711a7af36dcb0cee76e419a1a768f2a6e79cf0`
- Freeze held throughout (no merge / web-redeploy / var-change / `railway up`).

## Phase C — encryption (PASS)

- Cipher: AES-256-CBC, PBKDF2 (600 000 iterations), salted. Passphrase = 256-bit random,
  stored in macOS Keychain (`wizmatch-g1-backup-20260728T055917Z`); never printed, never
  in args/history (fed via stdin).
- Round-trip decrypt verified (decrypted SHA-256 == plaintext SHA-256).
- Keychain retrieve-without-print verified by equality check.
- **Encrypted archive SHA-256:** `5c2c38a5b43ad25bda9c2ae35e803bf139eb2191f3d1029180b6229f7356d0c6`
- Plaintext dump shredded (`rm -P`); no `.dump` remains.
- Manifest at `input-data/g1-backups/wizmatch-prod-20260728T055917Z.manifest.json` (chmod 600).
- Authentication note: CBC is not AEAD; integrity is provided by the retained SHA-256
  digests of both plaintext and ciphertext (the allowed fallback).

## Phase D — restore test into disposable local PG18 (PASS)

Disposable PG18 cluster, localhost-only, short socket dir, no production write.

- `pg_restore --no-owner --no-acl --exit-on-error` → rc 0, no errors.
- Restored counts match production metadata **exactly**: journal 35 (head `1784464092263` =
  0036); `wizmatch_company_policies` absent; 0 `_tenant_id_id_uniq` indexes;
  contacts 2813 · contact_channels 4719 · users 15 · wizmatch_job_signals 6743 ·
  wizmatch_companies 183 · wizmatch_requirements 4 · wizmatch_suppression_list 0.
- Collision probe: 0 of 0037's 8 new tables present (clean pre-0037).

## Phase E — clone migration + lock test (PASS)

Fixed thresholds recorded *before* measuring (`input-data/g1-backups/phase-e-thresholds.txt`).
Applied 0037 to the clone in a single transaction (replicating drizzle), lock-monitored
with concurrent representative reads; `log_lock_waits=on`, `deadlock_timeout=200ms`,
`log_min_duration_statement=0`.

- **0037 file SHA-256 == reviewed hash** `76729b609e2981f272a18f26ce032fee1978f3f0b3cc60ba53ab57c1c5937db5`.
- drizzle journal hash method confirmed = raw file SHA-256 (0036 file sha == its journal row).
- Migration rc 0, **total 107 ms**; longest statement **6.364 ms**; **max lock-wait 0 ms**;
  **0 blocked reads**; 0 lock-wait log lines; 0 deadlocks.
- Journal row inserted (hash = file sha, created_at epoch ms). Journal now 36, newest hash = 0037.
- Schema verified: 8/8 new tables; **3/3 U-7 shared indexes** (`users`/`contacts`/
  `contact_channels` `_tenant_id_id_uniq`) + 6 more; scope_type CHECK (12 CHECKs);
  suppression `(tenant_id, lower(email))` expression index; composite tenant FKs
  (`actor`/`company`/`requirement`/`signal` all `(tenant_id, x)→ref(tenant_id,id)`);
  immutability trigger `wizmatch_company_policies_immutability_trg` + function;
  `active_scope` partial unique index; suppression_list columns `channel_invalid`,
  `contact_channel_id`; no `0038`.
- Write-path test (DB-sourced UUIDs — never hand-typed): `INSERT` succeeds; decision-column
  `UPDATE` **rejected by the immutability trigger** ("…immutable except
  superseded_at/superseded_by_policy_id"); supersession `UPDATE` allowed; cleanup OK.
  (A hand-typed UUID homoglyph earlier produced a false FK failure — confirmed to be the
  literal, not the data/migration; lesson: always read UUIDs from the DB.)

## Phase F — G1 verdict: **GO**

All G1 conditions met (backup, restore, clone migration, journal, locks, U-7 measured
trivial, mechanism proven, migrate-before-deploy mandatory). Documented limitation: no
Railway PITR; recovery point = dump timestamp.

## Phase G — production migration 0037 (APPLIED + VERIFIED)

Preconditions reconfirmed (backup round-trip OK, Keychain OK, journal 35 / no 0037,
hash == reviewed, all services SUCCESS). Applied the **exact reviewed SQL** + drizzle
journal row in a **single transaction** via the `Postgres` container's psql
(`DATABASE_URL` stayed in-container; `ON_ERROR_STOP=1`; no app deploy).

- rc 0, ~4.9 s (incl. SSH), zero errors/rollbacks. Journal row `INSERT 0 1`.
- Verified via journal + schema (not exit code): journal **36**, newest hash ==
  `76729b60…`; `0037_applied_to_journal`; 8/8 tables; 3/3 U-7 indexes; scope_type CHECK;
  immutability trigger; `wizmatch_company_policies` row_count 0 (pre-backfill) → the ATS
  and TheirStack crons no longer face a missing-table hazard.
- All prod services SUCCESS; `web` still at `1e748125` (no app deploy — migrate-before-
  deploy ordering preserved).

## Phase H — G2 backfill (APPLIED + VERIFIED)

Dry-run-first. Two read-only dry runs both returned `missing_root=183` (deterministic),
0 companies with >1 active root, 0 non-WizMatch policies. The backfill writes
`outreach_eligibility='needs_review'` (never `allow`) — missing context never becomes allow.

- Applied as a single atomic `INSERT … SELECT … ON CONFLICT (tenant_id, company_id,
  scope_key) WHERE superseded_at IS NULL DO NOTHING`, tenant scoped by subquery
  `(SELECT id FROM tenants WHERE slug='wizmatch')` (no hand-typed UUIDs).
- `INSERT 0 183`. Verified: `missing_after=0` (**idempotent**); `active_root_policies=183`
  (one per company); 0 companies with >1 active root; 0 non-WizMatch policies
  (**tenant-safe**); 0 rows deviating from `needs_review`/`policy_unknown_cold_start`/
  `deterministic_rule`. No provider, sending, or preparation action occurred.
