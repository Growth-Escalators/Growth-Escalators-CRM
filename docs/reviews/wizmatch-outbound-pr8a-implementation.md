# WizMatch Outbound OS — PR 8A: Smartlead-free live-pilot hardening (implementation)

- **Branch:** `ge/outbound-08a-live-pilot-hardening` · **Parent:** `ge/outbound-08-outreach-adapter` (code-ready at `1b4b59fa`, marker `.ai/OUTBOUND_PR8_CODE_READY`)
- **Implemented:** 2026-07-27, self-reported. Marker: `.ai/OUTBOUND_PR8A_IMPLEMENTED`.
- **Independent review:** not yet performed — a separate Opus review owns `.ai/OUTBOUND_PR8A_CODE_READY`, per standing instruction.

This is an additional hardening pass before the first internal production
pilot. It does not replace PR 9 (Smartlead CSV adapter) or PR 10 (reply
ingestion), both of which remain gated on the sanitised Smartlead fixtures
(U-6) and are not required for this pilot.

## Scope delivered

Fourteen required items, each below with the exact defect found and the fix.

### 1. Approval provenance (`src/modules/outreach/decisionWorkbenchActions.ts`)

`approve_queue` now requires a non-null `actor.userId` (fails closed with
`actor_required` otherwise) and is idempotent: re-approving an
already-`eligible` company is rejected with `already_approved` rather than
silently re-superseding the row. Provenance itself — `actorUserId`, `source`,
`reasonCode`, evidence, and the full supersession chain
(`previousPolicyId`/`fromState`/`toState` on `wizmatch_company_policy_events`)
— was already recorded by `writeCompanyPolicy`; this schema has no
`approved_by`/`approved_at` columns on `wizmatch_company_policies` (those
exist only on `wizmatch_outreach_batches`, PRD-005 §10.5, a PR 9 concern), so
no such columns were invented here.

### 2. Pilot roster enforcement (`src/middleware/wizmatchPilotGate.ts`)

New middleware reusing the EXISTING `resolveStaffingAccess`/`requireStaffingPilot`
(`src/services/wizmatchStaffingAccess.ts`, `WIZMATCH_STAFFING_PILOT_USER_IDS`)
rather than inventing a second roster mechanism. Wired into
`wizmatchPolicy.ts`, `wizmatchToday.ts`, `wizmatchPrepare.ts` — all three had
only a broad role allow-list (`wizmatchRequireStaffing` in `src/index.ts`,
admin/team_lead/manager_ops/sales/staff/**viewer**) and NO pilot-roster check
at all. Fails closed in production when the roster is unconfigured
(inherited from `resolveStaffingAccess`'s existing production/non-production
split); permissive in dev/test, matching the Staffing OS precedent. Grants no
write permission on its own — every downstream `requireRole`/team_lead/admin
check is unchanged.

### 3. Non-overridable at every scope

Two gaps closed:

- `CompanyStatusResult` (`outreachGate.ts`) and `CanonicalCompanyEligibility`
  (`legacyEligibilityAdapter.ts`) discarded `blockClass`/`isNonOverridable`/
  `recommendedRoute`/`accountOwnerUserId` even though the full `PolicyDecision`
  already computes them correctly at every scope including L1c. Now carried
  through.
- The Decision Workbench's own `isNonOverridable` came from the ROOT row
  only (`fetchRootPolicyCompanies` selects `scopeType='entire_company'`
  exclusively). A new batched query, `fetchNarrowerNonOverridableBlockByCompany`,
  independently detects a narrower (region/business_unit/location/specific_*)
  active non-overridable block regardless of request-context resolvability
  (necessary because `resolveEffectivePolicy`'s `applicableRows` is
  context-scoped, and a bare company-level display request supplies no
  signal/region hint). `decisionWorkbenchActions.ts`'s action layer
  separately scans `effective.allActiveRows` (already available, no extra
  query) and refuses every unblocking action — for every role, including
  admin — when ANY active row is non-overridable-blocked, not only the root.

### 4. Reason-code validation and preparation safety

- `isPreparationAllowed()` (`src/config/wizmatchReasonCodes.ts`) defaulted to
  `true` for an unrecognised code — fail-OPEN. Now defaults to `false`.
- `writeCompanyPolicy` (`policyService.ts`) and `resolveDuplicate`
  (`duplicateService.ts`) had NO taxonomy check on `reasonCode` at all — any
  string was accepted and stored. Both now reject an unrecognised code with
  `unknown_reason_code`, at the sole write chokepoints for each.
- No second reason-code interpretation exists anywhere else (`prepareCompanies.ts`
  and the admin frontend both derive permission from `decision.preparationAllowed`
  only — confirmed by grep, not just by design intent).

### 5. Stale-state and concurrency protection

`PolicyWriteInput.expectedPolicyId` (optional) added to `writeCompanyPolicy`;
checked INSIDE the write transaction against the row it just read (not a
caller's earlier, separate read), closing any TOCTOU gap. `TodayActionRequest.expectedPolicyId`
threaded through the workbench action layer with the same semantics, plus an
early fast-fail check before the non-overridable/admin gates. Both raise a
new `PolicyStaleStateError`, mapped to a stable `stale_policy_state` code
(409 on the direct policy route; a per-target `ok:false` result on the
Today-actions route, never a whole-request abort). Duplicate resolution
(`resolveDuplicate`) already had an equivalent DB-level compare-and-swap via
its `WHERE resolution='pending'` update — unchanged, confirmed sufficient.
The partial unique index `wizmatch_company_policies_active_scope_uniq`
already prevents a double-submit from producing two active rows at one
scope; unchanged.

### 6. `set_review_date` preserves policy meaning

Previously shared the generic write path, which (a) applied
`ACTION_DEFAULT_REASON_CODE`'s fallback `'manual_reclassified'` — silently
overwriting e.g. a `company_removal_request` row's `reasonCode`, which flows
directly into `isPreparationAllowed(reasonCode)` at the next gate
evaluation and would have flipped a compliance-blocked company back to
preparable — and (b) accepted request-supplied evidence/reason overrides.
Now a dedicated branch: every field except `reviewDate` is read from the
root row verbatim (`outreachEligibility`, `externalHiringPolicy`,
`relationshipType`, `isPermanent`, `blockClass`, `isNonOverridable`,
`reasonCode`, evidence), and the action fails closed with
`policy_dimension_unresolved` if the root is missing a required field
rather than defaulting to a cold-start value.

### 7. Review-date resurfacing

`decisionWorkbench.ts` computes `isReviewDateArrived(reviewDate, now)` —
explicit UTC-midnight comparison, computed once per request so every item in
one response agrees on "now". A **paused** row (never a blocked one — a
block's review date is informational only) whose date has arrived now
re-enters Needs Review instead of sitting in Paused or Blocked indefinitely.
A future date, or no date, changes nothing. Purely a bucketing/display
concern — never a write gate — so it applies identically in shadow and
enforce.

### 8. Routed/assigned queue

New `routed` queue and count in `TodayQueues`, derived entirely from EXISTING
data — the resolver's own `recommendedRoute` (§8.6/§8.7: `account_owner`,
`partnership_workflow`, `account_management`, `msp_vms_research`,
`vendor_empanelment`, `reengagement_review`) and `wizmatch_companies.account_owner_user_id`
— no migration. Precedence per PRD-005 §13: blocked → pending duplicate →
paused (unless due) → **routed** → needs_review → eligible. A routed item is
never also placed in Ready to Contact or Needs Review. Assignment/routing
grants no permission — every action on a routed item still passes through
the same pilot-gate/role/non-overridable checks as any other queue.

### 9. Decision styling and accessibility

- `StatusBadge.jsx`: the workbench passed the raw canonical `'allow'|'review'|'deny'`
  string as `status`, none of which were keys in `STATUS_TONE` — every
  decision, including every `deny`, silently rendered the same neutral
  `muted` badge as an unrecognised status. Fixed. Non-overridable is folded
  into the SAME badge (relabelled), not a second `badge-danger` element,
  because `badge-danger`'s shared CSS measured ~4.22:1 contrast — just under
  WCAG AA's 4.5:1 — a pre-existing gap (every other badge tone already used
  its 700 shade; danger was the one left on 600). Fixed by adding a `danger-700`
  shade (matching the existing success/warning/info/accent pattern) and using
  it in `.badge-danger`, now ~5.65:1. Distinct treatments added for a routed
  item (`routed`/`routed — unassigned`), a shadow-would-block divergence
  (`shadow_would_block`), and a stale item (`stale_policy_state`, its own key
  — the pre-existing `stale` key means something different, a stale contact
  candidate, with a different tone).
- `useDialogA11y.js`: the Tab-trap's focusable-element query never excluded
  `:disabled`, so a disabled button at either end of the DOM order broke the
  trap (browsers silently no-op `.focus()` on a disabled element). Fixed
  (`:not(:disabled)` added). Nothing restored focus to the triggering element
  after a dialog closed — fixed (captures `document.activeElement` on open,
  restores it on close).
- `TodayActionDialog.jsx` / `TodayDecisionWorkbench.jsx`: the disabled
  Confirm button, and the "No action available" span, relied solely on a
  `title` tooltip to explain why — not reliably read by screen readers. Both
  now also expose the reason via `aria-describedby` pointing at visible,
  always-in-the-DOM text.
- `expectedPolicyId` wired end-to-end: the workbench item now carries
  `policyId` (the root row's id); a single-target dialog round-trips it back
  as the stale-state precondition (bulk actions span multiple companies with
  different policy ids, so intentionally omitted there).

### 10. Role/route regression coverage

New `src/__tests__/wizmatchPilotGate.test.ts` (13 tests): unauthenticated,
every pilot-eligible role, `viewer` (rejected), an unrecognised role
(rejected), production with no roster (fails closed for every role including
admin), production with a roster (listed user passes, unlisted user and
ineligible role rejected). Each of `wizmatchPolicyRoutes.test.ts`,
`wizmatchTodayRoutes.test.ts`, `wizmatchPrepareRoutes.test.ts` gained
route-level pilot-gate tests (unauthenticated, `viewer` rejected on a route
with no separate role gate, all five eligible roles pass, production
fail-closed) plus — for the policy router — an explicit
read-requires-no-role/write-requires-team_lead+ proof. Express route
ordering (dynamic vs. static) was already covered by the existing
`POST /companies/bulk/policy` vs `POST /companies/:id/policy` precedence
test and `wizmatchIndexMountOrder.test.ts`; unchanged.

### 11. Command Center company linkage tests

The existing suite (`wizmatchLegacyEligibilityAdapter.test.ts`,
`wizmatchLinkage.test.ts`) already covered: missing `companyId` fails closed
(not open), the tenant predicate (via the predicate-capture mock idiom, not
the discard-`.where()` pattern), shadow-vs-enforce divergence, and priority/
nextAction agreement with the canonical decision at L0/L1/review/allow. One
genuine gap closed: `wizmatchLegacyEligibilityGuard.test.ts` verified a
migrated file *imports* the adapter module but never that it *calls* one of
its fold/resolve functions — a dead import (or a deleted call) would have
passed. New assertion requires an actual function-call pattern
(`resolveCanonicalCompanyEligibility(Batch)?\(`, `applyCanonicalEligibilityTo...\(`)
in each of the three migrated files.

### 12. Live-pilot configuration contract

[`docs/wizmatch/WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md`](../wizmatch/WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md) —
the five required initial flag values, the "must not" list (no Smartlead
credential, paid discovery disabled, no scheduler, no provider selected,
adapter ≠ sending), and the two functional-availability flags
(`WIZMATCH_COMPANY_POLICY_ENABLED`/`WIZMATCH_DECISION_WORKBENCH_ENABLED`)
that must be `true` for the pilot to be usable at all — a distinct concern
from the safety flags, stated as such.

### 13. Go-live readiness command

`src/services/wizmatchPilotReadiness.ts` (pure, testable) +
`scripts/wizmatch-pilot-readiness.ts` (CLI, `npm run wizmatch:pilot-readiness`).
Read-only: no DB connection, no migration, no backfill, no network/provider
call. Checks code-ready markers through PR 8, enforcement mode (exact-string
`enforce` match, mirroring `outreachGate.ts`'s own §16 rule 3 parsing so it
can never disagree with runtime behaviour), the four safety flags, Smartlead
credential presence (name only, never the value — `/SMARTLEAD/i` against
every env var name), paid-discovery flags, pilot roster configuration,
the two pilot-visibility flags, provider selection, and a dangerous
adapter-on/unrecognised-provider combination. Migration/backfill status is
reported from the filesystem (journal + script presence) only — explicitly
never asserts anything about production application, since that is not
checkable without a DB connection. Exits non-zero on any `danger` finding.
19 tests in `wizmatchPilotReadiness.test.ts` cover every dangerous
configuration named in the task's own test plan, plus the safe baseline and
the "never prints a secret value" property.

### 14. Production runbook

[`docs/runbooks/WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md`](../runbooks/WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md) —
G1 (migration approval) / G2 (backfill approval) / G3 (shadow deployment) /
G4 (future enforce, explicitly not part of this pilot), each ending in a
signed-approval placeholder, no auto-apply command for `0037` or
`--apply`. States plainly that PR 9/10 are not required for this pilot.

## Gates — run for real

```
git diff --check        → clean
npm run build            → tsc, exit 0
npm test                 → 122 files / 1246 tests, all green (was 120/1165 at the PR 8 baseline; +2 files, +81 tests)
npm run admin:build      → exit 0
npx playwright test --config=playwright.wizmatch-local.config.ts
                          → 99 passed / 15 skipped / 0 failed (identical to the PR 8 baseline)
npm run wizmatch:pilot-readiness
                          → exit 0, no dangerous findings, against this repo's actual local environment
```

The 15 skips are the documented no-password real-backend specs (two
hardening specs × 5 tests × 3 projects) — same reason as every prior PR in
this stack, unchanged.

## Boundary checks

- No guardrail file touched: `src/db/schema.ts`, `src/db/migrations/`,
  `src/middleware/auth.ts`, `src/middleware/rbac.ts`, `src/routes/cashfree.ts`,
  `src/services/sodEodService.ts` all verified untouched.
- No migration added (`0037` remains the latest; no `0038`).
- No Smartlead code, header, fixture, credential, or API call added.
- No sending, enrolment, reply-ingestion, or paid-discovery code added or
  enabled.
- No `package-lock.json` change.
- No Growth/SEO/n8n code touched.
- `admin/tailwind.config.js` and `admin/src/index.css` changed ONLY to add
  a missing `danger-700` shade (matching the existing success/warning/info/
  accent pattern) and use it in `.badge-danger` — a color-contrast fix, not
  a design change; no other selector, layout, or component style touched.
- Nothing pushed, merged, or deployed. No Railway or production access. No
  database mutation, migration, or backfill run. No network or provider
  call made by anything in this PR (the readiness CLI is read-only by
  construction, verified by its own test suite).

## Not done, deliberately

PR 9 (Smartlead CSV adapter) and PR 10 (reply ingestion) not started —
still gated on U-6 (sanitised fixtures), unaffected by this PR. Migration
`0037` not applied to any database. Backfill not run. Enforcement mode not
promoted (`shadow` remains the default; the readiness command flags
`enforce` as dangerous). Sending, the outreach adapter, and paid discovery
remain disabled. No Smartlead connection of any kind.

## Exact next step

Independent readiness review of this PR (three-subagent method, per the
PR 2–8 precedent). `.ai/OUTBOUND_PR8A_CODE_READY` is reserved for that
review, not created here.
