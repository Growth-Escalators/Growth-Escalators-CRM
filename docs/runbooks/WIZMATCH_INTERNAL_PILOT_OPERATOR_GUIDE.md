# WizMatch internal pilot — operator guide

- **Status:** Operating guide for the internal, Smartlead-free WizMatch Outbound pilot (PR 1–8B).
  Written for a pilot-roster member using the Decision Workbench day to day. It does not authorise
  any production, migration, or configuration change — those follow
  [`WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md`](WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md).
- **Companion docs:** [`WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md`](../wizmatch/WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md)
  (what the environment must look like), [`docs/prd/005-wizmatch-outbound-operating-system.md`](../prd/005-wizmatch-outbound-operating-system.md)
  §4 (roles), §8 (policy/block semantics), §13 (workbench UI states).

This guide does not name real team members, production URLs, or Railway service names — those are
operational specifics the deploying human fills in at G3, not something this document invents.

## 1. What the pilot team CAN do

- **Review companies** in the Decision Workbench (`/wizmatch/today`) — every company the pilot
  surfaces, bucketed into one of five queues (see §4).
- **Understand allow/review/deny** — every company shows its canonical decision, the effective
  policy that produced it, and (in shadow mode) whether the *stored* decision diverges from what
  the resolver would compute if enforcement were on ("shadow: would deny" badges never block
  anything — see §16 rule 2 of the PRD).
- **Examine evidence** — the reason code, evidence links, and provenance (who/what made the
  decision and when) behind any policy row, including a block scoped to one specific signal or
  requirement (PR 8B, P8B-1 — see §5 below).
- **Resolve duplicates** — merge or confirm-separate a pending duplicate-company pair.
- **Assign or reroute work** — set an account owner, or act on a company the resolver has routed
  to a specific workflow (account management, partnership, MSP/VMS research, re-engagement).
- **Approve a company with provenance** — `team_lead`+ can move a `review` decision to `eligible`
  (Approve & Queue); the write always records who approved it and why, and refuses to record an
  approval with no identified actor.
- **Pause a company, or set/adjust its review date** — without changing any other policy field.
- **Trigger preparation once it is separately enabled** — company preparation
  (`WIZMATCH_AUTO_PREP_ENABLED`) is OFF for this pilot's initial deployment; if and when the owner
  turns it on later, the same role rules apply.
- **Review contacts and confidence** — a contact's confidence tier (high/medium/low) gates whether
  it is offered as ready-to-contact; a blocked signal's evidence is excluded from this (PR 8B).
- **Use campaign-family recommendations and personalisation drafts** — both are advisory only; a
  draft never invents a fact, and never uses a blocked signal or requirement as its basis (PR 8B).
- **Report a wrong decision** — see §7, escalation path.

## 2. What the pilot team CANNOT do

- **Send anything from the system.** `WIZMATCH_SENDING_ENABLED=false` and
  `AUTOMATED_EMAILS_ENABLED=false` for the whole pilot; no UI action reaches an email provider.
- **Enrol a contact into a sequence.** No enrolment write path is reachable
  (`WIZMATCH_OUTREACH_ADAPTER_ENABLED=false`).
- **Enable Smartlead, or use any provider credential.** No Smartlead code exists in this stack; the
  provider factory only constructs a `mock` provider and fails closed on anything else.
- **Change the policy enforcement mode.** `WIZMATCH_POLICY_ENFORCEMENT_MODE` stays `shadow` for the
  whole pilot; promoting to `enforce` is a separate, later owner decision (G4), not a UI action.
- **Bypass a non-overridable block.** A company/region/business-unit/location-scoped
  non-overridable block cannot be overridden by any role, including admin, through any action —
  individual, bulk, or otherwise.
- **Use a blocked signal or requirement as evidence.** A specific signal or requirement carrying an
  active block is excluded from readiness, recommendations, confidence, personalisation, and
  routing — even though the company itself stays fully actionable (PR 8B, P8B-1).
- **Run a migration or a backfill.** Both remain human-run, explicitly-approved operations outside
  the application (see the go-live runbook's G1/G2 gates); nothing in the UI or API triggers either.
- **Change production configuration flags.** Environment variables are changed through the repo's
  standing infrastructure process, never through the pilot surfaces themselves.

## 3. Role matrix

No new roles were introduced for this pilot — it reuses the CRM's existing roles, narrowed further
by the pilot roster (see §6).

**PR 8B remediation, M-3:** the pilot roster now gates the entire `/api/wizmatch` router (82 routes),
not only the Decision Workbench/policy/preparation surfaces. Sending, paid contact discovery,
provider-run sourcing, and every other outreach-mutating or read route in that router require pilot
roster membership. This is a behavior change from the original PR 8B submission, where a
role-permitted user outside the roster could still reach those routes. Machine-to-machine internal
routes (`/signals/ingest`, `/signals/:id/(score|enrich|match)`, `/candidates/ingest`,
`/classify-reply`, `/unsubscribe`) are unaffected — they authenticate via an internal token, not a
human session, and are resolved before this gate.

| Action | Minimum role |
|---|---|
| Read policy, read queues | any pilot-roster member (`staff`+) |
| Write a policy row (approve / pause / block / reclassify) | `team_lead` |
| Approve a `review`-decision batch | `team_lead` |
| Admin override of a `standard` block | `admin` |
| Override a `compliance` or `legal` (non-overridable) block | **nobody** — no role can do this |
| Bulk policy write, bulk queue action | `admin` only |
| Assign account owner | `team_lead` |
| Merge / confirm-separate a duplicate pair | `team_lead` |
| Promote `shadow` → `enforce` | owner decision, not a role — not available in this pilot |

**A `staff` or read-only pilot member sees write actions as disabled with a visible reason, not as
an enabled button that then fails.** This is enforced twice — the server never accepts a write from
an ineligible role regardless of what the UI shows, and the UI now predicts the same answer the
server would give, so nobody sees a control they cannot actually use (PR 8B, P8B-2).

## 4. Queue definitions

The Decision Workbench (Today page) buckets every company into exactly one queue, in this
precedence order:

1. **Paused or Blocked** — a pending duplicate, an active pause whose review date has not yet
   arrived, or a non-overridable block at company/region/business-unit/location scope. A company
   whose *only* block is on one specific signal or requirement does **not** land here — it is
   bucketed normally, with the affected signal/requirement disclosed separately (PR 8B, P8B-1).
2. **Routed** — the resolver has recommended a specific non-default workflow (account management,
   partnership, MSP/VMS research, re-engagement) or the company already has an assigned account
   owner.
3. **Needs Review** — the canonical decision is `review`, or the only available contact is
   medium/low confidence.
4. **Replies Needing Action** — an enrolment (once enrolment exists in a later PR) is awaiting a
   human response.
5. **Ready to Contact** — the canonical decision is `allow`, a high-confidence contact exists, and
   nothing above applies.

## 5. Action definitions

| Action | What it does | What it never does |
|---|---|---|
| Approve & Queue | Moves a `review` decision to `eligible`, recording who approved it | Send anything; approve twice (a second click on an already-`eligible` company is refused, not silently repeated) |
| Pause | Suspends a company's outreach eligibility with an optional review date | Delete the company or its history |
| Block / Reject | Sets a `standard`, `compliance`, or `legal` block | Convert an admin-overridable `standard` block into a non-overridable one without being asked to |
| Resume (Reclassify) | Moves a paused or blocked company back to `needs_review` | Override a non-overridable block |
| Assign Owner | Sets the account owner for a routed or any other company | Grant that owner any special policy permission |
| Set Review Date | Changes only the review date | Change any other field on the policy row, even implicitly |
| Merge / Confirm Separate | Resolves a pending duplicate-company pair | Apply to more than one pair per call |

## 6. Blocked-action explanations

Every disabled action shows a visible, non-decorative reason, and the same reason is available to
assistive technology (`aria-describedby` pointing at the visible text, not only a hover tooltip).
The reasons you will see:

- **"This action requires team_lead or admin."** — your role does not meet the action's minimum
  tier (§3).
- **"Bulk actions require admin."** — a true multi-select (more than one row) is always admin-only,
  regardless of what the individual items permit. Selecting exactly one row is **not** bulk — it
  uses that row's own single-target rules, so a `team_lead` can act on a single selected company
  without seeing this message (PR 8B remediation, M-0/M-1). Within an actual multi-select, the bar
  also now disables an action the moment **any** selected row individually forbids it — e.g. Resume
  is disabled, with the specific reason, if even one selected company carries a non-overridable
  block, rather than showing every bulk action as available and letting the server refuse each
  target silently (PR 8B remediation, H-6).
- **"This company has a non-overridable block... No override, resume or reclassify action is
  available at any scope."** — a company, region, business-unit, or location-level compliance/legal
  block is active. This cannot be overridden by anyone, including admin.
- **"A specific signal/requirement is blocked and cannot be used as evidence or as an outreach
  route. The company itself is otherwise active and its company-level actions remain available."**
  — a narrower, signal- or requirement-scoped block is active. Unlike the reason above, this does
  **not** disable the company's other actions — this is the PR 8B (P8B-1) distinction between a
  company-wide block and a block on one specific opportunity.
- **"Overriding a block requires an admin."** — the company is blocked with a `standard`
  (admin-overridable) class, and your role is below admin.
- **"This company is already eligible; the approval was already recorded."** — Approve & Queue is a
  one-time transition; re-clicking it is refused, not silently repeated.
- **"This company's policy has changed since you loaded it. Refresh and retry."** — someone else
  changed this company's policy since your page loaded; refresh before retrying.

## 7. Escalation path

If you believe a decision, block, or disabled action is wrong:

1. Note the company id, the action you attempted, and the exact reason shown.
2. Do not attempt to work around it by using a different action or a bulk selection — every path
   enforces the same rule server-side, so a workaround will simply be refused (or, if you believe
   you have found one that succeeds, that is itself the thing to report immediately, not use).
3. Escalate to whoever the deploying team designates as the pilot's technical point of contact for
   this rollout (named at G3, not fixed in this document) with the three details above.

## 8. First-day operating checklist

- [ ] Confirm you can log in and reach `/wizmatch/today` without a 403.
- [ ] Confirm all five queues render (§4), even if some are empty.
- [ ] Open one company in each non-empty queue and read its decision, evidence, and (if present)
  its block reason.
- [ ] If you are `team_lead`+, perform one low-stakes write (e.g. Set Review Date) on a test/known
  company and confirm it round-trips.
- [ ] If you are `staff`-tier, confirm write actions render disabled with a reason rather than as
  enabled buttons.
- [ ] Confirm no action anywhere claims to send, enrol, or connect to an external provider.

## 9. First-week observation checklist

- [ ] Note any company that seems to be in the wrong queue, and report it (§7) rather than acting
  around it.
- [ ] Note any disabled-action reason that seems unclear or wrong.
- [ ] Note any "shadow: would deny" divergence you don't understand — this is informational in
  shadow mode and never blocks anything, but is exactly the signal the observation window before
  G4 is meant to collect.
- [ ] Confirm the pilot roster is still limited to the intended members (ask the technical point of
  contact — pilot members do not have visibility into the roster itself).

## 10. Smoke-test checklist (for whoever verifies the pilot is healthy)

- [ ] `GET /api/wizmatch/today/queues` returns all five queues without error.
- [ ] A single policy write round-trips (see G3's own smoke-test list in the go-live runbook).
- [ ] A non-overridable company-scope block still shows no override affordance for any role.
- [ ] A signal/requirement-only block still leaves the company's other actions available.
- [ ] A `staff` account sees write actions disabled with a reason, never enabled-then-403.
- [ ] Nothing in the UI or API offers to send, enrol, or select a live provider.

## 11. Rollback / escalation triggers

Stop using the pilot and escalate immediately if you observe any of the following — these indicate
a live safety-boundary problem, not a workflow question:

- Any UI or API response indicates an email was sent, a sequence enrolment happened, or a Smartlead
  connection was attempted.
- A non-overridable block was successfully overridden by any role.
- A blocked signal or requirement's content appears in a draft, recommendation, or confidence score
  for a company that has not separately approved contact.
- The pilot roster appears to admit an account that is not an intended pilot member.
- `WIZMATCH_POLICY_ENFORCEMENT_MODE` appears to have changed to `enforce` without a separate,
  explicit G4 approval having happened.

None of the above should be possible given this pilot's configuration and code — if you see one,
it is exactly the kind of finding this pilot exists to surface before wider rollout.
