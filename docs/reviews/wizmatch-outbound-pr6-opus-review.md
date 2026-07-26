# WizMatch Outbound OS — PR 6 (Decision Workbench) independent readiness review

- **Branch:** `ge/outbound-06-decision-workbench`
- **Parent:** `ge/outbound-05-lifecycle-consolidation`
- **Implementation commit reviewed:** `9b9c2c56`
- **Fix commits made during this review:** `e86704b3`, `c84681f5`
- **Reviewed at:** 2026-07-26T21:05:00Z
- **Reviewer:** independent Opus session. Findings below were verified first-hand against the code
  and, where behaviour was in question, against a running Express harness — not from
  `.ai/OUTBOUND_PR6_IMPLEMENTED`, whose claims are self-reported.

## Final verdict

**READY — after two fixes made during this review.**

As submitted at `9b9c2c56`, PR 6 was **NOT READY**. It contained one Critical defect that would have
taken the entire WizMatch API down in production on the next push to `main`, and one High defect that
made shadow mode block work through the new surface. Both are fixed, both have behavioural regression
tests that fail if the defect returns, and the full gate set is green.

No remaining Critical or High finding. Ten Medium and five Low findings are recorded below and
carried forward; none of them blocks PR 7.

The implementation marker's five self-reported gate results were re-run independently and all five
reproduced on the as-submitted tree. The marker was accurate about what it ran. It was silent on both
defects found here, because neither is visible from the gates it ran — which is the point of this
review.

## Completeness against PR 6 scope

| PRD-005 requirement | Verdict |
|---|---|
| `GET /api/wizmatch/today/queues` (§12) | **Met** — `src/routes/wizmatchToday.ts:46`, four queues + counts + partial disclosure |
| `POST /api/wizmatch/today/actions`, per-target results (§12) | **Met** — `wizmatchToday.ts:57`, `decisionWorkbenchActions.ts:249` |
| Four decision queues (§13) | **Met** — `decisionWorkbench.ts:236` |
| Contextual actions (§13) | **Partial** — see M-A, M-B, M-C |
| Today page extended **in place**, no new route/nav entry (§13) | **Met** — `WizmatchTodayPage.jsx`, route stays `permission: 'always'` |
| `DataTable` `selectedIds`/`onToggleRow`/`onToggleAll` wired (A-9) | **Met** — `TodayDecisionWorkbench.jsx:132` |
| WizMatch bulk-action bar built new, not reusing Growth's (§13) | **Met** — `TodayBulkActionBar.jsx` |
| A-8: delete the two dead pages | **Met** — verified zero importers across `admin/`, `src/`, `e2e/` |
| M-1 closure | **Met, but it introduced the Critical defect** — see C-1 |
| M-2 closure | **Met** |
| No second eligibility engine | **Met after fix** — see H-1 |
| No PR 7 work | **Met** — diff grep for preparation jobs, enrichment, provider adapters, Smartlead, sending, paid discovery returns only prose in `.ai/`/docs and deletions from the removed Command Center page |

**Disclosed scope limits, correctly disclosed and accepted:** the free-preparation pipeline (§14) is
PR 7, so "Ready to Contact" approximates §13's definition with policy decision + contact confidence
and no prep signal; "Reclassify" reuses the `resume` write; "route a reply" is a navigation link, not
the PR 9 enrolment-transition endpoint. These are stated in the marker and in the code, not hidden.

## Verdicts by area

| Area | Verdict |
|---|---|
| Backend | **PASS after fix** (C-1 was a production outage) |
| Tenancy | **PASS** |
| RBAC | **PASS**, with M-C recorded |
| Shadow / enforce | **PASS after fix** (H-1) |
| M-1 closure | **PASS**, with C-1 as its side effect — now fixed |
| M-2 closure | **PASS** |
| Bulk actions | **PASS**, with M-F recorded |
| Frontend & accessibility | **PASS**, with M-B/M-H/M-I/L-A recorded |
| Feature flags | **PASS after fix**, with M-D recorded |
| Test quality | **PASS**, with M-E recorded |

---

## Critical

### C-1 — Both flagged routers 404'd the entire `/api/wizmatch` prefix. **FIXED (`e86704b3`)**

`src/routes/wizmatchPolicy.ts` and `src/routes/wizmatchToday.ts` both gate their surface with
`router.use(featureGate)`, and that gate responded `404` inline. `router.use` with no path matches
**every** path under the mount. PR 6's M-1 fix moved both routers ahead of `wizmatchRouter` in
`src/index.ts`. The two facts together mean that whenever either flag was off, every `/api/wizmatch`
request not handled by `wizmatchStaffingRouter` was answered 404 before it could reach
`wizmatchRouter` — **all 82 of its routes**.

Both flags default to `false`. This repo auto-deploys on push to `main`.

Verified empirically on Express 5.2.1 with a standalone harness replicating the exact mount order and
gate shape:

```
FLAGS OFF /api/wizmatch/companies -> 404 {"error":"not_found","by":"WIZMATCH_COMPANY_POLICY_ENABLED"}
FLAGS OFF /api/wizmatch/command-center -> 404 {"error":"not_found","by":"WIZMATCH_COMPANY_POLICY_ENABLED"}
```

**Why nothing caught it.** `wizmatchIndexMountOrder.test.ts` was a source-text ordering guard — it
asserts statement order in `src/index.ts` and cannot observe routing. `wizmatchTodayRoutes.test.ts`
and `wizmatchPolicyRoutes.test.ts` each mount their router **alone** on a bare app, where a terminal
404 is the correct result. No test mounted the routers together in the real order.

**Fix.** Both gates now call `next('router')`, which exits the router and returns control to the
parent app, so an off flag hides only that router's own paths. Re-verified on the same harness: with
both flags off `/api/wizmatch/companies` → 200 from the downstream router while `/today/queues` and
`/companies/:id/policy` still 404.

`wizmatchIndexMountOrder.test.ts` gains a behavioural suite that mounts the **real** routers in the
**real** order against a stub downstream router. Confirmed non-vacuous: reintroducing the inline 404
fails 2 of its 6 tests.

---

## High

### H-1 — Shadow mode blocked work through the workbench. **FIXED (`c84681f5`)**

`buildTodayQueues` keyed queue placement, `requiresExplicitApproval` and `disabledReason` on
`canonical.decision` directly, ignoring `canonical.actsOnDecision` — the predicate
`legacyEligibilityAdapter.ts` exposes for exactly this purpose, carrying the resolver's own
`decision !== 'allow' && enforcementMode === 'enforce'`.

This is not theoretical. The gate ladder denies well past the stored policy row: L5 duplicate
suspicion, L6b company cold-email lock, L7 suppression (`outreachGate.ts:394-578`). So a company can
be `outreach_eligibility = 'eligible'` **and** canonically denied at the same time. In shadow, that
company was:

- filed under **Paused or Blocked** instead of Ready to Contact — a hidden work item;
- given `disabledReason = "This company is blocked by policy. Reclassify requires an admin."` — a
  disabled action;
- offered **Reclassify** as its primary action, which writes `needs_review` over a company that was
  merely mid-conversation;
- rendered self-contradictorily, showing "Eligibility: eligible" on a card inside the blocked queue.

All four caused solely by a canonical deny while `WIZMATCH_POLICY_ENFORCEMENT_MODE` was `shadow` —
which PRD-005 §16 rule 2 and gate G3 forbid, and which ADR-006 D-31 was ratified to prevent.

The module header argued this was acceptable because the endpoint is new and has no legacy
predecessor. That argument does not hold: PRD-005 §13 defines the four queues **on the stored policy
row** ("policy `eligible`", "policy `needs_review`", "policy `paused` or `blocked`"), not on the gate
decision, so the canonical-first bucketing also diverged from the PRD. The existing unit tests
encoded the wrong behaviour — every fixture passed `enforcementMode: 'shadow', actsOnDecision: false`
and still asserted a deny landed in Paused or Blocked.

**Fix.** Items now carry `effectiveDecision`: the canonical decision when `actsOnDecision` is true,
otherwise derived from the stored policy row (`blocked`/`paused` → deny, `eligible` → allow,
null/unknown → review, which fails closed without blocking). Queue placement,
`requiresExplicitApproval` and `disabledReason` follow `effectiveDecision`.
`canonicalDecision`/`canonicalReasonCode`/`canonicalBlockerCode` are still **always** attached — D-31
explicitly permits displaying canonical metadata — and the UI now discloses a divergence with a
`shadow: would deny` badge rather than silently acting on it. `TodayDecisionWorkbench.jsx` keys its
affordances off `effectiveDecision` for the same reason.

Five shadow-vs-enforce unit tests added, plus an e2e assertion that a shadow-diverged row keeps
"Approve & Queue" and never shows "Reclassify".

---

## Medium (recorded, not fixed — each needs an owner call or exceeds PR 6 fix authority)

- **M-A — Queue precedence deviates from PRD §13.** §13 specifies non-overridable block → overridable
  block → pending duplicate → paused → routed → `needs_review` → `eligible`. The implementation
  collapses blocked and paused into one `deny` tier evaluated **before** duplicates
  (`decisionWorkbench.ts:292`), so a *paused* company with a pending duplicate is filed under Paused
  or Blocked rather than Needs Review. §13's "paused past `review_date` → Needs Review" is not
  implemented, and the **routed** state (`msp_vms_only` / `preferred_vendors_only` / `existing_client`
  → "Open Route" primary) is absent entirely, though `relationshipType` is carried on every item.
- **M-B — "Approve & Queue is disabled with an inline reason" is only half-implemented.**
  `disabledReason` is rendered as text (`TodayDecisionWorkbench.jsx:98`) but the button stays
  enabled. `allowedCampaignTypes`, the other disabling condition §13 names, is not consulted at all.
- **M-C — Reclassify affordance vs role.** §13 labels Reclassify on a blocked company **(admin)**;
  `POST /today/actions` allows any single-target action at team_lead+ (`wizmatchToday.ts:62`), and
  `writeCompanyPolicy` only refuses `is_non_overridable` rows (`policyService.ts:359`). This matches
  §12's "policy write → team_lead+", so the PRD contradicts itself; the UI offers the affordance to
  team_leads. Needs an owner ruling, not a unilateral tightening.
- **M-D — Feature-flag parsing diverges across layers.** `decisionWorkbenchFlag.js:10` accepts
  `1|true|yes|on` case-insensitively and is force-on under `import.meta.env.DEV`; the backend requires
  the exact string `'true'` (`wizmatchToday.ts:28`). Deploying with `WIZMATCH_DECISION_WORKBENCH_ENABLED=1`
  renders the workbench against a 404 backend. (Same idiom as `companyPolicyFlag.js`, so pre-existing
  in shape.)
- **M-E — Workbench DB mocks discard `where`/`orderBy`/`limit`.** `decisionWorkbench.test.ts:38`'s
  `makeChain` returns itself for every builder method, so removing a tenant predicate would not fail
  a behavioural test. The suite compensates with a source-level regex guard
  (`decisionWorkbench.test.ts:191`) that asserts each `db.select` block mentions `tenantId` — real
  coverage, but text-level, and its `/await db\s*\n\s*\.select\(/` split misses a query written on
  one line.
- **M-F — No idempotency on company actions.** A duplicate submit writes two superseding policy rows.
  Duplicates are protected (`resolveDuplicate` updates `WHERE resolution = 'pending'`), companies are
  not.
- **M-G — `set_review_date` can change eligibility as a side effect.** It writes
  `root.outreachEligibility ?? 'needs_review'` (`decisionWorkbenchActions.ts:221`), so on a root row
  with a null eligibility, setting a review date silently flips the company to `needs_review`.
- **M-H — Bulk bar is not role-aware client-side.** `TodayBulkActionBar` renders for any role; the
  server correctly 403s bulk for non-admins, so a team_lead selects rows, picks an action, fills the
  dialog and only then gets an error toast.
- **M-I — Dialogs never restore focus to their trigger.** `useDialogA11y` implements focus trap,
  Escape and autofocus but no restore on close. Pre-existing and shared by six staffing dialogs, so
  fixing it is a cross-cutting change, not a PR 6 change.
- **M-J — Unbounded fan-out queries.** `fetchPendingDuplicateIdByCompany` issues two `IN`-list queries
  and `fetchBestContactConfidenceByCompany` one, none with a `LIMIT`, over up to 500 company ids.
  Fine at pilot scale; worth a cap before volume.

## Low

- **L-A** — `ReplyRow` calls `item.state.replaceAll(...)` unguarded (`TodayDecisionWorkbench.jsx:155`).
  The server always populates `state`, so this needs a malformed row to bite.
- **L-B** — `/today/queues?limit=` bounds companies and replies with the same value; a large reply
  backlog and a large company list share one budget.
- **L-C** — `wizmatch-a11y.spec.ts`'s `needsReview` fixture sets `contactConfidenceTier: 'medium'`
  alongside a `disabledReason` claiming no medium-confidence contact exists. Incoherent fixture, not
  a code defect.
- **L-D** — `ScoredRequirement.blockers` is always `[]` in shadow; it only populates when the adapter
  attaches a blocker code under `enforce`. Correct by design, but a dead field today.
- **L-E** — If `/api/wizmatch/staffing/users` fails, the Assign Owner dialog silently shows an empty
  owner list (`TodayDecisionWorkbench.jsx:194`).

---

## Detailed findings against the required checklist

**1. No second eligibility engine.** Confirmed after H-1. Every queue, priority, enabled action,
disabled reason and approval requirement now derives from `effectiveDecision`, which is either the
canonical decision or the stored policy row — never a local recomputation. The three non-policy
operational states that also gate actions (pending duplicate, contact-confidence tier, non-overridable
flag) are read from their own tables and documented as such, not re-derived eligibility.

**2. Shadow remains non-blocking.** Confirmed after H-1. Mode is read via
`resolveCompanyStatus` → `actsOnDecision`, which is exact-string `enforce` only; the workbench never
re-derives it. Mutations still perform canonical validation (`resolveEffectivePolicy` per target) and
the resolver still records observations, unchanged.

**3. Tenant safety.** Every query in `decisionWorkbench.ts` carries `eq(<table>.tenantId, tenantId)`,
and both joins are composite on `(tenantId, id)` — `wizmatchCompanies` at `:137` and `:322`. The
write path never trusts a client id: `resolveEffectivePolicy`, `writeCompanyPolicy`,
`assignAccountOwner` and `resolveDuplicate` are all tenant-scoped from `req.user.tenantId` via
`actorFrom`. No cross-tenant read or mutation found.

**4. Bulk actions.** Empty selection rejects (`targets_required`). Mixed/invalid target types reject
the **whole** request before any mutation (`mixed_invalid_targets`), as does missing evidence for
block/reject and a missing review date for pause. Each target is re-read server-side and its current
policy re-evaluated. Staleness is rejected per-target by inheritance — `writeCompanyPolicy` refuses a
non-overridable predecessor inside its own transaction, `resolveDuplicate` loses the race on an
already-resolved row. Per-record results are always returned; `requested`/`succeeded`/`failed` make
partial success explicit. **There is no request-level transaction**, which is correct here: each
target is independent, so a late failure must not roll back earlier successes. Duplicate submission is
protected for duplicates, not for companies (M-F).

**5. M-1 correctly closed.** Staff-tier reads now reach the policy and workbench routers. Verified
this granted **reads only**: every write route in `wizmatchPolicy.ts` carries its own gate —
`requireTeamLead` on policy write / owner / duplicate-resolve (`:105`, `:125`, `:168`) and
`requireAdmin` on bulk, override and readiness (`:91`, `:115`, `:186`). None relied on the outer
`wizmatchRequireAdmin` middleware the move bypassed. `requireAuth` runs on both new mounts, and
`viewer` remains read-only via `auth.ts:98`. Direct endpoint access follows the same permissions as
the UI. The mount move's real cost was C-1, now fixed.

**6. M-2 correctly closed.** `fetchCommandCenterRequirements` now selects `r.company_id`
(`wizmatch.ts:354`) and maps it to `companyId` (`:380`); `ScoredRequirement` carries it; and
`buildWizmatchCommandCenter` folds `requirements` through
`applyCanonicalEligibilityToPriorityResults` against a batch that now includes requirement company
ids. `nextAction` is folded in lockstep with `priority` inside the adapter
(`legacyEligibilityAdapter.ts:156`, `:163`), so the two cannot disagree. A null `companyId` leaves the
result untouched rather than granting anything, and the resolver itself denies on a missing root row.
`candidateIntelligence` stays unfolded because a talent-pool candidate has no single company to
resolve against — disclosed in the module header, matching PR 5's precedent, not silently dropped.

**7. Feature flags at all layers.** Backend: exact `'true'`, 404 for its own surface only (after C-1),
and the mutation endpoint is gated by the same `router.use`, so there is no partially-working write
path. Frontend: nav flag computed in `navEntries.js`, page body switched in `WizmatchTodayPage.jsx`
with the route left `permission: 'always'` — so flipping the flag off cannot make Today unreachable or
produce a permanent error screen; it falls back to the legacy bucket view and does not call the new
endpoints. Divergent parsing is M-D.

**8. Contextual actions.** Each action maps to exactly one existing PR 4 write service, with the
role gate, evidence requirement and reason code checked server-side before dispatch; audit rows are
written by those services, not by this layer. Success and error shapes are per-target and typed by
code. The UI refetches after every completed submit and clears selection. Gaps are M-B (disabled
state), M-C (Reclassify role) and M-F (idempotency).

**9. Test quality.** Non-vacuous overall. The action suite exercises real orchestration paths and
asserts on inputs passed to mocked services rather than on values it supplied. The route suite mounts
the real router and drives it over HTTP. The a11y spec renders the real workbench with populated
queues and asserts focus-into-dialog and Escape-to-close, so it is not a no-op scan. Weaknesses:
M-E (mocks discard `where`), and the a11y spec still does not assert focus **restore** (M-I). This
review added behavioural coverage for both defects it found; both were confirmed to fail before the
fix.

**10. No PR 7 work.** Confirmed by diff grep. No preparation job, enrichment, provider adapter,
Smartlead code, sending path or paid-discovery change. No guardrail file touched (`schema.ts`,
`migrations/`, `auth.ts`, `rbac.ts`, `cashfree.ts`, `sodEodService.ts` all absent from the diff), and
`package-lock.json` is untouched.

---

## Fixes made during this review

| Commit | Finding | Files |
|---|---|---|
| `e86704b3` | C-1 | `src/routes/wizmatchPolicy.ts`, `src/routes/wizmatchToday.ts`, `src/index.ts`, `src/__tests__/wizmatchIndexMountOrder.test.ts` |
| `c84681f5` | H-1 | `src/modules/outreach/decisionWorkbench.ts`, `admin/src/components/wizmatch/TodayDecisionWorkbench.jsx`, `src/__tests__/decisionWorkbench.test.ts`, `e2e/wizmatch-a11y.spec.ts` |

No guardrail file, no schema or migration, no dependency, no new source file.

## Gates (post-fix tree)

| Gate | Result |
|---|---|
| `git diff --check` | clean (exit 0) |
| `npm run build` | exit 0 |
| `npm test` | **117 files / 1072 tests passed** (was 117/1064) |
| `npm run admin:build` | clean |
| `npx playwright test --config=playwright.wizmatch-local.config.ts` | **97 passed / 15 skipped / 0 failed** |

The 15 skips are the pre-existing, documented real-backend specs that skip when
`WIZMATCH_E2E_TEST_PASSWORD` is unset (`wizmatch-e2e-hardening-contact-cap.spec.ts:22`,
`wizmatch-e2e-hardening-delete-archive.spec.ts:20`). No other skip.

All five gates were also run on the as-submitted `9b9c2c56` tree and reproduced the marker's claimed
results exactly (1064 tests, 97/15/0) — the marker did not overstate what it ran.

## Remaining blockers before PR 7

**None.** PR 7 may proceed.

M-A through M-J and L-A through L-E are carried forward. M-A and M-B are the two worth scheduling
before the workbench flag is turned on for a real operator, because they are the difference between
the queues the PRD specifies and the queues that ship.

## Remaining blockers before G1 / G4 / production

Unchanged from PR 5, plus PR 6's own:

- **B-1 — migration `0037` must be applied before this stack reaches `main`.** The repo auto-deploys
  on push. Still unapplied.
- **G1** — the §10.11.4 fresh-database checks have not been run; no database access in this session.
- **G4** — promoting `shadow` → `enforce` remains an owner decision. Note that H-1's fix changes what
  that promotion will do to this surface: under `enforce`, canonical denies will now move companies
  into Paused or Blocked that shadow leaves in Ready to Contact. That delta is now observable in
  advance through the `shadow: would deny` badge, which is the point.
- **M-A / M-B** — close before the workbench is used for real decisions.
- **M-D** — settle flag parsing before the flag is set in any deployed environment.

## Could not verify

No database and no Railway or production access, so: whether `0037` is applied anywhere; the G1
fresh-database checks; and real-data behaviour of the queue queries at volume (M-J). C-1's blast
radius is established from Express routing semantics and a reproduction harness, not from an observed
production request.

## Method note

Three read-only Explore subagents were dispatched in parallel per the standing method (backend/policy,
frontend/accessibility, tests/finding-closure). They did not return within this session. Every finding
above was therefore derived and verified first-hand by the lead session against the code, the PRD, the
ADRs, and — for C-1 and the `next('router')` fix — a running Express harness. Nothing in this report
rests on an unreturned subagent's summary.

## Safety

Nothing pushed, merged or deployed. No Railway or production access. No database mutation. Migration
`0037` not applied. Backfill `--apply` not run. `WIZMATCH_POLICY_ENFORCEMENT_MODE` untouched
(`shadow`). Sending and paid-discovery kill-switches untouched. Smartlead not connected. No shared
environment variable changed. PR 7 not started.
