# CURRENT_TASK.md

## Active task

**MULTI-TENANT SEO PLATFORM — PHASES 1–3 BUILT LOCALLY, NOTHING PUSHED (2026-08-05).**

Branch `fix/wizmatch-scoring-pipeline`, local only. Plan:
`~/.claude/plans/can-you-check-the-atomic-cascade.md`. Turning the single-property SEO learning loop
into a multi-tenant, multi-platform service an agency can be sold as a per-site add-on.

- **Phase 1** (`e0c0f248`) — tenant leaks closed, SEO gated behind `requireTenantFeature('seo')`,
  adapter contract + cost-guard groundwork. Migration `0045`.
- **Phase 2** (`0f8b4d55`) — `seo_sites` registry, nine hardcoded client-domain arrays deleted, and
  **the C2 blocker fixed**: every SEO cron now sweeps per tenant, so enabling the add-on for a second
  agency no longer kills every SEO cron for every tenant including GE's own. Migrations `0046`/`0047`.
- **Phase 3** (`7fc5e72c`, `035b96a5`, `f06c6557`) — `SiteAdapter` implementations for git/WordPress/
  Shopify, `site_changes` + `seo_site_snapshots` (migration `0048`), and `siteChangeService.ts`.
- **Phase 4** (`95b10e7e`) — `/api/seo-changes` + the approvals UI, `seo_api_usage` (migration
  `0049`), the per-tenant Serper cost guard wired into the four real spend sites, WordPress/Shopify
  credential entry in the admin, and `src/utils/redactSecrets.ts`.

**The invariant that governs everything from here:** nothing publishes to a client's live website
without a recorded human approval. Three independent enforcement layers (DB CHECK, service-level
assertion on the sole caller of `publishChange`, per-adapter re-check). Do not add a second caller of
`provider.publishChange()` — a test fails if you do. Do not weaken
`assertSiteChangeApproved`'s "status must be exactly `approved`".

**Gates as of Phase 3:** build exit 0 · admin build exit 0 · `npm test` 2865 passing with the 7-file /
21-failure pre-existing env-dependent baseline (see memory `project_local_test_env_failures`) ·
`lint:tenant-scoping` zero new findings.

**Blocked / owner-gated, unchanged:**
- **Credential rotation** (Priority-1, checklist at `feat+contracts-esign/SECRETS-ROTATION.md`) —
  the WordPress adapter is written but must not be enabled, and the legacy
  `programmaticSeoService.publishToWordPress()` must not be retired, until this lands.
- **Push/merge** — nothing pushed. This repo auto-deploys on push to `main`.
- **The 3-client SEO data purge** — still gated on restore-testing a backup first.
- `SITE_ADAPTER_ENABLED` defaults false and must stay false in production until Phase 4's approval UI
  exists — there is currently no way for a human to approve anything through a UI.

- **Phase 5** (`b7aaa9b0`, `26a8d434`, `44f2a015`, `74e320df`) — drift sweep + classifier, GSC and GA4
  pulls as separate importable per-tenant services writing to Postgres, cost caps actually enforced.
- **Phase 6** (`53e0230b`) — n8n retired (including two LIVE ungated fetches to the dead host),
  workflows archived, docs rewritten, and all 65 live crons made observable.

**All six phases are complete.** What remains is owner-gated only — see
[`docs/go-live/OWNER_ACTION_LIST.md`](../docs/go-live/OWNER_ACTION_LIST.md): backups, the branch
push, the credential rotation, and the retired-client purge (gated on a restore-tested backup).

**Known gaps, stated rather than hidden:**
- GA4 calls are not counted by the cost guard — `SeoCostGuardEstimatedCalls` has no `ga4Calls`
  field, and reusing `gscCalls` would corrupt the real GSC cap counter.
- The drift sweep's third URL source (top GSC URLs by impressions) is not implemented — no per-URL
  GSC table exists and inventing one was correctly refused.
- `hot_lead_alert` jobs have had **no consumer since n8n died** — `bookingService.ts` still creates
  one per hot lead and nothing drains them. Pre-existing, documented in `jobDrainer.ts`, out of
  scope for this work, but real.
- `.claude/agents/seo-debugger.md` still describes the retired n8n system.

**Credential correction, verified against `origin/main`:** the `tenant_integrations` store, its
route and `credentialEncryption` are all on `main` today. What is missing there is a *consumer* —
`programmaticSeoService.publishToWordPress()` is still the only reader of WordPress credentials and
it reads `process.env`. So the WordPress remediation is: rotate the application password and
**update** the `WP_AGEDDENTISTRY_*` Railway vars. Deleting them silently stops WordPress publishing
until this branch ships.

---

## Prior entry — TWO-USER PILOT OPERATIONALLY READY (superseded above)

**TWO-USER PILOT OPERATIONALLY READY (2026-07-29) — independently verified.**

> **PILOT READY FOR LIMITED INTERNAL USE — TWO USERS · EXPLICIT CONFIG REDEPLOY PENDING**

PR #89 is **merged** (`4a8d103a`, head `b35e16c4`); active deployment
`21f4d381-e7af-4ab5-b81e-6548a57099b2` is SUCCESS on that commit. An independent Opus review
treated the prior session's reports as claims to verify, not evidence to trust: three read-only
lanes (Git/CI, database, runtime), reconciled, with the lead re-inspecting the critical evidence
directly. **Zero Critical, zero High.** Records:
[`docs/go-live/WIZMATCH_PILOT_LIVE_STATUS_FINAL.md`](../docs/go-live/WIZMATCH_PILOT_LIVE_STATUS_FINAL.md),
[`WIZMATCH_G3_SMOKE_TEST_RESULT_FINAL.md`](../docs/go-live/WIZMATCH_G3_SMOKE_TEST_RESULT_FINAL.md),
[`WIZMATCH_PILOT_TEAM_ONBOARDING_FINAL.md`](../docs/go-live/WIZMATCH_PILOT_TEAM_ONBOARDING_FINAL.md).

- **Verified:** `0037` applied once and **hash-verified** (no `0038`) · backfill idempotent and
  tenant-safe, **183** root policies, **0** missing, **0** duplicates, all `needs_review` ·
  PostgreSQL **18.3** · encrypted backup restore-tested, recovery point `2026-07-28T05:59:17Z`,
  Railway managed backup/PITR unavailable · roster exactly two `admin` humans (Itika deferred —
  no account in any tenant; `deck-sync` `viewer` outside the human roster) ·
  sending/email/prep/adapter/paid-discovery/Google-fallback disabled · enforcement `shadow`.
- **Config has three distinct categories:** (A) explicit in the running deployment; (B) four
  variables **absent** from the running process but effective via reviewed fail-safe code
  defaults; (C) those same four **staged** in Railway pending a successful redeploy. Both
  redeploy attempts failed on the builder (`50ce0ec6` FAILED, `6510b15e` REMOVED). The pending
  redeploy is **behaviourally inert** (identical readiness PASS both ways).
  `list_variables` = staged config; `railway ssh` + `printenv` = running config. Do not conflate.
- **~~Deployment migrations are NOT automatic~~ — CORRECTED 2026-07-30, this was WRONG.** Deploy
  logs show `[migrate] Migration started … complete`; that prefix comes only from
  `src/scripts/migrate.ts`, invoked only by `railway.json`'s startCommand. **Migrations DO run at
  deploy.** Do not hand-apply a future migration expecting the deploy to skip it. Builder drift
  (NIXPACKS vs RAILPACK) is real but cosmetic.
- **NOT verified, deliberately:** authenticated behavioural smoke checks (non-pilot denial,
  per-user access, unknown-scope fail-closed, company/signal block, cross-tenant denial) need
  logged-in sessions and belong to the two operators — no plaintext password requested or used,
  **no synthetic record created**. **TheirStack post-deployment execution NOT verified** (next
  run Thu 2026-07-30 01:35 UTC) — no claim is made that it is healthy.
- **Open follow-ups (none blocking):** explicit config redeploy after builder recovery ·
  `railway.json` drift · `[edge-drainer]` Redis error ~every 5 s · TheirStack verification ·
  `input-data/` ignored only via `.git/info/exclude` (not fresh-clone-safe).
- **Traps:** Railway log queries default to the REMOVED latest deployment — pin `21f4d381` ·
  `ecom.…/health` is a **false-green** Vercel SPA, not the API · always read UUIDs from the DB.

**Nothing in production was changed by the review.** **Do not** redeploy, change variables, rerun
`0037`, rerun the backfill, change user accounts or the roster, promote `enforce`, enable
sending/preparation/the adapter/paid discovery, or connect Smartlead without explicit approval.

---

## Prior entry — MAIN rollout execution (superseded above)

**MAIN rollout execution (2026-07-28): Phases A–H DONE; G3 merge/deploy next.** Branch
`ge/outbound-08b-g3-pilot-completion` @ local HEAD (docs-only after reviewed `0d330269`); PR
#89 draft/base `main`. Full execution evidence:
[`docs/go-live/WIZMATCH_ROLLOUT_EXECUTION_EVIDENCE.md`](../docs/go-live/WIZMATCH_ROLLOUT_EXECUTION_EVIDENCE.md).

Owner decisions: Railway managed backup/PITR abandoned → encrypted logical `pg_dump` backup
instead (done, restorable); **Itika deferred** → initial pilot roster is exactly two humans
(Jatin admin, Kanishk admin); G1 clone = restored local PG18.

- **Backup:** encrypted archive `input-data/g1-backups/wizmatch-prod-20260728T055917Z.dump.enc`
  (AES-256-CBC+PBKDF2, Keychain); plaintext sha `d07474f8…`, ciphertext sha `5c2c38a5…`;
  restore-tested into disposable PG18 (all counts match prod). No Railway PITR (accepted).
- **G1 (clone + 0037 + locks):** GO — 0037 file hash == reviewed `76729b60…`; applied to clone
  in 107 ms, max lock-wait 0 ms, all schema objects verified, U-7 measured trivial.
- **G1 prod migration (Phase G):** `0037` applied to production (single txn, journal-verified,
  8/8 tables, 3/3 U-7 indexes, web unchanged). Migrate-before-deploy satisfied.
- **G2 backfill (Phase H):** applied `INSERT 0 183`; idempotent, tenant-safe, every row
  `needs_review` (never `allow`). PASS.
- **G3 (Phase I) — IN PROGRESS:** push docs → final CI → if green, merge (normal commit) →
  auto-deploy → enable `WIZMATCH_COMPANY_POLICY_ENABLED` + `WIZMATCH_DECISION_WORKBENCH_ENABLED`
  → verify 2-user roster (no Itika/viewer/machine) → readiness + smoke tests.

Final state must keep sending/email/prep/adapter/paid-discovery OFF, enforcement `shadow`,
NODE_ENV=production. Smartlead absent.

**Prior — G1 read-only evidence (superseded by execution above):** G1 was NO-GO on 2026-07-28
morning (no backup, no Itika). Both cleared differently: backup via encrypted logical dump;
Itika deferred. The earlier session was read-only throughout. Branch
`ge/outbound-08b-g3-pilot-completion` @ `85c9dd09` (docs-only, unpushed); PR #89 open/draft/base
`main`/head `af6d0438`, CI green. Full record:
[`docs/go-live/WIZMATCH_G1_RUNTIME_READONLY_EVIDENCE.md`](../docs/go-live/WIZMATCH_G1_RUNTIME_READONLY_EVIDENCE.md).

This was the first session to actually connect to the production database. Read-only throughout —
every transaction ran under `default_transaction_read_only=on` + `BEGIN READ ONLY` with 15s/2s/30s
timeouts and ended in an explicit `ROLLBACK`.

**Six G1 blockers resolved:** the production Postgres is the Railway service **`Postgres`**
(`0c31ec38-0433-46c6-9fbb-5dd2859d1a08`, volume instance `144db25d-…`) — proven by `server_version
18.3` versus `Postgres-K0lx`'s `postgres-ssl:17` image, **not** by trusting
`postgres.railway.internal`; production schema is **clean pre-`0037`** (all 8 tables, 7 indexes, 3
columns, 2 FKs, trigger and function absent); the journal head is byte-identical to this repo
(`0036` hash `f7c20080…` matches); `0037` is unapplied, proven by journal, by object probe, and by
the container not containing the file; the migration mechanism is `railway.json`'s
`node dist/scripts/migrate.js && node dist/index.js`, so **merging auto-applies `0037`**; and the
Command Deck sync principal is confirmed `deck-sync` `role='viewer'`, `acdab2ee-7e02-4e7d-b2c1-4bcabd4f2579`,
WizMatch tenant — settling the one F-A item the PR 8B review flagged as unverifiable from code.

**The new blocker is the serious one: production has ZERO database backups and NO backup schedule.**
Railway's read-only API returns `[]` for `volumeInstanceBackupList` and
`volumeInstanceBackupScheduleList` on every volume in the project. That fails the owner's U-7
condition ("verified backup/rollback plan") outright, rules out a PITR clone, and is a standing
data-loss exposure independent of this branch.

**Second blocker: `itika.khandelwal@growthescalators.com` has no production account** — 0 exact and
0 fuzzy matches. Jatin (`427e6b95-68f7-42b6-83b0-ced1799139b2`, admin) and Kanishk
(`115f2251-cf72-417e-bdbb-b63cd23415b3`, admin) resolve cleanly in the WizMatch tenant
(`4b3dd3e2-…`), both `is_active=true`, and are already the roster's only two entries. Creating
Itika's account is a production write and was not performed.

**Recorded, needs an owner decision, not actioned:** `WIZMATCH_PAID_DISCOVERY_ENABLED=true` in
production with `SERPER_API_KEY` present and `WIZMATCH_GOOGLE_FALLBACK_ENABLED=true` — a spending
path is reachable, contradicting "paid discovery disabled". Apollo/Snov per-provider flags are off.
Also: production `users` has `is_active`/`is_test_account` columns that `schema.ts` does not model,
and three migrations (`0008`, `0013`, `0014`) are permanently skipped by drizzle's timestamp-only
pending rule — both pre-existing, neither touched by `0037`.

**Confirmed safe:** sending `false`, enforcement unset → `shadow`, preparation/adapter/provider
unset, all eleven Smartlead credential aliases absent, `WIZMATCH_STAFFING_PILOT_ALL_USERS=false`,
`NODE_ENV=production` (settles PR 8A H-4).

**Exact next action — REVISED 2026-07-28 (owner decision).** `APPROVE_G1_CLONE_PROVISIONING` is
**withdrawn**. The work is now split into three tracks behind five separate gates, specified in
[`docs/go-live/WIZMATCH_G1_BLOCKER_CLEARANCE_PLAN.md`](../docs/go-live/WIZMATCH_G1_BLOCKER_CLEARANCE_PLAN.md):

- **Track A** — production backup. Awaiting `APPROVE_PRODUCTION_BACKUP_ENABLE`. Plan: one manual
  volume backup first (no redeploy), then `DAILY`+`WEEKLY` schedule, then enable PITR. PITR **is**
  available on this service (`volumeInstancePITRRestore`, image on the required major tag) — the
  earlier "unavailable" note was wrong; it is simply switched off (`archive_mode=off`).
- **Track B** — Itika's account. Awaiting `APPROVE_ITIKA_ACCOUNT_PROVISIONING`. Path is
  `POST /api/permissions/users` (`src/routes/permissions.ts:173`), which takes the tenant from the
  **caller's session** — so the acting admin must be logged in on the `wizmatch` slug or the account
  silently lands in `growth-escalators`.
- **Track C** — a **zero-PII synthetic** production-sized clone (no production rows), behind
  `APPROVE_G1_CLONE_CREATE` → `APPROVE_G1_CLONE_LOAD_SYNTHETIC` → `APPROVE_G1_CLONE_DESTROY`.

**Mandatory ordering:** `0037` must be applied and verified **before** the PR 8B code deploys —
two enabled crons write to `wizmatch_company_policies`, which `0037` creates. Exit code 0 from the
migrate process is not proof of application; only the journal row and post-migration schema are.

**New on 2026-07-28:** `users` spans **two** tenants (`wizmatch` and `growth-escalators`) and both
Jatin and Kanishk hold an account in each; the pilot roster correctly contains only the two
wizmatch-tenant UUIDs. Itika has **no** account in any tenant (0 case-insensitive matches).

**Do not** apply `0037`, push, merge, mark PR #89 ready, deploy, run backfill `--apply`, promote
`enforce`, enable sending/preparation/the adapter, connect Smartlead, change roles or the roster, or
start PR 9/10.

---

## Prior entry — PR 8B CODE READY (superseded above)

**PR 8B is CODE READY at `0d330269`.** Branch `ge/outbound-08b-g3-pilot-completion`, PR #89 (draft).
Marker `.ai/OUTBOUND_PR8B_CODE_READY` created. **Zero Critical, zero High.** Report:
[`docs/reviews/wizmatch-outbound-pr8b-final-opus-review.md`](../docs/reviews/wizmatch-outbound-pr8b-final-opus-review.md).

The one blocker (F-A — the M-3 pilot gate locking every `viewer` out of all 82 WizMatch routes,
breaking the Command Deck sync) was ratified by the owner as a **narrow read-only machine-sync
exception** and implemented at `111e5322`. `viewer` was NOT made pilot-eligible, NOT added to the
roster, and the pilot gate was NOT removed. `src/middleware/wizmatchMachineSyncLane.ts` admits a
request only when it is a `GET`, from an authenticated RBAC-passed caller with non-empty `tenantId`
and `id`, role exactly `viewer`, and `req.path` exactly equal to one of eight frozen paths — the set
`GE-Brain/scripts/crm-sync.mjs` calls. Everything else delegates to the untouched pilot gate;
`PILOT_ELIGIBLE_ROLES` and `wizmatchPilotGate.ts` both have zero-line diffs.

**Six vacuous mutation controls have now been found across three rounds on this branch** — four on
the remediated tree, two more in the F-A lane's own tests (`43c7fa89`, `0d330269`). In two of the
six, a reviewer cited a control that could not fail as its own evidence. All are fixed and red.
If you review this stack again, assume a control is vacuous until you have watched it fail.

**Gates at `0d330269`:** `git diff --check` clean · build exit 0 · `npm test` **132 files / 1551
tests** · admin build exit 0 · Playwright **99 passed / 15 skipped / 0 failed**.

**Exact next action — G3 preparation, all read-only or configuration:**
1. Configure `WIZMATCH_STAFFING_PILOT_USER_IDS` with exactly the three human roster ids (two `admin`,
   one `team_lead`), resolved read-only. Do not record their emails in this repo.
2. Perform the mandatory read-only verification of the production sync principal, its role, its
   tenant and its endpoints. The lane engages only for `role === 'viewer'`. If no legitimate sync
   exists, leave the lane unused — do not create a machine account.
3. Note the recorded pre-existing limitation: `GET /placements` still 403s for the sync via its own
   `['admin','team_lead']` check, which predates this branch and feeds no cockpit tile.

**G1 remains separately NO-GO** (production-database blockers, unchanged). Do not push, merge,
deploy, apply `0037`, run backfill `--apply`, promote `enforce`, enable sending/preparation/the
adapter/paid discovery, connect Smartlead, or start PR 9/10.

---

## Prior entry — PR 8B NOT CODE READY, blocked on F-A (superseded by the resolution above)

**PR 8B is NOT CODE READY after the final independent review of the remediated tree.** Branch
`ge/outbound-08b-g3-pilot-completion`, PR #89 (draft). Reviewed `84fc340e`; fixes at `5f045b5d`
(tests + doc accuracy) and `2b1f074a` (disclosure). Report:
[`docs/reviews/wizmatch-outbound-pr8b-final-opus-review.md`](../docs/reviews/wizmatch-outbound-pr8b-final-opus-review.md).
**`.ai/OUTBOUND_PR8B_CODE_READY` is NOT created.**

**The remediation's core work holds.** All six High findings are genuinely closed, proven by
fifteen executed mutation controls rather than by the remediation report's account of them —
including the one that stayed green last round (deleting only `p.tenant_id = s.tenant_id` from
`prepareCompanies.ts`, now three tests red). Migration `0037` verified end-to-end on disposable
local Postgres. Zero Critical.

**Exactly one thing blocks the marker: F-A, a new High needing an owner decision.** The M-3 fix
gates the whole 82-route `wizmatchRouter` with `wizmatchPilotGate`. `viewer` is not in
`PILOT_ELIGIBLE_ROLES` and role-eligibility is checked *before* roster membership, so every
`viewer` is now 403'd on all 82 routes — reads included — and **adding it to the roster does not
help**. `src/index.ts` names `viewer` as the read-only Command Deck sync account, and
`GE-Brain/scripts/crm-sync.mjs` reads eight of those routes; merging auto-deploys, so that sync
breaks on merge. Four remedies (re-role the sync account / make `viewer` pilot-eligible / exempt
GETs / accept the stale card) are recorded as a blocking pre-merge item in the go-live runbook —
two are RBAC changes, so the choice is the owner's. Unverifiable from here: whether the live sync
account really is `viewer` (needs production access, deliberately not taken).

**Also found: four narrow mutation controls stayed GREEN on the submitted tree** — M-2, M-4, the
application half of H-4, and M-5 had no working regression control. The remediation report's claim
that M-4's control "went red" for both implementations is wrong for `wizmatchStaffing.ts`. The
worst was H-4's app half: deleting `validatePolicyWrite`'s unknown-scope guard left the **entire**
suite green (1469 tests), and the DB CHECK that would otherwise cover it is not in force until
`0037` is applied (G1, NO-GO). M-5's scope guard was separately evaded by `SmartLeadCsvAdapter`
and three other plausible names. All fixed this session; all four now go red, and
`KNOWN_PROVIDERS` is pinned to `['mock']` so a PR 9 provider is caught regardless of naming.

**Gates after fixes:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **131 files /
1495 tests** · `npm run admin:build` exit 0 · Playwright **99 passed / 15 skipped / 0 failed**.

**Exact next action:** owner decides F-A, then a short re-review to confirm that one item and
create the marker. **G1 remains separately NO-GO.** Do not push, merge, deploy, apply `0037`, run
backfill `--apply`, promote `enforce`, enable sending/preparation/the adapter/paid discovery,
connect Smartlead, or start PR 9/10.

---

## Prior entry — PR 8B REMEDIATED (superseded by the final review above)

**PR 8B is REMEDIATED. All six High and all five Medium findings from the corrected review are
closed.** Branch `ge/outbound-08b-g3-pilot-completion`, PR #89 (draft), remediated commit
`84fc340e` (code, before the docs/marker commit). Report:
[`docs/reviews/wizmatch-outbound-pr8b-remediation.md`](../docs/reviews/wizmatch-outbound-pr8b-remediation.md).

**Method:** five parallel read-only discovery agents (one per finding cluster), reconciled before
any code was written; three isolated git-worktree implementation lanes with zero file overlap,
each producing its own mutation controls; three clean merges into the target branch with zero
conflicts; one integration-only defect found and fixed afterward — a React hooks-order violation
in `TodayDecisionWorkbench.jsx` (H-6's `useMemo` landed after early returns), invisible to
`npm test` since it never renders a component, only caught by re-running the full Playwright suite
against the fully integrated tree. Fixed, full suite re-verified at the exact historical baseline
(99 passed / 15 skipped / 0 failed).

**Deviations from the literal mission spec, both forced and empirically proven, both documented:**
the readiness CLI flag is `--audit-env-file`, not the originally-specified `--env-file` — proven
(three ways: plain `node`, `tsx`, and the real npm-wrapper invocation) to collide with Node.js's
own native `--env-file` flag (20.6+), which intercepts it before the script runs at all. The
`--audit-env-file` merge semantics are file-only (no `process.env` fallback for keys the file
omits), not a literal `{...processEnv, ...fileValues}` spread — the literal formula could not pass
the mission's own stale-credential scenario 4, reproduced then fixed.

**Gates on the final integrated tree:** `git diff --check` clean, `npm run build` exit 0, `npm
test` **130 files / 1469 tests** (was 126/1418 at the review baseline), `npm run admin:build` exit
0, Playwright `wizmatch-local` **99 passed / 15 skipped / 0 failed**.

**`.ai/OUTBOUND_PR8B_CODE_READY` remains absent** — this is remediation, not an independent
readiness verdict. **Next step: a fresh, independent Opus review session**, with no memory of this
remediation work, per standing practice on this stack. Do NOT proceed to G1/G2/G3 on the strength
of this remediation alone.

**G1 remains separately NO-GO** — unchanged by this remediation; every G1 blocker is about
production database access this session did not have and did not take (see
`docs/go-live/WIZMATCH_G1_PRODUCTION_PREFLIGHT.md`, code-side note added noting `0037`'s content
changed via the D-R2 CHECK constraint but no G1 blocker is resolved by that).

---

## Prior entry — PR 8B NOT CODE READY (revoked), before remediation

**PR 8B is NOT CODE READY. The CODE_READY marker was created in error and has been REVOKED.**
Branch `ge/outbound-08b-g3-pilot-completion`, PR #89 (draft). Report:
[`docs/reviews/wizmatch-outbound-pr8b-opus-review.md`](../docs/reviews/wizmatch-outbound-pr8b-opus-review.md).

**Six High findings, all independently re-verified.** An earlier revision of the review declared
"zero Critical, zero High" and wrote `.ai/OUTBOUND_PR8B_CODE_READY`. That verdict was wrong. The five
parallel review agents went idle without reporting, the lead issued a verdict on his own pass alone,
and the agents then returned reports finding five High issues the lead had missed.

**The instructive one:** the lead's mutation deleted the whole `NOT EXISTS` block in
`prepareCompanies.ts` and went red. R5 deleted only `AND p.tenant_id = s.tenant_id` — 25/25 tests
still passed, because a doc comment on line 276 satisfies the source grep. A passing control proves
only what it mutates.

**The six High:** (H-1) the blocked-signal tenancy guard has no working control; (H-2) the readiness
CLI reads `.env` from `cwd`, silently ignoring the audited file; (H-3) stale shell exports override
it — H-2/H-3 together let the CLI report SAFE against sending-enabled + a live Smartlead credential,
and that CLI *is* the G3 gate; (H-4) the gate fails OPEN on an unrecognised `scope_type` and there is
no DB CHECK; (H-5) blocked signals still rank/score/recommend via client discovery — a third call
site the "PASS" verdict missed; (H-6) the bulk bar enables actions the selected rows forbid, on the
default action of the queue where those rows all live.

**Plus five Medium:** bulk denies team_lead at count=1; `GET /staffing/access` sits above the pilot
gate; the roster does **not** gate the send/spend routes (`grep -c wizmatchPilotGate
src/routes/wizmatch.ts` → 0); `NODE_ENV` still selects Staffing phase defaults; the capability
wiring and the PR 9/10 boundary guard are both untested/evadable.

**Next step: another implementation round on PR 8B**, then a fresh independent review. Do NOT
proceed to G1/G2/G3.

**G1 is separately NO-GO** — see `docs/go-live/WIZMATCH_G1_PRODUCTION_PREFLIGHT.md`. Production target
identified (GE-Backend-Server / production / `web`, deployed `1e748125` = origin/main, healthy).
**`NODE_ENV=production` is now VERIFIED** at runtime via `GET /health`. But: no production DB access,
the CRM's Postgres is not positively identified among three candidates, U-7 unsigned, no
production-sized restore, and **migrations run automatically at container start** — so merging to
`main` auto-applies 0037 and G1/G3 are coupled. The runbook does not say so.

---

## Prior entry — PR 8B implementation (self-reported)

**PR 8B IMPLEMENTED (self-reported) 2026-07-27 — WizMatch Outbound Operating System, G3 pilot
completion.** Branch `ge/outbound-08b-g3-pilot-completion`, local only, NOT pushed, NOT merged. Built
on the independently-reviewed `ge/outbound-08a-live-pilot-hardening` (CODE READY at `f12c62ca`).
Marker: `.ai/OUTBOUND_PR8B_IMPLEMENTED` (self-reported; independent review still required for
CODE_READY). Report: [`docs/reviews/wizmatch-outbound-pr8b-implementation.md`](../docs/reviews/wizmatch-outbound-pr8b-implementation.md),
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 8B section, `.ai/HANDOFF_LOG.md`.

**What changed:** resolves all three PR 8A owner-decision findings — **S1-2** (a PRD §8.2 L4
per-signal/requirement non-overridable block no longer freezes company-level actions, only the
affected signal/requirement, keyed on the real `scope_type` DB column via one shared predicate; also
closes a related evidence leak in `prepareCompanies.ts`/`wizmatchRequirementPriority.ts` so a blocked
signal/requirement can no longer drive a draft or a priority ranking), **S2-4** (new
`decisionWorkbenchCapabilities.ts`, one canonical backend-computed capability calculation the
workbench renders from directly — previously the workbench had zero role logic at all and showed
every action as enabled to every role), **S3-1** (the readiness CLI now detects ten Smartlead
credential aliases by exact-name match, e.g. `SL_API_KEY`, alongside the existing broad name test,
with no `SL_`-prefix false-positive risk) — plus a fourth, newly-ratified decision **P8B-3**
generalising H-4: `resolveStaffingAccess`'s `NODE_ENV === 'production' ? strict : permissive` ternary
is deleted outright, so a missing/empty/malformed pilot roster now fails closed in every runtime, not
only when `NODE_ENV` happens to equal that one literal string.

**Method:** five parallel read-only Stage A Explore subagents (policy/signal-scope, pilot-gate/RBAC,
workbench frontend/capabilities, readiness/credential-safety, test/finding-matrix), reconciled by the
lead before any code was written. Three isolated Stage B implementation lanes in separate git
worktrees, run in parallel, each producing its own mutation-control matrix; cherry-picked into this
branch (policy → access → readiness) with **zero conflicts**. One orchestrator-owned integration pass
added a cross-lane parity test (proving the capability module and the real enforcement path cannot
silently drift on the four rules they both encode) and a scope-boundary regression guard (mechanically
confirming PR 9/10 have not started), and fixed one real Playwright a11y regression the integrated
capability rework correctly surfaced (a fixture predating capability-driven rendering, retargeted to
a company where the tested action is genuinely available rather than papered over).

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **126 files / 1418 tests**
(was 122/1270 at the PR 8A baseline, +4 files/+148 tests) · `npm run admin:build` exit 0 · Playwright
**99 passed / 15 skipped / 0 failed** (exact match to the PR 8A baseline). Readiness CLI: all 17
required scenarios (safe baseline, all danger conditions including the two new alias/malformed-roster
checks, the SL-prefix false-positive negative case, and the safe-`.env`-copy case) pass against the
fully integrated tree.

**Owner decisions still required, neither blocking G3, both carried forward unchanged (not new to
this branch):** PR7 O-3 / PR8A S2-3 (the `POST .../prepare` route's role tier — PRD-005 §4 has no row
for preparation, and this branch deliberately did not resolve the question unilaterally in either
direction, inert while `WIZMATCH_AUTO_PREP_ENABLED=false`); PR6 M-1 residual (whether
`wizmatch_company_policies` gets dedicated `approved_by`/`approved_at` columns versus the current
actor/source/event-chain provenance — migration-gated, doubly out of this branch's authority).

**Exact next action:** get an independent readiness review of PR 8B (three-subagent method, per the
PR 2–8A precedent). `.ai/OUTBOUND_PR8B_CODE_READY` is reserved for that review, not created here. Do
not push, merge, deploy, apply `0037`, run backfill `--apply`, promote `enforce`, enable
sending/preparation/the adapter/paid discovery, connect Smartlead, or start PR 9/10 on the strength
of this session.

---

## Prior task — PR 8A CODE READY (independently reviewed) 2026-07-27

**PR 8A CODE READY (independently reviewed) 2026-07-27 — WizMatch Outbound Operating System,
Smartlead-free live-pilot hardening.** Branch `ge/outbound-08a-live-pilot-hardening`, local only,
NOT pushed, NOT merged. Markers: `.ai/OUTBOUND_PR8A_IMPLEMENTED` (self-reported) +
**`.ai/OUTBOUND_PR8A_CODE_READY` (independent review, at `f12c62ca`)**. Report:
[`docs/reviews/wizmatch-outbound-pr8a-opus-review.md`](../docs/reviews/wizmatch-outbound-pr8a-opus-review.md),
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 8A review section, `.ai/HANDOFF_LOG.md`.

**Review outcome:** NOT READY as submitted at `47c27173`; **READY at `f12c62ca`** after **four High,
six Medium and three Low fixes**. **Zero Critical.** Three parallel read-only Explore subagents
reconciled with an independent hand review. **Nineteen control runs.** Every submitted-tree gate
number reproduced exactly (122 files / 1246 tests; Playwright 99/15/0), so the implementation marker
did not overstate itself.

**Method note worth keeping.** The three subagents returned *late* — after the lead had finished an
independent hand review of all three areas and committed a first round of fixes. That made the two
passes genuinely independent, and **each caught defects the other missed**: the lead found H-1/M-2/M-3,
the subagents found H-4/S1-1/S1-3/S1-5 plus three recorded owner decisions, and three findings were
confirmed by both. One subagent reading was wrong on the merits and is corrected in the report (S3
read the absent dotenv import as deliberate; it is not).

- **H-1** — the go-live readiness CLI **read no `.env`**, unlike every sibling script. The runbook's
  G3 step tells an operator to run it "against an identical local `.env` copy"; against one, every
  safety flag read `undefined` -> "off" -> exit 0. **A `.env` with `WIZMATCH_SENDING_ENABLED=true`
  would have been reported safe to go live.**
- **H-2** — the **"No action available" affordance lost its explanation** for a state PR 8A itself
  introduced (a routed company that already has an account owner). Bare, unexplained text for every
  user. `routed` is now resolved before the item is built rather than mutated after bucketing.
- **H-3** — **approval provenance was enforced in the workbench layer only**, while three other paths
  reach `writeCompanyPolicy` directly with an optional `actor.userId` and a nullable
  `actor_user_id`. With no `approved_by`/`approved_at` on this table (verified), an `eligible` row was
  still persistable with a NULL actor. Now refused at the chokepoint for `source: 'human'`; the
  backfill's non-human sources are unaffected. `resolveDuplicate` too.
- **H-4 (subagent)** — **the pilot roster's fail-closed branch turns entirely on `NODE_ENV === 'production'`,
  and nothing in this repo records that it is set at runtime** (Nixpacks' documented value is
  build-phase). With any other value the roster is bypassed and every pilot-eligible role is admitted —
  an open deployment, not a pilot. Asserting `--production` while `NODE_ENV` disagrees is now a
  readiness DANGER, and G3 gained an explicit checked step. **Railway was not accessed; the live value
  must be confirmed by a human at G3.**
- **M-1/M-2/M-3** — unknown `OUTREACH_PROVIDER` only dangerous with the adapter on, so `smartlead_csv`
  passed silently; an absent roster only dangerous under `NODE_ENV=production`, which a copied `.env`
  never carries (added `--production`; `WIZMATCH_STAFFING_PILOT_ALL_USERS` is now reported as the open
  deployment it is); the configuration contract had **no roster row at all**.
- **S1-1/S1-3/S1-5 (subagent, fixed)** — a narrower non-overridable block was **invisible in shadow**
  when the root read `eligible`, landing a company nobody may contact in **Ready to Contact** (nothing
  was sendable — the gate re-resolves every active row — but the operator was shown the wrong thing);
  a concurrent double-submit leaked a raw Postgres `23505` instead of the stable `stale_policy_state`;
  `decisionWorkbench.test.ts`'s mock discarded `.where()`, so the new narrower-block query's predicates
  were unobservable.
- **RECORDED, needing an owner decision — S1-2** the non-overridable scan does not separate PRD §8.2's
  L4 per-signal blocks from L1c scope blocks, so one per-signal block freezes every company-level
  action (deliberately NOT changed — loosening a block guard is not a reviewer's call, and the current
  behaviour errs safe); **S2-4** the workbench shows actions a `staff` member's role always 403s;
  **S3-1** Smartlead detection is env-var-name-substring only.

**Three of the reviewer's OWN guards were found vacuous by control runs and rewritten** — a
commented-out import satisfied one, an identifier's own `const` satisfied another, and a walker
followed Drizzle's circular `.table` back-reference and so collected every sibling column. All three
are the repo's recurring evadable-guard class, reproduced while reviewing for it.

**Gates at `f12c62ca`:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **122 files /
1270 tests** (+24) · `npm run admin:build` exit 0 ·
`npx playwright test --config=playwright.wizmatch-local.config.ts` **99 passed / 15 skipped / 0
failed** · readiness CLI exit 0 on the approved safe baseline AND on a fully correct production
config, exit 1 on all nine required danger conditions plus the new `NODE_ENV` mismatch.

**Exact next action:** owner decisions on S1-2, S2-4 and S3-1, then G1. **Before G1:** apply migration
`0037` (**B-1** — the repo auto-deploys on push) plus the U-7 shared-index owner sign-off, and run the
§10.11.4 fresh-database checks. **Before G3:** confirm `NODE_ENV=production` on Railway (H-4); set
`WIZMATCH_STAFFING_PILOT_USER_IDS` to an explicit id list (not the all-users override); run
`npm run wizmatch:pilot-readiness -- --production`; enable `WIZMATCH_COMPANY_POLICY_ENABLED` and
`WIZMATCH_DECISION_WORKBENCH_ENABLED`. **PR 7's O-3 is still open.** Before G4: everything carried
from PR 3/5/6 plus PR 7's O-2. **PR 9 remains GATED on U-6.**

**Do not** push, merge, deploy, apply `0037`, run backfill `--apply`, promote `enforce`, enable
sending/preparation/the adapter/paid discovery, connect Smartlead, or start PR 9/10 on the strength
of this review.

---

## Prior task — PR 8A implementation (self-reported, superseded by the review above)


**PR 8A IMPLEMENTED (self-reported, not independently reviewed) 2026-07-27 — WizMatch Outbound
Operating System, Smartlead-free live-pilot hardening.** Branch `ge/outbound-08a-live-pilot-hardening`
(cut from code-ready `ge/outbound-08-outreach-adapter` at `1b4b59fa`), local only, NOT pushed, NOT
merged. This is an ADDITIONAL hardening pass before the first internal production pilot — it does
not replace PR 9 (Smartlead CSV adapter) or PR 10 (reply ingestion), both still gated on U-6
(sanitised Smartlead fixtures) and not required for this pilot. Marker: `.ai/OUTBOUND_PR8A_IMPLEMENTED`.
Full detail: [`docs/reviews/wizmatch-outbound-pr8a-implementation.md`](../docs/reviews/wizmatch-outbound-pr8a-implementation.md),
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 8A section, `.ai/HANDOFF_LOG.md`.

**Scope delivered (14 items):** approval provenance + idempotency on `approve_queue`
(`decisionWorkbenchActions.ts`); pilot roster enforcement wired onto `wizmatchPolicy.ts`/
`wizmatchToday.ts`/`wizmatchPrepare.ts` (new `src/middleware/wizmatchPilotGate.ts`, reusing the
existing `WIZMATCH_STAFFING_PILOT_USER_IDS` pattern — these three routers previously had a broad
role allow-list but no pilot-roster check at all); non-overridable blocks now derived at every
scope, not only `entire_company` (both the action layer's write-time check and the workbench's
display layer); `isPreparationAllowed()` fixed from fail-open to fail-closed on an unrecognised
reason code, plus new taxonomy validation at the `writeCompanyPolicy`/`resolveDuplicate` write
chokepoints (previously no check existed at all); `expectedPolicyId` stale-state precondition
added to `writeCompanyPolicy` (checked inside its own transaction) and threaded through the
Today-actions layer and the frontend; `set_review_date` rewritten as its own branch that changes
ONLY the review date (the shared path had been silently overwriting `reasonCode` with
`manual_reclassified`, which flows into `isPreparationAllowed` and would have un-blocked a
compliance-removed company's preparation eligibility); review-date resurfacing for paused
companies (explicit UTC-midnight comparison); a new `routed` queue derived from the existing
`recommendedRoute`/`accountOwnerUserId` (no migration); decision badges fixed (the workbench's
own `allow`/`review`/`deny` decision was never a `STATUS_TONE` key, so every decision silently
rendered as a neutral grey badge) plus a genuine WCAG contrast fix (`badge-danger` was the only
badge tone missing a 700 text shade, ~4.22:1, now ~5.65:1) and two real focus-trap defects in
`useDialogA11y.js` (disabled elements were included in the Tab cycle; focus was never restored on
close); 13 new pilot-gate tests plus route-level pilot-gate coverage added to all three routers;
one closed test gap (a migrated Command Center file could import the canonical adapter and never
call it, undetected); the live-pilot configuration contract doc; a new read-only
`npm run wizmatch:pilot-readiness` CLI (no DB/network/migration, never prints a secret value); and
the go-live runbook with G1–G4 approval gates.

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **122 files / 1246 tests**
(was 120/1165 at the PR 8 baseline, +2 files/+81 tests) · `npm run admin:build` exit 0 ·
`npx playwright test --config=playwright.wizmatch-local.config.ts` **99 passed / 15 skipped / 0
failed** (identical to the PR 8 baseline) · `npm run wizmatch:pilot-readiness` exit 0, no dangerous
findings against this repo's real local environment.

**Not done, deliberately:** PR 9/10 not started; migration `0037` still not applied to any
database; backfill not run; enforcement mode untouched (`shadow`); sending, the outreach adapter,
and paid discovery all remain disabled; no Smartlead connection of any kind; no guardrail file
touched (verified); no `package-lock.json` change; nothing pushed, merged, or deployed; no Railway
or production access; no database mutation.

**Exact next action:** get an independent readiness review of PR 8A (three-subagent method, per
the PR 2–8 precedent). `.ai/OUTBOUND_PR8A_CODE_READY` is reserved for that review, not created
here. Do not start PR 9/10, apply `0037`, run backfill `--apply`, promote `enforce`, enable
sending, or connect Smartlead on the strength of this session.

---

## Prior task — PR 8 CODE READY (independently reviewed) 2026-07-27

**PR 8 CODE READY (independently reviewed) 2026-07-27 — WizMatch Outbound Operating System, PR 8 of 10
(provider-neutral outreach adapter).** Branch `ge/outbound-08-outreach-adapter` (cut from code-ready
`ge/outbound-07-free-prep` at `70c310b5`), local only, NOT pushed, NOT merged. Markers:
`.ai/OUTBOUND_PR8_IMPLEMENTED` (self-reported) + `.ai/OUTBOUND_PR8_CODE_READY` (independent review).
Full detail: [`docs/reviews/wizmatch-outbound-pr8-opus-review.md`](../docs/reviews/wizmatch-outbound-pr8-opus-review.md),
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 8 sections, `.ai/HANDOFF_LOG.md`.

**Review outcome:** NOT READY as submitted at `2e329c12`; **READY** at **`1b4b59fa`** after **eleven**
fixes made during the review — six High, five Medium — plus three doc corrections in the two handoff
files PR 9/10 are instructed to build on. **Zero Critical.** Three parallel read-only Explore subagents
reconciled with an independent hand review; **ten control mutations**, each proving the new assertion
fails on the defect.

**The production code was good; the evidence layer was not.** Contract purity, the fail-closed factory
(safer than the e-sign precedent it copies, which silently falls through to the *live* provider on an
unknown name), mock inertness/determinism/tenant isolation, and scope discipline all verified clean —
12 files, all additions, zero guardrail touches, zero migrations, and **no importer anywhere in `src/`
except the module's own test**. But **four of ten control mutations survived the submitted suite**, all
four in the "did PR 8 leak policy logic, a network call, or a DB write into the provider boundary?"
guards that are ADR-007's only mechanical evidence.

- **H-1** — the policy-gate guard filtered `/^\s*import\b/` lines, so a prettier **multi-line import**
  (the dominant style in this very module, including `mock.provider.ts` itself) put the module
  specifier on a continuation line the filter discarded. A mock provider that genuinely imported
  `evaluateWizmatchOutreachGate` passed **35/35**. This is **PR 7's P-5 defect verbatim**, reintroduced
  in the same PR whose implementation doc claims it was deliberately avoided — the **fourth**
  recurrence of this class (PR 2, PR 5, PR 7 T-3, PR 8).
- **H-2** — the network guard matched only `node:https?` and the `require()` form, so a bare
  `import https from 'https'` evaded it *and* the runtime `fetch` spy the doc presents as the stronger
  proof. **35/35 green.**
- **H-3** — the DB guard matched only `db.insert|update|delete(`; `db.execute(sql\`INSERT\`)`, a `tx`
  handle inside a transaction, `getDb().insert(`, or prettier's own line break all evaded it, and
  reads were never checked at all. **35/35 green.**
- **H-4** — the PR 10 event map told PR 10 to wire a multi-tenant reply poller into
  `POST /api/wizmatch/classify-reply` under a heading claiming tenant safety. That route resolves
  `process.env.WIZMATCH_TENANT_ID`, ignoring the caller, then writes signals, tasks, `suppress()` and
  `contacts.do_not_contact` against that one tenant.
- **H-5** — nothing pinned the in-method capability enforcement: deleting both
  `assertOutreachProviderCapability` calls left the suite green, so "unsupported operations cannot
  execute" was unproven.
- **H-6** — the guarded file list was hardcoded, so any new file in `providers/` — most obviously
  PR 9's smartlead adapter, the exact leak these guards exist to catch — was scanned by nothing, and
  `outreachIdempotencyKey.ts` was covered by no guard at all.
- **M-1…M-5** — idempotency tiers 1–3 untrimmed, so `' evt_1'` and `'evt_1'` derive two keys for one
  event and the `UNIQUE (tenant_id, provider, idempotency_key)` constraint that makes a re-import a
  no-op (ADR-007 D-3) admits a duplicate row; `csvEscape` did not neutralise CSV formula injection in
  a file whose whole purpose is to be opened by an operator in Excel/Sheets, with `companyName`
  sourced from scraped signal data; `parseResultFeed` accepted timestamps ECMA-262 parses in **local**
  time, so the same feed yields different `eventAt` — and different idempotency keys — on an IST
  laptop and a UTC CI box; a blank `tenantId` silently collapsed every caller into one shared bucket;
  `capabilities`/`identity` were `readonly` in TS only, on a process-wide singleton.
- **M-6…M-14 (recorded, not fixed)** — readiness is enforced by convention not construction (no
  operation calls `assertOutreachProviderReady`); `getConfigStatus()` takes no `tenantId`;
  `OutreachProviderConfigStatus.reason` is free text piped into a logged message;
  `WIZMATCH_OUTREACH_ADAPTER_ENABLED` is read by **no code anywhere in the repo**, so PRD-005 §16's
  promised second gate does not exist; ADR-007 still documents `exportBatch`/`parseResults`/
  `{sends, polls}`, none of which exist.
- **L-1…L-11** — full table in the report.

**Gates (post-fix, `1b4b59fa`), every one run for real:** `git diff --check` clean · `npm run build`
exit 0 · `npm test` **120 files / 1165 tests** (+11) · `npm run admin:build` clean · Playwright
**99 passed / 15 skipped / 0 failed**. Every submitted-tree number reproduced exactly (1154 tests), so
the implementation marker did not overstate itself. The 15 skips are the documented no-password
real-backend specs (two hardening specs × 5 tests × 3 projects).

**No PR 6/PR 7 open finding is falsely closed** — O-1…O-4, P-1…P-5 and the PR 6 §13 approval-capture
gap all survive verbatim.

**Exact next action:** PR 9 (`ge/outbound-09-smartlead-csv`) remains **GATED** on the sanitised
Smartlead fixtures (**U-6**) — this review does not lift that gate, and PR 9 must not start without
them. Before PR 9 writes a real provider, settle **M-7** (where readiness is asserted), **M-8**
(whether `getConfigStatus()` takes a `tenantId` — cheapest now, at zero callers), **M-6** (constrain
`reason` before a credentialed provider populates it), **M-12** (actually enforce
`WIZMATCH_OUTREACH_ADAPTER_ENABLED`) and **M-13** (implement the real ADR-007 D-4 grep). Before PR 10:
**H-4**, **M-10**, **M-11**.

Before this stack reaches `main`: **apply migration `0037` (B-1 — the repo auto-deploys on push)** and
run the §10.11.4 fresh-database checks (G1). Before `WIZMATCH_AUTO_PREP_ENABLED` with real data:
O-1, O-3, O-4. Before G4/`enforce`: O-2 plus everything carried from PR 3/5/6. Before the workbench
makes real decisions: the PR 6 §13 approval-capture gap.

**Do not** merge, push, deploy, apply 0037, run backfill `--apply`, promote `enforce`, enable sending,
enable paid discovery, or connect Smartlead on the strength of this review.

---

## Prior task — PR 8 implementation (self-reported, superseded by the review above)

**PR 8 IMPLEMENTED (self-reported, not independently reviewed) 2026-07-27 — WizMatch Outbound
Operating System, PR 8 of 10 (provider-neutral outreach adapter).** Branch
`ge/outbound-08-outreach-adapter` (cut from code-ready `ge/outbound-07-free-prep` at `70c310b5`), local
only, NOT pushed, NOT merged. Marker: `.ai/OUTBOUND_PR8_IMPLEMENTED`. Full detail:
[`docs/reviews/wizmatch-outbound-pr8-implementation.md`](../docs/reviews/wizmatch-outbound-pr8-implementation.md),
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 8 section, `.ai/HANDOFF_LOG.md`.

**Scope delivered:** ADR-007 D-1's provider boundary — `src/modules/outreach/providers/outreach-provider.interface.ts`
(vendor-neutral types, an 11-flag typed `OutreachProviderCapabilities`, identity, config status, the
two-method `OutreachProvider` interface with no generic execute/request escape hatch, a 7-code
`OutreachProviderError`, and `assertOutreachProviderCapability`/`assertOutreachProviderReady`),
`providers/mock.provider.ts` (`MockOutreachProvider` — deterministic, in-memory, no network/credential
code, per-tenant call capture and id sequencing, controllable success/unsupported/failure/duplicate
scenarios, `__reset`/`__setScenario`/`__setConfigStatus`/`__getCalls` test-only hooks mirroring the
esign mock's `__view`/`__sign`/`__reject`/`__reset` convention), `providers/index.ts` (lazy singleton
factory mirroring `src/modules/esign/providers/index.ts`; `KNOWN_PROVIDERS = ['mock']` is an allow-list
with no fallback — an unrecognised or unimplemented name, including the documented default
`'smartlead_csv'`, fails closed with `unknown_provider` rather than substituting anything, a deliberate
divergence from esign's own fail-open-to-`documenso` behaviour), and `outreachIdempotencyKey.ts`
(`deriveOutreachIdempotencyKey` — ADR-007 D-3's four-tier order, provider-neutral for PR 9/10 reuse).

Also produced: `docs/handoffs/WIZMATCH_PR9_SANITISED_FIXTURE_CHECKLIST.md` (blocking, U-6 — no
Smartlead field invented) and `docs/handoffs/WIZMATCH_PR10_PROVIDER_EVENT_MAP.md` (provider-neutral
reply-ingestion fields, grounded in existing schema/services, gaps stated not papered over).

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **120 files / 1154 tests**
(was 119/1119 at the PR 7 baseline, +1 file / +35 tests) · `npm run admin:build` clean (no admin files
touched) · Playwright **99 passed / 15 skipped / 0 failed** — identical to the PR 7 baseline.

**Not done, deliberately:** no Smartlead API/CSV, no IMAP/reply-ingestion, no schema/migration change
(no `0038`), `WIZMATCH_OUTREACH_ADAPTER_ENABLED`/`OUTREACH_PROVIDER` not wired into any route/worker job
(no caller exists yet — PR 9/10 scope), no guardrail file touched, no Growth/SEO/n8n/
`package-lock.json` change, nothing pushed/merged/deployed, no Railway/production access, no database
mutation, no sending or paid discovery enabled.

**Exact next action:** get an independent readiness review of PR 8 (three-subagent method, per the
PR 2–7 precedent). PR 9 (`ge/outbound-09-smartlead-csv`) remains **GATED** on the sanitised Smartlead
fixtures (U-6) regardless of that review's outcome. **Do not** start PR 9/10, connect Smartlead, or
enable sending on the strength of this session.

---

## Prior task — PR 7 CODE READY (independently reviewed) 2026-07-26

**PR 7 CODE READY (independently reviewed) 2026-07-26 — WizMatch Outbound Operating System, PR 7 of
10 (zero-cost company preparation).** Branch `ge/outbound-07-free-prep` (cut from code-ready
`ge/outbound-06-decision-workbench`), local only, NOT pushed, NOT merged. Markers:
`.ai/OUTBOUND_PR7_IMPLEMENTED` (self-reported) + `.ai/OUTBOUND_PR7_CODE_READY` (independent review).
Full detail: [`docs/reviews/wizmatch-outbound-pr7-opus-review.md`](../docs/reviews/wizmatch-outbound-pr7-opus-review.md),
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 7 sections, `.ai/HANDOFF_LOG.md`.

**Review outcome:** NOT READY as submitted at `ac2c2b06`; **READY** at **`70c310b5`** after **twelve**
fixes made during the review — five High, seven Medium — plus three test-quality gaps closed. Three
parallel read-only Explore subagents reconciled with an independent hand review; six control runs,
each proving the new test fails on the defect. None of the twelve was visible to the five gates the
implementing session ran, and all five reproduced exactly on the submitted tree (119 files / 1097
tests), so the marker did not overstate its numbers.

- **H-1** — `deriveConfidenceTier` read the whole `metadata` column, not `metadata.raw`: **PR 6's H-4
  reintroduced.** Every canonically-written contact read as ungraded and fell back to the numeric
  heuristic, promoting an explicitly-graded `low` contact to `high` at score ≥ 8 — §7's cold-start gate
  defeated, and that contact's name written into the draft as a verified fact. The PR's own test
  encoded the wrong shape, so it could never have caught this.
- **H-2** — the contact INSERT wrote the provider's `raw` object *as* the metadata column instead of
  the canonical `{ reasons, providerCostCents, raw }` envelope, stripping
  confidenceTier/roleCategory/team/mxProvider from every other reader.
- **H-3** — a `deny` that still permits preparation (`policy_paused_by_owner`,
  `manual_block_by_operator`, `signal_role_irrelevant`) was reported `status: 'prepared'` with a full
  draft: a policy-denied company presented as ready to contact.
- **H-4** — a `medium`-confidence contact was also reported `prepared`, against PRD-005's explicit
  "high → Ready; medium → Needs Review".
- **H-5** — the batch selector starved itself: `skipped`/`failed` companies never wrote a freshness
  key, so the same dead companies refilled every run forever and no other company was ever prepared.
- **H-6** — `WIZMATCH_AUTO_PREP_ENABLED=1` started the cron (which scrapes websites and writes contact
  candidates) while both HTTP routes stayed 404. PR 6's M-D class, on a new flag.
- **M-1…M-11** — a dedup that could never fire (`ON CONFLICT DO NOTHING`, no unique index on
  `wizmatch_contact_candidates`) leaving a TOCTOU window against `poc_discovery`; missing
  `company_intelligence_id`; a scraped contact falsely also tagged `internal_crm`; a draft greeting a
  published `careers@` inbox by "first name"; a website budget understating the outbound surface ~11×
  and dropping scrapes whose company later failed; a 0-row report write reported as success; a
  hardcoded `zeroSpend: true`; a `409` for a company that does not exist; missing reason codes and
  report versioning.
- **T-1…T-3** — the mount-order guard did not cover the new router; the SSRF redirect-revalidation
  fix shipped with **no test at all** (reverting `redirect: 'manual'` → `'follow'` left the suite
  green); tenant-predicate assertions were vacuous against a dropped `WHERE` clause (third recurrence
  of the PR 2 / PR 5 mock-vacuity finding).

**Gates (post-fix, `70c310b5`):** `git diff --check` clean · `npm run build` exit 0 · `npm test`
**119 files / 1119 tests** (+22) · `npm run admin:build` clean · Playwright **99 passed / 15 skipped /
0 failed**. Boundary checks all pass — no guardrail file, no migration, no `package-lock.json`, no
admin/client/scripts change, no PR 8 adapter or Smartlead reference, no send or paid-provider
capability enabled, no production action. No PR 6 Medium/Low finding is falsely marked closed.

**Open, owner decisions (not fixed):** **O-1** a denied company with no intelligence row still churns
— decide whether being denied may create one; **O-2** residual cross-job duplicate-contact race with
`poc_discovery` (a partial unique index is a migration, blocked behind 0037); **O-3** `POST
.../prepare` is a **write** at staff+ while every other write in this stack is team_lead+ and PRD-005
§4 has no row for preparation — plus PR 6's M-6 pilot roster, which now applies to a write for the
first time; **O-4** §21 G5 calls this job "verified read-only" and it is not.
**Pre-existing, recorded:** P-1 post-download 200 KB cap, P-2 no per-domain rate limiter, P-3
`isPreparationAllowed` fails *open* on an unknown reason code, P-4 DNS rebinding, P-5 the static
"no paid import" test is weaker than it reads.

**Exact next action:** PR 8 (`ge/outbound-08-outreach-adapter` — interface + mock + factory, **no
Smartlead**) per the standing 10-PR programme, cut from `ge/outbound-07-free-prep` at `70c310b5`.
Nothing blocks it.

Before enabling `WIZMATCH_AUTO_PREP_ENABLED` with real data: settle O-1, O-3, O-4. Before G4/`enforce`:
O-2 plus everything carried from PR 3/5/6. Before this stack reaches `main`: **apply migration `0037`
(B-1 — the repo auto-deploys on push)** and run the §10.11.4 fresh-database checks (G1).

**Do not** merge, deploy, apply 0037, run backfill `--apply`, promote `enforce`, enable sending,
enable paid discovery, or connect Smartlead on the strength of this review.

---

## Prior task — PR 7 implementation (self-reported, superseded by the review above)

**PR 7 IMPLEMENTED (self-reported, not independently reviewed) 2026-07-27 — WizMatch Outbound
Operating System, PR 7 of 10 (zero-cost company preparation).** Branch `ge/outbound-07-free-prep`
(cut from code-ready `ge/outbound-06-decision-workbench`), local only, NOT pushed, NOT merged. Marker:
`.ai/OUTBOUND_PR7_IMPLEMENTED`. Full detail:
[`docs/reviews/wizmatch-outbound-pr7-implementation.md`](../docs/reviews/wizmatch-outbound-pr7-implementation.md),
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 7 section, `.ai/HANDOFF_LOG.md`.

**Scope delivered:** `prepareCompaniesJob` (PRD-005 §14) — new
`src/modules/outreach/prepareCompanies.ts`, new `src/routes/wizmatchPrepare.ts`
(`POST/GET /api/wizmatch/companies/:id/prepare[/status]`), a new `WIZMATCH_AUTO_PREP_ENABLED` cron in
`worker.ts` (default off, mirrors the TheirStack/ATS cron pattern), and a targeted SSRF fix
(redirect-hop revalidation, bounded to 3 hops) in `src/services/emailExtractorService.ts`'s shared
`fetchPage` helper, which PR 7's website-discovery step depends on. **No migration** — reuses the
existing `wizmatch_company_intelligence.metadata` jsonb column (`metadata.prep`). **Zero-spend by
construction**: calls only the free `websitePatternSearch` rung, never `discoverFreePocsForSignal` as a
whole (its SearchAPI fallback can spend), never Apollo/Snov/Serper — enforced by a static test that
fails if a paid identifier appears in the module's own imports. Tenant-scoped, advisory-locked
(`withWizmatchSourceLock`, same helper the sourcing crons use), idempotent (report is a jsonb
overwrite, new-contact insert is dedup-checked by email). Reuses `evaluateWizmatchOutreachGate`
(hard stop on `!preparationAllowed`), `deriveConfidenceTier` (cold-start gate: medium/low never
auto-surfaced), and `computeCampaignCompatibility` (advisory campaign routing) verbatim — no new
policy/scoring/routing logic. Draft personalisation is a deterministic template merge, no LLM call,
`hypotheses` always empty (never fabricates a fact).

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **119 files / 1097 tests**
(was 117/1081 at the PR 6 review baseline, +16 new tests: `prepareCompanies.test.ts`,
`wizmatchPrepareRoutes.test.ts`) · `npm run admin:build` clean (no admin files touched — PR 7 is
backend-only per PRD-005 §14) · `npx playwright test --config=playwright.wizmatch-local.config.ts`
**99 passed / 15 skipped / 0 failed** — identical to the PR 6 baseline, confirming zero UI regression.

**Disclosed, not silently dropped:** no per-domain rate limiter beyond the per-run fetch cap
(`DEFAULT_PREP_MAX_WEBSITE_FETCHES = 25`) and sequential (concurrency-1) processing — no such utility
exists anywhere in the repo yet, a pre-existing gap PR 7 does not generalise-fix. No CLI (PRD-005 §12
names only the two HTTP routes). The §7 cold-start confidence gate remains unwired inside
`evaluateWizmatchOutreachGate` itself — PR 7 applies an equivalent gate at its own job level, which is
sufficient for its own output but does not retroactively protect any other caller of the gate. The PR 6
§13 approval-capture gap (`approve_queue` has no `approved_by`/`approved_at`) is **not** touched.

**Not done, by instruction:** migration 0037 still not applied; no backfill `--apply`; enforcement mode
untouched (`shadow`); both sending kill-switches untouched; no paid provider enabled; Smartlead not
connected; no guardrail file touched; no Growth/SEO/n8n/`package-lock.json` change; nothing pushed,
merged, or deployed; no Railway or production access; no database mutation; no scheduler or production
invocation enabled.

**Exact next action:** get an independent readiness review of PR 7 (three-subagent method, per the
PR 2/3/5/6 precedent). Then PR 8 (`ge/outbound-08-outreach-adapter` — interface + mock + factory, no
Smartlead) per the standing 10-PR programme. **Do not** start PR 8 before that review.

---

## Prior task — PR 6 CODE READY (independently reviewed) 2026-07-26

**WizMatch Outbound Operating System, PR 6 of 10 (Decision Workbench).** Branch `ge/outbound-06-decision-workbench` (cut from
`ge/outbound-05-lifecycle-consolidation`), local only, NOT pushed, NOT merged. Markers:
`.ai/OUTBOUND_PR6_IMPLEMENTED` (self-reported) + `.ai/OUTBOUND_PR6_CODE_READY` (independent review).
Full detail: [`docs/reviews/wizmatch-outbound-pr6-opus-review.md`](../docs/reviews/wizmatch-outbound-pr6-opus-review.md),
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 6 sections, `.ai/HANDOFF_LOG.md`.

**Review outcome:** NOT READY as submitted at `9b9c2c56`; **READY** after **eleven** fixes made
during the review (`e86704b3`, `c84681f5`, `69e68c19`, `c03bf442`) — one Critical, ten High. None was
visible to the five gates the implementing session ran; all five reproduced exactly, so the marker did
not overstate itself.

**Method note:** the lead's first pass found two defects and concluded READY. The three subagents'
reports arrived after that and surfaced nine more, four High. The first conclusion was wrong and is
corrected in the report. One first-pass finding (M-C) was wrong on the merits and is **retracted** —
§4 is explicit that admin override of a `standard` block is admin, so the endpoint was under-gated.

- **C-1 (Critical)** — `router.use(featureGate)` responded 404 inline in both flagged routers; mounted
  ahead of `wizmatchRouter`, either flag off (both default `false`) 404'd all 82 `wizmatchRouter`
  routes. A production API outage on the next push. Fixed with `next('router')`.
- **H-1** — a team_lead could override a `standard` block unevidenced, against §4, while the endpoint
  told the operator it required an admin.
- **H-2** — shadow mode blocked work (bucketing keyed on raw `canonical.decision`, not `actsOnDecision`).
- **H-3** — every action rebuilt the root policy row, so Set Review Date stripped
  `isPermanent`/`blockClass`/evidence off a permanent compliance block.
- **H-4** — contact confidence read `metadata` not `metadata.raw`, letting a low-confidence contact into
  Ready to Contact and defeating §7's cold-start gate.
- **H-5** — a null `companyId` failed OPEN in the plural fold; the test pinning it was a regression
  guard pointing the wrong way.
- **H-6** — pending duplicates never reached Needs Review.
- **H-7/H-8/H-9** — a switched-off feature showed a permanent error screen; committed writes were
  reported as failures with no refetch; a malformed 200 crashed the page or faked "nothing to do".
- **H-10/H-11** — unbounded resolver fan-out; a failed replies query presenting as "no replies waiting".

**Biggest open gap (Medium, not fixed):** §13 approval capture is **NOT implemented** — `approve_queue`
launders `review → eligible` into a permanent policy row with no `approved_by`/`approved_at`. Close
before the workbench is used for real decisions. Also open: M-2…M-16, L-1…L-8, and two test gaps —
nothing exercises `fetchCommandCenterRequirements`, and five of six policy write routes have no role
test.

**Gates (post-fix):** `git diff --check` clean · `npm run build` exit 0 · `npm test` 117 files /
**1081 tests** · `npm run admin:build` clean · Playwright **99 passed / 15 skipped / 0 failed**.

**Scope delivered:**
- **New backend**: `src/modules/outreach/decisionWorkbench.ts` (`buildTodayQueues` — re-buckets
  companies into Ready to Contact / Needs Review / Replies Needing Action / Paused or Blocked, deriving
  every decision from `resolveCanonicalCompanyEligibilityBatch`, never re-deriving eligibility itself)
  and `decisionWorkbenchActions.ts` (`runTodayActions` — approve_queue/skip/pause/resume/block/reject/
  assign_owner/set_review_date/merge/confirm_separate, all routed through the existing PR 4
  `policyService`/`duplicateService` write paths). New routes `src/routes/wizmatchToday.ts`:
  `GET /api/wizmatch/today/queues` (staff+), `POST /api/wizmatch/today/actions` (team_lead+ single
  target, admin-only for any multi-target/"bulk" request, per PRD-005 §4). Gated behind
  `WIZMATCH_DECISION_WORKBENCH_ENABLED` (default false).
- **M-1 fixed** (PR 5 review): `wizmatchPolicyRouter` and the new `wizmatchTodayRouter` are now mounted
  in `src/index.ts` BEFORE the `wizmatchRequireAdmin`-gated `wizmatchRouter`, so a staff-tier request no
  longer 403s on an unrelated stricter gate before reaching a router that would have allowed it. Guarded
  by a source-level ordering test (`wizmatchIndexMountOrder.test.ts`) since `src/index.ts` cannot be
  safely imported in a unit test.
- **M-2 fixed** (PR 5 review): `wizmatchCommandCenter.ts`'s `requirements` array is now folded through
  the canonical adapter exactly like `clientDiscovery` — `fetchCommandCenterRequirements` now selects
  `r.company_id`, `ScoredRequirement` carries `companyId`/`blockers`, and `buildWizmatchCommandCenter`
  calls `applyCanonicalEligibilityToPriorityResults` on it. `candidateIntelligence` is explicitly NOT
  folded — disclosed in the module header, identical reasoning to why `wizmatchCandidateIntelligence.ts`
  itself is excluded (a talent-pool candidate isn't scoped to one company).
- **Frontend**: `WizmatchTodayPage.jsx` extended in place (no new route/nav) — when
  `VITE_WIZMATCH_DECISION_WORKBENCH_ENABLED` is on (or `import.meta.env.DEV`), it renders the new
  `TodayDecisionWorkbench.jsx` instead of the legacy My Work buckets; `/wizmatch/today` itself stays
  `permission: 'always'` either way. New components: `TodayDecisionWorkbench.jsx` (four queues, reuses
  `DataTable`'s previously-unused `selectedIds`/`onToggleRow`/`onToggleAll` props, per PRD §5.3 A-9),
  `TodayActionDialog.jsx` (reason-code/evidence/review-date/owner capture, focus-trapped via the
  existing `useDialogA11y`), `TodayBulkActionBar.jsx` (first WizMatch-side bulk bar — cannot reuse the
  Growth `BulkActionBar.jsx`, which is hardcoded to Growth endpoints, per PRD §5.3 A-9's own
  disposition). Bulk actions are queue-scoped and exclude any combination that isn't safe (no bulk
  merge/confirm-separate, since that requires every selected row to share one pending-duplicate id).
  `DataTable`'s selection checkboxes gained `aria-label`s (additive, no behaviour change).
- **A-8 closed**: deleted the two dead, unrouted pages `WizmatchCommandCenterPage.jsx` and
  `WizmatchReviewQueuePage.jsx` (PRD-005 §5.3 disposition: "Deleted — PR 6"), confirmed zero importers
  first.
- **D-31 preserved**: canonical decision metadata is always attached for display; the new queues/actions
  endpoints are net-new surfaces (no legacy behavioural predecessor to preserve), and every mutation
  still calls the existing PR 4 write services, which perform their own server-side re-validation
  (supersede-before-insert, non-overridable refusal, `WHERE resolution='pending'` staleness rejection)
  — no route in this PR implements a partial check of its own.
- **Bulk-action contract**: `POST /today/actions` rejects a mixed/empty/malformed selection for the
  WHOLE request up front (400), then processes every target independently and returns a per-target
  `results[]` — one target's failure (stale duplicate, non-overridable predecessor, missing root policy)
  never aborts or hides another's success or failure.

**Verified this session:** `git diff --check` clean; `npm run build` exit 0; `npm test` **117 files /
1064 tests green** (was 113/1030 at the PR5 re-review baseline — +4 test files, +34 tests); `npm run
admin:build` clean; `npx playwright test --config=playwright.wizmatch-local.config.ts` full suite —
**97 passed / 15 skipped (real-backend specs, no server started — pre-existing) / 0 failed**. One
pre-existing spec (`wizmatch-phase0-local.spec.ts`'s Today empty-state test) was updated to mock the new
`/today/queues` endpoint and assert the new empty-state copy, since the legacy My Work checklist it
tested no longer renders once the workbench flag is on (which the dev server always has, via
`import.meta.env.DEV`) — not a regression, a necessary update for the UI this PR replaces. One real a11y
defect was found and fixed by the a11y spec itself: a `StatusBadge` `blocked` tone (`badge-danger`,
shared repo-wide CSS) failed color-contrast on this page; removed the redundant badge rather than
editing the shared class (out of scope, used by dozens of other pages).

**What's next / open:** ~~this marker is self-reported, not independently reviewed~~ — **superseded:
the independent review is done (2026-07-26), see the top of this file and
`docs/reviews/wizmatch-outbound-pr6-opus-review.md`.** Known, disclosed scope limits: the free-preparation pipeline (§14) is still not built, so "Ready to Contact"
approximates §13's "policy eligible, prepared, ≥1 high-confidence contact" using policy + contact
confidence only (no `preparationAllowed`/prep-report signal exists yet to check); "Reclassify" on a
blocked-but-overridable company maps to the same `resume` action as resuming from pause (sets
`needs_review`), not a full re-classification UI across all 8 hiring-policy values — building that is
new UI scope beyond a contextual action wrapper around existing services; "route a reply" in the
Replies Needing Action queue is a navigation link to the company drawer, not a new write action — the
enrolment-transition endpoint (`POST /outreach/enrolments/:id/transition`) is PR 9 (outreach adapter)
scope, not built yet. Carried forward unchanged from the PR5 re-review: M-3…M-9, L-1…L-6, U-7, U-9, O-1,
and **B-1 (apply migration 0037 before this stack reaches `main` — the repo auto-deploys on push)**.

**Exact next action (updated after the independent review):** ~~get an independent readiness review of
PR 6~~ — **done.** PR 6 is code-ready at `c84681f5`; PR 7 (`ge/outbound-07-free-prep`,
`prepareCompaniesJob`) may start, cut from `ge/outbound-06-decision-workbench`. Nothing blocks it.

Before this stack reaches `main`: apply migration `0037` (B-1 — the repo auto-deploys on push) and run
the §10.11.4 fresh-database checks (G1). Before an operator uses the workbench for real decisions:
close M-A (queue precedence vs §13) and M-B (Approve & Queue not actually disabled). Before setting
`WIZMATCH_DECISION_WORKBENCH_ENABLED` in any deployed environment: settle M-D (the UI accepts
`1|true|yes|on`, the backend requires exact `'true'`).

**Do not** merge, deploy, apply 0037, run backfill `--apply`, promote `enforce`, enable sending,
enable paid discovery, or connect Smartlead on the strength of this session.

---

## Prior task — PR 4 + PR 5 REVIEWED AND CODE READY 2026-07-26 at `a5e48602` (+ this review's fixes)

Final independent code-readiness re-review of
`ge/outbound-03-policy-enforcement..ge/outbound-05-lifecycle-consolidation`, three parallel read-only
Explore subagents, every load-bearing finding re-verified by hand, every fix with a control run.
Report: `docs/reviews/wizmatch-outbound-pr5-opus-checkpoint.md` (appended section "Final independent
code-readiness re-review"). Marker: **`.ai/OUTBOUND_PR5_CODE_READY` created.**

> **The fix pass genuinely closed C-1, C-2 and H-1…H-14 — with two exceptions found here.**
>
> **RC-1 (Critical, fixed) — the C-1 fix did not fully land.** H-2's null-`companyId` block in
> `wizmatchRequirementPriority.ts` sat on the one path that never reaches `resolveCompanyStatus`, so
> it never consulted the mode. `wizmatch_requirements.company_id` is nullable (masked clients) and
> the fetcher `LEFT JOIN`s with no filter, so in the shipped default `shadow` those requirements went
> `blocked` **and** `POST /requirement-priority/:id/review-plan` returned **409** — C-1's exact defect
> class, falsifying the claim that neither 409 fires in shadow. New in this range; the
> `wizmatchClientDiscovery.ts` block it claims to mirror predates the stack, so they are not
> equivalent. Fixed with `isEnforcementActive()`; canonical metadata still always attached (D-31).
>
> **RH-1 (High, fixed) — H-8/H-9/H-10 shipped with no regression test at all**, against an explicit
> claim that each had one. Deleting the enum validation, SSRF scrub or company-agreement invariant
> left the suite green. 23 tests added; controls fail 2 / 6 / 4.
>
> **RH-2 (High, fixed) — `wizmatchLinkage.test.ts` could not detect either regression D-32 exists to
> prevent** (dropped tenant predicate, reintroduced `.limit(1)`) — third recurrence of M-5/L-6/H-7, on
> the file the fix pass had just rewritten. Controls now fail 5 / 2.
>
> **RH-3 (High, fixed) — D-35's mode-flip alert could not fire for the mechanism that changes the
> mode.** The baseline was in-process only; the env var is applied by redeploying, so the real flip
> always arrived as a fresh process and was seeded silently. Now also compared against a persisted
> baseline in `audit_logs`, best-effort, once per process. Control fails 3.
>
> **Gates:** `git diff --check` clean · `npm run build` exit 0 · **113 files / 1030 tests** (was
> 113/1003) · `npm run admin:build` clean · Playwright `wizmatch-local` 97 passed / 15 skipped / 0
> failed. Boundary checks all pass — no guardrail file, no `package-lock.json`, no Growth/SEO/n8n or
> legacy-outreach contamination, no send or paid-provider capability enabled, no production action.
>
> **Playwright command note:** `--project=wizmatch-local` does not exist; use
> `npx playwright test --config=playwright.wizmatch-local.config.ts`.
>
> **Open, carried forward:** M-1 staff+ policy reads 403 at the `/api/wizmatch` mount (fails
> **closed**); **M-2 Command Center requirements/candidateIntelligence unfolded and the fetcher does
> not select `company_id` — inert in shadow, must close before G4/`enforce`**; M-3…M-9, L-1…L-6 (full
> table in the review); U-7, U-9, O-1; **B-1 — apply 0037 before this stack reaches `main`.**

**Exact next action:** owner decides whether M-2 lands as a PR 5 follow-up commit or is scheduled as a
hard G4 precondition. Then PR 6 (decision workbench — queues API + Today re-bucket + bulk bar) per the
standing 10-PR programme. **Do not** merge, deploy, apply 0037, run backfill `--apply`, or promote
`enforce` on the strength of this review. Before `main`: B-1 and the §10.11.4 fresh-database checks (G1).

---

## Prior task — PR 4 + PR 5 checkpoint fix pass (superseded by the re-review above)

**PR 4 + PR 5 CHECKPOINT FIX PASS COMPLETE 2026-07-26.** Every Critical/High finding in the
2026-07-26 independent Opus checkpoint review (`docs/reviews/wizmatch-outbound-pr5-opus-checkpoint.md`)
is closed on `ge/outbound-05-lifecycle-consolidation`. Owner decisions D-31 through D-39 were ratified
up front (C-1: option A, adapter respects `shouldBlock`) and are all implemented — D-31 (mode-aware
adapter, closes C-1), D-32 (multi-company most-restrictive-wins, closes U-13), D-33 (verified already
satisfied), D-34 (persisted, idempotent shadow observations in `audit_events`), D-35 (mode-flip
alert/audit once per transition), D-36 (tenant-bound versioned unsubscribe token, retires U-8), D-37
(fail-closed on every unknown policy value, folded into H-8's fix), D-38 (Duplicate Companies
nav/route/page all gated), D-39 (PRD-005 §22.4/§22.5 added). H-2 through H-14 are each fixed with a
dedicated regression test. Full detail: the checkpoint report's new "Fix pass" addendum,
`.ai/OUTBOUND_PR5_IMPLEMENTED`'s fix-pass section, and `.ai/HANDOFF_LOG.md`'s 2026-07-26 entry.

> **Gates on the fix-pass tree:** `git diff --check` clean · `npm run build` exit 0 ·
> **113 files / 1003 tests** (was 110/970 at checkpoint HEAD) · `npm run admin:build` clean ·
> Playwright `wizmatch-local` 97 passed / 15 skipped / 0 failed.
>
> **`.ai/OUTBOUND_PR5_CODE_READY` was deliberately NOT created by this fix pass** — that marker is
> reserved for an independent reviewer, per standing instruction, not for the session that made the
> fixes. Do not merge, deploy, apply 0037, run backfill `--apply`, or promote `enforce` on the strength
> of this fix pass. U-7, U-9, O-1 (PR 3 review) and B-1 (0037 must be applied before this stack reaches
> `main`) remain open, carried forward unchanged.

**Exact next action:** get an independent readiness re-review of PR 4 + PR 5 against the fix pass
(three-subagent method, per the PR 2/PR 3/PR 5-checkpoint precedent). If it passes, the reviewer
creates `.ai/OUTBOUND_PR5_CODE_READY`. **Do not** start PR 6 until that happens.

---

## Prior task — PR 4 + PR 5 independent Opus checkpoint review: NOT READY (superseded by the fix pass above)

**PR 4 + PR 5 REVIEWED 2026-07-26 — verdict NOT READY (fix-then-re-review).** Independent Opus
checkpoint review of `ge/outbound-03-policy-enforcement..ge/outbound-05-lifecycle-consolidation` at
implementation HEAD `7777c455`, three parallel read-only Explore subagents, every load-bearing
finding re-verified by hand. Report:
`docs/reviews/wizmatch-outbound-pr5-opus-checkpoint.md`. **`.ai/OUTBOUND_PR5_CODE_READY` was
deliberately NOT created.**

> **Two Criticals. One is the blocker and needs an owner call.**
>
> **C-1 — PR 5 blocks in `shadow` mode. NOT FIXED.** The PR 5 adapter resolves the canonical decision
> and acts on it without ever consulting `shouldBlock` / `WIZMATCH_POLICY_ENFORCEMENT_MODE`. Two call
> sites are real write blocks (409), not display: `send-to-contact-intelligence` and the new
> `requirement-priority/:id/review-plan`. PRD-005 §16 rule 2 says shadow "blocks nothing"; gate G3
> requires "zero behavioural change post-deploy". With 0037 unapplied every company resolves
> `deny/policy_resolver_error`; applied-but-un-backfilled, `deny/policy_missing_root` — the
> client-discovery and requirement-priority surfaces go dark on merge, while
> `WIZMATCH_COMPANY_POLICY_ENABLED` being off 404s the API that would unblock them. Two defensible
> readings; both agree the two 409s are wrong. **Recommendation: make the adapter mode-aware.**
>
> **C-2 — no policy could ever be changed. FIXED.** `writeCompanyPolicy` inserted the new active row
> before superseding its predecessor, violating the non-deferrable partial unique index
> `wizmatch_company_policies_active_scope_uniq`. Every supersession, including every admin override,
> would have raised `23505` and 500'd against a real database. CI was green only because the mock
> enforced no constraints — the same class as the PR 2 FK-ordering Critical.
>
> **Also fixed, with control runs:** H-1 `POST /companies/bulk/policy` was shadowed by
> `POST /companies/:id/policy`, so the admin-only bulk endpoint never ran and the `team_lead` gate
> fired instead (confirmed against the repo's Express 5.2.1); H-12 the supersession test never
> asserted supersession happened. New `src/__tests__/wizmatchPolicyRoutes.test.ts` pins path
> precedence, the role gate that actually fires, and flag-off 404s against a real Express app.
>
> **Twelve Highs open**, including: requirement-priority fails **open** on a null `companyId`; the
> canonical REVIEW branch for contact intelligence is dead code; `priority` is folded but `nextAction`
> is not, so the workbench offers a live POST on a denied company; the fifth caller's scope-out reason
> is falsified by this same PR; the adapter test's mock discards `.where()`; unknown
> `outreachEligibility` fails **open**; `evidence_url` is not SSRF-scrubbed though §10.1/§18.2 name
> the control as shipping here; and **the PR 4 marker's flag-gating claim is false** — the Duplicate
> Companies page has no flag import and its nav entry and route are unconditional.
>
> **Gates on the post-fix tree:** `git diff --check` clean · build exit 0 · **110 files / 970 tests** ·
> `admin:build` clean · Playwright 97 passed / 15 skipped / 0 failed. Boundary checks all pass — no
> guardrail file, no `package-lock.json`, no Growth/SEO/n8n or legacy-outreach contamination, no send
> or paid-provider capability enabled, no production action.

**Exact next action:** get the owner decision on C-1, implement it, close the twelve open Highs, then
re-review. **Do not** merge, deploy, apply 0037, run backfill `--apply`, promote `enforce`, or start
PR 6 until that is done.

---

## Prior task — PR 5 implementation (self-reported)

**PR 5 IMPLEMENTED (self-reported, not independently reviewed) 2026-07-26 —
WizMatch Outbound Operating System, PR 5 of 10 (lifecycle consolidation).** Branch
`ge/outbound-05-lifecycle-consolidation` (cut from `ge/outbound-04-policy-ui-backfill`), local only,
NOT pushed, NOT merged. Marker: `.ai/OUTBOUND_PR5_IMPLEMENTED`. Full detail:
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 5 section.

**Scope delivered:** migrated the five legacy eligibility computations named in PRD-005 §5.2 C-2 onto
the canonical resolver (`resolveCompanyStatus`/`evaluateWizmatchOutreachGate`, built in PR 2) via a
new compatibility adapter, `src/modules/outreach/legacyEligibilityAdapter.ts`. Four migrated
(`wizmatchClientDiscovery.ts`, `wizmatchCommandCenter.ts`, `wizmatchRequirementPriority.ts`,
`wizmatchContactIntelligence.ts`/`Repo.ts`); one (`wizmatchCandidateIntelligence.ts`) explicitly
scoped out with a disclosed reason (scores a candidate, not a company — the gate requires a
`companyId` this file structurally lacks). Fixed the concrete ADR-006 D-13 violation in
`wizmatchContactIntelligenceRepo.ts` (persisted legacy `status` no longer overrides a freshly computed
status, in both the read path and the write-time freeze clause). Added a contract test file proving
the migrated callers agree with the canonical resolver, and a source-level guard test preventing a
sixth independent eligibility computation.

**Verified this session:** `git diff --check` clean; `npm run build` exit 0; `npm test` 109 files /
966 tests green (was 107/948). No admin/UI files touched, so `admin:build`/Playwright were not run.

**Not done, deliberately:** migration 0037 still unapplied; backfill `--apply` not run; Today page not
re-bucketed; free-prep pipeline not built; no provider integration; enforcement mode untouched
(`shadow`); sending/paid-discovery/Smartlead untouched; U-13/U-14/U-10/U-12/L-7…L-13 from the PR 3
review still open, untouched by this PR (carried from PR 4, not this PR's scope).

**Exact next action:** get an independent readiness review of PR 5 (three-subagent method, per the
PR 2/PR 3 precedent — this marker is self-reported and has not had that yet), then PR 6 (decision
workbench — queues API + Today re-bucket + bulk bar) per the standing 10-PR programme. Stop after PR 6.

---

## Prior task — PR 4, policy UI/API/backfill/readiness

**PR 4 IMPLEMENTED (self-reported, not independently reviewed) 2026-07-26 at `9561c10` —
WizMatch Outbound Operating System, PR 4 of 10.** Branch `ge/outbound-04-policy-ui-backfill`
(cut from `ge/outbound-03-policy-enforcement`), local only, NOT pushed, NOT merged. This session
resumed an interrupted PR 4 build: most of the implementation already existed uncommitted in the
worktree; this session verified it against AGENTS.md/CLAUDE.md, PRD-005, ADR-006, ADR-007 and the
handoff log, fixed three defects found while verifying (a stray compiled `.js` duplicate of the
backfill script; `WizmatchDuplicateReviewPage` had a nav entry but no route wired into `App.jsx`;
`CompanyPolicySection` crashed the whole company drawer on a malformed policy-API response — caught
by two failing Playwright specs), ran the full gate suite, and committed. Marker:
`.ai/OUTBOUND_PR4_IMPLEMENTED` (full detail, including the exact gate output and everything
explicitly not done, is there — read it before resuming).

**Scope delivered:** policy read/write API + RBAC + admin bulk actions
(`src/routes/wizmatchPolicy.ts`, `src/modules/outreach/policyService.ts`); duplicate-company
review/resolve (`src/modules/outreach/duplicateService.ts`); dry-run-first backfill CLI
(`scripts/onboarding/wizmatch-policy-backfill.ts`, `src/modules/outreach/policyBackfill.ts`);
the §21.1 readiness report/CLI (`src/modules/outreach/policyReadiness.ts`,
`scripts/wizmatch-policy-readiness.ts`); company-drawer Policy section + a new Duplicate Companies
admin page. Everything is behind `WIZMATCH_COMPANY_POLICY_ENABLED` (default false — API 404s,
UI renders nothing when off).

**Verified this session:** `git diff --check` clean; `npm run build` exit 0; `npm test` 107 files /
948 tests green; `npm run admin:build` clean; full `playwright.wizmatch-local.config.ts` suite —
97 passed / 15 skipped (real-backend specs, no server started) / 0 failed.

**Not done, deliberately:** migration 0037 still unapplied; backfill `--apply` not run; enforcement
mode untouched (`shadow`); sending/paid-discovery/Smartlead untouched; **U-13** (`resolveWizmatchLinkage`
returns an arbitrary company on multi-linkage, fail-open), **U-14** (bulk-email/export per-row gating
performance), U-10, U-12, L-7…L-13 from the PR 3 review are **not folded into this PR** — no code in
this commit touches `wizmatchLinkage.ts` or the bulk-gating call sites. They were not part of the
already-started work found in the worktree this session, and this session was instructed to finish
only that, not start new scope. Recorded as open, not silently dropped.

**Exact next action:** get an independent readiness review of PR 4 (three-subagent method, per the
PR 2/PR 3 precedent — this marker is self-reported and has not had that yet), then an owner decision
on whether U-13/U-14/U-10/U-12/L-7…L-13 land as a PR 4 follow-up commit or are explicitly deferred to
PR 5. Then PR 5 (lifecycle consolidation) per the standing 10-PR programme. Stop after PR 5.

---

## Prior task — PR 3, policy enforcement (shadow) + readiness review

**PR 3 REVIEWED AND CODE READY 2026-07-26 at `21b3bc3` — WizMatch Outbound Operating System, Wave A.**
Branch `ge/outbound-03-policy-enforcement` (cut from `ge/outbound-02-policy-schema-service`), local
only, NOT pushed, NOT merged. Implements PRD-005 §22.3: every §8.10.1 caller-migration-checklist row
closed (migrated onto the gate, gate-or-reject, or routed through `suppress()`), A-1/A-4/mailer/HMAC
fixes, shadow-mode-default enforcement with a shadow-vs-enforce equivalence harness.
Marker: `.ai/OUTBOUND_PR3_CODE_READY`. **Does not promote `enforce`, does not enable sending** — both
kill-switches and the enforcement-mode default are untouched/off.

> **Independent readiness review 2026-07-26 — verdict fix-then-ship.**
> `docs/reviews/wizmatch-outbound-pr3-opus-review.md`. Three read-only Explore subagents; **six defects
> found and fixed in `21b3bc3`**, each with a control run proving the new test fails on it. Two of the six
> made the gate *report* a block while permitting the state it existed to prevent: row 4 hand-rolled
> `decision === 'deny'` so a `review` decision queued drafts every other site blocks, and row 12
> committed `status='approved'` on autocommit and *then* returned 403. Also: `POST /suppression` flipped
> `contacts.do_not_contact` for `hard_bounce` (the §8.4 grain collapse); `suppress()` wrote its audit row
> in a second autocommitted statement; `/send-test` discarded the resolved `contactId` so the A-1
> suppression union degraded to one grain; all three contact-grain writes missed mixed-case channel rows.
> The equivalence harness was strengthened — as submitted it compared the gate to itself, so **a live
> divergence in the same diff left it green**. Suite 103 files / **916** tests (was 896), build 0, tree clean.

**READ THIS BEFORE MERGING — hard deploy-order prerequisite (B-1), new and previously unrecorded.**
`suppress()` writes `wizmatch_suppression_events`, created **only by migration 0037**, which is
deliberately unapplied (G1, pending U-7). Before 0037 is applied, the **public
`GET /api/wizmatch/unsubscribe` route throws** (it worked before this PR), `POST /suppression` and
`/classify-reply` 500, and hard bounces are dropped — re-creating the A-4 defect §22.3 #6 closes.
This repo **auto-deploys on push to `main`**, so: **apply 0037 before PR 3 reaches `main`.**

**Four owner decisions before G4** (detail in the review §11): **U-8** unsubscribe tenant lookup is
"most recent sender wins" across tenants and the HMAC carries no tenant to disambiguate; **U-9** rows
15-17 gate at preparation level though §8.10.1 labels them `enrol`/`follow-up`; **O-1** §16 rule 5's
Slack-alert-on-mode-flip has no implementation and was undisclosed; **U-11** confirm PR 4 owns the
persisted `gate_denied` row. **B-2:** M-5/L-6 (the PR 2 review's own stated PR-3 prerequisites) are
still open and were undisclosed — the gate mocks still discard `.where()`, so deleting
`isNull(supersededAt)` or the linkage tenant predicates leaves the suite green. Close before G4.

**Exact next action:** get owner decisions on U-8, U-9 and O-1, then create
`ge/outbound-04-policy-ui-backfill` from `ge/outbound-03-policy-enforcement` and implement PRD-005's
PR 4 scope — policy read/write API + RBAC, company-drawer Policy section, effective-policy provenance
UI, duplicate comparison/Merge/Confirm-Separate, admin bulk actions, dry-run-first backfill (never run
`--apply`), readiness endpoint/CLI, pending-duplicate and shadow-block reporting. Fold in U-13
(most-restrictive-wins across multiple company linkages — today `.limit(1)` with no `ORDER BY` lets an
eligible company mask a blocked one), U-14 (batch or tenant-short-circuit the per-row gating on
`bulk-email`/`export`), U-10, U-12 and L-7…L-13. Flags default false. Then PR 5 (lifecycle
consolidation). Stop after PR 5.

---

## Prior task — PR 2, schema + migration + resolver/gate module

**DONE 2026-07-26 — WizMatch Outbound Operating System, PR 2 of 10
(`ge/outbound-02-policy-schema-service`, schema + migration `0037` + resolver/gate module — NOT
committed as a PR, local branch only, NOT pushed, NOT merged).** Implemented against PRD-005 §22.2
(twenty acceptance criteria). Full detail: `docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`. Summary:

> **REVIEWED 2026-07-26 — verdict fix-then-ship.**
> `docs/reviews/wizmatch-outbound-pr2-opus-review.md`. Two Critical and five High defects found and
> fixed in four corrective commits (`79bb384`, `3057221`, `e690ac1`, `810d144`). The headline: **0037
> could not apply to any database** — all 29 composite FKs preceded their `(tenant_id, id)` target
> indexes (SQLSTATE 42830); fixed by statement reorder only. Also: `PolicyDecision` was forgeable;
> allowed campaign types/modes were zeroed on a deny; L1c hardcoded `preparationAllowed: true`; the
> suppression read did not lowercase the stored column; reason codes named the wrong cause; L5
> duplicate containment was never implemented. **One §22.2 criterion remains open: #16**, the
> cold-start root-policy row on every company insert path — needs an owner call on PR 2 vs PR 3, and
> must land before G2/G4. Suite now 60 outbound tests / 867 total, build 0, tree clean.
> The counts below are as-submitted and are superseded by the review where they differ (notably: 29
> composite FKs, not 22; 60 outbound tests, not 37; 99 files / 867 tests, not 97 / 840).

- `src/db/schema.ts` — 8 new tables (`wizmatch_company_policies`, `_policy_events`,
  `_duplicates`, `wizmatch_reply_mailboxes`, `wizmatch_outreach_batches`, `_enrolments`, `_events`,
  `wizmatch_suppression_events`), 2 additive ALTERs (`wizmatch_companies.account_owner_user_id`,
  `wizmatch_suppression_list.contact_channel_id`/`channel_invalid`), 6 additive non-partial
  `(tenant_id, id)` unique indexes (§10.10.1), 22 composite FKs, all §10.1/§10.6.1/§10.6.2/§10.7/§10.9.1
  CHECKs. `admin_override` and `suppression_scope` do not exist. Existing
  `wizmatch_suppression_tenant_email_uniq_idx` untouched.
- `src/db/migrations/0037_unknown_siren.sql` — generated by `db:generate`, then hand-hardened with
  `IF NOT EXISTS`/`DO $$...EXCEPTION WHEN duplicate_object` guards on the two ALTERs on long-lived
  tables (H-11), plus a marked manual guard block (§10.11.2) containing the one construct drizzle-kit
  cannot emit: the policy-immutability trigger (ADR-006 D-10). Zero destructive statements confirmed
  by grep. Journal `when=1785039545644` > `1784464092263`. **NOT applied to any database — that is G1.**
- `src/modules/outreach/` — `policyTypes.ts` (branded `PolicyDecision`), `scopeKey.ts`
  (`buildScopeKey()`, the sole producer of `scope_key`), `scopeApplicability.ts` (§8.1.1 region/BU/
  location resolution, fails closed per H-4), `policyResolver.ts` (Phase-0 per-dimension inheritance),
  `campaignCompatibility.ts` (§8.6/§8.7 routing matrix + combination rule), `outreachGate.ts`
  (`evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed` / `resolveCompanyStatus` — L0-L8,
  fail-closed, no legacy fallback).
- `src/config/wizmatchOutreachStates.ts` — the one exported constant all four §10.6.2 partial-index
  predicates and the enrolment-state CHECK derive from. `src/config/wizmatchReasonCodes.ts` — the §9
  taxonomy as data, with a mechanical §9.11 invariant checker.
- Tests: `wizmatchOutreachGate.test.ts`, `wizmatchScopeKey.test.ts`, `wizmatchReasonCodes.test.ts`,
  `wizmatchCampaignCompatibility.test.ts` — 37 new tests, all passing. Full suite: 97 files / 840 tests
  passing (`npm run admin:install` run first, closing the pre-existing `lucide-react` load-failure gate).
  `npm run build` exits 0. **No caller migrates onto the gate in this PR** (PR 3 scope, §8.10.1).

**Known PR-2 scope limits, stated not hidden** (see `outreachGate.ts` header comment): the cold-start
contact-confidence gate (§7) is not wired in (no caller supplies it yet); duplicate-suspect containment
(L5, §8.8) is not queried from the gate in this PR; shadow-vs-enforce is a no-op either way since
nothing calls the gate yet. **Could not run:** the §10.11.4 fresh-database replay / incremental-apply /
re-apply-idempotency / production-drift-diff / lock-measurement / trigger-fire checks — direct
Postgres access (`psql`) was denied by this session's tool-permission layer despite a local Postgres
being available. These remain to run, with real output recorded, before G1.

---

## Prior task — PR 1, PRD + ADRs (docs only)

**IN PROGRESS 2026-07-26 — WizMatch Outbound Operating System, PR 1 of 10 (docs only, DRAFT PR, NOT
MERGED).** Branch `ge/outbound-01-prd-adrs`, worktree `~/repo-comparison/v2-outbound-os`, cut clean
from `origin/main` = `1e74812`. Adds `docs/prd/005-wizmatch-outbound-operating-system.md`,
`docs/decisions/ADR-006-company-outreach-policy.md` and `ADR-007-outreach-provider-boundary.md`.
**Documentation only** — no `schema.ts`, no migration, no backend, no frontend, no Railway change, no
env change, no production data, no sending, no paid provider. Full status:
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`.

**Push state:** `687b8a0` **is** on `origin/ge/outbound-01-prd-adrs`. Later commits are local only.
Do not rewrite that branch's history.

**SPEC-REPAIR PASS COMPLETE (2026-07-26).** The overnight Opus review
(`docs/reviews/wizmatch-outbound-overnight-opus-review.md`) found six CRITICAL and twelve HIGH defects
**in the specification**, not in code — no code exists. All are now dispositioned in that report's new
§19. Eight owner decisions D-1 … D-8 are recorded as PRD-005 §25.1 A-22 … A-30:

- **D-1** missing root policy fails closed (`policy_missing_root`); the legacy-status fallback is
  deleted, and `wizmatch_company_intelligence.status` is display-only from here on.
- **D-2** all 22 cross-table entity references become composite `(tenant_id, ref_id)` FKs;
  `scope_ref_id` is deleted in favour of typed `signal_id` / `requirement_id`.
- **D-3** raw SQL approved for the immutability trigger only, inside a marked guard block;
  `admin_override` deleted.
- **D-4** suppression keeps three grains in three homes; `suppression_scope` deleted and the existing
  `UNIQUE (tenant_id, email)` retained, so `0037` is **additive** (it was previously believed not to be).
- **D-5** one mandatory chokepoint — `evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed`
  — plus a 31-row caller-migration checklist that is PR 3's acceptance evidence.
- **D-6** a reply does **not** release the company cold-email lock; 15 enrolment states, 8 live, 7
  terminal.
- **D-7** every permanent or non-overridable block requires evidence, CHECK-enforced.
- **D-8** the taxonomy freezes when PR 2 lands values, not before.

**PR 2 is unblocked.** Build against PRD-005 **§22.2** (twenty acceptance criteria); PR 3 against
§22.3. Marker: `.ai/OUTBOUND_PR2_SPEC_READY`. Two owner items remain open and neither blocks PR 2 —
**U-6** Smartlead fixtures (blocks PR 9) and **U-7** sign-off on three shared-table indexes (blocks G1).

**Reason-code taxonomy RATIFIED (2026-07-26), then corrected in the repair pass.**
`policy_accepts_external_vendors` requires evidence; `contact_role_mismatch` replaced by
`contact_role_uncertain` and `contact_role_confirmed_mismatch`; the 2026-07-09 cost-leakage audit's
"alert + keep sending" mailer decision is annotated superseded by ADR-006 D-11 (fail closed). The
repair pass additionally fixed five evidence violations, three preparation-flag contradictions, and
added `manual_admin_override` and `manual_lock_release`.

**What it specifies.** A decision-first outbound layer extending (not replacing) PRD-004: a scoped
company **outreach policy** authoritative over signal score and contact approval; a four-queue Today
decision workbench (Ready to Contact / Needs Review / Replies Needing Action / Paused or Blocked); a
zero-cost automatic preparation pipeline; and a provider-neutral outreach adapter whose first
implementation is Smartlead **CSV export + result CSV import** — no API, keys or recurring cost.

**Load-bearing design calls** (full rationale in ADR-006): policy scope identity is a canonical
`scope_key` (`entire_company`, `region:india`, `business_unit:cloud`, `signal:<uuid>`, …) so two
business units can both hold active policies while a duplicate is rejected by the database;
**per-dimension inheritance** with `entire_company` as the root, so a location-only pause never resets
an `existing_client` relationship or a company-wide hiring policy; hard blocks beat specificity;
`block_class` (`standard`/`compliance`/`legal`) + `is_non_overridable` replace a single overloaded
legal-hold flag, and a company removal request is **compliance, not legal**; privacy/GDPR erasure is
explicitly **not** an outreach policy and needs its own workflow (PRD §18.4, FUTURE list).

**Audit findings this stack fixes.** P0 — suppression is **fail-open**: `sendSignalDraftEmail()`
(`src/services/wizmatchOutreachService.ts:183-189`) checks only `wizmatch_suppression_list` and never
`contacts.do_not_contact`, which `PATCH /api/contacts/:id` sets freely. P1 — hard bounces are detected
then discarded (`wizmatchBounceParser.ts:57-77`, default-off flag). P1 — `POST /api/wizmatch/classify-reply`
is fully implemented but has **no caller in the repo**. Carried, not fixed: the `sequence_step` job
loop is dead (n8n undeployed since 2026-05-03), so WizMatch gets its own enrolment table instead.

**Exact next action (superseded by the PR 2 update above — kept for history):** ~~create
`ge/outbound-02-policy-schema-service`... begin PR 2~~ — **done**, see the Active task section at the
top of this file. Remaining before G1: run the ten §10.11.4 fresh-database verification requirements
with real output (needs a scratch Postgres — **not optional**: skipping the fresh `0000→0037` replay is
exactly what hid the Critical FK-ordering defect the review found), and obtain owner sign-off on U-7
(the three shared-table indexes).

**Before PR 3, in order:** (1) owner decision on §22.2 #16, the cold-start root-policy write on every
company insert path — the one criterion still open; (2) add a `lower(email)` expression index, since
the suppression-normalisation fix makes that read a sequential scan; (3) converge the two gate test
mocks so the original suite can also detect a wrong query predicate. Then PR 3 proper (caller migration
onto the gate, per the §8.10.1 checklist). Full list: §12 and §13 of
`docs/reviews/wizmatch-outbound-pr2-opus-review.md`.

**Rollout is gated.** Enforcement ships in `shadow` mode (logs what it would block, blocks nothing);
promotion to `enforce` needs a readiness report plus five hard preconditions and is an explicit owner
decision. `WIZMATCH_SENDING_ENABLED` and `AUTOMATED_EMAILS_ENABLED` are not modified by any milestone.

## Prior task — cost-safe POC/client search

**SHIPPED 2026-07-16 (`origin/main` = `695a139`, Railway deploy `35c38b14` SUCCESS): cost-safe
POC/client search — read-only preview + role targeting + credit banner.** Surfaces the existing
free-first, capped machinery so you can search for POCs (Talent Acquisition / HR-People /
Hiring-Delivery Mgr / Vendor-Procurement) without wasting credits: `buildPocSearchQuery(company,
domain, roles?)` is role-parameterized (default = original all-roles query, unchanged); a new
read-only `POST /signals/:id/discover-poc/preview` (`previewFreePocSearch`) returns the exact query +
remaining SearchAPI allowance (today X/5 · month Y/80) + cooldown/internal-contacts state + estimated
credit cost (0 or 1) and **calls no provider** (pure DB read); `/discover-poc` now takes a `roles`
body. The Signals "Find POC" is preview-first (query + role toggles + credit/cost + "Run free
search"), plus a Search-credits banner over the sourcing cards. The free run itself is unchanged
(internal CRM → website scrape → SearchAPI 1 credit only within the 5/day+80/mo caps + 30-day
cooldown + ≤5 cap; channels never guessed); Apollo/Snov stay OFF behind their gate. No schema/
migration, no guardrail file, no new env var. **Verified:** tsc, 455 Vitest (new
`wizmatchPocSearchPreview.test.ts` — role-set query builder + preview cost logic, DB-only/no-provider),
admin build, 97 Playwright (sourcing spec updated to preview-first). **Live:** deploy SUCCESS, zero
5xx, `/health` 200, SPA 200, the new preview route 401 (intact). **Enablement — NOW DONE:**
`WIZMATCH_POC_DISCOVERY_ENABLED=true` was set on the production `web` service (env
`81b087de`, Railway) and applied via a redeploy (empty commit `7223b49`, deploy `2c895610` SUCCESS —
`set_variables` alone did not restart the process, so a push was needed to reboot with the flag).
`SEARCHAPI_API_KEY` was already present (validated in prior handoffs; not re-read, to avoid leaking).
So the free POC search now RUNS in prod (capped 5/day + 80/mo + 30-day cooldown + ≤5 results,
preview-first, channels never guessed). **Apollo/Snov paid discovery stays OFF** behind
`WIZMATCH_PAID_DISCOVERY_ENABLED` + its cost guard — untouched.
Client-side cost-safety (TheirStack free preview + SearchAPI allowance) is on the same Signals
sourcing cards; Companies paid `discovery-preview` + Client-Discovery seeding are unchanged (paid
stays off / seeding is credit-free).

## Prior task — comprehensive filters on every page (SHIPPED `d7906e0` + analytics scoping `9767469`)

**SHIPPED 2026-07-16 (`origin/main` = `d7906e0`, Railway deploy `88cd21cf` SUCCESS): comprehensive,
consistent filtering on every Wizmatch page.** A new shared filter/table system
(`admin/src/components/wizmatch/filters/`: `useTableControls` + `FilterBar` + `filterPipeline` +
`exportCsv`, plus a sortable/column-hideable `ui/DataTable`) is wired into all 10 pages: Job
Leads/Signals, Candidates, Requirements, Companies, Hiring Contacts (both tabs), Talent Matching,
Submissions/Delivery, Placements, Contact Intelligence, Reports. Every page gets type-aware filters
(search / multi-select / numeric+date ranges / toggles), active-filter chips + Clear all, **shareable
URL views** (filters/sort/columns/page in the query string), **saved presets** (localStorage per
`pageId`), **CSV export of the filtered set**, and — on the table pages — sortable headers + column
show/hide. Server-paginated pages (Signals/Candidates/Requirements) filter AND **sort globally**
server-side via a safe allowlisted ORDER BY (`wizmatchOrderBy`; the user key/dir only look up a
hard-coded column map + normalised direction + `created_at` tiebreaker), and their CSV re-fetches the
full filtered set at the backend max (200). Client pages (Companies 500-cap, Delivery, Placements,
Contact Intelligence, Hiring Contacts fan-out) filter/sort in-browser over the loaded set. Backend
changes are **read-only query params + ORDER BY only** — no schema/migration, no env var, no
auth/RBAC/Cashfree/SOD-EOD, no pilot-flag change; one CI LATERAL join added to `listCompanies`.
**Verified:** tsc clean, 446 Vitest (53 files, incl. new `wizmatchRequirementsFilters.test.ts`
asserting the ORDER BY allowlist + injection-safe fallback), admin build clean, 97 Playwright (0
failed) — the loop caught + fixed 8 regressions (FilterBar contrast a11y across 6 pages, Reports
Status control, Companies URL shape, chip/checkbox/transition edge cases). **Live-verified** on prod:
deploy SUCCESS, no boot errors from the change, zero 5xx since deploy, `api/health` 200, CRM SPA 200,
wizmatch filter routes 401 (intact) with the new `sort=`/multi-value params. **Known follow-ups (not
blockers):** the staffing-analytics *date* filter on Reports is now **SHIPPED** (`9767469`, Railway
deploy `ca1fb1f6` SUCCESS) — `analytics(tenantId, from?, to?)` scopes the funnel/revenue/time-to-
start/recruiter+source/rejection metrics by the From/To range (SLA exceptions + aging stay
current-state; clearing the range = all-time); Reports `Status` is single-select (kept a funnel spec
meaningful); Placements recruiter/prime filters need backend fields;
client pages past their cap (Companies 500, etc.) need server pagination later. Also still open from
before: the broken cold-outreach send loop; strict India-only tightening; the deferred region-column
migration.

## Prior task — India-only sourcing (SHIPPED `ade021a`)

**SHIPPED 2026-07-16 (`origin/main` = `ade021a`, Railway deploy `b508ecc1` SUCCESS): India-only
sourcing.** Behind a `WIZMATCH_INDIA_ONLY` flag (default on, no infra change): the ATS poller drops
confident-US postings at ingest (keeps India + remote/blank — neutralizes US even if a US company
keeps polling, so no `ats_type` cleanup); X-Ray seed queries are now all Indian metros; the signals
list (`GET /signals`) excludes confident-US by default (`region=all` bypass, `region=us` invert);
Job Leads has an "India only / All regions" toggle (default India) and Requirements default to India;
the misleading "Outreach" nav decoy (Growth Saleshandy dashboard) was removed. TheirStack + SearchAPI
were already India-scoped. No schema/migration; existing US rows kept (hidden), viewable via the
toggle. **Live-verified**: Job Leads default 6714→3819 (US hidden), toggle restores 6714, Outreach
gone, zero console errors / Railway 5xx. **Known limitation / recommended next step**: the rule is
"exclude confident-US, keep ambiguous", so non-US **non-India** roles (e.g. Spotify São Paulo/Korea,
Airbnb) still show in the India view; tightening to *strict* India-only means excluding all confident
non-India places (with the tradeoff that an India role labelled only "Remote/Global" could be hidden).
Also still open: the broken cold-outreach send loop; the deferred region-column migration.

## Prior task — matching reachable + discardable drafts (SHIPPED `5cb7c31`)

**SHIPPED 2026-07-16 (Railway deploy `f4274479` SUCCESS): candidate
matching is now reachable through the UI + draft requirements are discardable.** The actionable
Gate-B matcher (`POST /staffing/requirements/:id/matches/recalculate`) had no UI trigger and the
Talent Matching workspace was hidden, so a user couldn't get from a requirement to recalculated
matches. Now: a "Recalculate matches" button in the requirement drawer runs the matcher and renders
ranked candidates (score/dimensions/blockers) with Shortlist/Watch/Reject, sorted by score + a
hide-blocked toggle + an "add must-have skills first" hint; Talent Matching is in nav + Cmd-K
search; requirement `?id=` deep-links open the drawer; the signal "Create requirement draft" shows
an "Open requirement →" CTA; requirement rows show a matched-candidate count badge. Backend: a DRAFT
requirement with only undecided (algorithm-computed) matches + no submissions is now deletable,
cascading its match rows + snapshots (discard experimental drafts); non-draft/human-decided/submitted
still 409. **Live walkthrough proved it end-to-end**: seeded a disposable company+signal → qualified
→ free Find-POC (paid off, 0 contacts found, ≤2 cap honored) → promoted → **Recalculate produced 311
ranked matched candidates** → draft-cascade delete removed the requirement + all 311 matches → signal
+ company deleted. Zero console errors, zero Railway 5xx. No schema/migration/guardrail/env/pilot-flag
change. Minor follow-up: the requirement delete-dialog copy still says "no candidate matches" (stale
frontend text; backend now allows undecided matches).

## Prior task — signal-500 fix + manual delete + candidate max-detail (SHIPPED `3b1dd05`)

**SHIPPED 2026-07-16 (Railway deploy `0e45691d` SUCCESS): signal-detail
500 fix + manual-delete for every entity + candidate max-detail.** The tenant-wide 500 on
`GET /api/wizmatch/signals/:id` (drafts sub-query used `messages.created_at`; that table only has
`sent_at`) is fixed and verified live (200, no console/Railway 5xx). New manual-delete affordances:
Job Signals "Delete permanently" (existing backend, new UI); Hiring-contact/POC **hard** delete
(new `deleteCompanyContact` — relationship-only, keeps the CRM contact + history, blocks on active
attribution/submission/interview); company/candidate/discovered-contact delete surfaced
consistently. Candidate 360 now returns + renders submission history. Both residual
`PROD_SMOKE_WIZMATCH_20260715221717` records (signal + company) were deleted live via the new UI.
POC hard-delete UI/route is unit+e2e-tested and deployed but wasn't exercised live (production has
zero linked hiring contacts to click). No schema/migration/guardrail/env/pilot-flag change.

## Prior active task — entity-first UI/UX push

**Entity-first UI/UX + complete-build push is live (commit `2d8ddd6`, Railway deployment
`baec1d83`, `SUCCESS`) — a navigation/UX/safety-tooling release, not a pilot-scope change. The
Wizmatch results-first sourcing pilot task below is still the substantive product work in front of
Jatin/Kanishk; this push doesn't change what they need to do next.**

Work directly in `/Users/jatinagrawal/repo-comparison/v2` on `main` (now equal to `origin/main`).
The `v2-wizmatch-phase0-trust` worktree referenced below may be stale relative to `main` post-push —
re-verify its branch position before resuming work there.

## Prior active task (still relevant — pilot data review)

**Wizmatch results-first sourcing — provider release is live for the Jatin/Kanishk production
pilot. Review genuine signals and configure approved ATS boards; enable X-Ray only after the first
genuine accepted, skill-reviewed requirement exists.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

## Verified release candidate

- `c293b88` adds SearchAPI.io public research, shared POC/X-Ray allowance, provider-account status,
  real free TheirStack preview, hiring-team evidence, requirement-specific X-Ray queries and honest
  provider UI.
- `142eb51` handles free-credit account reporting, excludes up to 500 seen TheirStack job IDs before
  paid retrieval, and retries one transient SearchAPI timeout/429/5xx response.
- No schema or migration changed. No credential value entered Git, docs, `.ai`, screenshots or
  command output.
- Final local suite: TypeScript build; 47 files / 395 Vitest tests; admin production build; 22/22
  Wizmatch Playwright scenarios; `git diff --check` clean.

## Isolated staging evidence

- Deployment `d3b0e543-87db-4fe3-87e2-703bebcbc350` is `SUCCESS`; health/database are green.
- Supplied temporary credentials validate: TheirStack reports 200 credits; SearchAPI.io reports
  100 starting free credits. Values remain secret.
- TheirStack imported 29 public India target-role signals across two capped runs: all 29 have
  distinct provider IDs and matching SAP/Java/JavaScript/frontend title evidence. One provider
  repeat updated the existing row rather than creating a duplicate; the release now excludes seen
  IDs before retrieval.
- ATS refreshed 10 controlled Greenhouse jobs with no new duplicates or errors.
- POC research produced six named public candidates and correctly left them
  `identified_channel_pending`; no email/phone was guessed.
- Requirement-first X-Ray produced 10 requirement-linked leads. All 10 remain unreviewed and cannot
  enter canonical matching until a recruiter validates evidence.
- Authenticated live Signals UI passed desktop, tablet and 390px mobile with all provider cards,
  shared allowance, no horizontal overflow, no console errors and no 5xx responses.
- Legacy Wizmatch automation, sending, paid discovery and Google fallback remain off. No outreach,
  consent, submission or production business record was created.

## Production activation

- `05a5c5a` is live. Code deployment `5e8d1302-2c50-4a2b-b7b3-4f3e1e160023` and provider-flag
  deployment `8d68a585-5277-4be4-8e90-cc830e1b4036` both reached `SUCCESS`.
- Source master, TheirStack, ATS and POC discovery are active. SearchAPI/TheirStack accounts validate;
  X-Ray is configured but off. Legacy automation, sending, paid discovery and Google fallback are off.
- The first production TheirStack run fetched/inserted 15 genuine public target-role signals with no
  errors or duplicates. Their 15 provider IDs are distinct. ATS ran safely but polled zero companies
  because no production company has an approved ATS board yet.
- Production Signals UI passed desktop/tablet/390px with no overflow, console errors or 5xx. Health
  and database are green; sampled traffic had zero 5xx, p95 73 ms and healthy CPU/memory.

## Exact next action

Jatin/Kanishk review the 15 signals in Job Signals, qualify useful ones, run Find POC, verify a genuine
contact channel and promote only real demand. Configure ATS type/slug/board URL on approved Company
360 records. Once one genuine requirement is accepted and has reviewed mandatory skills, enable
`WIZMATCH_XRAY_CANDIDATE_ENABLED=true` and run one manual requirement-first search.

Never add users, enable pilot-all, sending, paid discovery, Google fallback, legacy automation,
automatic requirements, outreach, consent, shortlist or submission. Never delete production data.
