# ADR-006: Company Outreach Policy

- **Status:** Accepted — reason-code taxonomy ratified 2026-07-26; **amended 2026-07-26 with D-13…D-18**
  (spec-repair pass against the overnight Opus review); no schema applied yet
- **Date:** 2026-07-26
- **Product contract:** `docs/prd/005-wizmatch-outbound-operating-system.md`
- **Supersedes:** nothing. **Extends:** ADR-004 (staffing domain spine)
- **Companion:** `ADR-007-outreach-provider-boundary.md`

## Context

WizMatch can source, score, discover and match. It cannot answer the one question that gates all of
it: **may we contact this company at all?**

The 2026-07-26 audit of `origin/main` found that eligibility is re-derived, ad hoc, in five places
that do not agree with one another, and that none of them persists a decision with evidence:

- `wizmatch_company_intelligence.status` — persisted, 1:1 with company (`src/db/schema.ts:1807-1840`)
- `hardBlocks[]` — computed in memory, folded into `source_summary` jsonb as a side effect
  (`src/services/wizmatchContactIntelligence.ts:263-424`)
- four independent `hot | warm | watch | blocked` enums, none persisted
  (`wizmatchClientDiscovery.ts:2`, `wizmatchCandidateIntelligence.ts:2`, `wizmatchCommandCenter.ts:7`,
  `wizmatchRequirementPriority.ts:7`)

Related structural gaps:

- **No company-level relationship type.** Only `isPrime` + `primeMsaStatus`; `relationshipStage` is
  person-level (`schema.ts:1325-1326`, `wizmatchStaffingDomain.ts:10`).
- **Suppression fragmented across four grains and never unioned** — `contacts.doNotContact`,
  `wizmatch_suppression_list`, `wizmatch_company_contacts.relationshipStage`,
  `wizmatch_company_intelligence.status` (`schema.ts:53`, `:1506`, `:1591`, `:1807`).
- **The one function that actually sends checks only one of them.** `sendSignalDraftEmail()` reads
  `wizmatch_suppression_list.email` and never `contacts.do_not_contact`, which the generic CRM
  `PATCH /api/contacts/:id` sets freely with no mirrored write (`wizmatchOutreachService.ts:183-189`,
  `src/routes/contacts.ts:405,421`). Suppression is therefore **fail-open** today.

A sixth ad hoc eligibility computation would make this worse. This ADR records the decisions that
make one policy model authoritative.

## Decision

### D-1 — A dedicated, scoped policy table, not an extension of `wizmatch_company_intelligence`

`wizmatch_company_intelligence` is 1:1 with company (`uniqueIndex` on `(tenantId, companyId)`,
`schema.ts:1838`). The required policy scope — whole company, a region, a business unit, a location,
one signal, one requirement — is inherently many-rows-per-company. A 1:1 table cannot express
"blocked in India, eligible in the US", and cannot pin a policy to a single signal.

Two new tables: `wizmatch_company_policies` (current state, one active row per real scope) and
`wizmatch_company_policy_events` (append-only history).

`wizmatch_company_intelligence.status` keeps its current writer during transition, but is **not**
consulted for any outreach decision — it is historical display context only (D-13). Nothing legacy is
dropped.

### D-2 — Scope identity is a canonical `scope_key`; entity references are typed and tenant-safe

**Revised 2026-07-26.** Uniqueness keyed on a reference id alone cannot distinguish two business
units, because business unit, location and region are labels rather than UUIDs. Scope identity is
therefore a single canonical string built only by `buildScopeKey(scopeType, ref)` — lowercased,
trimmed, internal whitespace collapsed to `-`:

```
entire_company · region:india · region:us · business_unit:cloud
location:bengaluru · specific_signal:<uuid> · specific_requirement:<uuid>
```

```sql
UNIQUE (tenant_id, company_id, scope_key) WHERE superseded_at IS NULL
```

`business_unit:cloud` and `business_unit:data` are distinct keys, so both stay active; a second active
`business_unit:cloud` is rejected by the database.

**The single polymorphic `scope_ref_id` column is deleted** (D-14 below; owner decision D-2). An
earlier draft kept one nullable
uuid that might name a signal, a requirement, or nothing, and described it as "a typed, CHECK-bound
column for querying". That is not achievable: a single column cannot carry a foreign key to two
parents in any dialect, so the column necessarily had **no FK at all**, and a `specific_signal` policy
could name a signal belonging to another tenant, or no signal.

It is replaced by two typed, mutually exclusive columns — `signal_id` and `requirement_id` — each with
a composite `(tenant_id, x_id)` foreign key, and each CHECK-tied to `scope_key` so the key and the
reference cannot disagree. `signal_id` references **`wizmatch_job_signals`**; the table named `signals`
is Growth's prospect-scoped table and has no `tenant_id` at all. `scope_ref_label` remains for the
three label scopes, which have no entity to reference. Full matrix: PRD-005 §10.10.

`region` is CHECK-constrained to `india | us`, matching `wizmatch_company_intelligence.target_region`
and the `WIZMATCH_INDIA_ONLY` classification. Open-ended labels would invite `US` / `usa` /
`United States` drift, and scope keys are a uniqueness dimension — drift there creates silently
duplicated policies the database cannot catch. Extending the set is a later migration.

### D-3 — Per-dimension inheritance, with `entire_company` as the root

`entire_company` must define all three dimensions — `outreach_eligibility`, `external_hiring_policy`,
`relationship_type`. Every narrower row may leave any dimension NULL, meaning *inherit from the next
broader applicable scope*, and must override at least one dimension. Both rules are CHECK-enforced.

Each dimension resolves **independently** up the ladder
`signal|requirement → location → business_unit → region → entire_company`, taking the first non-null
value and recording which `scope_key` supplied it.

**This is the load-bearing part.** Without it, a `location:bengaluru` row that pauses Bengaluru would
carry default values for the other two dimensions and silently reset an `existing_client` relationship
and a company-wide hiring policy. A narrow row must never reset a dimension it did not mention.

A company with no active `entire_company` row resolves to **DENY** with
`reasonCode = 'policy_missing_root'`, and is counted as missing by the readiness report. This is
unconditional: there is no legacy-status fallback, no "unknown means proceed", and no per-caller
exemption (D-13).

### D-4 — Hard blocks beat specificity

Resolution is two phases. Phase 0 builds the effective policy by D-3 inheritance. Phase 1 applies the
enforcement gates to that composite.

"Most specific wins" is a **Phase-0 inheritance rule only**. It never lets a narrow `eligible` row
defeat a hard block in Phase 1. A non-overridable block — at **any** scope, per D-17 — or
`no_external_agencies` always wins, regardless of how specific a permissive row is.

**Company-wide blocks come from this table, never from a suppression row.** `wizmatch_suppression_list`
has exact email/channel grain only (D-15); it carries no company or domain concept. An earlier draft of
this decision said "a company/domain suppression", which contradicted this ADR's own rejected
alternative *"A separate domain-suppression table for company-wide removal"*.

Full gate order is PRD-005 §8.2. The resolver **fails closed**: any DB error, missing row, unresolvable
scope or ambiguous match evaluates to DENY, never ALLOW.

### D-5 — `block_class` + `is_non_overridable`, not a single `is_legal_hold` flag

An earlier draft modelled the strongest block as `is_legal_hold`. That conflates two different things:
a company asking to be removed is a **compliance** obligation, not a legal or regulatory restriction.
Overloading one flag would have made every removal request look like a legal matter and would have
left no way to express an ordinary but firm business block.

| `block_class` | Meaning | Override |
|---|---|---|
| `standard` | Ordinary business block — competitor, quality, operator judgement | `admin` |
| `compliance` | A binding request or obligation — e.g. a company-wide removal request | none |
| `legal` | Actual legal or regulatory restriction | none |

**Enforcement keys on `is_non_overridable`, not on `block_class`.** The class classifies and explains;
the boolean enforces. This keeps the gate logic independent of how many classes exist later.

### D-6 — Privacy erasure is not an outreach policy

A GDPR or privacy erasure request is **not** modelled as a policy row. Suppressing outreach does not
erase data. Genuine erasure requires identifying PII across `contacts`, `contact_channels`, `messages`,
`events`, generated exports and provider systems; erasing it; and evidencing the erasure.

A `privacy_request_pending` reason code exists so an in-flight request suppresses outreach and routes
to that workflow, but **it must never be treated as evidence that erasure occurred**. The erasure
workflow itself is out of scope and is the highest-priority item in the PRD FUTURE list.

### D-7 — Restrictions bind at their own grain

| Event | Blocks | Does not block |
|---|---|---|
| Role closed | that signal | the company, the contact |
| Wrong contact | that contact | the company, other contacts |
| Hard bounce / invalid email | that email/channel only | the person, the company |
| Personal unsubscribe | that email **and** that contact | the company, colleagues |
| Spam complaint | that email **and** that contact, never overridable | the company, colleagues |
| Company removal request | the company, permanently | — |

A hard bounce is a channel-quality fact and must not silently mark a whole person do-not-contact. An
unsubscribe is a stated personal preference and must not silently block their employer. An earlier
draft conflated the two into one "set both" write; that is corrected here.

**Storage rule — this is the part the earlier draft left unsaid, and where the contradiction lived.**
Grain separation is a rule about *what a restriction blocks*, not a licence to store several effective
rows for one address. See D-15.

**Valid companies are never deleted merely because they are unsuitable for outreach.** Reclassification
is a policy write.

### D-8 — Restricted is routed, not uniformly denied

Treating every restricted hiring policy as the same DENY throws away the most useful information in the
record. Each policy therefore returns a route and a permitted campaign set:

`no_external_agencies` → deny, no preparation · `direct_hiring_only` → deny, monitor only ·
`msp_vms_only` → deny direct outreach, route to MSP/VMS research · `preferred_vendors_only` → review,
route to vendor empanelment · `fte_vendors_only` → FTE campaigns only · `contract_vendors_only` →
contract/C2H only · `accepts_external_vendors` → matching campaigns · `unknown` → free preparation,
review before outreach.

`no_external_agencies` and `relationship_type='irrelevant'` are the only values that stop free
preparation.

### D-9 — Three orthogonal campaign dimensions

| Dimension | Controls | Does **not** control |
|---|---|---|
| `campaign_type` | policy compatibility | workflow, overlap |
| `campaign_family` | workflow and reporting only | permission, ever |
| `outreach_mode` | company-level overlap lock; whether cold email is possible at all | which campaign type is permitted |

Campaign types were extended to cover `vendor_empanelment`, `msp_vms` and `reengagement` so that no
workflow is ever assigned a **fake staffing type** — an MSP research batch is `campaign_type='msp_vms'`,
never `'contract'`.

The company-level lock is on `outreach_mode`, **family-agnostic**: one **live** cold-email enrolment per
company across all families. Family alone would have permitted a company to sit in several concurrent
cold-email campaigns.

**"Live" is defined by D-16, and a reply does not release the lock.** The earlier draft left "active"
as undefined prose backed by a three-state predicate that excluded `replied` — so a company that
replied became eligible for a second cold-email campaign while the conversation was still open, which
is precisely the overlap this decision exists to prevent.

A unit test asserts the resolver returns identical decisions across all five families for identical
policy inputs, proving family grants no permission.

### D-10 — Policy decision content is immutable; supersession is metadata

A change is a new row that supersedes the previous one. The **only** columns ever updated on an
existing row are `superseded_at` and `superseded_by_policy_id`. Enforced three ways: no service update
path for decision columns; a DB trigger raising on any UPDATE touching another column; a test asserting
the trigger fires.

This is not fully append-only, and the exception is deliberate: the partial unique index needs a null
`superseded_at` to identify the live row. A fully append-only design would need either a separate
"current pointer" table or a window function on every read, both of which cost more than a two-column,
trigger-guarded exception.

**How the trigger ships (revised 2026-07-26, owner decision D-3).** drizzle-kit 0.31.10 has no trigger primitive and
the repo contains zero triggers, so this requirement and the PRD's earlier *"never a hand-written SQL
file"* rule were mutually exclusive as written. The trigger is hand-authored inside the marked guard
block defined in PRD-005 §10.11.2, under a six-step process — generate first, append the minimum,
mark the block, replay on a fresh database, verify no destructive statement, document why. It is the
**only** construct in `0037` that is not generated: composite FKs, partial unique indexes and CHECK
constraints are all emittable at the pinned versions.

**Two consequences for the design.** First, `admin_override` is deleted (D-18) — a mutable boolean on
an immutable row has no reachable write path, so an override must itself be a superseding row. Second,
the same reasoning applies to enrolment lock release: `manually_released` is a state transition with an
actor, a reason and an event, not a flag someone sets (D-16).

### D-11 — The unhealthy-mailer fallback is reversed

`src/services/multiDomainMailer.ts:71-75` currently reads *"If no healthy domains match, use all
inboxes"*. **That code is unchanged today.** Under this decision, once PR 3 lands, the sender will
**fail closed** with no healthy inbox unless `WIZMATCH_MAILER_EMERGENCY_OVERRIDE=true` — a flag that
also does not exist yet — which will log and Slack-alert on every use.

**This reverses a previously recorded decision** — `docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md`
§1 verdict row 7 / §4 "All-domains-unhealthy Slack alert" adopted "alert + keep sending". It is
recorded here so the reversal is deliberate and traceable
rather than looking like a regression. It does **not** enable sending: both kill-switches remain off
and untouched, so live impact today is zero. The change only makes the path stricter.

### D-12 — PRD-005 inverts PRD-004's source precedence

PRD-004 §0 ranks current code above the PRD. PRD-005 ranks approved target behaviour above current
code, because the audit found four live defects the target explicitly corrects: fail-open suppression,
the dead follow-up loop, discarded hard bounces, and the unhealthy-mailer fallback.

Code that contradicts approved target behaviour is a defect to fix, not a constraint to honour. This
divergence is recorded here so it is never mistaken for an oversight.

### D-13 — No legacy-status fallback for an outreach decision

*Added 2026-07-26.* `resolveCompanyStatus()` returns the policy-derived status only. A company with no
active `entire_company` row is `deny` / `policy_missing_root` — unconditionally, with no fallback to
`wizmatch_company_intelligence.status` or to any other legacy status, and no per-caller exemption.

The rejected design is worth recording because it was subtle and nearly shipped: the compatibility
shim existed to consolidate five disagreeing eligibility computations, and it did so by falling back to
the legacy status when no policy row existed. A company with no root row and a legacy
`status='approved'` would then have returned ALLOW through all five migrated callers,
`policy_missing_root` would never have fired, and the single most load-bearing safety property in the
design would have been defeated by its own migration aid. Legacy status survives as **display-only
historical context**, labelled as such.

Because a missing root row is now a hard deny, a root row is written **in the same transaction as every
company insert** — not only by the one-off backfill. Otherwise "zero companies missing an effective
policy" is true for one instant and false forever after.

### D-14 — Composite FKs everywhere an entity is referenced

*Added 2026-07-26.* The reasoning already applied to `account_owner_user_id` — that a plain
`REFERENCES users(id)` permits a cross-tenant reference — applies to **every** cross-table entity
reference, and is now applied to all 22 of them (PRD-005 §10.10). Six additive, non-partial
`(tenant_id, id)` unique indexes support them.

The earlier draft derived the principle from first principles for one column and then applied it
nowhere else, leaving naked single-column FKs on `company_id`, `actor_user_id`, `contact_id`,
`batch_id`, `enrolment_id`, `approved_by`, `created_by`, `resolved_by` and `contact_channel_id`, and
leaving `scope_ref_id` with no FK at all. Since the repo has zero composite FKs today, PR 2 pays the
cost of introducing the pattern either way; applying it to one column bought almost none of the
benefit.

Three of the six supporting indexes are on **core CRM tables shared with the Growth tenant** — `users`,
`contacts`, `contact_channels`. None can fail or reject a write, because `id` is already the primary
key. But they are a guarded-path change and need explicit owner sign-off at G1, not a WizMatch-local
assumption. Every reference into `users` is `ON DELETE SET NULL` with a nullable column, so a WizMatch
foreign key can never block teammate offboarding.

### D-15 — Suppression keeps three grains in three homes, and one effective row per email

*Added 2026-07-26.* D-7 says what a restriction *blocks*. This says where it is *stored*:

| Grain | Effective state | History |
|---|---|---|
| exact email / channel | one `wizmatch_suppression_list` row; the existing `UNIQUE (tenant_id, email)` is **retained** | `wizmatch_suppression_events` |
| contact (person) | `contacts.do_not_contact = true` plus an audit row | `wizmatch_suppression_events` |
| company | a non-overridable `compliance` policy row in this table | `wizmatch_company_policy_events` |

A second suppression event for the same address is an **idempotent upsert onto the same row**, never a
second effective row. History is append-only events.

The rejected design added `suppression_scope IN ('email','contact')` so one table could hold two
grains. It collided head-on with the existing unique index: `john@acme.com` hard-bounces, writing an
`email`-scope row; the same address later unsubscribes, and the write either throws — losing the
unsubscribe — or upserts over the bounce, losing the channel-invalid fact. Either way one grain is
destroyed, which is the exact conflation D-7 exists to prevent. Removing the column also keeps `0037`
additive: no index is dropped and no production dedup dry-run is needed.

### D-16 — A reply does not release the company cold-email lock

*Added 2026-07-26.* Eight **live** states hold the lock: `queued`, `exported`, `sent`, `replied`,
`awaiting_action`, `positive_reply`, `referral_received`, `conversation_open`. Seven **terminal** states
release it: `completed`, `closed`, `disqualified`, `company_blocked`, `unsubscribed`, `contact_invalid`,
`manually_released`.

Release is only ever an explicit terminal transition. `manually_released` requires an actor, a reason
and an audit event. **A CSV import may move an enrolment between live states but may never write a
lock-releasing terminal state** — releasing a company for a second cold-email campaign is a human
decision, not a provider row.

This is a product judgement, and the alternative was defensible: one could argue a reply is exactly the
moment a new campaign becomes appropriate. It is rejected because the failure mode is asymmetric —
enrolling a company in a second cold sequence while a real human is mid-conversation damages the
relationship the first campaign just created, whereas holding the lock only delays a campaign until
someone closes the conversation.

Two earlier state names are replaced, at zero cost since no row exists: `bounced` → `contact_invalid`,
and `withdrawn` → `closed` or `company_blocked` depending on cause. Both old names hid *why* the
enrolment ended.

### D-17 — Non-overridability binds at any scope; evidence is required and CHECK-enforced

*Added 2026-07-26.* Two constraints in the earlier draft made approved behaviour inexpressible.

**(a)** `CHECK (is_non_overridable = false OR (scope_type = 'entire_company' AND …))` forced every
narrower row to be overridable. But §9.2 scopes `contractual_restriction` to *company, region, BU*, and
D-5 says compliance blocks are overridable by nobody. A contractual restriction covering one business
unit was therefore written as an ordinary overridable restriction that an admin could override. The
`entire_company` conjunct is dropped, a new gate level L1c denies at narrower scopes, and
`CHECK (block_class = 'standard' OR is_non_overridable = true)` makes D-5's "override: none" enforced
rather than merely stated.

**(b)** Nothing required evidence in the database. It does now:

```sql
CHECK ((is_permanent = false AND is_non_overridable = false)
       OR (evidence_kind IS NOT NULL
           AND (evidence_text IS NOT NULL OR evidence_url IS NOT NULL OR evidence_ref IS NOT NULL)))
```

Evidence has six named classes: human text, source URL, email/reply reference, provider event
reference, legal or contractual document reference, and auditable automated evidence. The last covers
any deterministic, re-runnable detection whose inputs and output artefact are persisted — a bounce
event, an HMAC unsubscribe token, a cost-guard audit row, a confidence-grader output. It is evidence,
not an exemption. Taxonomy rows that were permanent or non-overridable with no evidence are corrected,
and PRD-005 §9.11 gains an invariant covering the non-overridable half, which no invariant previously
did.

### D-18 — `admin_override` is deleted; an override is a superseding row

*Added 2026-07-26.* The column was a mutable boolean on a row D-10 declares immutable, so it had no
reachable write path. No gate consulted it, and no CHECK tied it to `block_class='standard'` — so
`admin_override = true` on a company-removal row would have been accepted by the database, with only
untested application code between it and outreach to a company that asked to be removed.

An override is what every other state change is: a new superseding policy row, with
`reason_code='manual_admin_override'`, an actor and evidence. The service refuses to write one over a
predecessor with `is_non_overridable = true`. Dropping the column before it acquires data costs
nothing.

## Tenant and integrity rules

- Every new table carries `tenant_id uuid NOT NULL REFERENCES tenants(id)`; indexes lead with
  `tenant_id`. This matches all 32 existing `wizmatch_*` tables, which are 100% consistent on this rule.
- Enforcement is application-level; there is no RLS in this database. Every route filters on
  `req.user.tenantId`.
- **Every cross-table entity reference is a composite FK** `(tenant_id, ref_id) → parent (tenant_id, id)`
  (D-14). A plain `REFERENCES users(id)` would permit a cross-tenant owner; the same is true of every
  other naked single-column reference. Full matrix in PRD-005 §10.10, supporting indexes in §10.10.1.
- Composite FKs guarantee **same-tenant**, not same-company. Enrolment company↔contact agreement, and
  policy company↔signal/requirement agreement, are service-layer invariants with their own tests,
  because `wizmatch_job_signals.company_id` and `wizmatch_requirements.company_id` are both nullable.
- Every policy mutation and every ownership change writes an audit row.
- `wizmatch_reply_mailboxes` stores non-secret `provider_config` and an opaque, scheme-prefixed
  `secret_ref` — **never a credential value**. A write-time validator rejects `provider_config` keys
  matching `/pass|secret|token|key|credential/i`.

## Backfill proposal

One `scope='entire_company'` row per existing company: `needs_review` / `unknown` / `new_prospect`,
`source='deterministic_rule'`, `reason_code='policy_unknown_cold_start'`.

Production holds roughly 131 WizMatch companies — small enough for one transactional backfill after a
count-first dry run. The script emits a count and sample report and **exits without writing** unless
`--apply` is passed. It ships in its own PR, separate from the schema, and requires its own approval.

## API and compatibility proposal

`resolveCompanyStatus(companyId)` returns the policy-derived status **only**. A company with no active
`entire_company` policy row resolves to `decision = 'deny'`, `reasonCode = 'policy_missing_root'`.

**There is no fallback to `wizmatch_company_intelligence.status`, or to any other legacy status, for an
outreach decision** (D-13). An earlier draft of this section specified such a fallback; it would have
made the entire fail-closed design fail open through the very five callers it was meant to consolidate,
because a company with no policy row and a legacy `status='approved'` would have been queueable. That
fallback is deleted, not softened.

Legacy intelligence status remains readable as **historical context for display only** — a company
card, a timeline entry, a migration report — and must be labelled legacy. It grants no preparation,
enrolment, export, sending or follow-up permission.

The five existing eligibility computations migrate onto the corrected adapter in a dedicated PR. Legacy
writers stay live; no legacy table or column is dropped in this release.

## Rollout and rollback

Additive nullable schema first → new reads/writes second → backfill third → stricter constraints only
after clean production evidence, per ADR-004.

Enforcement ships in `shadow`, which logs what it *would* block while blocking nothing. Promotion to
`enforce` is gated on a readiness report plus five hard preconditions (PRD-005 §21.2), and is an
explicit owner decision.

Rollback is an application-code revert. `0037` is additive and its tables are left in place — ADR-004
forbids destructive down-migrations during incident response.

## Required tests

Every gate level including permanent-block-beats-specific-eligible; fail-closed on DB error, missing
row and unresolvable scope; per-dimension inheritance including the location-pause case; scope-key
normalisation and CHECK rejection; two business units coexisting; the immutability trigger; block-class
separation; the full 8×8 routing matrix; campaign-type correctness with no fake staffing types; the
family-agnostic cold-email lock and the family-invariance proof; cold-start confidence gating at both
queue and export; the bounce/unsubscribe split; the A-1 regression; duplicate detection true and false
cases; cross-tenant owner rejection; secret-like key rejection in `provider_config`.

## Approval questions

1. **Ratify the reason-code taxonomy** (PRD-005 §9) before any row exists. Values are stable
   identifiers; renaming after data is written breaks the learning signal. **Approved 2026-07-26**,
   including the final taxonomy ratification changes: `policy_accepts_external_vendors` now requires
   evidence; `contact_role_mismatch` is replaced by `contact_role_uncertain` and
   `contact_role_confirmed_mismatch` (PRD-005 §9.4).
2. Confirm the mailer fallback reversal (D-11) supersedes the 2026-07-09 audit decision. **Approved.**
   See `docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md` §1 verdict row 7 and §4
   "All-domains-unhealthy Slack alert" — the same item under two numbering schemes,
   annotated superseded 2026-07-26.
3. Confirm PRD-005 may invert PRD-004's source precedence (D-12). **Approved.**
4. The six spec-repair decisions D-13 … D-18. **Approved 2026-07-26**, recorded as PRD-005 §25.1
   A-22 … A-30.
5. Sign-off on the additive `(tenant_id, id)` unique indexes on the shared core tables `users`,
   `contacts` and `contact_channels` (D-14). **Open — blocks G1, not PR 2.** PR 2 writes the schema
   and measures the index-build lock on a production-sized restore; applying it is G1.

## Consequences

**Positive.** One authoritative, evidence-backed answer to "may we contact this company". Scoped rules
without losing broader context. Complete audit history. Fail-closed by construction. Restrictions bind
at their own grain, so a closed role never costs a company and a bounce never costs a person.
Structured reason codes become a future learning label set at no extra cost.

**Negative.** A seventh table group in an already-large schema. Two-phase resolution is more complex
than a single lookup and must be well tested. Inheritance means a decision's provenance is a chain, not
a row — the UI must show which scope supplied each dimension or operators will find blocks confusing.
Until the consolidation PR lands, the legacy eligibility computations still exist alongside the new
resolver.

**Neutral.** Shadow mode defers all behavioural risk to an explicit later decision.

## Alternatives considered

### Extend `wizmatch_company_intelligence` with policy columns

Rejected. The table is 1:1 with company, so the scope dimension would have to be dropped entirely. An
India-only block on a company that also hires in the US becomes inexpressible, as does a policy pinned
to one signal. The scope requirement is not negotiable, and retrofitting it onto a 1:1 table means
either abandoning it or de-normalising into JSON, which the database cannot constrain.

### Reuse `wizmatch_staffing_events` for policy history

Rejected. It already carries a `company_id` FK and an `event_type`/`payload` shape, so it was the
closest structural fit. But policy history needs typed from/to state and must survive independently of
the staffing timeline. Folding it in would add a seventh meaning to an audit surface already fragmented
across six mechanisms.

### A separate domain-suppression table for company-wide removal

Rejected. Suppression already fragments across four grains that no query reconciles. A company-wide
removal request is expressible as an `entire_company` policy row with `block_class='compliance'` and
`is_non_overridable`, which keeps it inside the one authoritative model rather than creating a fifth
disagreeing source.

### Fuzzy duplicate detection (trigram / Levenshtein)

Rejected for v1. It would catch legal-suffix variants (`Acme Inc` / `Acme Incorporated`), but a pending
duplicate hard-blocks **both** companies from outreach, and near-identical distinct entities
(`Infosys BPM` / `Infosys BPO`) score high. Exact-after-normalisation catches the known defect —
`(tenant_id, name)` is exact-case while `seedProspectCompany` matches `LOWER(name)` — without a
`pg_trgm` dependency or a false-positive review burden that scales with company count.

### Enforce immediately rather than shadow-first

Rejected. The pilot is live for two named users. Turning a fail-closed resolver on without first
measuring what it would block risks silently stopping real work, and the failure mode is invisible
precisely because it fails closed.
