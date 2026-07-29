# WizMatch pilot team onboarding — FINAL

**Date:** 2026-07-29 (UTC) · **Scope:** the two-user internal pilot
**Status:** approved and live for limited internal use

**No password, password hash, token, API key or personal datum beyond the two approved work
email addresses appears in this document.** The two UUIDs below are already recorded in this
repository's existing go-live runbook and are safe to reference here; they were read from the
production database, never hand-typed.

---

## 1. Approved initial users

Exactly **two** humans. Both hold the `admin` role, both are active, and both sit in the
WizMatch tenant (`4b3dd3e2-…`).

| User | Role | Production UUID (WizMatch tenant) | Active |
|---|---|---|---|
| `jatin@growthescalators.com` | `admin` | `427e6b95-68f7-42b6-83b0-ced1799139b2` | ✅ `is_active = true` |
| `kanishk.khandelwal@growthescalators.com` | `admin` | `115f2251-cf72-417e-bdbb-b63cd23415b3` | ✅ `is_active = true` |

`WIZMATCH_STAFFING_PILOT_USER_IDS` in the running deployment contains **exactly these two
UUIDs and nothing else**, verified by set membership against values read from the production
database.

> **Note — two tenants.** Both people also hold an account in the `growth-escalators` tenant.
> The pilot roster correctly contains only the **wizmatch**-tenant UUIDs. When performing any
> admin action for WizMatch, be logged in on the **`wizmatch`** slug, or the action silently
> targets the wrong tenant.

### Deferred and excluded principals

- **Itika (`itika.khandelwal@growthescalators.com`) — DEFERRED.** She has **no production
  account in any tenant** (0 case-insensitive matches). This is an owner decision, not an
  oversight. Onboarding her is a post-launch action requiring explicit approval; the path is
  `POST /api/permissions/users` (`src/routes/permissions.ts:173`), which takes the tenant
  **from the caller's session**, so the acting admin must be logged in on the `wizmatch` slug.
- **`deck-sync` (`role='viewer'`, `acdab2ee-7e02-4e7d-b2c1-4bcabd4f2579`) — EXCLUDED from the
  human roster.** This is the read-only Command Deck machine principal. It is admitted only
  by the narrow machine-sync lane (`src/middleware/wizmatchMachineSyncLane.ts`): `GET` only,
  authenticated, non-empty `tenantId` and `id`, role **exactly** `viewer`, and `req.path`
  **exactly equal** to one of eight frozen paths. Everything else falls through to the
  ordinary pilot gate and is refused. `viewer` is **not** pilot-eligible and must not be added
  to the roster.

---

## 2. Allowed usage

The pilot is a **decision and review** pilot. Everything below is enabled and safe to use:

- **Dashboards** — the WizMatch dashboard and command centre.
- **Queues** — candidate-intelligence queue, client-discovery queue.
- **Candidate and company reviews** — reading and reviewing records in the review workbench.
- **Company Policy** (`WIZMATCH_COMPANY_POLICY_ENABLED=true`) — setting and superseding
  company outreach policy.
- **Decision Workbench** (`WIZMATCH_DECISION_WORKBENCH_ENABLED=true`) — making and recording
  decisions.
- **Internal assignments** — routing and account-owner assignment.
- **Internal approvals** — approving queue items internally.

All 183 WizMatch companies currently carry a root policy of `outreach_eligibility =
'needs_review'`. That is the intended cold-start state: **missing context never becomes
`allow`.** Expect to review, not to be handed pre-approved targets.

---

## 3. Prohibited usage

Do **not** attempt, enable, or request any of the following during the pilot. Each is
currently blocked in code as well as by configuration — the list is the operating rule, not a
description of what would merely be unwise.

- ❌ **Sending** of any kind (`WIZMATCH_SENDING_ENABLED=false`).
- ❌ **Automated email** — blocked at two independent points; a call throws rather than sends.
- ❌ **Sequence enrolment.**
- ❌ **Automatic preparation** (`WIZMATCH_AUTO_PREP_ENABLED` off).
- ❌ **Smartlead** — do not connect it; no Smartlead credential exists in production.
- ❌ **Provider-backed outreach** — only the `mock` provider is constructible; anything else
  throws `unknown_provider`.
- ❌ **Paid discovery.**
- ❌ **Google fallback.**
- ❌ **Enforcement beyond `shadow`** — do not promote `WIZMATCH_POLICY_ENFORCEMENT_MODE` to
  `enforce`.

**Also prohibited without explicit owner approval:** changing any Railway variable, changing
user accounts, roles or the pilot roster, triggering a redeploy, rerunning migration `0037`,
rerunning the production backfill, or restoring the database.

---

## 4. What the two operators still need to verify by hand

The independent review completed every check that could be made read-only. Five behavioural
checks require a **logged-in session** and were therefore deliberately not performed — no
plaintext password was requested or used. **These are yours to run**, using synthetic
identifiers only (`WizMatch Opus Pilot Test Company`, `Opus Pilot Test Record`, an
`@example.invalid` address) and never a real candidate, prospect, client or email address:

1. A **non-pilot** user is denied access to the WizMatch surface.
2. Each of the two pilot users **can** access the surface.
3. An **unknown scope** fails closed (is refused, not permitted).
4. A **company or signal block** is honoured in the workbench.
5. A **cross-tenant** request is denied.

Delete or archive any synthetic record you create. Do not test an actual send.

---

## 5. Getting oriented

- Live status and verified production state:
  [`WIZMATCH_PILOT_LIVE_STATUS_FINAL.md`](WIZMATCH_PILOT_LIVE_STATUS_FINAL.md)
- Independent verification evidence:
  [`WIZMATCH_G3_SMOKE_TEST_RESULT_FINAL.md`](WIZMATCH_G3_SMOKE_TEST_RESULT_FINAL.md)
- Deployment plan and rollback:
  [`WIZMATCH_G3_DEPLOYMENT_PLAN_FINAL.md`](WIZMATCH_G3_DEPLOYMENT_PLAN_FINAL.md)

**If something looks wrong:** the rollback is to flip the offending `WIZMATCH_*_ENABLED`
variable to `false`. A database restore is a separate, explicit owner decision — the recovery
point is `2026-07-28T05:59:17Z` and any change after it would be lost.
