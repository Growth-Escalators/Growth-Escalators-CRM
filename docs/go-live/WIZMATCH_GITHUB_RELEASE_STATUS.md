# WizMatch Outbound OS — GitHub release status (Phase 1)

- **Produced:** 2026-07-27, read-only except for one action: PR #89's description was replaced.
- **Branch:** `ge/outbound-08b-g3-pilot-completion` @ `033d1aa7`
- **Final reviewed code commit:** `0d330269`
- **Purpose:** record the verified GitHub/CI/release state before any production access.

---

## 1. Phase 0 — local and remote verification: **PASS**

| # | Check | Result |
|---|---|---|
| 1 | Working directory | `/Users/jatinagrawal/repo-comparison/v2-outbound-os` |
| 2 | Branch | `ge/outbound-08b-g3-pilot-completion` |
| 3 | Working tree clean | Yes (`git status --short` empty) |
| 4 | `input-data/` ignored | Yes — via `v2/.git/info/exclude` (this worktree shares the `v2` git dir) |
| 5 | `input-data/` tracked files | **0** |
| 6 | Local HEAD | `033d1aa7` — expected value |
| 7 | `0d330269` ancestor of HEAD | Yes |
| 8 | `.ai/OUTBOUND_PR8B_CODE_READY` well formed | Yes — `READY` / branch / `reviewed_commit=0d330269` / `reviewed_at=2026-07-27T16:25:30Z` |
| 9 | `reviewed_commit` ancestor of HEAD | Yes |
| 10 | Application code after `reviewed_commit` | **None.** `033d1aa7` touches only `.ai/` and `docs/` (8 files) — docs/marker only |
| 11–13 | Remote state | `origin/ge/outbound-08b-g3-pilot-completion` == local HEAD exactly; 0 ahead / 0 behind; no unexpected force update |
| 14 | Migration `0037` exists | Yes — `0037_unknown_siren.sql`, journal idx 37 |
| 15 | Migration `0038` absent | Yes — not on disk, not in journal |
| 16 | PR 9 / PR 10 absent | Yes — enforced by `wizmatchScopeBoundaryPR8B.test.ts` (comment-stripped source scan with a mutation control) |
| 17 | Secret files tracked | None (`.env.example` and `client/.env.production` only) |
| 18 | Smartlead credential in repo config | None — every `SMARTLEAD_*` name found is in *detection/denylist* code or docs, not a stored value |

### Verification commands

| Command | Result |
|---|---|
| `git diff --check` | clean |
| `npm run build` | exit **0** |
| `npm test` | **132 files / 1551 tests passed** |
| `npm run test:coverage` | **132 files / 1551 tests passed** (CI's exact test command) |
| `npm run admin:build` | exit **0** |
| `npx playwright test --config=playwright.wizmatch-local.config.ts` | **99 passed / 15 skipped / 0 failed** |

The 15 skipped Playwright specs are the `(real backend)` contact-cap and delete/archive specs
(5 specs × 3 viewport projects) requiring a live API on `localhost:3000`. **Skipped, not failed** —
recorded explicitly rather than counted as passes.

### Pilot-readiness matrix (synthetic local values, `/tmp`, never in the repo)

Against the intended final production state — all checks **OK**, `RESULT: no dangerous configuration
detected`.

Six negative controls each correctly produced a `DANGER` and a non-zero exit, proving the gate is not
vacuous:

| Negative control | Caught |
|---|---|
| `WIZMATCH_SENDING_ENABLED=true` | Yes |
| `WIZMATCH_POLICY_ENFORCEMENT_MODE=enforce` | Yes |
| a Smartlead-shaped credential present | Yes (name reported, value never printed) |
| paid discovery / Apollo enabled | Yes |
| all-users roster override | Yes |
| adapter on + `OUTREACH_PROVIDER` set | Yes (two findings) |

A roster of non-UUID-shaped ids is also reported as `DANGER` — so the production roster **must** be
real UUID user ids.

### F-A machine-sync lane — targeted suite

`wizmatchMachineSyncLane`, `wizmatchPilotGate`, `wizmatchIndexMountOrder`,
`wizmatchPilotGateOnOutreachRouter`, `wizmatchScopeBoundaryPR8B` → **5 files / 98 tests passed**.

Mount chain confirmed at `src/index.ts:418`:
`requireAuth` → `wizmatchRequireAdmin` → `wizmatchPilotOrMachineSync` → `wizmatchRouter`.

`PILOT_ELIGIBLE_ROLES` (`wizmatchStaffingAccess.ts:13`) = `admin, team_lead, manager_ops, sales,
staff` — **excludes `viewer`**, **includes `team_lead`** (Itika's required tier). Admission is
`allowed = configured && pilotAllowed` with **no `NODE_ENV` branch** — fails closed in every runtime.

---

## 2. Phase 1 — parallel analysis

Four read-only agents were launched simultaneously. **Three returned complete reports (P1, P3, P4).**
**P2 (stack topology) went idle and never returned a report despite two re-prompts** — its two
critical outputs were therefore re-derived directly by the session lead and are marked as such below.
This is disclosed rather than papered over; the prior G1 preflight recorded the same agent-idle
failure mode.

### 2.1 PR #80–#89 stack (derived directly by session lead)

All ten PRs are **OPEN, DRAFT, and unmerged**, chained head-to-base in sequence:

| PR | Base | Head | Ancestor of `033d1aa7` |
|---|---|---|---|
| 80 | `main` | `ge/outbound-01-prd-adrs` | Yes |
| 81 | `ge/outbound-01-prd-adrs` | `ge/outbound-02-policy-schema-service` | Yes |
| 82 | `ge/outbound-02-policy-schema-service` | `ge/outbound-03-policy-enforcement` | Yes |
| 83 | `ge/outbound-03-policy-enforcement` | `ge/outbound-04-policy-ui-backfill` | Yes |
| 84 | `ge/outbound-04-policy-ui-backfill` | `ge/outbound-05-lifecycle-consolidation` | Yes |
| 85 | `ge/outbound-05-lifecycle-consolidation` | `ge/outbound-06-decision-workbench` | Yes |
| 86 | `ge/outbound-06-decision-workbench` | `ge/outbound-07-free-prep` | Yes |
| 87 | `ge/outbound-07-free-prep` | `ge/outbound-08-outreach-adapter` | Yes |
| 88 | `ge/outbound-08-outreach-adapter` | `ge/outbound-08a-live-pilot-hardening` | Yes |
| 89 | `ge/outbound-08a-live-pilot-hardening` | `ge/outbound-08b-g3-pilot-completion` | Yes (is HEAD) |

**Ancestry proof:** `git rev-list --left-right --count origin/main...033d1aa7` → **`0  72`**.
`origin/main` is a **strict ancestor** of `033d1aa7`; main has not diverged. 72 commits would land.
`git log --format='%s' origin/main..033d1aa7 | sort | uniq -d` → **empty** (no duplicate subjects).
PR #89 therefore already contains the complete reviewed ancestry of the whole stack.

### 2.2 Landing options (session lead; P2's recommendation was never received)

| Option | Prod deploys | Duplicate-commit risk | Auditability | Notes |
|---|---|---|---|---|
| **(a) Retarget PR #89 base → `main`, merge once** | **1** | None (main is a strict ancestor) | #80–#88 keep full review history; #80 auto-closes as merged, #81–#88 stay open until their base branches are cleaned up with a comment pointing at the merge commit | **Recommended** |
| (b) New integration PR `ge/outbound-08b-g3-pilot-completion` → `main` | 1 | None | Same as (a), plus one extra PR record | Equivalent to (a); only worth it if #89's own history is considered too noisy |
| (c) Merge each layer #80→#89 sequentially | 1 *if* strictly ordered bottom-up (only #80's base is `main`) | Moderate — 10 operations, rebase/conflict surface at each | Best per-PR record | Highest operational risk for no additional safety |

**Recommendation: (a).** Because `origin/main` is a strict ancestor, the merge is conflict-free and
no commit is duplicated. **Retargeting or merging PR #89 is a G3 action and requires
`APPROVE_G3_MERGE_DEPLOY_SHADOW`. It has not been done.**

### 2.3 CI and deploy triggers (P3, independently re-verified by session lead)

**GitHub CI has never run on this PR.** `.github/workflows/ci.yml` triggers only on
`pull_request: branches: [main]` and `push: branches: [main]`. PR #89 targets
`ge/outbound-08a-live-pilot-hardening`, so no CI check-run exists for `033d1aa7`.

- Check-runs on `033d1aa7`: `Vercel Preview Comments` (success) only.
- Combined status: `{state: success, total: 1, contexts: ["Vercel"]}` — a **Vercel preview**, not CI.
- `main` branch protection: **404 "Branch not protected"** — no required checks, no required reviews.

So "required CI is green" is **not satisfiable as stated**: there are no required CI checks
configured anywhere in this repo. What was done instead: CI's exact command set
(`npm run build` + `npm run test:coverage`) was reproduced locally and is green. The only way to make
GitHub CI actually execute against this tree is to open or retarget a PR against `main` — itself a
G3-gated action.

#### Deploy-trigger decision table

| Action | Deploys production? |
|---|---|
| Push to `ge/outbound-08b-g3-pilot-completion` | **No** |
| **Updating PR #89's body alone** | **No** — confirmed; no workflow or platform integration keys off PR text |
| Marking PR #89 ready-for-review | **No** |
| Merging into `ge/outbound-08a-live-pilot-hardening` | **No** |
| **Merging into `main`** | **YES** — Railway auto-deploys and **runs pending migrations first** |
| Railway manual deploy/redeploy | **YES** (not performed) |
| Changing a Railway environment variable | **YES** — triggers redeploy (not performed) |

#### Migration-at-startup — confirmed empirically

`railway.json` startCommand: `node dist/scripts/migrate.js && node dist/index.js`, corroborated by
`src/index.ts:12` and by real production deploy logs (`[migrate] Lock acquired` /
`[migrate] Migration complete`). **Merging to `main` will itself apply `0037`.** Note
`get_service_config` reports the start command as only `node dist/index.js` — that field is
misleading; the deploy logs are authoritative.

Railway topology (read-only): project **GE-Backend-Server**, environment **production**, application
service **`web`**, serving `api./crm./ecom.growthescalators.com`. **No separate worker service
exists** — `docs/DEPLOYMENT.md`'s "two Railway services" and `railway.worker.json` are stale/absent.
`mcp__railway__list_variables` was **not called** (it returns plaintext secrets).

### 2.4 Independent security / scope boundary (P4)

All ten scope claims **CONFIRMED** with file-level evidence:

1. Sending disabled and un-triggerable — hard 403 gate before any send logic
2. Campaign/sequence enrolment impossible — but see the caveat below
3. Provider invocation impossible — **stronger than claimed**: `getOutreachProvider()` has zero
   production call sites at all
4. Smartlead absent — every hit is detection code, docs or tests; provider dir has only
   mock + interface + index
5. Paid discovery disabled — all three flags default false
6. Reply ingestion (PR 10) not implemented
7. Auto-prep gated off — route + worker cron on the same flag
8. Machine-sync lane contract holds exactly as documented
9. Roster excludes `viewer`, includes `team_lead`, fails closed in **all** runtimes
10. Scope-boundary guard is non-vacuous and green

**The eight machine-sync paths were each traced to their handler and confirmed read-only** — none
writes to the DB, spends, invokes a provider, or triggers prep/sending:

| Path | Handler | Verdict |
|---|---|---|
| `/dashboard` | `wizmatch.ts:1906` → `buildWizmatchDashboardSnapshot` | READ-ONLY |
| `/command-center` | `wizmatch.ts:2433` → `buildWizmatchCommandCenter` | READ-ONLY |
| `/candidate-intelligence/queue` | `wizmatch.ts:1290` | READ-ONLY |
| `/client-discovery/queue` | `wizmatch.ts:1006` | READ-ONLY |
| `/review-workbench` | `wizmatch.ts:1534` | READ-ONLY |
| `/guardrails` | `wizmatch.ts:1549` | READ-ONLY |
| `/placements` | `wizmatch.ts:3351` — own `['admin','team_lead']` check, so `viewer` gets 403 from the handler | READ-ONLY (functionally dead for the sync; pre-existing) |
| `/candidates` | `wizmatch.ts:3041` | READ-ONLY |

**No remaining vacuous assertions** in `wizmatchMachineSyncLane.test.ts`. The tenant-safety test now
asserts `paramLists.length > 0` *before* asserting no cross-tenant leak, so it cannot pass on an
empty mock-call array — exactly the failure mode `43c7fa89` and `0d330269` fixed.

#### New finding worth carrying forward (not blocking this pilot)

**Sending and sequence enrolment are one gate, not two.** Enrolment happens inside
`sendSignalDraftEmail` immediately after a successful send, with no separate flag. If
`WIZMATCH_SENDING_ENABLED` is ever flipped on for "one supervised send", the live `sequenceWorker.ts`
cron will pick up the enrolment and send automated follow-ups on its own schedule with no further
confirmation. Harmless while sending is off; **must** be understood before any G4 sending decision.

---

## 3. Action taken on GitHub

**One mutation only:** PR #89's description was replaced (`gh pr edit 89 --body-file`). The previous
body was backed up first to `/tmp/pr89_body_backup_20260727T171043Z.md` so the change is reversible.

The old body asserted `CODE READY at 7a0cea20 … zero Critical, zero High` — a verdict that had been
formally **revoked** — plus stale test counts (126 files / 1418 tests) and a findings list
(`M-1, M-2, L-1…L-4`) entirely superseded by the corrected H-1…H-6 / M-0…M-5 set. Leaving it in place
would have actively misled any reviewer.

Post-edit state verified unchanged: **OPEN, DRAFT, base `ge/outbound-08a-live-pilot-hardening`,
head `033d1aa7`, MERGEABLE.** Not retargeted. Not merged. Not marked ready.

---

## 4. Verdict

**Phase 0: PASS. Phase 1: COMPLETE**, with one disclosed gap (P2 idle; its critical outputs
re-derived by the session lead and independently verified).

**Proceed to Phase 2 (read-only production identification and G1 preflight).**

### Carried into Phase 2 as known blockers

`docs/go-live/WIZMATCH_G1_PRODUCTION_PREFLIGHT.md` already recorded a **G1 NO-GO** with five
blockers, three of which cannot be resolved from a coding session:

1. No read-only production database access → no `information_schema` drift review possible
2. The production Postgres cannot be positively identified — three candidates (`Postgres`,
   `Postgres-Bhky`, `Postgres-K0lx`) and the only tool that resolves `DATABASE_URL` leaks secrets
3. U-7 shared-index owner sign-off outstanding since PR 2 (`users`, `contacts`, `contact_channels`
   are shared with the Growth tenant)
4. No production-sized clone exists → no lock measurement
5. G1 and G3 are **coupled** by migrate-at-startup; the owner must choose out-of-band apply vs. one
   combined gate

Nothing in Phase 0 or Phase 1 resolves any of these.

### Confirmations

- No database was accessed. No migration applied. No backfill run.
- No production variable, user role or pilot roster changed.
- No PR merged, retargeted or marked ready. No force-push. No destructive git command.
- No secret value printed. `mcp__railway__list_variables` not called.
- `input-data/` untouched and still untracked.
