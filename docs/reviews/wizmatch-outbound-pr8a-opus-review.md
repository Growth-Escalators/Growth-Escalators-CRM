# WizMatch Outbound OS — PR 8A independent readiness review (Smartlead-free live-pilot hardening)

- **Branch:** `ge/outbound-08a-live-pilot-hardening` · **Parent:** `ge/outbound-08-outreach-adapter` (code-ready at `1b4b59fa`)
- **Reviewed range:** `ge/outbound-08-outreach-adapter..HEAD`
- **Submitted at:** `47c27173` (implementation marker `.ai/OUTBOUND_PR8A_IMPLEMENTED`, self-reported)
- **Reviewed/fix HEAD:** `f12c62ca`
- **Reviewed at:** 2026-07-27
- **Review method:** three parallel read-only Explore subagents, reconciled with an independent hand
  review by the lead. Every finding is evidenced by file:line, a reproduced command, or a control run.

---

## FINAL VERDICT

**NOT READY as submitted at `47c27173`. READY at `f12c62ca`** after **three High, three Medium and
two Low fixes in the first pass, plus one High, three Medium and one Low from the three-subagent
reconciliation.** Zero Critical. `.ai/OUTBOUND_PR8A_CODE_READY` **created.**

All five gates green on the fix tree. The readiness CLI fires on all nine required danger conditions
plus a new tenth (a `NODE_ENV` that would silently disable the pilot roster), and passes both the
approved safe baseline and a fully correct production configuration.

## Method — three subagents, reconciled

Three read-only Explore subagents were spawned in parallel with fixed output contracts:
S1 workbench/policy mutations, S2 RBAC/pilot roster/frontend, S3 preparation/go-live safety. They
returned late — after the lead had completed an independent hand review of all three areas and
committed a first round of fixes — so this review has **two passes**, both recorded below.

That timing turned out to be useful rather than wasteful: the two passes were genuinely independent,
and each caught defects the other did not.

| | Found by the lead's hand review | Found by the subagents |
|---|---|---|
| Confirmed by **both**, independently | H-3 actor-at-chokepoint (= S1-4) · H-2 routed disabled-reason (= S2-5) · M-1 unknown provider (= S3-2) · H-1's underlying fact, the absent dotenv (= S3-3) | same three, plus the dotenv observation |
| Found by the lead **only** | H-1 (that the absent dotenv makes the CLI report SAFE against a sending-enabled config — S3 saw the absence but read it as deliberate) · M-2 roster/`--production` · M-3 contract gap · L-1, L-2 | — |
| Found by the subagents **only** | — | **S2-1** `NODE_ENV` runtime assumption (High) · **S1-1** non-overridable invisible in shadow · **S1-3** leaked 23505 · **S1-2** L4-vs-L1c scope conflation · **S2-4** UI role affordances · **S3-1** Smartlead name-detection blind spots · **S1-5** vacuous `.where()` mock |

One notable disagreement: **S3 read the absent dotenv import as deliberate** ("consistent with its
no-DB claim"). That reading is wrong — dotenv has nothing to do with database access, and the runbook
explicitly instructs an operator to point the CLI at a `.env` copy. The lead's H-1 fix stands.

## Verdicts

| Area | Verdict |
|---|---|
| **Implementation completeness** | **PASS.** All fourteen claimed items exist and do what the doc says, with three exceptions found and fixed (H-1, H-2, H-3) and three under-implemented conditions (M-1, M-2, M-3). The gate numbers in the implementation doc reproduced exactly on the submitted tree (122 files / 1246 tests; Playwright 99/15/0), so the marker did not overstate itself. |
| **Tenancy** | **PASS.** The one new query, `fetchNarrowerNonOverridableBlockByCompany` (`decisionWorkbench.ts:250-270`), filters `tenantId` first, then `inArray(companyIds)`, then `isNull(supersededAt)`. No new query anywhere in the diff omits a tenant predicate. |
| **RBAC / pilot roster** | **PASS-WITH-GAPS.** The gate is correct and correctly ordered; the roster's *configuration* was under-checked (M-2, fixed) and undocumented (M-3, fixed). **H-4: its fail-closed branch turns entirely on a runtime `NODE_ENV` this repo never confirms is set** — now a readiness DANGER and an explicit G3 checklist step, but the live value must be confirmed by the operator. See the endpoint table below. |
| **Approval provenance** | **FAIL as submitted → PASS at `f12c62ca`.** H-3: the `actor_required` guard existed only in the workbench action layer; three other paths reach the write chokepoint directly. Fixed. |
| **Stale-state** | **PASS at `f12c62ca`.** S1-3 (a concurrent write leaking a raw `23505` instead of the stable code) fixed. `expectedPolicyId` is compared inside `writeCompanyPolicy`'s own transaction against the row that transaction just read (`policyService.ts:389-398` pre-fix numbering), before any mutation. Stable `stale_policy_state` code, 409 on the direct route, per-target `ok:false` on Today actions — never a whole-request abort. One semantic note recorded as L-3. |
| **Non-overridable** | **PASS at `f12c62ca`.** Verified across the full action union (table below). S1-1 (a narrower block invisible in shadow behind an `eligible` root) fixed. **S1-2 recorded as a G3 blocker needing an owner decision** — the scan does not separate PRD §8.2's L4 per-signal blocks from L1c scope blocks, so it is currently *too* restrictive. |
| **Preparation / taxonomy** | **PASS.** `isPreparationAllowed` now defaults `false`; both write chokepoints validate against the §9 taxonomy; grep confirms no second reason-code or preparation-permission engine. |
| **Queue** | **PASS at `f12c62ca`.** Precedence is as documented and a routed item appears exactly once. H-2's fix also removed a latent contradiction: `routed` was mutated *after* bucketing, so it could disagree with the queue the item was in. |
| **Accessibility** | **FAIL as submitted → PASS at `f12c62ca`.** S2-4 (UI shows actions that always 403 for `staff`) recorded as a G3 blocker, not fixed — an owner decision. H-2: the "No action available" affordance lost its explanation for a state PR 8A itself introduced. Contrast claims independently verified by computation. |
| **Readiness CLI** | **FAIL as submitted → PASS at `f12c62ca`.** H-1 (read no `.env` — reported SAFE against a sending-enabled config), H-4 (`NODE_ENV`), M-1 (unknown provider), M-2 (absent roster). All nine required danger conditions fire, plus a tenth for the `NODE_ENV` mismatch; the safe baseline and a fully correct production config both pass. **S3-1 recorded**: Smartlead detection is name-substring only. |
| **Configuration contract** | **PASS-WITH-GAPS → PASS at `f12c62ca`.** M-3: the contract had no row for the pilot roster — the single control that makes this a pilot. Added. |
| **Runbook** | **PASS.** G1–G4 are four separate signed approvals; no auto-apply command for `0037` or `--apply`; no automatic flag promotion. Updated for the CLI's new `--production` requirement at G3 and for the CLI's honest limits. |
| **Test quality** | **PASS at `f12c62ca`.** New tests are behavioural against real Express apps and real service code. **Nineteen control runs across both passes**; **three of the reviewer's own guards were found vacuous and rewritten** (see "Control runs"). S1-5's discarded-`.where()` mock fixed. |
| **Scope boundary** | **PASS.** No guardrail file, no migration, no `0038`, no Smartlead/sending/enrolment/reply-ingestion/paid-discovery code, no `package-lock.json`, no Growth/SEO/n8n change, no production action. |

---

## Findings

### Critical

None.

### High (all four fixed in this review)

**H-1 — the go-live readiness CLI read no `.env`, so it reported SAFE against a dangerous configuration.**
`scripts/wizmatch-pilot-readiness.ts` imported no dotenv, unlike every sibling script in the repo
(`scripts/wizmatch-policy-readiness.ts:8`, `scripts/wizmatch-staffing-backfill-preview.ts:11`). The
go-live runbook's G3 step instructs an operator to run it "against the deployment's actual
environment (**or an identical local `.env` copy**)". Against a `.env` copy it read none of that
file: every safety flag resolved to `undefined` → "off" → exit 0 → `RESULT: no dangerous
configuration detected`. A configuration with `WIZMATCH_SENDING_ENABLED=true` in `.env` would have
been reported as safe to go live. **This is the one mechanical check standing between the operator
and a bad production configuration, and it was blind to the file the runbook tells them to point it
at.** Fixed: `import 'dotenv/config';`. Control: commenting out *or* deleting the import fails the
new guard.

**H-2 — the "No action available" affordance lost its explanation, for a state PR 8A itself introduced.**
`TodayDecisionWorkbench.jsx` replaced the disabled affordance's `title` fallback with
`aria-describedby={disabledReasonId}`, where `disabledReasonId` was `undefined` whenever
`item.disabledReason` was null. `primaryActionFor` returns `null` for a **routed company that already
has an `accountOwnerUserId`** — a state this PR created — and `disabledReasonFor`
(`decisionWorkbench.ts`) returned `null` for an allow/review, non-duplicate, high-confidence item.
So a routed-and-owned company rendered a bare, unexplained "No action available": no tooltip, no
described-by target, no visible text. Not only a screen-reader gap — nobody was told why. This is
precisely the "disabled-action explanations" requirement the hardening pass was meant to satisfy.
Fixed on both sides: a routed branch in `disabledReasonFor` (owned vs. unassigned wording), and an
always-present reason on the client so the affordance can never be unexplained. `routed` is now
resolved *before* the item is constructed rather than mutated after bucketing, so it can never be
`true` on a row precedence sends to another queue. Controls: 2 failed / 2 failed.

**H-3 — approval provenance was enforced in the workbench layer only, not at the write chokepoint.**
PR 8A added `actor_required` to `decisionWorkbenchActions.ts`. But `POST /api/wizmatch/companies/:id/policy`
(`wizmatchPolicy.ts:128`), `POST /companies/bulk/policy` (`policyService.ts:587`) and
`writeCompanyPolicyOverride` (`policyService.ts:490`) all call `writeCompanyPolicy` directly and
never pass through that layer. `PolicyActor.userId` is **optional** (`policyService.ts:98-101`) and
`wizmatch_company_policies.actor_user_id` is **nullable** (`schema.ts:2474`). This table has no
`approved_by`/`approved_at` pair — verified against the schema, confirming the implementation doc's
claim on that point — so `actor_user_id` + `source` + the paired event row's
`previousPolicyId`/`fromState`/`toState` **is the entire provenance record for a human decision**.
An approval to `eligible` was therefore still persistable with a NULL actor: a permanent policy row
nobody can be shown to have approved. Fixed: `writeCompanyPolicy` refuses a `source: 'human'` write
with no `actor.userId`, before any read or write inside the transaction; non-human sources
(`import`/`deterministic_rule`/`provider` — the backfill's path) are legitimately unaffected.
`resolveDuplicate` gets the same guard. Controls: 2 failed / 1 failed.

**H-4 — the pilot roster's fail-closed branch depends on a runtime `NODE_ENV` nothing in this repo confirms is set.** *(found by subagent S2)*
`resolveStaffingAccess` selects its fail-closed branch with
`NODE_ENV === 'production' ? (configured && pilotAllowed) : (roleEligible && (!configured || pilotAllowed))`.
If `NODE_ENV` is unset, blank, or anything but that exact string in the deployed process, the roster
check is **bypassed entirely** and every pilot-eligible role (`admin`, `team_lead`, `manager_ops`,
`sales`, `staff`) is admitted — the restricted pilot silently becomes an open deployment. S2 checked
`railway.json`, `nixpacks.toml` and `docs/DEPLOYMENT.md` and found **nothing** recording that the
variable is set at runtime; the `NODE_ENV=production` documented there is Nixpacks' *build-phase*
behaviour, which says nothing about the running container. This is pre-existing (the same code backs
the Staffing OS surfaces) but PR 8A extends it to three more write-capable routers and makes it the
pilot's primary access control. Compounding it, the readiness CLI used the same unverified
assumption, so the one automated safety net could not catch it either.
**Fixed as far as a code review can:** asserting `--production` while `NODE_ENV` disagrees is now a
`DANGER` finding naming the exact consequence, and runbook G3 gained an explicit checked step.
**Railway was not accessed** — verifying the live variable is explicitly out of scope for this
read-only review and remains a G3 checklist item for the operator. Control: 1 failed.

### Medium (all three fixed)

**M-1 — an unrecognised `OUTREACH_PROVIDER` was not a danger while the adapter flag was off.**
The required danger condition "provider is unknown" only fired when
`WIZMATCH_OUTREACH_ADAPTER_ENABLED` was on. Reproduced: `OUTREACH_PROVIDER=totally_unknown_provider`
with the adapter off → exit 0, zero dangers. `smartlead_csv` — the documented default *and the exact
provider this pilot must not use* — passed silently. Fixed: validated against the `['mock']`
allow-list independent of the adapter flag.

**M-2 — an absent pilot roster was only a danger under `NODE_ENV=production`.**
Reproduced: no `NODE_ENV`, no roster → exit 0 with a warning. Compounding H-1, the runbook's G3
instruction to run against a copied `.env` — which does not carry `NODE_ENV=production` — could not
detect a missing roster, the single control that makes this a *pilot* rather than an open
deployment. Fixed: a `--production` assertion flag (now required by the runbook at G3). Separately,
`WIZMATCH_STAFFING_PILOT_ALL_USERS=true` with no explicit id list satisfied "roster configured" and
reported `ok` — it admits every pilot-eligible role tenant-wide. It is now reported as the open
deployment it is.

**M-3 — the configuration contract had no row for the pilot roster at all.**
`WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md` documented five safety flags and two visibility flags but
never mentioned `WIZMATCH_STAFFING_PILOT_USER_IDS` / `WIZMATCH_STAFFING_PILOT_ALL_USERS`, despite the
roster being PR 8A's headline control and the runbook's G3 checking it. Added, with the role-gate /
roster-gate independence stated explicitly.

### Low (recorded; L-1 and L-2 fixed, L-3…L-6 not)

- **L-1 (fixed)** — two code comments (`StatusBadge.jsx`, `TodayDecisionWorkbench.jsx`) asserted that
  `badge-danger`'s contrast defect was "recorded, not fixed … out of scope here" while this same PR
  fixes it in `admin/src/index.css`. Corrected.
- **L-2 (fixed)** — `package.json` used `npx tsx` for this one script where every sibling uses `tsx`;
  `npx` can reach the registry if the local binary is missing. Aligned.
- **L-3 (recorded)** — `expectedPolicyId` is a **per-request** wire field applied to every target,
  though the implementation doc describes it as "per-target-checked, not per-request". It *is*
  checked per target, but sourced once per request, so a bulk caller supplying one would fail every
  target but one. Fails closed, and the frontend correctly omits it for bulk. Making it genuinely
  per-target is a wire-contract change, deferred.
- **L-4 (recorded)** — the focus-trap query excludes `:disabled` but not `aria-disabled="true"` or
  visually-hidden focusables (`useDialogA11y.js`). Bounded; no such element exists in the dialogs
  today.
- **L-5 (recorded)** — `isQueuePayload` validates queue *arrays* but not item shape
  (`TodayDecisionWorkbench.jsx`). A queue item missing `policyId` yields `expectedPolicyId: undefined`,
  which silently *skips* the stale-state precondition rather than refusing the action. Bounded: the
  server-side re-read and re-validation still run. `policyId` is selected by
  `fetchRootPolicyCompanies`, so this is defence-in-depth only.
- **L-6 (recorded)** — `.badge-danger` is a repo-wide shared class; the change touches every Growth
  CRM page that renders a danger badge. It is strictly an improvement (see the verified numbers
  below), so no action, but it is a change beyond the WizMatch surface and is recorded as such.

### Reconciliation pass — findings raised by the subagents

**S1-1 (Medium, fixed) — a non-overridable block was invisible in shadow when the root read `eligible`.**
`disabledReasonFor` surfaced the block only when `effectiveDecision === 'deny'`. In shadow (§16 rule
2) `effectiveDecision` follows the ROOT row, so a company whose root is `eligible` while a narrower
scope carries an active non-overridable **compliance** block resolved to `allow`, showed no warning,
and landed in **Ready to Contact** — the queue whose entire meaning is "you may contact these now".
`writeCompanyPolicy` only refuses a supersession at the *same* scope_key, so a root written to
`eligible` through the direct or bulk policy route reaches exactly that state. The block itself was
never weakened (the gate re-resolves every active row at send/enrol time and
`findUnresolvableScopeType` fails closed), so **nothing was sendable** — the defect is that the
operator was shown the wrong thing on the pilot's main screen. Fixed: non-overridable now surfaces
regardless of decision, with wording that states the contradiction, and such a company never enters
Ready to Contact. Display-only — blocks no write and removes no affordance, so §16 rule 2 holds.
Controls: 1 failed / 2 failed.

**S1-3 (Medium, fixed) — a concurrent double-submit leaked a raw Postgres `23505`.**
`expectedPolicyId` is optional, so two simultaneous `approve_queue` writes at one scope can both read
the same predecessor, both pass every check, and both reach the INSERT. The partial unique index
correctly prevents a second active row, but raised a driver error that is none of the typed errors
`messageAndCodeFor` maps — the caller got a leaked database string instead of the same stable
`stale_policy_state` code the sequential path returns. Losing that race *is* staleness. Fixed and
narrowed by SQLSTATE **and** constraint name, so an unrelated unique violation is never disguised as
a stale-state conflict (pinned by its own test). Control: 1 failed.

**S1-5 (Low, fixed) — `decisionWorkbench.test.ts`'s mock discarded `.where()` entirely.**
The brand-new `fetchNarrowerNonOverridableBlockByCompany` query's predicates were therefore
unobservable: dropping `eq(outreachEligibility,'blocked')` or `eq(isNonOverridable,true)` left the
suite green. This is the project's recurring mock-vacuity class (PR 2 / PR 5 / PR 7 T-3). Predicate
capture added; controls now fail on each of the tenant, blocked and non-overridable predicates.

**S1-2 (Medium, RECORDED — needs an owner decision, deliberately not changed).**
The non-overridable scan does not distinguish `specific_signal` / `specific_requirement` blocks from
company/region/BU/location ones. PRD §8.2 draws a real line: L1c denies that scope, whereas L4 denies
**that signal or requirement only — "company and contact remain active"**. So a single per-signal
non-overridable block currently freezes every company-level action forever. **I did not change this.**
The correct behaviour is a spec-interpretation call whose effect is to *loosen* a block guard, and
loosening a safety guard is not a reviewer's decision to make unilaterally. Current behaviour errs
toward too restrictive, which is the right direction to be wrong in. **Blocker before G3.**

**S2-4 (Medium, RECORDED).** The Decision Workbench shows every action to every pilot-eligible role;
a `staff` pilot member can click Approve & Queue, Pause, Block and the bulk bar, all correctly 403'd
server-side. The sibling `CompanyPolicySection.jsx` already solves this (`getAuthUser()?.role` gating
`canWrite`) and the pattern is not reused. Not a security defect — the backend enforces correctly —
but operators should not be shown actions that always fail. The role→action mapping for this
component is not written down anywhere, so this is an owner decision, not a mechanical fix.

**S3-1 (Medium, RECORDED).** Smartlead credential detection is `/SMARTLEAD/i` against env var
**names** only. A credential under a name not containing that substring (`SL_API_KEY`, a future
rebrand) is invisible — a false negative on the exact thing this pilot must never have. No alias list
exists in the repo to reuse, so the fix is not decision-free.

**S3-3 (Low, partially addressed).** The runbook's "run against the deployment's actual environment"
named no mechanism. The `.env` half is fixed by H-1; the runbook now also states plainly that the CLI
only ever sees the environment of the machine it runs on and cannot reach into Railway. Naming a
concrete `railway run --service <name> …` command needs the real service name, which this read-only
review did not look up.

**S2-3 / PR 7 O-3 (carried, unchanged).** `POST .../prepare` remains a write at pilot-member tier with
no role gate. Confirmed by both the lead and S2. Inert while `WIZMATCH_AUTO_PREP_ENABLED=false`.

---

## Detailed verification

### Non-overridable at every scope — full action union

`UNBLOCKING_ACTIONS = ['approve_queue', 'resume', 'skip', 'pause']`
(`decisionWorkbenchActions.ts:189`). The scan over `effective.allActiveRows`
(`:246-259`) refuses each of those when **any** active row is a non-overridable block, at any scope,
**for every role including admin**, and it runs before every write.

| Action | Guarded? | Correct? |
|---|---|---|
| `approve_queue` | yes (unblocking) | ✓ |
| `resume` | yes (unblocking) | ✓ |
| `skip` | yes (unblocking) | ✓ |
| `pause` | yes (unblocking) | ✓ |
| `block` / `reject` | no | ✓ — strictly more restrictive; not a weakening |
| `set_review_date` | no | ✓ — changes only the review date; and `writeCompanyPolicy` refuses it anyway if the *root* is non-overridable |
| `assign_owner` | no | ✓ — does not touch policy state |
| `merge` / `confirm_separate` | n/a | ✓ — duplicate targets, own compare-and-swap |

Direct API (`POST /companies/:id/policy`) and bulk API: a write **to the narrower scope itself** is
refused by `writeCompanyPolicy`'s own `previousRow.isNonOverridable` check. A write to the *root*
while a narrower non-overridable block exists succeeds — but the block is not weakened: the resolver
is most-restrictive-wins and `findUnresolvableScopeType` (`policyResolver.ts:122-126, 156`) fails
closed when a narrower row exists that the request context cannot resolve. **The security property
holds at every scope through every path.** The asymmetry (the workbench action layer refuses more
than the direct API does) is an affordance/audit-clarity difference, not a bypass; recorded here so
it is not rediscovered as a defect later.

### `set_review_date` preserves policy meaning

Every field is read from the root row verbatim; the only field that can differ is `reviewDate`
(`decisionWorkbenchActions.ts:305-335`). It fails closed with `policy_dimension_unresolved` if the
root is missing `outreachEligibility`, `externalHiringPolicy`, `relationshipType` or `reasonCode`
rather than defaulting to a cold-start value. Request-supplied evidence/reason overrides are not
applied. The pre-fix defect this replaced was real and load-bearing: the generic path applied
`'manual_reclassified'`, which feeds `isPreparationAllowed(reasonCode)` and would have flipped a
`company_removal_request` company back to preparable. The test pinning it asserts the exact
predecessor `reasonCode` survives.

### Endpoint permission table (three pilot routers)

Every route on all three routers is behind: `auth` → tenant (from `req.user.tenantId`) →
feature flag (`next('router')` on off, never an inline 404) → **pilot gate** → role.

| Method + path | Flag | Pilot gate | Role |
|---|---|---|---|
| `GET /companies/:id/policy` | `WIZMATCH_COMPANY_POLICY_ENABLED` | ✓ | none (read) |
| `GET /companies` (by policy) | ✓ | ✓ | none (read) |
| `GET /duplicates` | ✓ | ✓ | none (read) |
| `POST /companies/:id/policy` | ✓ | ✓ | `admin`, `team_lead` |
| `POST /companies/bulk/policy` | ✓ | ✓ | `admin` |
| `POST /companies/:id/policy/override` | ✓ | ✓ | `admin` |
| `POST /companies/:id/account-owner` | ✓ | ✓ | `admin`, `team_lead` |
| `POST /duplicates/:id/resolve` | ✓ | ✓ | `admin`, `team_lead` |
| `GET /today/queues` | `WIZMATCH_DECISION_WORKBENCH_ENABLED` | ✓ | staff+ |
| `POST /today/actions` | ✓ | ✓ | `team_lead`+ single, `admin` for multi-target |
| `POST /companies/:id/prepare` | `WIZMATCH_AUTO_PREP_ENABLED` | ✓ | **none beyond the pilot gate** |
| `GET /companies/:id/prepare/status` | ✓ | ✓ | none |

The pilot gate is registered via `router.use(...)` immediately after the feature gate and before
every route definition in all three files, so it cannot be bypassed by a route added later.
**Pilot membership grants no write permission on its own** — verified: `requireStaffingPilot` returns
only an `allowed` boolean plus a capability map the gate ignores; every downstream `requireRole` is
unchanged.

`POST .../prepare` remains a **write at pilot-member tier with no role gate** while every other write
in this stack is `team_lead`+. This is **PR 7's open finding O-3, still open** — PR 8A added the
pilot gate on top of it but did not resolve the tier question, which is an owner decision. It is
inert while `WIZMATCH_AUTO_PREP_ENABLED=false` (the required pilot value).

### Pilot gate fail-open/fail-closed

`resolveStaffingAccess` (`wizmatchStaffingAccess.ts:33-65`):
- **Production** (`NODE_ENV === 'production'`): `configured && roleEligible && (allUsers || ids.has(userId))` — fails closed when the roster is unset, for **every** role including `admin`.
- **Non-production**: `roleEligible && (!configured || pilotAllowed)` — permissive by design, matching the Staffing OS precedent.
- Roster parsing splits on `/[\s,]+/` and filters empties, so whitespace/trailing-comma inputs are safe.
- `viewer` and any unrecognised role are refused at every configuration.

The production/non-production split turns on `NODE_ENV` alone. That is correct for the running
service, but it is why M-2 mattered for the *readiness check*, which is often run somewhere else.

### Readiness CLI — required danger conditions, re-run for real at `a2662cb1`

| Required condition | Fires? | Exit |
|---|---|---|
| approved safe shadow/all-off configuration | **passes** (0 dangers) | 0 |
| `WIZMATCH_POLICY_ENFORCEMENT_MODE=enforce` | DANGER | 1 |
| `WIZMATCH_SENDING_ENABLED` | DANGER | 1 |
| `AUTOMATED_EMAILS_ENABLED` | DANGER | 1 |
| `WIZMATCH_AUTO_PREP_ENABLED` (preparation) | DANGER | 1 |
| `WIZMATCH_OUTREACH_ADAPTER_ENABLED` | DANGER ×2 | 1 |
| Smartlead credential present | DANGER (name only, value never printed) | 1 |
| pilot roster absent | DANGER (`NODE_ENV=production` **or** `--production`) | 1 |
| unknown provider | DANGER (**fixed** — now independent of the adapter flag) | 1 |

Read-only by construction, verified by reading the source line by line: no DB import or connection,
no `fetch`/network/provider call, no filesystem write. Migration and backfill status are reported
from the filesystem only and both messages state explicitly that application to a database "is not
checkable without a DB connection". Secret values are never printed — pinned by an existing test and
re-verified for the new roster path.

**Honest limitation, now stated in the runbook:** the CLI only ever sees the environment of the
machine it runs on (plus `.env`, after H-1's fix). It cannot reach into Railway. "Run it against the
deployment's actual environment" means exactly that.

### Contrast claims — independently recomputed, not taken on trust

`badge-danger` text on `bg-danger-500/10` over white:
- old `danger-600` `#dc2626` → **4.23:1** (fails WCAG AA's 4.5:1)
- new `danger-700` `#b91c1c` → **5.66:1** (passes)

The implementation doc's "~4.22:1 → ~5.65:1" is accurate.

### Runbook G1–G4

Four gates, each ending in its own signed-approval placeholder, none skippable or combinable. No
command in the runbook applies `0037`, runs `--apply`, or promotes a flag; each such action is
explicitly deferred to its signed gate. G4 carries an explicit `G4 — NOT APPROVED` block. Verified by
reading every fenced block in the file.

### Scope boundary

`git diff --name-only ge/outbound-08-outreach-adapter..HEAD` — 37 files, all WizMatch outbound,
tests, or docs.

- **No guardrail file touched**: `src/db/schema.ts`, `src/db/migrations/`, `src/middleware/auth.ts`, `src/middleware/rbac.ts`, `src/routes/cashfree.ts`, `src/services/sodEodService.ts` — all confirmed absent from the diff.
- **No migration**: `0037_unknown_siren.sql` is still the latest; no `0038`.
- **No `package-lock.json` change.**
- **No Growth / SEO / n8n / D2C change.**
- Every `smartlead` occurrence in the diff is prose in docs/comments saying this pilot must not use
  it — no Smartlead code, header, fixture, credential or call.
- No sending, enrolment, reply-ingestion, IMAP, or paid-discovery (Apollo/Snov/Serper) code added or
  enabled. The `enrol`-family matches in the diff are in explanatory comments only.
- The only file outside WizMatch's own surface is `admin/src/index.css` / `admin/tailwind.config.js`
  (shared `badge-danger` contrast fix — see L-6).

---

## Control runs

**Nineteen mutations across the two passes**, each reverted immediately. Sixteen failed correctly.
**Three did not, and the tests were rewritten** — all three are the reviewer's own guards, and all
three are instances of this repo's recurring evadable-guard class (PR 2, PR 5, PR 7 T-3, PR 8 H-1),
which is worth recording precisely because the reviewer reproduced it while reviewing for it:

| Mutation | Result |
|---|---|
| dotenv import **commented out** | ✗ **survived** — the guard matched the commented line. Rewritten to strip comments first. |
| dotenv import commented out / deleted (after rewrite) | ✓ 1 failed / 1 failed |
| `--production` pass-through deleted | ✗ **survived** — the identifier's own `const` satisfied the guard. Rewritten to pin the call site. |
| `--production` pass-through deleted (after rewrite) | ✓ 1 failed |
| `blocked` predicate dropped from the narrower query | ✗ **survived** — the walker followed Drizzle's circular `.table` back-reference and so collected every sibling column, exactly the trap `wizmatchPolicyService.test.ts`'s own `paramValues` documents. Rewritten to skip `table`. |
| `blocked` / `isNonOverridable` / tenant predicate dropped (after rewrite) | ✓ 1 / 1 / 2 failed |
| unknown-provider danger removed | ✓ 1 failed |
| `assumeProductionTarget` ignored | ✓ 1 failed |
| all-users override treated as a roster | ✓ 1 failed |
| `NODE_ENV` runtime check removed | ✓ 1 failed |
| routed `disabledReason` branch removed | ✓ 2 failed |
| `routed` not set at construction | ✓ 2 failed |
| non-overridable surfaced only on `deny` (old behaviour) | ✓ 1 failed |
| non-overridable bucketing removed | ✓ 2 failed |
| `23505` mapping removed | ✓ 1 failed |
| policy `actor_required` guard removed | ✓ 2 failed |
| duplicate `actor_required` guard removed | ✓ 1 failed |

A fourth control was **invalid rather than survived**: the first attempt to drop the tenant predicate
matched the *root* query's identical line first, so it mutated the wrong statement. Re-run against a
unique multi-line context, it failed 2 correctly.

## Gates — every one run for real, on both trees

**Submitted tree (`47c27173`) — reproducing the implementation doc's claims:**

| Gate | Result |
|---|---|
| `git diff --check` | clean |
| `npm run build` | exit 0 |
| `npm test` | **122 files / 1246 tests**, all green — matches the doc exactly |
| `npm run admin:build` | exit 0 |
| `npx playwright test --config=playwright.wizmatch-local.config.ts` | **99 passed / 15 skipped / 0 failed** — matches |

**Fix tree (`f12c62ca`):**

| Gate | Result |
|---|---|
| `git diff --check` | clean |
| `npm run build` | exit 0 |
| `npm test` | **122 files / 1270 tests** (+24 over the submitted tree) |
| `npm run admin:build` | exit 0 |
| `npx playwright test --config=playwright.wizmatch-local.config.ts` | **99 passed / 15 skipped / 0 failed** |
| `npm run wizmatch:pilot-readiness` | exit 0 on the approved safe baseline; exit 0 on a fully correct production config (`NODE_ENV=production` + explicit roster + `--production`); exit 1 on every one of the nine required danger conditions and on the new `NODE_ENV` mismatch |

The 15 Playwright skips are the documented no-password real-backend specs (two hardening specs × 5
tests × 3 projects) — the same count and the same reason as every prior PR in this stack.

---

## Blockers

### Before creating the PR
- Nothing outstanding. `.ai/OUTBOUND_PR8A_CODE_READY` created at `f12c62ca`.

### Before G1 (apply migration `0037`)
- **B-1**, carried from PR 5/6/7/8: `0037` must be applied before this stack reaches `main` — the repo
  auto-deploys on push. Run the PRD-005 §10.11.4 fresh-database checks.
- **U-7 / ADR-006 D-14**: the three additive `(tenant_id, id)` unique indexes on `users`, `contacts`,
  `contact_channels` are shared with the Growth tenant and need that owner's sign-off (runbook G1).

### Before G2 (backfill `--apply`)
- Dry run reviewed against production data; "missing root policy" count sanity-checked. Nothing in
  PR 8A changes this.

### Before G3 (shadow deployment / live pilot)
- **Confirm `NODE_ENV=production` on the deployed Railway service (H-4).** The pilot roster gate fails
  closed on that exact string and nothing else; with any other value every pilot-eligible role is
  admitted regardless of the roster. Now an explicit G3 checklist step and a readiness `DANGER`, but
  the live value must be checked by a human — this review did not access Railway.
- **Owner decision on S1-2**: whether a `specific_signal` / `specific_requirement` non-overridable
  block should freeze company-level actions (current behaviour) or deny only that signal (PRD §8.2
  L4). Current behaviour is the safe direction to be wrong in, but it can strand a company.
- **Owner decision on S2-4**: whether the workbench should hide actions a `staff` pilot member's role
  will always cause the backend to 403.
- **Owner decision on S3-1**: whether Smartlead detection needs an alias list beyond the
  `/SMARTLEAD/i` name match.
- **Set `WIZMATCH_STAFFING_PILOT_USER_IDS` to an explicit id list.** Not the all-users override — the
  readiness CLI now refuses it as an open deployment.
- **Run `npm run wizmatch:pilot-readiness -- --production`** (the `--production` flag is now required
  at G3; without it a copied `.env` cannot fail the roster check).
- Set `WIZMATCH_COMPANY_POLICY_ENABLED=true` and `WIZMATCH_DECISION_WORKBENCH_ENABLED=true`, or the
  pilot's own surfaces stay invisible.
- **PR 6's §13 approval-capture gap** is now *closed in substance* by H-3's fix — the actor is
  guaranteed on every human write, at the chokepoint — but this schema still has no
  `approved_by`/`approved_at` columns. If the owner wants a dedicated approval pair rather than
  `actor_user_id` + `source` + the event chain, that is a migration and an owner decision.
- **PR 7's O-3 remains open**: `POST .../prepare` is a write at pilot-member tier with no role gate,
  while every other write in this stack is `team_lead`+. Inert while `WIZMATCH_AUTO_PREP_ENABLED=false`.
- PR 7's O-1 and O-4 before enabling `WIZMATCH_AUTO_PREP_ENABLED` with real data.

### Before G4 (`enforce`)
- Everything carried from PR 3/5/6, plus PR 7's O-2 (the cross-job duplicate-contact race, which
  needs a partial unique index and is therefore blocked behind a migration).
- G3's observation window must show the readiness report's hard preconditions met (zero companies
  missing an effective policy, among others).

### Deferred to PR 9 / PR 10
Unchanged by this review, carried verbatim from the PR 8 review. **PR 9 remains GATED on the
sanitised Smartlead fixtures (U-6).** Before PR 9 writes a real provider: M-7 (where readiness is
asserted), M-8 (whether `getConfigStatus()` takes a `tenantId` — cheapest now, at zero callers), M-6
(constrain `reason` before a credentialed provider populates it), M-12 (actually enforce
`WIZMATCH_OUTREACH_ADAPTER_ENABLED` — still read by no code), M-13 (the real ADR-007 D-4 grep).
Before PR 10: H-4 (the multi-tenant reply-poller route), M-10, M-11. Plus this review's L-3
(per-target `expectedPolicyId`) if the bulk contract is revisited.

---

## No prior finding is falsely closed

Spot-checked and confirmed still open, not silently marked resolved: PR 7's O-1…O-4 and P-1…P-4
(P-3, `isPreparationAllowed` failing open, **is** genuinely closed by PR 8A and correctly claimed);
PR 8's M-6…M-14 and L-1…L-11; PR 6's §13 approval-capture gap (now closed in substance by H-3 —
recorded above with the residual schema question).

---

## Safety

Nothing was pushed, merged or deployed. No Railway or production access. Migration `0037` not
applied. Backfill not run. Enforcement mode untouched (`shadow`). Sending, the outreach adapter,
preparation and paid discovery all remain disabled. No Smartlead connection of any kind. No provider
credential used. No environment variable changed anywhere outside a transient, per-command `env`
prefix in this session's own local readiness-CLI test matrix. PR 9 and PR 10 not started. No `0038`.
No unrelated functionality modified. Working tree clean.
