# WizMatch pilot — LIVE STATUS (FINAL)

**Date:** 2026-07-29 (UTC) · **Authority:** independent Opus review, completed

---

## Declaration

> # PILOT READY FOR LIMITED INTERNAL USE — TWO USERS
> # EXPLICIT CONFIG REDEPLOY PENDING

**No Critical or High finding blocks the pilot.** Three independent read-only review lanes
(Git/CI, database, runtime) were reconciled, and the lead independently re-inspected the most
critical evidence rather than accepting any lane's conclusion on its own. Four subordinate
claims were rejected on the evidence and one correction accepted; the detail is in
[`WIZMATCH_G3_SMOKE_TEST_RESULT_FINAL.md`](WIZMATCH_G3_SMOKE_TEST_RESULT_FINAL.md).

**No secret value appears in this document.**

---

## 1. Verified production state

| Item | Verified state |
|---|---|
| **Migration `0037`** | Applied **exactly once**, **hash-verified** — production journal hash `76729b60…5937db5` equals local `sha256(0037_unknown_siren.sql)`; `0035`/`0036` also match. No `0038` exists. |
| **Backfill** | Applied (`INSERT 0 183`), **idempotent** (a re-run inserts 0), **tenant-safe** (0 non-WizMatch rows). |
| **Root policy rows** | **183** active WizMatch root-policy rows — exactly one per company. |
| **Missing roots** | **0** |
| **Duplicates** | **0** companies with more than one active root policy. |
| **Default eligibility** | **All `needs_review`** — 0 rows deviate. Missing context never becomes `allow`. |
| **PostgreSQL** | **18.3** |
| **Backup** | Encrypted logical `pg_dump` (AES-256-CBC, PBKDF2-SHA256, 600 000 iterations), **restore-tested** into a disposable PostgreSQL 18 with all counts matching production. Archive is `chmod 600`, untracked, and ignored. |
| **Railway managed backup / PITR** | **Unavailable** — abandoned as an accepted operational limitation (plan and cost constraints). |
| **Recovery point** | `2026-07-28T05:59:17Z`, retained as already documented (≥ 7 days after stable rollout). Changes after this point would be lost in a full logical restore. |
| **Human pilot users** | **Two**, both `admin`, both `is_active`, both in the WizMatch tenant. |
| **Itika** | **Deferred** — no production account in any tenant (owner decision). |
| **Machine principal** | `deck-sync` (`role='viewer'`) — outside the human roster, admitted only by the 8-path GET allow-list lane. |
| **Dangerous capabilities** | **Disabled** — sending, automated email, preparation, provider-backed outreach, paid discovery, Google fallback. Enforcement is `shadow`. |
| **Active deployment** | `21f4d381-e7af-4ab5-b81e-6548a57099b2` — SUCCESS, commit `4a8d103a…`, deployed 2026-07-28 15:57:17 UTC. |

---

## 2. Configuration — three distinct categories

These are **not** interchangeable. `list_variables` reports *staged service configuration*;
`railway ssh` + `printenv` reports what the **running process** actually has. They currently
disagree, and conflating them was the single most-contested claim of the review.

### A. Explicit in the currently running deployment

Verified in-container on `21f4d381`:

```
NODE_ENV=production
WIZMATCH_SENDING_ENABLED=false
WIZMATCH_STAFFING_PILOT_ALL_USERS=false
WIZMATCH_STAFFING_PILOT_USER_IDS=<exactly the two roster UUIDs>
WIZMATCH_COMPANY_POLICY_ENABLED=true
WIZMATCH_DECISION_WORKBENCH_ENABLED=true
```

### B. Effective through reviewed safe code defaults — **absent** from the running process

These four variables are **not present** in deployment `21f4d381`'s environment. Their safe
values are produced by reviewed fail-safe code defaults, not by configuration:

| Variable | Effective value | Source of that value |
|---|---|---|
| `WIZMATCH_POLICY_ENFORCEMENT_MODE` | `shadow` | `outreachGate.ts:181` — `=== 'enforce' ? 'enforce' : 'shadow'` |
| `AUTOMATED_EMAILS_ENABLED` | `false` | `multiDomainMailer.ts:54,158` (throws) and `emailService.ts:140` — two independent points |
| `WIZMATCH_AUTO_PREP_ENABLED` | `false` | `wizmatchAutomation.ts:16-19` allow-list `['1','true','yes','on']` |
| `WIZMATCH_OUTREACH_ADAPTER_ENABLED` | `false` | same allow-list; the real block is `providers/index.ts` — `KNOWN_PROVIDERS = ['mock']` |

Every gate uses the fail-closed `=== 'true'` / allow-list idiom, never the fail-open
`!== 'false'`.

### C. Staged in Railway, pending a successful redeploy

The **same four names**, staged with values `shadow` / `false` / `false` / `false`. They have
**not** been applied to the running deployment, because both redeploy attempts
(`50ce0ec6` FAILED, `6510b15e` REMOVED) failed on the Railway builder.

**The pending redeploy is behaviourally inert.** Confirmed empirically: the readiness CLI
returns an identical PASS against both the *effective* running environment and the
*post-redeploy* environment. Applying the staged values makes explicit what is already true;
it does not change behaviour.

---

## 3. Non-blocking follow-ups

None of these gates the pilot. All five are recorded for action.

1. **Explicit Railway configuration redeploy after builder recovery.** Apply the four staged
   variables (category C) once the Railway builder is healthy, so the safe values are explicit
   in configuration rather than only implicit in code defaults. Verify afterwards with
   `railway ssh` + `printenv` against the **new** deployment id — not with `list_variables`.
2. **`railway.json` versus Railway service configuration drift.** The repository declares
   NIXPACKS and a start command of `node dist/scripts/migrate.js && node dist/index.js`. The
   live service uses **RAILPACK** and `node dist/index.js`. **Consequence: deployment
   migrations are currently not automatic.** Any future migration must be applied
   deliberately; do not assume a deploy will run it. (This is also the strongest proof that a
   redeploy cannot reapply `0037`.)
3. **Edge-drainer Redis error.** `[edge-drainer] loop error` repeats roughly every five
   seconds on the active deployment with an empty message body. Cause not established;
   unrelated to the WizMatch pilot surface.
4. **Verify TheirStack after its next scheduled execution.** The cron is `'35 1 * * 1,4'`
   (`src/worker.ts:1710`) — next run **Thursday 2026-07-30 at 01:35 UTC**. **No claim is made
   that TheirStack is healthy**; post-deployment execution is not yet verifiable.
5. **`input-data/` is ignored only through the shared local git exclude**
   (`.git/info/exclude`), which is **not** carried by a fresh clone. Protect it in a
   fresh-clone-safe way — without committing any production data or the backup archive
   itself.

---

## 4. Operator traps worth remembering

- **Railway log queries default to the latest deployment**, which is the REMOVED `6510b15e`,
  not the active one. Unpinned queries return "No Deploy logs found" and read as an outage.
  Always pin `deployment_id=21f4d381-e7af-4ab5-b81e-6548a57099b2`.
- **`https://ecom.growthescalators.com/health` is a false-green oracle** — it returns Vercel
  SPA HTML with HTTP 200 and is not the API. Use the real API health endpoint on `api.` /
  `crm.`.
- **`list_variables` shows staged config, not running config.** Only `railway ssh` +
  `printenv` tells you what the process actually has.
- **Always read UUIDs from the database, never hand-type them** — a homoglyph in a hand-typed
  UUID previously produced a false foreign-key failure.

---

## 5. Rollback

Flip the offending `WIZMATCH_*_ENABLED` variable to `false` (this triggers a redeploy). If
schema or data repair becomes necessary, the recovery point is the encrypted logical backup at
`2026-07-28T05:59:17Z`; **a full restore is a separate, explicit owner decision**, and changes
after that timestamp would be lost.

---

## 6. What this review changed in production

**Nothing.** No variable, no user, no role, no roster, no deployment, no migration, no
backfill, no restore, no send, no synthetic record. The review was read-only throughout.
