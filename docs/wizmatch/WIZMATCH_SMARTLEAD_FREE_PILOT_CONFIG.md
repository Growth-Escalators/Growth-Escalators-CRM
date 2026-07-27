# WizMatch Smartlead-free live-pilot configuration contract

- **Status:** Required initial configuration for the internal Smartlead-free production pilot (PR 8A + 8B hardening)
- **Scope:** `ge/outbound-08b-g3-pilot-completion`, built on the independently-reviewed
  `ge/outbound-08a-live-pilot-hardening` stack (PR 1–8A, CODE READY at `f12c62ca`)
- **Companion:** [`docs/prd/005-wizmatch-outbound-operating-system.md`](../prd/005-wizmatch-outbound-operating-system.md) §16 (feature flags), [`ADR-007`](../decisions/ADR-007-outreach-provider-boundary.md)
- **Verification:** `npm run wizmatch:pilot-readiness` (read-only, see below) checks every value in this table mechanically

This document is the single source of truth for what the environment must
look like on the day this stack is first deployed to the internal pilot. It
does **not** authorise changing any shared or production environment
variable — that remains a separate, explicit action gated by
[`docs/runbooks/WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md`](../runbooks/WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md).

## Required initial values

| Variable | Required initial value | Why |
|---|---|---|
| `WIZMATCH_POLICY_ENFORCEMENT_MODE` | `shadow` (or unset — anything other than the exact string `enforce` is shadow, PRD-005 §16 rule 3) | The pilot observes what the resolver *would* block without blocking anything. Promotion to `enforce` is a separate, later G4 owner decision. |
| `WIZMATCH_SENDING_ENABLED` | `false` (or unset) | No cold email may leave the system during this pilot. |
| `AUTOMATED_EMAILS_ENABLED` | `false` (or unset) | The generic automated-email path stays off; this pilot is preparation/decision only. |
| `WIZMATCH_AUTO_PREP_ENABLED` | `false` | Gates BOTH the automatic preparation cron and the manual `POST/GET .../prepare[/status]` routes (same flag, `wizmatchPrepare.ts`). Preparation ships off on day one; enabling it is a later, separate decision once the pilot roster and policy surfaces have been observed. |
| `WIZMATCH_OUTREACH_ADAPTER_ENABLED` | `false` | No outreach batch/export/import route may be reachable. Adapter availability never implies sending availability, but this pilot needs neither. |

## Pilot roster — the control that makes this a pilot

| Variable | Required initial value | Why |
|---|---|---|
| `WIZMATCH_STAFFING_PILOT_USER_IDS` | an explicit, comma/whitespace-separated list of exactly the intended pilot members' user ids | This is the ONLY thing that limits the pilot surfaces (Decision Workbench, policy read/write, preparation) to the pilot group. `resolveStaffingAccess` fails closed in **every** runtime when it is unset — dev, staging and production alike, with no permissive local branch — so no role, not even `admin`, gets through; an unset value does not leak, it simply makes the pilot unusable. `npm run wizmatch:pilot-readiness` reports an unset/blank roster as a DANGER without needing `--production`, and reports a count of any entry that is not UUID-shaped (ids never printed). |
| `WIZMATCH_STAFFING_PILOT_ALL_USERS` | unset / `false` | Setting this admits **every** pilot-eligible role (`admin`, `team_lead`, `manager_ops`, `sales`, `staff`) tenant-wide. That is an open deployment, not a restricted pilot, in every runtime — the staffing gate has no environment condition — so `npm run wizmatch:pilot-readiness` reports it as a DANGER with or without `--production`. |

Note the role gate and the roster gate are independent and neither implies the
other: a roster member with an ineligible role is still refused, and passing
the roster grants **no** write permission on its own — every write still passes
its own `team_lead`+/`admin` check.

## Also required (not new flags, but must hold true)

- **No Smartlead credential may be present.** No environment variable whose
  name matches `/SMARTLEAD/i` may hold a non-empty value, **and** no known
  Smartlead credential alias may either — the readiness command also exact-name
  matches an enumerated alias list (`SL_API_KEY`, `SL_API_TOKEN`, `SL_TOKEN`,
  `SL_SECRET`, and the `SMARTLEAD_*` names) so a credential parked under a name
  containing no "smartlead" at all is still caught. Matching is by exact name,
  never an `SL_` prefix, so unrelated variables such as `SL_TIMEZONE` are not
  flagged. `OUTREACH_PROVIDER`
  is irrelevant while `WIZMATCH_OUTREACH_ADAPTER_ENABLED=false` — it is read
  by no code path in that state — but it must never be set to a real
  provider name while the adapter is (or might be) turned on.
- **Paid-discovery configuration remains disabled.** `WIZMATCH_PAID_DISCOVERY_ENABLED`,
  `WIZMATCH_ENABLE_APOLLO`, `WIZMATCH_ENABLE_SNOV`, `WIZMATCH_GOOGLE_FALLBACK_ENABLED`
  stay at their existing (off) values — this pilot changes none of them.
- **No scheduler is enabled** for anything this stack adds. `WIZMATCH_AUTO_PREP_ENABLED=false`
  already covers the one cron this stack introduces (`prepareCompaniesJob`,
  PRD-005 §14); no other cron is part of PR 1–8A.
- **No provider is selected.** `KNOWN_PROVIDERS = ['mock']` in
  `src/modules/outreach/providers/index.ts` — there is no real (Smartlead or
  otherwise) provider implementation on disk yet, so `OUTREACH_PROVIDER`
  cannot select one even if it were misconfigured. This is a structural
  guarantee, not merely a configuration one (PR 8 review). The readiness
  command nonetheless reports a non-empty `OUTREACH_PROVIDER` that is not in
  that allow-list as a **dangerous** finding regardless of the adapter flag —
  including `smartlead_csv`, the documented default and the exact provider
  this pilot must not use. Leave it unset.
- **Adapter availability does not imply sending availability.** Even in a
  later state where `WIZMATCH_OUTREACH_ADAPTER_ENABLED=true` and a real
  provider exists, `capabilities.sends` and `WIZMATCH_SENDING_ENABLED` /
  `AUTOMATED_EMAILS_ENABLED` are independent gates. All must agree before any
  send is possible — a future PR 9/10 concern, not this one.

## What the pilot MAY support with the table above

Per the hardening objective: company policies (read + write, `team_lead`+),
duplicate review, Decision Workbench queues (Ready to Contact / Needs Review
/ Routed / Replies Needing Action / Paused or Blocked), human review and
approvals, zero-cost company preparation (once `WIZMATCH_AUTO_PREP_ENABLED`
is deliberately turned on in a later step), evidence and provenance, contact-
candidate review, campaign recommendations (advisory only), personalisation
drafts, and readiness/shadow-observation reporting.

Two additional flags gate the pilot's OWN visible surfaces (not safety
flags — functional-availability ones):

| Variable | Required for the pilot to be usable at all |
|---|---|
| `WIZMATCH_COMPANY_POLICY_ENABLED` | `true` — policy read/write API + UI |
| `WIZMATCH_DECISION_WORKBENCH_ENABLED` | `true` — Today queues (including the new Routed queue) |

Both default to `false` in the codebase (fail closed, invisible rather than
merely unauthenticated). Turning them on is required for the pilot to show
anything, and is independent of every safety flag above.

## What the pilot MUST NOT do

Send, enrol, connect Smartlead, import or export a Smartlead CSV, use any
provider credential, ingest a reply, use paid discovery, or promote
enforcement beyond shadow. Every one of these is prevented by the table
above, not merely documented — see `npm run wizmatch:pilot-readiness` for a
mechanical check.

## Do not change shared or production environment variables

This document describes what the values must **be**; it is not itself
authorisation to change any Railway/Vercel environment variable, shared or
otherwise. Changing an actual deployed value follows
[`docs/runbooks/WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md`](../runbooks/WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md)
and the repo's standing `ge-manage-railway-env` skill/guardrails.
