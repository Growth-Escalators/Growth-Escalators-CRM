# PRD 005: WizMatch Outbound Operating System

- **Status:** Approved — reason-code taxonomy (§9) ratified 2026-07-26 (owner: Jatin). PR 2 may proceed.
- **Owner:** Growth Escalators / Wizmatch
- **Date:** 2026-07-26
- **Last source review:** 2026-07-26
- **Canonical path:** `docs/prd/005-wizmatch-outbound-operating-system.md` — do not duplicate
- **Extends:** [`004-wizmatch-staffing-operating-system.md`](004-wizmatch-staffing-operating-system.md) — does **not** supersede it
- **Architecture decisions:** [`ADR-006`](../decisions/ADR-006-company-outreach-policy.md) · [`ADR-007`](../decisions/ADR-007-outreach-provider-boundary.md)
- **Scope:** The pre-requirement outbound funnel — company policy, decision workbench, free preparation, provider-neutral outreach adapter
- **Out of scope:** Growth `prospects/*` and the n8n-era `outreach_leads` pipeline (different product/tenant)

This document does **not** itself approve a database migration, production data change, deployment,
paid-provider call, cold-email send, or candidate submission. Those actions remain subject to the
guardrails in `AGENTS.md` and the approval gates in §21.

**Automatic sending remains disabled.** `WIZMATCH_SENDING_ENABLED` and `AUTOMATED_EMAILS_ENABLED` are
not modified by any milestone in this PRD. Enabling sending remains a separate go-live decision under
`.claude/skills/wizmatch-go-live-sending`. A PRD titled "outbound operating system" is at high risk of
implicitly reframing manual-gated outreach as an automated one; §2.2 restates the boundary explicitly
so scope creep by naming cannot occur.

---

## 0. How to use this document

### 0.1 Source precedence

PRD-005 declares its own precedence, which **deliberately differs** from PRD-004 §0:

1. `AGENTS.md` and security / compliance guardrails
2. Approved owner decisions (§25.1)
3. Approved ADRs (ADR-006, ADR-007)
4. Approved PRD target behaviour (this document)
5. **Current code — evidence of what exists, not authority over what is correct**
6. Older PRDs and historical documentation

**Why this inverts PRD-004.** PRD-004 §0 ranks current code above the PRD, which is correct when the
code is trusted. The 2026-07-26 audit found four live defects that the approved target behaviour
explicitly corrects (§5.3: fail-open suppression, dead follow-up loop, discarded hard bounces,
unhealthy-mailer fallback). Code that contradicts approved target behaviour is a defect to fix, not a
constraint to honour. This divergence is recorded in ADR-006 so it is never mistaken for an oversight.

### 0.2 Label convention

**AS-IS** = verified current behaviour, with `file:line`. **TARGET** = approved behaviour this PRD
introduces. **FUTURE** = explicitly deferred (§24). Any statement without a label is TARGET.

### 0.3 Required startup reading for an implementation agent

`AGENTS.md` → `CLAUDE.md` → `.ai/CURRENT_TASK.md` → `.ai/CURRENT_STATE.md` → this PRD → ADR-006 →
ADR-007 → `docs/prd/004-wizmatch-staffing-operating-system.md` §3 (vocabulary) and §8 (state machines).

---

## 1. Executive summary

WizMatch is capability-first. Thirty admin pages expose every technical step — source, score,
discover, qualify, match, submit — and the operator must drive each one by hand. The machinery largely
works. What is missing is a decision layer.

Two structural gaps follow from that:

1. **There is no concept of whether a company may be contacted at all.** Eligibility is re-derived ad
   hoc in five places that do not agree with each other, and none of them persists a decision with
   evidence (§5.2, C-2).
2. **The operator has no single place to make a business decision.** The Today page shows *when* work
   is due, not *what to decide*.

This PRD makes WizMatch decision-first. The day-to-day user opens one Today page and sees four
queues — Ready to Contact, Needs Review, Replies Needing Action, Paused or Blocked — with six
contextual actions. Everything the system can do for free it does before showing the company: company
normalisation, duplicate detection, **company-policy check**, signal scoring, internal CRM contact
reuse, official website/public-email discovery, contact ranking, email-confidence grading, campaign
recommendation, and draft personalisation.

Underneath sits a **company outreach policy** model that is authoritative over signal score and
contact approval, supports scoped rules with inheritance, carries structured evidence and complete
audit history, and fails closed.

The system starts in **Cold Start Mode**: every company begins `external_hiring_policy = unknown`,
`outreach_eligibility = needs_review`. Unknown means *not yet decided* — never automatically eligible,
never automatically blocked. Only deterministic unsafe records are auto-rejected. Humans approve;
the system learns from structured decisions; movement to Assisted Mode is a later, separate decision.

---

## 2. Business outcomes and non-goals

### 2.1 Outcomes

| # | Outcome | Measured by |
|---|---|---|
| O-1 | An operator can run a day from one page | Today page session covers ≥90% of decisions without navigating elsewhere |
| O-2 | No company is contacted that should not be | Zero outreach to a company with a `blocked` or `no_external_agencies` effective policy |
| O-3 | Every block is explainable and reversible | 100% of DENY decisions carry a structured reason code; every non-compliance block has an override path |
| O-4 | Preparation costs nothing | `prepareCompaniesJob` spends ₹0; asserted by test |
| O-5 | Provider independence | Swapping the outreach provider changes no lifecycle state, no table, and no caller |
| O-6 | Decisions become training data | Every human decision writes a structured reason code suitable as a future learning label (§9) |

### 2.2 Non-goals for the first release

- **Fully automatic sending.** No milestone enables it. Both kill-switches stay off and untouched.
- Automatic production scoring-weight changes.
- Machine-learning models. §9 prepares labels; nothing consumes them.
- Paid enrichment automation. Paid discovery stays preview-first and manually approved.
- Smartlead paid API integration. CSV only, no keys, no recurring cost.
- Automatic permanent company blocks inferred from free text. Deterministic rules only.
- Removal of any legacy outreach table.
- Major unrelated CRM refactoring.
- Consolidation of the Growth `prospects/*` or n8n `outreach_leads` pipelines.
- **Privacy/GDPR erasure.** Suppressing outreach is not erasure. See §18.4 and §24.

---

## 3. Vocabulary delta

PRD-004 §3 remains binding for `hiring signal`, `company`, `hiring contact`, `contact candidate`,
`CRM contact`, `requirement`, `candidate match`, `shortlist`, `consent/RTR`, `submission`,
`placement`. Unknown states are already named `needs_review` (company/contact) and `needs_attribution`
(requirement source) — reused verbatim, **not** renamed to "unknown".

New nouns introduced by this PRD, and nothing else:

| Term | Definition |
|---|---|
| **Outreach policy** | A persisted, evidence-backed decision about whether and how a company may be contacted. Authoritative over score and contact approval. |
| **Policy scope** | The slice of a company a policy applies to: whole company, a region, a business unit, a location, one signal, or one requirement. |
| **Effective policy** | The composite produced by resolving each policy dimension independently up the scope ladder (§8.1). |
| **Outreach enrolment** | A WizMatch-owned record that a contact or company has entered a specific outreach batch. **Distinct from `sequence_enrolments`**, the shared CRM concept, which this PRD does not use or revive (§5.3, A-2). |
| **Outreach batch** | A set of enrolments exported to (and imported back from) one outreach provider campaign. |
| **Outreach mode** | `cold_email` · `account_managed` · `research_only`. Governs the company-level overlap lock and whether cold email is possible at all. |
| **Preparation run** | One idempotent, zero-cost pass of the free preparation pipeline over a company. |

**Naming note.** PRD-004 uses "outbound" only twice, generically. The dominant existing terms are
"demand funnel" / "client-acquisition funnel" (`docs/wizmatch/DATAFLOW.md`) and "employer acquisition"
(PRD-004 §13.1). This PRD scopes "the outbound operating system" as **the same demand funnel**, from
company discovery through to a confirmed requirement — not a fifth undefined term.

---

## 4. Personas, ownership and permissions

No new roles. Existing `src/middleware/rbac.ts` roles are reused, layered with the pilot role map in
`docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md` §3.

| Action | Minimum role |
|---|---|
| Read policy, read queues | pilot member (`staff`+) |
| Write a policy row (approve / pause / block / reclassify) | `team_lead` |
| Approve a `review`-decision batch (`approved_by`) | `team_lead` |
| Admin override of a `standard` block | `admin` |
| Override a `compliance` or `legal` block | **nobody** — `is_non_overridable` (§8.3) |
| Bulk policy write, bulk queue action | `admin` (OWNER_INPUTS §7: exports and bulk actions are admin-only) |
| Assign account owner | `team_lead` |
| Merge / confirm-separate a duplicate pair | `team_lead` |
| Create/export an outreach batch | `team_lead` |
| Import a result CSV | `team_lead` |
| Promote `shadow` → `enforce` | owner decision, not a role (§21, G4) |

Initial pilot exposure remains **Jatin and Kanishk only**, via the existing
`WIZMATCH_STAFFING_PILOT_USER_IDS` roster, which fails closed when absent.

---

## 5. AS-IS baseline

Audited 2026-07-26 against `origin/main`. Every claim carries `file:line`.

### 5.1 Useful foundations to preserve

| Capability | Location | Verdict |
|---|---|---|
| Signal ingest + dedupe (provider_id / URL / identity fingerprint), advisory-locked | `src/services/wizmatchSourcing.ts:140-205` | Idempotent. Reuse as-is. |
| Deterministic signal scoring, region-aware, pure function | `src/services/wizmatchScoring.ts:98-169` | Re-runnable. Reuse as-is. |
| Free contact discovery cascade (internal CRM → website scrape → SearchAPI) | `wizmatchSourcing.ts:370-520` | Live in production, capped. **Extend, do not rebuild.** |
| Free provider toolkit (scrape, MX/catch-all, Reacher verify, generic guess) | `src/services/wizmatchContactDiscoveryProviders.ts` | ₹0 by default. Reuse. |
| Email confidence grading (high/medium/low) | `wizmatchContactDiscoveryProviders.ts:73-102`; `wizmatchContactIntelligenceRepo.ts:107-113` | Exists. Reuse — no new grading logic. |
| Contact ranking (0–100) | `src/services/wizmatchContactIntelligence.ts:431-488` | Exists. Reuse. |
| Cost guard — budget/rate/provider caps, typed 402/429/503, audit rows, advisory-lock serialised | `src/services/wizmatchCostGuard.ts:256-358` | Reuse for any paid step. |
| Contact write invariant | `findOrCreateContact`, `src/services/contactService.ts:52-128` | Load-bearing. All contact writes go through it. |
| Provider-adapter precedent | `src/modules/esign/providers/esign-provider.interface.ts`; `providers/index.ts:10-26` | Vendor-neutral interface + real + mock + env-keyed lazy singleton with test hooks. **Copy exactly** (ADR-007). |
| CSV import primitives (RFC4180 parser, header aliases, email validation) — all `export`ed | `src/routes/outbound.ts:80-213` | Import and reuse; do not duplicate. |
| Shared admin table kit | `admin/src/components/wizmatch/filters/` + `ui/DataTable.jsx` | URL-shareable, preset-persisting. Use for all new views. |
| Today page — already bucket-based | `admin/src/pages/WizmatchTodayPage.jsx:5-35` | Re-bucket **in place**; do not add a page. |
| Review Workbench action-card contract | `src/services/wizmatchReviewWorkbench.ts:237-273` | Per-action `endpoint`/`method`/`payload`. Follow it. |
| Reply classifier + bounce parser | `outreachEnrichmentService.ts:349-467`; `src/services/wizmatchBounceParser.ts:25-77` | Working. Reuse. |
| HMAC unsubscribe, fail-closed, `timingSafeEqual` | `wizmatchOutreachService.ts:195-205`; `src/routes/wizmatch.ts:3611-3641` | Correct. Do not weaken. |

### 5.2 Duplicated or conflicting data models

| # | Conflict | Evidence |
|---|---|---|
| **C-1** | "Company" modelled 5+ ways: `wizmatch_companies`, `clients`, `billing_clients`, `growth_os_clients`, plus free-text `company` on `prospects` / `outreach_leads` / `discovery_results`. Only link to billing is at placement time. | `schema.ts:1309`, `:149`, `:574`; `wizmatch_placements.billingClientId` `:1460` |
| **C-2** | **Eligibility computed 5 independent ways; none persisted as a decision.** `wizmatch_company_intelligence.status` (persisted) vs in-memory `hardBlocks[]` folded into `source_summary` jsonb, vs four separate `hot\|warm\|watch\|blocked` enums. | `schema.ts:1817`; `wizmatchContactIntelligence.ts:263-424`; `wizmatchClientDiscovery.ts:2`; `wizmatchCandidateIntelligence.ts:2`; `wizmatchCommandCenter.ts:7`; `wizmatchRequirementPriority.ts:7` |
| **C-3** | **Suppression fragmented across 4 grains, never unioned.** `contacts.doNotContact`; `wizmatch_suppression_list` (email); `wizmatch_company_contacts.relationshipStage='do_not_contact'`; `wizmatch_company_intelligence.status='suppressed'`. | `schema.ts:53`, `:1506`, `:1591`, `:1807` |
| **C-4** | **No company-level relationship type.** Only `isPrime` bool + `primeMsaStatus`. `relationshipStage` is *person*-level. | `schema.ts:1325-1326`; `wizmatchStaffingDomain.ts:10` |
| **C-5** | Audit history in 6 mechanisms, incl. `audit_logs` (ensure-hook, nullable tenant, no FK). | `schema.ts:858`; `auditLogger.ts:9`; `schema.ts:1704` |
| **C-6** | Two coexisting WizMatch backend models — "Staffing OS" (`wizmatchStaffing.ts`) vs older "intelligence" (`wizmatch.ts`) — documented as unreconciled debt. | `.ai/CURRENT_STATE.md:85-87` |
| **C-7** | Three parallel outbound systems. WizMatch; Growth `prospects`/`signals`/`replies`/`outbound_events`; n8n-era `outreach_leads` (**no `tenant_id` at all**). | `schema.ts:1344`, `:1206-1298`; `outreachLeadsService.ts:11` |

### 5.3 Defects this PRD fixes or explicitly carries

| ID | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| **A-1** | P0 | **Suppression is fail-open.** `sendSignalDraftEmail()` checks only `wizmatch_suppression_list.email`; never reads `contacts.do_not_contact`, which `PATCH /api/contacts/:id` sets freely with no mirrored write. Verified: zero `doNotContact` references in `wizmatchOutreachService.ts` or `multiDomainMailer.ts`. | `wizmatchOutreachService.ts:183-189`; `src/routes/contacts.ts:405,421` | **Fixed** — PR 3 unions both (§8.2 L7) |
| **A-2** | P0 | **Follow-up loop is dead.** `sequenceWorker` inserts `jobType='sequence_step'` into `jobs`; the only in-process consumers are CRUD and a stuck-job failer. Intended consumer is n8n `03-process-sequence-step.json`, **not deployed since 2026-05-03**. Jobs sit `pending` forever. | `src/workers/sequenceWorker.ts:59-74`; `src/workers/stuckJobWorker.ts:8-43`; `n8n-workflows/README.md:3-12` | **Carried** — WizMatch uses its own enrolment table; this loop is untouched (§25.1 A-7) |
| **A-3** | P1 | **`/classify-reply` has no caller in-repo.** Fully implemented; `imapService` only matches Growth `outreach_leads`. | `src/routes/wizmatch.ts:3690-3762`; `src/services/imapService.ts:240-249` | **Fixed** — PR 10 |
| **A-4** | P1 | **Bounce suppression writes are opt-in.** Detection always runs; the write is gated on `WIZMATCH_BOUNCE_SUPPRESSION_ENABLED` (default off). Hard bounces are detected and discarded. | `wizmatchBounceParser.ts:57-77` | **Fixed** — PR 3 |
| **A-5** | P1 | **Company dedupe is name-based and case-inconsistent.** Unique index `(tenant_id, name)` exact-case; `seedProspectCompany` looks up `LOWER(name)`. `domain` is a non-unique index. | `schema.ts:1337`; `wizmatchSourcing.ts:154-164`; `wizmatchContactIntelligenceRepo.ts:1129-1134` | **Carried + contained** — full identity migration out of scope; suspects block outreach (§8.5) |
| **A-6** | P1 | **Mailer falls back to all inboxes when no domain is healthy.** | `multiDomainMailer.ts:71-75` | **Reversed** — fails closed behind an emergency override (§18.3) |
| **A-7** | P2 | **`ge-add-ensure-table` skill is factually wrong.** Claims "all ~12 Wizmatch tables use this pattern" and cites `wizmatchOutreachTemplates.ts`, **which does not exist**. Ground truth: all 32 `wizmatch_*` tables are migration-tracked; zero ensure-hooks. | `.claude/skills/ge-add-ensure-table/SKILL.md:15-17` | **Fixed** — separate PR |
| **A-8** | P2 | Two dead unrouted pages: `WizmatchReviewQueuePage.jsx`, `WizmatchCommandCenterPage.jsx`. | no importer in `admin/src` | **Deleted** — PR 6 |
| **A-9** | P2 | **No bulk actions anywhere in WizMatch.** `DataTable` implements selection props; zero callers pass them. `BulkActionBar.jsx` is hardcoded to Growth endpoints. | `ui/DataTable.jsx:28-46`; `BulkActionBar.jsx:46-66` | **Built** — PR 6 |

---

## 6. Canonical lifecycle

PRD-004 §1 fixes the **delivery** chain beginning at *confirmed requirement*. This PRD defines the
**acquisition** chain that terminates at that same node. They join; they do not conflict.

```
Company ──(evidence)──> Hiring Signal
   │
   ├─> Contact Candidate ──(human approval)──> CRM Contact
   │                                              │
   │                                              └─> Outreach Enrolment
   │                                                       │
   │                                                       └─> Reply
   │                                                             │
   └────────── Company Outreach Policy ───────────┐              │
       authoritative over score and contact       │              ▼
       approval at EVERY arrow above              │        Requirement ──> [PRD-004 delivery chain]
                                                  │                            │
                                                  └────────────────────────────┴──> Placement / Revenue
```

Invariants carried from PRD-004 and restated: *a signal is not a requirement; a score is not a
shortlist; a shortlist is not a submission.* This PRD adds:

> **A policy is not a score, and a score never overrides a policy.**

`wizmatch_requirements` is still never populated automatically from a signal — the single insert path
`POST /requirements` remains (`docs/wizmatch/DATAFLOW.md:16-19`). Nothing in this PRD changes that.

---

## 7. Cold-start journey

**TARGET.** Every company — existing and newly discovered — enters:

```
external_hiring_policy = unknown
outreach_eligibility   = needs_review
relationship_type      = new_prospect
```

`unknown` means **not yet decided**. It is neither automatically eligible nor automatically blocked.

Cold Start Mode behaviour:

1. Collect and score signals — existing machinery, unchanged.
2. Prepare companies for free (§14). Preparation runs for `needs_review`; it is stopped only by
   `no_external_agencies` and `irrelevant`.
3. **Automatically reject only deterministic unsafe records**: missing or unresolvable domain,
   company domain already on the suppression list company-wide, self/competitor domain allowlist
   match. Everything else is `needs_review`. No block is ever inferred from free text.
4. Require explicit human approval of company **and** contact before any outreach.
5. Never send automatically.
6. Learn from structured human decisions (§9 reason codes are the label set).
7. Support a later, separate decision to move toward Assisted Mode. That decision is **FUTURE** (§24).

**Cold-start contact confidence gate.** Applied at §8.2 L7 and again at export, so a contact
downgraded after approval cannot slip into a CSV:

| Confidence | Queue | May be queued / exported |
|---|---|---|
| **high** | Ready to Contact | yes |
| **medium** | **Needs Review** | only after explicit human approval |
| **low / unverified** | not surfaced for outreach | **no — hard block** |

Reuses `deriveConfidenceTier` (`wizmatchContactIntelligenceRepo.ts:107-113`). No new grading logic.

---

## 8. Company-policy state machine, restriction rules and enforcement hierarchy

### 8.1 Scoped-policy inheritance

Scope breadth ladder, narrow → broad:

```
signal:<uuid> / requirement:<uuid>  →  location:<x>  →  business_unit:<x>  →  region:<x>  →  entire_company
```

`entire_company` is the **inheritance root** and must define all three dimensions. Every narrower row
may leave any dimension NULL, meaning *inherit from the next broader applicable scope*, and must
override at least one dimension (no no-op rows). Both rules are CHECK-enforced (§10.1).

**Each dimension resolves independently.** For `outreach_eligibility`, `external_hiring_policy` and
`relationship_type` separately: walk the ladder over scopes applicable to the request context and take
the **first non-null** value, recording which `scope_key` supplied it. Termination is guaranteed by the
root.

> A `location:bengaluru` row that sets only `outreach_eligibility='paused'` pauses Bengaluru while the
> company-wide `relationship_type='existing_client'` and `external_hiring_policy` remain in force. A
> narrow row never resets a dimension it did not mention.

A company with **no** `entire_company` row resolves to **DENY** (fail closed) and is counted by the
readiness report's *companies missing an effective policy* metric, which must be zero before enforce.

### 8.2 Enforcement hierarchy

Resolution is two phases. **Phase 0** builds the effective policy by §8.1 inheritance. **Phase 1**
applies the gates below to that composite, in strict order, first terminal DENY wins.

A non-overridable entire-company block, company/domain suppression, or `no_external_agencies`
**always** overrides a more-specific `eligible` value. "Most specific wins" is a Phase-0 inheritance
rule only — it never lets a narrow row defeat a hard block in Phase 1.

| L | Gate | Terminal | Notes |
|---|---|---|---|
| **L1** | Non-overridable entire-company block — `scope_key='entire_company'` AND `blocked` AND `is_non_overridable` | **DENY** | Not overridable by any narrower `eligible` row. `block_class` classifies it (§8.3) |
| **L1b** | Relationship hard exclusion — `competitor`, `irrelevant` | **DENY** | `irrelevant` additionally **stops free preparation** |
| **L2** | Company / domain suppression — overridable `entire_company` block, or a suppression row covering the company domain | **DENY** | |
| **L3** | Region / business-unit / location restriction | DENY when the inherited eligibility is `blocked`/`paused` **and** was supplied by a region/BU/location scope | Provenance comes from Phase 0, not a second specificity contest |
| **L4** | Signal / requirement restriction | DENY **for that signal or requirement only** | Company and contact remain active |
| **L5** | Pause · needs-review · duplicate-suspected | `paused`→DENY (resume path); `needs_review`→REVIEW; pending duplicate→DENY for queue and export, **preparation still allowed** | |
| **L6** | Campaign compatibility | DENY if requested **type** ∉ `allowedCampaignTypes`, **or** requested **mode** ∉ `allowedOutreachModes` | `campaign_family` is **never** consulted (§8.6) |
| **L6b** | Company cold-email lock | DENY when mode = `cold_email` and an active cold-email enrolment exists for the company | Mirrors the DB constraint so the UI names the holder rather than surfacing a constraint violation |
| **L7** | Contact / email restriction | DENY **for that contact only** | UNION of `wizmatch_suppression_list` **and** `contacts.do_not_contact` (fixes A-1); channel-invalid; cold-start confidence gate §7 |
| **L8** | Score and contact approval | never blocks | Advisory; ordering only |

**Fail closed.** Any DB error, missing policy row, unresolvable scope or ambiguous match evaluates to
**DENY**, never ALLOW. `unknown` is not a DENY on its own — it yields REVIEW, which permits free
preparation and gates every outbound action.

### 8.3 Block classes

`block_class` ∈ `standard` · `compliance` · `legal`, paired with `is_non_overridable`.

| Class | Meaning | Override |
|---|---|---|
| `standard` | An ordinary business block (competitor, quality, operator judgement) | `admin` |
| `compliance` | A binding request or obligation — e.g. a company-wide removal request | **none** |
| `legal` | An actual legal or regulatory restriction — `legal_notice`, `regulator_request` | **none** |

**A company removal request is a `compliance` block, not a legal hold.** `legal` is reserved for
genuine legal/regulatory restrictions. **L1 keys on `is_non_overridable`, not on `block_class`** —
the class classifies and explains; the boolean enforces.

**A privacy/GDPR erasure request is explicitly NOT modelled as an outreach policy.** Suppressing
outreach does not erase data. See §18.4 and §24.

### 8.4 Separation of restriction grains

A restriction only ever blocks at its own grain.

| Event | Blocks | Does NOT block |
|---|---|---|
| Role / requirement closed | that signal or requirement | the company, the contact |
| Wrong or stale contact | that contact candidate | the company, other contacts |
| Personal unsubscribe | that email **and** that contact | the company, colleagues |
| Hard bounce | that email/channel only | the contact's other channels, the company |
| Company-wide removal request | the company (permanent, compliance) | — |
| `no_external_agencies` | the company: no enrich, no export, no enrol, no follow-up | the company **record**, which remains valid |

**Do not delete valid companies merely because they are unsuitable for outreach.** Reclassification is
a policy write, never a row delete.

### 8.5 Bounce, unsubscribe and removal semantics

| Event | Suppression write | `contacts.do_not_contact` | Company policy | Enrolments |
|---|---|---|---|---|
| **Hard bounce** | row for that email, `reason='hard_bounce'`, `contact_channel_id` set, `channel_invalid=true`, `suppression_scope='email'` | **not set** | untouched | that enrolment → `bounced` |
| **Personal unsubscribe** | row for that email, `reason='unsubscribe'`, `suppression_scope='contact'` | **set true** | **untouched** | that enrolment → `unsubscribed` |
| **Company-wide removal request** | — | — | new `entire_company` row: `blocked`, `is_permanent`, `block_class='compliance'`, `is_non_overridable`, `reason_code='company_removal_request'` | **all** active enrolments → `withdrawn`; future follow-ups stopped |

A hard bounce is a channel-quality fact, not a stated preference — it must not silently mark a whole
person do-not-contact. An unsubscribe is a stated personal preference — it must not silently block
their employer.

### 8.6 Campaign routing — restricted is not uniformly denied

`campaign_type` controls **policy compatibility**. `campaign_family` controls **workflow and reporting
only, never permission**. `outreach_mode` controls the **company-level overlap lock** and whether cold
email is possible at all.

| `external_hiring_policy` | decision | `recommendedRoute` | `allowedCampaignTypes` | `allowedOutreachModes` | prep |
|---|---|---|---|---|---|
| `accepts_external_vendors` | **allow** | `standard_outreach` | `fte_permanent`, `contract`, `c2h` | cold_email, account_managed, research_only | yes |
| `fte_vendors_only` | **allow** | `standard_outreach` | `fte_permanent` | cold_email, account_managed, research_only | yes |
| `contract_vendors_only` | **allow** | `standard_outreach` | `contract`, `c2h` | cold_email, account_managed, research_only | yes |
| `preferred_vendors_only` | **review** | `vendor_empanelment` | `vendor_empanelment` only | research_only; cold_email only for an approved `vendor_empanelment` batch | yes |
| `msp_vms_only` | **deny** | `msp_vms_research` | `msp_vms` only | research_only | yes |
| `direct_hiring_only` | **deny** | `monitor_only` | — | research_only | yes |
| `no_external_agencies` | **deny** | `none` | — | **—** (no enrolment of any mode) | **no** |
| `unknown` | **review** | `prepare_then_review` | — | research_only | yes |

`no_external_agencies` is the only hiring policy that stops free preparation.

**MSP/VMS research and account-owner routing never yield `cold_email`.** Promotion to a cold-email
campaign requires an explicit human policy change — a new superseding policy row with evidence — not
an operator picking a different batch mode. The resolver is the sole source of `allowedOutreachModes`
and `allowedCampaignTypes`; the batch API rejects anything absent from those lists and additionally
requires `approved_by`/`approved_at` whenever the decision is `review`.

`vendor_empanelment` and `reengagement` **may** run as `cold_email` once policy permits, and are then
subject to the same company-level cold-email lock as any other family.

### 8.7 Relationship-type behaviour

| `relationship_type` | decision override | `recommendedRoute` | `allowedOutreachModes` | prep | notes |
|---|---|---|---|---|---|
| `new_prospect` | none | from §8.6 | from §8.6 | yes | normal evaluation |
| `existing_prospect` | none | from §8.6 | from §8.6 | yes | normal evaluation |
| `existing_client` | **deny cold outreach** | `account_owner` | account_managed | yes | routes to `wizmatch_companies.account_owner_user_id`; falls back to "unassigned — assign an owner" when null |
| `vendor_partner` | **deny cold outreach** | `partnership_workflow` | account_managed | yes | |
| `prime_partner` | **deny cold outreach** | `account_management` | account_managed | yes | |
| `former_client` | **review** | `reengagement_review` | account_managed, research_only | yes | contributes campaign type `reengagement`; card shows prior placements, last activity, closure reason |
| `competitor` | **deny** (L1b) | `none` | — | yes | blocks standard outreach only |
| `irrelevant` | **deny** (L1b) | `none` | — | **no** | excluded from preparation and outreach entirely |

**Combination rule:** the more restrictive `decision` of §8.6 and §8.7 wins. When §8.7 yields a
non-null route it takes precedence — account routing is more actionable than hiring-policy routing.

### 8.8 Duplicate suspects

Detection is exact-after-normalisation only, no fuzzy scoring, no `pg_trgm`:

```
domain_a = domain_b                                   (both non-null)
OR normalise(name_a) = normalise(name_b)
   normalise(s) = lower(trim(regexp_replace(s, '\s+', ' ', 'g')))
```

While `resolution='pending'`, **both** companies are blocked at L5 — free preparation still runs,
queueing and export are denied. The review card shows both companies side by side with a
policy-divergence warning when their effective policies differ, and offers **Merge** or
**Confirm Separate**. Policies must not silently diverge across probable duplicates.

This deliberately does not catch legal-suffix variants (`Acme Inc` / `Acme Incorporated`): trigram
similarity would, but every false positive hard-blocks two real companies, and near-identical distinct
entities (`Infosys BPM` / `Infosys BPO`) score high. A full company-identity migration remains out of
scope (§5.3 A-5).

### 8.9 Resolver return contract

```ts
interface PolicyDecision {
  decision:             'allow' | 'review' | 'deny';
  recommendedRoute:     RouteCode;
  allowedCampaignTypes: CampaignType[];      // [] when none permitted
  allowedOutreachModes: OutreachMode[];
  reasonCodes:          ReasonCode[];        // §9, ordered by the level that produced them
  effectiveLevel:       1|2|3|4|5|6|7|8;     // which gate was terminal

  effective: {                                // per-dimension provenance
    outreachEligibility:  { value: Eligibility;      scopeKey: string; policyId: string };
    externalHiringPolicy: { value: HiringPolicy;     scopeKey: string; policyId: string };
    relationshipType:     { value: RelationshipType; scopeKey: string; policyId: string };
  };
  blockClass:               'standard' | 'compliance' | 'legal' | null;
  isNonOverridable:         boolean;
  preparationAllowed:       boolean;         // false only for no_external_agencies and irrelevant
  requiresExplicitApproval: boolean;         // true when decision === 'review'
  accountOwnerUserId:       string | null;
  evidence: { text?: string; url?: string; source: string; actorUserId?: string };
}
```

---

## 9. Reason-code taxonomy — **ratified 2026-07-26**

**This section is documentation only.** No database enum and no rows are created by PR 1. Values below
are final; PR 2 implements this taxonomy as written. Any further change after PR 2 lands is a new,
additive code — never a rename or reuse of an existing value, because renaming after data exists
breaks the learning signal.

Column meanings — **Scope**: what the code can attach to. **Decision**: what it produces.
**Prep**: whether free preparation may still run. **Evid**: evidence required. **Perm**: may be marked
permanent. **Ovr**: admin override permitted. **Learn**: suitable as a future learning label.

### 9.1 `company_policy`

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `policy_accepts_external_vendors` | Accepts external vendors | company, region, BU, location | allow | ✅ | ✅ | ⬜ | n/a | ✅ |
| `policy_fte_vendors_only` | FTE vendors only | company, region, BU, location | allow | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `policy_contract_vendors_only` | Contract vendors only | company, region, BU, location | allow | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `policy_preferred_vendors_only` | Preferred vendor list only | company, region, BU, location | review | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `policy_msp_vms_only` | Hires via MSP/VMS only | company, region, BU, location | deny | ✅ | ✅ | ✅ | ✅ | ✅ |
| `policy_direct_hiring_only` | Direct hiring only | company, region, BU, location | deny | ✅ | ✅ | ✅ | ✅ | ✅ |
| `policy_no_external_agencies` | No external agencies | company, region, BU, location | deny | **⬜** | ✅ | ✅ | ✅ | ✅ |
| `policy_unknown_cold_start` | Not yet assessed | company | review | ✅ | ⬜ | ⬜ | n/a | ✅ |
| `policy_paused_by_owner` | Paused | any scope | deny (temp) | ✅ | ⬜ | ⬜ | ✅ | ⬜ |
| `policy_region_restricted` | Restricted in this region | region | deny | ✅ | ✅ | ✅ | ✅ | ✅ |
| `policy_business_unit_restricted` | Restricted in this business unit | business_unit | deny | ✅ | ✅ | ✅ | ✅ | ✅ |
| `policy_location_restricted` | Restricted at this location | location | deny | ✅ | ✅ | ✅ | ✅ | ✅ |

### 9.2 `compliance`

Every code here is `is_non_overridable = true`. None is a learning label — compliance is an obligation,
not a signal about fit.

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `company_removal_request` | Company asked to be removed | entire_company | deny | **⬜** | ✅ | ✅ | **⬜** | ⬜ |
| `legal_notice` | Legal notice received | entire_company | deny | ⬜ | ✅ | ✅ | ⬜ | ⬜ |
| `regulator_request` | Regulator request | entire_company | deny | ⬜ | ✅ | ✅ | ⬜ | ⬜ |
| `privacy_request_pending` | Privacy request in progress | entire_company | deny | ⬜ | ✅ | ⬜ | ⬜ | ⬜ |
| `contractual_restriction` | Contractual restriction | company, region, BU | deny | ✅ | ✅ | ✅ | ⬜ | ⬜ |

> `privacy_request_pending` suppresses outreach **and routes to the separate privacy workflow**. It is
> not, and must never be treated as, evidence that erasure occurred (§18.4).

### 9.3 `relationship`

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `relationship_existing_client` | Existing client | entire_company | deny cold | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `relationship_vendor_partner` | Vendor partner | entire_company | deny cold | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `relationship_prime_partner` | Prime partner | entire_company | deny cold | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `relationship_former_client` | Former client | entire_company | review | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `relationship_competitor` | Competitor | entire_company | deny | ✅ | ✅ | ✅ | ✅ | ✅ |
| `relationship_irrelevant` | Not a relevant target | entire_company | deny | **⬜** | ✅ | ✅ | ✅ | ✅ |

### 9.4 `contact_quality`

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `contact_confidence_low` | Low-confidence contact | contact | deny (contact) | ✅ | ⬜ | ⬜ | ⬜ | ✅ |
| `contact_unverified` | Unverified contact | contact | deny (contact) | ✅ | ⬜ | ⬜ | ⬜ | ✅ |
| `contact_confidence_medium` | Medium confidence — needs review | contact | review | ✅ | ⬜ | ⬜ | n/a | ✅ |
| `contact_role_uncertain` | Contact responsibility is uncertain | contact | review | ✅ | ⬜ | ⬜ | n/a | ✅ |
| `contact_role_confirmed_mismatch`* | Not a relevant hiring decision-maker | contact | deny (contact) | ✅ | ✅ | ✅† | ✅ | ✅ |
| `contact_stale` | Contact data is stale | contact | review | ✅ | ⬜ | ⬜ | ✅ | ✅ |
| `contact_rejected_by_reviewer` | Rejected by reviewer | contact | deny (contact) | ✅ | ⬜ | ⬜ | ✅ | ✅ |
| `contact_left_company` | No longer at the company | contact | deny (contact) | ✅ | ✅ | ✅ | ✅ | ✅ |

> **Ratification note.** `contact_role_mismatch` is replaced by two codes so "we're not sure this is
> the right person" and "we checked, and it isn't" carry different weight as a learning label.
> *`contact_role_uncertain` is the default outcome of automated role inference — unreviewed, no
> evidence, review-only, never permanent.
> †`contact_role_confirmed_mismatch` requires evidence and may be marked permanent **only** for the
> specific employment relationship that was checked (this contact at this company, in this role) —
> it does not imply the person is permanently unsuitable elsewhere, and a later CRM contact record for
> the same person at a different company starts unblocked.

### 9.5 `email_quality`

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `email_hard_bounce` | Hard bounce | email/channel | deny (email) | ✅ | auto | ✅ | ✅ | ✅ |
| `email_soft_bounce_repeated` | Repeated soft bounces | email/channel | review | ✅ | auto | ⬜ | ✅ | ✅ |
| `email_unsubscribed` | Unsubscribed | email + contact | deny (contact) | ✅ | auto | ✅ | **⬜** | aggregate only |
| `email_spam_complaint` | Spam complaint | email + contact | deny (contact) | ✅ | auto | ✅ | **⬜** | aggregate only |
| `email_role_inbox_only` | Only a role inbox found | email | review | ✅ | ⬜ | ⬜ | ✅ | ✅ |
| `email_catch_all_domain` | Catch-all domain — unverifiable | email | review | ✅ | auto | ⬜ | ✅ | ✅ |
| `email_invalid_syntax` | Invalid address | email | deny (email) | ✅ | auto | ✅ | ⬜ | ⬜ |
| `email_domain_unresolvable` | Domain does not resolve | email | deny (email) | ✅ | auto | ⬜ | ✅ | ✅ |

> **"aggregate only"** means the label may inform aggregate content/quality analysis but must **never**
> be used to re-target, re-engage, or score an individual who unsubscribed or complained.

### 9.6 `signal_status`

All are scoped to one signal and never block the company or the contact.

| Code | Label | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|
| `signal_closed` | Role closed | deny (signal) | ✅ | ⬜ | ✅ | ✅ | ✅ |
| `signal_expired` | Posting expired | deny (signal) | ✅ | ⬜ | ✅ | ✅ | ✅ |
| `signal_filled_internally` | Filled internally | deny (signal) | ✅ | ⬜ | ✅ | ✅ | ✅ |
| `signal_duplicate_posting` | Duplicate posting | deny (signal) | ✅ | auto | ✅ | ✅ | ✅ |
| `signal_out_of_region` | Outside target region | deny (signal) | ✅ | auto | ⬜ | ✅ | ✅ |
| `signal_role_irrelevant` | Role not relevant | deny (signal) | ✅ | ⬜ | ⬜ | ✅ | ✅ |

### 9.7 `duplicate`

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `duplicate_suspected_domain` | Possible duplicate — same domain | company | deny queue/export | ✅ | auto | ⬜ | ⬜ | ⬜ |
| `duplicate_suspected_name` | Possible duplicate — same name | company | deny queue/export | ✅ | auto | ⬜ | ⬜ | ⬜ |
| `duplicate_confirmed_separate` | Confirmed distinct companies | company | allow | ✅ | ✅ | ⬜ | ✅ | ⬜ |
| `duplicate_merged` | Merged into another company | company | n/a — informational | ✅ | ✅ | ✅ | ⬜ | ⬜ |

### 9.8 `campaign_compatibility`

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `campaign_type_not_permitted` | Campaign type not permitted by policy | company + campaign | deny (campaign) | ✅ | ⬜ | ⬜ | n/a | ✅ |
| `outreach_mode_not_permitted` | Outreach mode not permitted by policy | company + campaign | deny (campaign) | ✅ | ⬜ | ⬜ | n/a | ✅ |
| `company_cold_email_lock` | Already in an active cold-email campaign | company | deny (campaign) | ✅ | auto | ⬜ | n/a | ⬜ |
| `contact_already_enrolled` | Contact already in an active campaign | contact | deny (contact) | ✅ | auto | ⬜ | n/a | ⬜ |
| `campaign_requires_approval` | Needs explicit approval before queueing | company + campaign | review | ✅ | ⬜ | ⬜ | n/a | ⬜ |

### 9.9 `operational`

Fail-closed and system-health codes. None is a learning label.

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `policy_resolver_error` | Policy could not be evaluated | any | deny | ⬜ | auto | ⬜ | ⬜ | ⬜ |
| `policy_missing_root` | No company-wide policy exists | company | deny | ⬜ | auto | ⬜ | ⬜ | ⬜ |
| `scope_unresolvable` | Policy scope could not be resolved | any | deny | ⬜ | auto | ⬜ | ⬜ | ⬜ |
| `preparation_incomplete` | Preparation has not finished | company | review | ✅ | auto | ⬜ | n/a | ⬜ |
| `cost_guard_block` | Blocked by a cost cap | company | deny | ✅ | auto | ⬜ | ⬜ | ⬜ |

### 9.10 `manual_review`

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `manual_approved_by_operator` | Approved by operator | any scope | allow | ✅ | ⬜ | ⬜ | n/a | ✅ |
| `manual_block_by_operator` | Blocked by operator | any scope | deny | ✅ | ✅ | optional | ✅ | ✅ |
| `manual_pause_by_operator` | Paused by operator | any scope | deny (temp) | ✅ | ⬜ | ⬜ | ✅ | ⬜ |
| `manual_skip_for_now` | Skipped for now | any scope | review | ✅ | ⬜ | ⬜ | n/a | ✅ |
| `manual_reclassified` | Reclassified by operator | any scope | per new policy | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `awaiting_owner_assignment` | Awaiting account-owner assignment | company | review | ✅ | ⬜ | ⬜ | n/a | ⬜ |

### 9.11 Taxonomy invariants

1. Values are **stable and machine-readable**; labels may be reworded freely, values may not.
2. Every `compliance` code is non-overridable and permits no preparation except
   `contractual_restriction`.
3. Only two codes stop preparation outside `compliance`: `policy_no_external_agencies` and
   `relationship_irrelevant`.
4. Every code producing a **permanent** block requires evidence.
5. `email_unsubscribed` and `email_spam_complaint` are never overridable and never used to re-target.
6. Codes marked **Learn ✅** are the label set a future model may consume. Nothing consumes them in
   this release (§2.2).

---

## 10. Database schema proposal — migration `0037`, additive and forward-only

Next free migration is **0037**: the journal has 37 entries (idx 0–36), latest
`0036_seo_content_calendar_link`. All new tables carry `tenant_id uuid NOT NULL REFERENCES tenants(id)`,
UUID PKs, and indexes leading with `tenant_id`, matching all 32 existing `wizmatch_*` tables.

**`src/db/schema.ts` and `src/db/migrations/` are guarded paths.** Owner approval for this migration
is recorded (§25.1 A-5). Generation goes through `npm run db:generate` — never a hand-written SQL file.

### 10.1 `wizmatch_company_policies`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL FK → `tenants` | |
| `company_id` | uuid NOT NULL FK → `wizmatch_companies` | |
| `scope_type` | text NOT NULL | `entire_company`,`region`,`business_unit`,`location`,`signal`,`requirement` |
| `scope_key` | text NOT NULL | canonical, normalised |
| `scope_ref_id` | uuid NULL | signal/requirement only |
| `scope_ref_label` | text NULL | region/BU/location only |
| `outreach_eligibility` | text NULL | `eligible`,`needs_review`,`paused`,`blocked`. NULL on a scoped row = inherit |
| `external_hiring_policy` | text NULL | the 8 spec values. NULL = inherit |
| `relationship_type` | text NULL | the 8 spec values. NULL = inherit |
| `reason_code` | text NULL | §9 |
| `reason` | text NULL | |
| `evidence_text` | text NULL | |
| `evidence_url` | text NULL | SSRF-scrubbed via existing `normalizeDomain()` |
| `source` | text NOT NULL | `human`,`import`,`deterministic_rule`,`provider` |
| `actor_user_id` | uuid NULL FK → `users` | |
| `is_permanent` | boolean NOT NULL default false | blocks scheduled review |
| `block_class` | text NOT NULL default `'standard'` | `standard`,`compliance`,`legal` |
| `is_non_overridable` | boolean NOT NULL default false | what L1 keys on |
| `review_date` | date NULL | |
| `admin_override` | boolean NOT NULL default false | |
| `created_at` | timestamptz NOT NULL default now() | |
| `superseded_at` | timestamptz NULL | supersession metadata only |
| `superseded_by_policy_id` | uuid NULL FK → self | supersession metadata only |

**Canonical `scope_key`.** Built only by `buildScopeKey(scopeType, ref)`; lowercased, trimmed,
internal whitespace → `-`:

```
entire_company
region:india          region:us
business_unit:cloud   location:bengaluru
signal:<uuid>         requirement:<uuid>
```

```sql
UNIQUE (tenant_id, company_id, scope_key) WHERE superseded_at IS NULL
CHECK ((scope_type = 'entire_company') = (scope_key = 'entire_company'))
CHECK ((scope_type IN ('signal','requirement')) = (scope_ref_id IS NOT NULL))
CHECK ((scope_type IN ('region','business_unit','location')) = (scope_ref_label IS NOT NULL))
CHECK (scope_type = 'entire_company' OR scope_key LIKE scope_type || ':%')
CHECK (outreach_eligibility <> 'paused' OR review_date IS NOT NULL)
CHECK (scope_type <> 'region' OR scope_ref_label IN ('india','us'))

-- inheritance root defines all three dimensions
CHECK (scope_type <> 'entire_company' OR (outreach_eligibility   IS NOT NULL
                                      AND external_hiring_policy IS NOT NULL
                                      AND relationship_type      IS NOT NULL))
-- a scoped row must override at least one dimension
CHECK (scope_type =  'entire_company' OR (outreach_eligibility   IS NOT NULL
                                       OR external_hiring_policy IS NOT NULL
                                       OR relationship_type      IS NOT NULL))
-- block metadata only meaningful on a block
CHECK (is_non_overridable = false OR (scope_type = 'entire_company' AND outreach_eligibility = 'blocked'))
CHECK (block_class = 'standard' OR outreach_eligibility = 'blocked')
```

Indexes: `(tenant_id, outreach_eligibility) WHERE superseded_at IS NULL`;
`(tenant_id, company_id) WHERE superseded_at IS NULL`;
`(tenant_id, review_date) WHERE review_date IS NOT NULL AND superseded_at IS NULL`.

`business_unit:cloud` and `business_unit:data` are distinct `scope_key`s, so both stay active; a
second active `business_unit:cloud` is rejected by the database.

**Immutability.** Policy *decision content* is immutable; a change is a new superseding row. The only
columns ever updated are `superseded_at` and `superseded_by_policy_id`, enforced by a service-layer
invariant, a DB trigger, and a test. Rationale and the two-column exception are in ADR-006.

### 10.2 `wizmatch_company_policy_events` — append-only

`id, tenant_id, company_id, policy_id, previous_policy_id, from_state jsonb, to_state jsonb,
reason_code, reason, evidence_text, evidence_url, actor_user_id, source, created_at`.
No UPDATE or DELETE path.

### 10.3 `wizmatch_company_duplicates`

`id, tenant_id, company_a_id, company_b_id, similarity numeric, detection_rule text
CHECK IN ('domain','normalised_name'), resolution text NOT NULL default 'pending'
CHECK IN ('pending','merged','confirmed_separate'), resolved_by uuid NULL, resolved_at, created_at`.
`CHECK (company_a_id < company_b_id)`, `UNIQUE (tenant_id, company_a_id, company_b_id)`.

### 10.4 `wizmatch_reply_mailboxes`

`id, tenant_id, provider text CHECK IN ('imap','ms365','google'), address, domain,
provider_config jsonb NOT NULL default '{}', secret_ref text NOT NULL, active boolean,
last_polled_at, created_at`. `UNIQUE (tenant_id, address)`.

Replaces the six hardcoded Purelymail addresses at `src/services/imapService.ts:30-37`.

- **`provider_config`** — non-secret settings only. IMAP `{host, port, useTls, folder}`;
  MS365 `{aadTenantId, clientId, scopes[], userPrincipalName}`; Google `{clientId, subject, scopes[]}`.
- **`secret_ref`** — an opaque, scheme-prefixed *pointer*, resolved at runtime:
  `env:PURELYMAIL_PASS_JATIN_ADSCALELAB`, `railway:IMAP_PASS_1`, `vault:wizmatch/imap/1`.

**No credential value is ever stored in the database.** A write-time validator rejects
`provider_config` keys matching `/pass|secret|token|key|credential/i` and rejects a `secret_ref`
without a known scheme prefix.

### 10.5 `wizmatch_outreach_batches`

`id, tenant_id, name, provider text default 'smartlead_csv',
campaign_family text NOT NULL CHECK IN ('fte_permanent','contract_c2h','vendor_empanelment','msp_vms','reengagement'),
campaign_type text NOT NULL CHECK IN ('fte_permanent','contract','c2h','vendor_empanelment','msp_vms','reengagement'),
outreach_mode text NOT NULL CHECK IN ('cold_email','account_managed','research_only'),
external_campaign_ref, status CHECK IN ('draft','exported','importing','closed'),
approved_by uuid NULL FK → users, approved_at timestamptz NULL,
exported_at, exported_row_count, omitted_row_count, created_by, created_at`.

Campaign types cover empanelment, MSP/VMS and re-engagement so **no workflow is ever assigned a fake
staffing type**: an MSP research batch is `campaign_type='msp_vms'`, never `'contract'`.

`approved_by`/`approved_at` back the explicit-approval requirement: when the resolver returns
`review`, the batch API refuses create **and** export until a `team_lead`+ sets them.

### 10.6 `wizmatch_outreach_enrolments`

`id, tenant_id, company_id, contact_id uuid NULL, batch_id, campaign_family, campaign_type,
outreach_mode, external_lead_ref, state CHECK IN
('queued','exported','sent','replied','bounced','unsubscribed','completed','withdrawn'),
state_at, policy_snapshot jsonb, created_by, created_at, updated_at`.

`contact_id` is nullable — `research_only` work is company-level and may have no contact yet.

```sql
UNIQUE (tenant_id, batch_id, contact_id)
-- 1. ONE active cold-email enrolment per company, across ALL families
UNIQUE (tenant_id, company_id)
  WHERE outreach_mode = 'cold_email' AND state IN ('queued','exported','sent')
-- 2. ONE active enrolment per contact, any mode
UNIQUE (tenant_id, contact_id)
  WHERE contact_id IS NOT NULL AND state IN ('queued','exported','sent')
-- 3. no duplicate active non-cold work for the same company + family + mode
UNIQUE (tenant_id, company_id, campaign_family, outreach_mode)
  WHERE state IN ('queued','exported','sent')
```

Constraint 1 is the company-level cold-email lock and is deliberately **family-agnostic**. Constraint 3
keeps family in the overlap picture for non-cold modes. Constraints 1 and 3 are non-contradictory —
1 is strictly narrower for `cold_email`. Duplicate outreach by different team members is caught by the
same constraints; the API pre-flights and names the `created_by` holding the conflict.

`policy_snapshot` records the decision at export time, so a later policy change never retroactively
rewrites what was true then.

### 10.7 `wizmatch_outreach_events`

`id, tenant_id, enrolment_id, batch_id, provider, event_type CHECK IN
('sent','bounced','replied','unsubscribed','completed'), event_at, external_event_id,
external_message_id, external_lead_ref, idempotency_key text NOT NULL, key_source text CHECK IN
('provider_event_id','provider_message_id','lead_ref_composite','fallback_hash'), raw jsonb, created_at`.

`UNIQUE (tenant_id, provider, idempotency_key)` — the idempotent re-import guarantee.

Key derivation, first non-null wins: `external_event_id` → `external_message_id` →
`external_lead_ref:event_type:event_at` → `sha256(batch_ref|email|event_type|event_at)`. Which tier is
actually available is determined by the fixture gate (§25.2 U-6), not assumed. `key_source` is stored
per row so import quality is observable.

### 10.8 Additive ALTERs on existing tables

**`wizmatch_suppression_list`** — add `contact_channel_id uuid NULL FK → contact_channels`,
`channel_invalid boolean NOT NULL default false`,
`suppression_scope text NOT NULL default 'email' CHECK IN ('email','contact')`. This marks a channel
invalid inside the WizMatch-owned table rather than adding columns to the shared core CRM
`contact_channels`, which Growth also uses.

**`wizmatch_companies`** — add `account_owner_user_id uuid NULL`. Tenancy is enforced by the database,
not only the service, because a plain `REFERENCES users(id)` would permit a cross-tenant owner:

```sql
CREATE UNIQUE INDEX users_tenant_id_id_uniq ON users (tenant_id, id);   -- additive, enables the composite FK
ALTER TABLE wizmatch_companies
  ADD CONSTRAINT wizmatch_companies_account_owner_fk
  FOREIGN KEY (tenant_id, account_owner_user_id) REFERENCES users (tenant_id, id);
```

Every ownership change writes an `audit_events` row via the existing `auditLogger` **and** a
`wizmatch_staffing_events` row (`event_type='company_owner_changed'`, carrying previous and new owner)
so it appears on the company timeline beside policy history.

**No column changes to `wizmatch_company_intelligence`.** Its `status` keeps its current writer during
transition and gains a derived read via `resolveCompanyStatus()` (§11.3). Nothing legacy is dropped.

---

## 11. Migration and backfill strategy

1. **`0037` applies additively. No backfill in the same PR.** Schema first, code second, data third —
   the ADR-004 rollout order.
2. **Backfill is a separate, approved, dry-run-first PR.** One `scope='entire_company'` row per
   existing `wizmatch_companies` row: `outreach_eligibility='needs_review'`,
   `external_hiring_policy='unknown'`, `relationship_type='new_prospect'`,
   `source='deterministic_rule'`, `reason_code='policy_unknown_cold_start'`. Production holds roughly
   131 WizMatch companies, small enough for one transactional backfill after a count-first dry run.
   The script emits a count and sample report and **exits without writing** unless `--apply` is passed.
3. **Compatibility adapter.** `resolveCompanyStatus(companyId)` returns the policy-derived status and
   falls back to `wizmatch_company_intelligence.status` when no policy row exists. All five existing
   eligibility computations (§5.2 C-2) migrate onto it. Legacy writers stay live and untouched.
4. **Constraints are tightened only after clean production evidence.** Nothing is made stricter
   retroactively.
5. **Forward-only.** ADR-005's `0008`/`0014` exception is explicitly not a precedent; no already-applied
   migration is edited.

---

## 12. API contracts

All routes tenant-scoped from `req.user.tenantId`, RBAC-gated per §4, and audited.

**Policy**
```
GET    /api/wizmatch/companies/:id/policy
       → { effective: {...}, scoped: [...], history: [...] }
POST   /api/wizmatch/companies/:id/policy
       body { scope, scopeRefId?, scopeRefLabel?, outreachEligibility?, externalHiringPolicy?,
              relationshipType?, reasonCode, reason?, evidenceText?, evidenceUrl?,
              isPermanent?, reviewDate?, blockClass? }
       → supersedes the matching row + writes a policy event.                       team_lead+
POST   /api/wizmatch/companies/:id/policy/override                                  admin, evidence required
POST   /api/wizmatch/companies/:id/owner        body { accountOwnerUserId }         team_lead+
GET    /api/wizmatch/companies?eligibility=&hiringPolicy=&relationship=&reviewDue=
POST   /api/wizmatch/companies/bulk/policy      body { companyIds[], ... }          admin
GET    /api/wizmatch/policy/readiness                                               admin, read-only
```

**Duplicates**
```
GET    /api/wizmatch/companies/duplicates?resolution=pending
POST   /api/wizmatch/companies/duplicates/:id/resolve  body { resolution, reasonCode, evidence } team_lead+
```

**Decision workbench**
```
GET    /api/wizmatch/today/queues?limit=
       → { readyToContact[], needsReview[], repliesNeedingAction[], pausedOrBlocked[], counts }
POST   /api/wizmatch/today/actions
       body { action: 'approve_queue'|'skip'|'pause'|'block'|'assign_owner'|'set_review_date',
              targets: [{ type, id }], reasonCode?, evidence?, reviewDate?, ownerUserId? }
       → per-target result[]; partial success reported, never silently swallowed
```

**Preparation**
```
POST   /api/wizmatch/companies/:id/prepare          idempotent, free-only, returns a prep report
GET    /api/wizmatch/companies/:id/prepare/status
```

**Outreach adapter**
```
POST   /api/wizmatch/outreach/batches               body { name, campaignFamily, campaignType, outreachMode, companyIds?|filter }
POST   /api/wizmatch/outreach/batches/:id/approve                                   team_lead+
GET    /api/wizmatch/outreach/batches/:id/export.csv → text/csv, provider-shaped
POST   /api/wizmatch/outreach/batches/:id/import     multipart result CSV
GET    /api/wizmatch/outreach/batches/:id            → batch + enrolment state counts
```

**Export re-evaluates policy per row at export time** and omits any DENY, recording each omission with
its reason code in the batch report. The export is never a stale snapshot of an earlier decision.

---

## 13. UI design and states

**Extend `admin/src/pages/WizmatchTodayPage.jsx` in place.** No new route and no new nav entry — it is
already `id: 'today'`, `group: 'primary'`, `permission: 'always'` in
`admin/src/routes/wizmatchRouteRegistry.ts:86-90`.

Replace `BUCKET_META` and `bucketRequirement`/`bucketTask` (`WizmatchTodayPage.jsx:5-35`) with four
queues fed by `GET /today/queues`:

| Queue | Contents |
|---|---|
| **Ready to Contact** | policy `eligible`, prepared, ≥1 **high**-confidence contact |
| **Needs Review** | policy `needs_review`; medium-confidence contacts; paused past `review_date`; pending duplicates |
| **Replies Needing Action** | `wizmatch_outreach_enrolments.state='replied'`, classified positive |
| **Paused or Blocked** | policy `paused` or `blocked`, grouped by block class |

Six actions, presented contextually:

| Company state | Primary | Secondary | More menu |
|---|---|---|---|
| `eligible`, prepared, high-confidence | **Approve & Queue** | Skip for Now | Pause · Block/Reclassify · Assign Owner · Set Review Date |
| `needs_review` | **Approve & Queue** | Skip for Now | Pause · Block/Reclassify · Assign Owner · Set Review Date |
| `paused` | **Resume** | Set Review Date | Block/Reclassify · Assign Owner |
| `blocked` | **Reclassify** (admin) | Assign Owner | Set Review Date |
| duplicate suspected | **Merge** | Confirm Separate | Assign Owner · Set Review Date |
| routed (`msp_vms_only`, `preferred_vendors_only`, `existing_client`, …) | **Open Route** | Skip for Now | Pause · Block/Reclassify · Assign Owner · Set Review Date |

Approve & Queue is **disabled with an inline reason** — never silently hidden — when
`allowedCampaignTypes` is empty or contact confidence is below the cold-start threshold.

Blocking and reclassifying require a structured reason code; evidence is required for `block` and for
any admin override. Compliance and legal blocks show no override affordance at all.

Cards are evidence-based: signal excerpt, score with breakdown, contact with confidence badge, policy
badge with reason and the scope that supplied it, recommended route, allowed campaign types, and draft
preview.

**Reuse:** `DataTable` — wiring its already-implemented but unused `selectedIds`/`onToggleRow`/
`onToggleAll` props (§5.3 A-9); `FilterBar` + `useTableControls`; `StatusBadge` — extend its
`STATUS_TONE` map rather than adding a fourth copied badge map; `ConfirmDialog` for block/reclassify;
`Toast`; `EmptyState`; `ErrorRetry`; and the `DiscoveryPreviewPanel`
eligible/blockedReasons/confirm-checkbox pattern (`WizmatchCompaniesPage.jsx:405-500`) for explaining
blocks. The existing partial-failure disclosure banner (`WizmatchTodayPage.jsx:100-112`) is preserved.

**Build new:** a WizMatch bulk-action bar. `admin/src/components/BulkActionBar.jsx` cannot be reused
directly — its endpoints are hardcoded to Growth — but its floating-bar pattern is the template.

The company detail drawer (`WizmatchCompaniesPage.jsx:149-397`) gains a **Policy** section: effective
policy per dimension with the supplying scope, all scoped rows, evidence, full history, and quick
actions.

---

## 14. Background-job flow

One new worker job, registered in the existing WizMatch cron block in `src/worker.ts`, advisory-locked
via the existing `withWizmatchSourceLock`, and idempotent:

```
prepareCompaniesJob — for each company where preparationAllowed and prep is stale:
  1. company normalisation (name + domain)      free
  2. duplicate detection                        free
  3. COMPANY-POLICY CHECK ← hard stop on DENY   free
  4. signal scoring                             free — reuse wizmatchScoring.ts
  5. internal CRM contact reuse                 free — reuse fetchInternalContactCandidates
  6. website / public email discovery           free — reuse discoverFreePocsForSignal rungs 1–2
  7. contact ranking + email-confidence grading  free — reuse existing graders
  8. campaign recommendation                    free — NEW, deterministic rules
  9. draft personalisation                      free — NEW, deterministic template merge
 → writes a preparation report; never sends, never spends
```

**This job is strictly ₹0.** SearchAPI (rung 3, 1 credit) stays behind its existing caps and is **not**
invoked by this job — it remains operator-triggered. Steps 8 and 9 are the only genuinely new logic.
Draft personalisation in v1 is deterministic template merge with **no Anthropic call**, keeping the job
free and idempotent; LLM drafting stays where it is today (operator-triggered
`generateSignalDraftEmails`).

`WIZMATCH_LEGACY_AUTOMATION_ENABLED` stays off and is not modified.

**AS-IS note carried, not fixed:** the legacy ATS cron (`30 0 * * *`) does not use the advisory lock
that the results-first cron (`40 0 * * *`) does. Currently moot because legacy automation is off.

---

## 15. Outreach provider boundary

Full rationale in [ADR-007](../decisions/ADR-007-outreach-provider-boundary.md). Summary:

`src/modules/outreach/` copies the `src/modules/esign/providers/` shape exactly — vendor-neutral types,
an `OutreachProvider` interface, a real provider, a mock, and an env-keyed lazy-singleton factory with
`setOutreachProvider`/`resetOutreachProvider` test hooks.

V1 capability is **CSV export + CSV result import only**:

1. Smartlead-compatible CSV export of approved and queued contacts.
2. Result CSV import for `sent`, `bounced`, `replied`, `unsubscribed`, `completed`.
3. Idempotent re-import (§10.7).
4. Campaign batch and external provider reference tracking.
5. Suppression updates for bounces and unsubscribes, per the split in §8.5.
6. **Existing IMAP remains the authoritative source for full reply bodies.** The CSV `replied` event
   marks *that* a reply happened and drives the queue; body, classification and follow-up task come
   from the IMAP path.
7. **No Smartlead API keys, API calls, credentials or recurring cost.**
8. **All Smartlead-specific column mapping is isolated inside the adapter**, behind a configurable
   header-alias map. Nothing outside `providers/smartlead-csv.provider.ts` references a Smartlead
   header; enforced by a review grep.

A real Smartlead API provider may be added later — `capabilities.sends = true` — without changing the
WizMatch lifecycle, any table, or any caller.

---

## 16. Feature flags

| Flag | Default | Gates |
|---|---|---|
| `WIZMATCH_COMPANY_POLICY_ENABLED` | `false` | policy read/write API + UI |
| `WIZMATCH_POLICY_ENFORCEMENT_MODE` | `shadow` | `shadow` logs would-block without blocking; `enforce` blocks. Promotion = G4 |
| `WIZMATCH_DECISION_WORKBENCH_ENABLED` | `false` | new Today queues; existing buckets remain until flipped |
| `WIZMATCH_AUTO_PREP_ENABLED` | `false` | `prepareCompaniesJob` |
| `WIZMATCH_OUTREACH_ADAPTER_ENABLED` | `false` | batch / export / import routes |
| `WIZMATCH_MAILER_EMERGENCY_OVERRIDE` | `false` | restores the old all-inbox fallback; logs and alerts on every use |
| `OUTREACH_PROVIDER` | `smartlead_csv` | adapter selection, mirroring `ESIGN_PROVIDER` |
| `VITE_WIZMATCH_DECISION_WORKBENCH_ENABLED` | `false` | build-time UI gate |

**Unchanged and untouched by every milestone:** `WIZMATCH_SENDING_ENABLED`,
`AUTOMATED_EMAILS_ENABLED`, `WIZMATCH_PAID_DISCOVERY_ENABLED`, `WIZMATCH_ENABLE_APOLLO`,
`WIZMATCH_ENABLE_SNOV`, `WIZMATCH_GOOGLE_FALLBACK_ENABLED`, `WIZMATCH_LEGACY_AUTOMATION_ENABLED`.

---

## 17. Observability

Structured logs and counters for: policy decisions by outcome and reason code; shadow-mode
would-have-blocked events; preparation runs (duration, steps completed, failures); export row counts
and policy-omission counts; import events by type, duplicates skipped, suppression writes; enrolment
state transitions; ownership changes.

Slack alerts to `WIZMATCH_SYSTEM_CHANNEL` on: any policy-resolver error — fail-closed is otherwise
silent to the user — and any import writing more than a configurable number of suppressions in one
file. `/api/wizmatch/system` gains a policy/adapter panel showing flag state and the last batch.

---

## 18. Security and compliance

### 18.1 Unchanged and not weakened

Tenancy; `src/middleware/auth.ts`; `src/middleware/rbac.ts`; HMAC unsubscribe (fail-closed,
`timingSafeEqual`); `requireInternalToken`; webhook idempotency; private R2 with five-minute signed
URLs; the `findOrCreateContact` normalisation invariants and the `lastActivityAt` bump.

### 18.2 New controls

Policy write is `team_lead`+; override and bulk are `admin` only; evidence URLs pass the existing
`normalizeDomain()` SSRF scrub; uploaded result CSVs are size-capped and parsed with the existing
hardened parser; every policy mutation and ownership change writes an audit row. Export files contain
contact PII — generated on demand, streamed, never persisted to disk or object storage.

`account_owner_user_id` cross-tenant assignment is rejected by a composite FK (§10.8), not only by
service validation.

`wizmatch_reply_mailboxes` stores non-secret `provider_config` and an opaque `secret_ref` — never a
credential value (§10.4).

### 18.3 Mailer fail-closed

`src/services/multiDomainMailer.ts:71-75` currently reads *"If no healthy domains match, use all
inboxes"*. This PRD reverses that: with no healthy inbox the sender **fails closed** unless
`WIZMATCH_MAILER_EMERGENCY_OVERRIDE=true`, which logs and Slack-alerts on every use.

This reverses the "alert + keep sending" decision recorded in
`docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md` §7 — recorded in ADR-006 so the reversal is
deliberate and traceable. **It does not enable or activate sending**; both kill-switches stay off, so
live impact today is zero. The change only makes the path stricter.

### 18.4 Privacy erasure is out of scope

A GDPR or privacy erasure request is **not** an outreach policy. Suppressing outreach does not erase
data. Genuine erasure requires identifying all PII across `contacts`, `contact_channels`, `messages`,
`events`, generated exports and any provider system; erasing it; and evidencing the erasure. That is a
separate workflow, **out of scope for this release** and recorded in §24.

`privacy_request_pending` (§9.2) exists so an in-flight request suppresses outreach and routes to that
workflow. **It must never be treated as evidence that erasure occurred.**

---

## 19. Rollback strategy

Application-code revert only. `0037` is additive; its tables are left in place on rollback — ADR-004
forbids destructive down-migrations during incident response. Each milestone is independently
flag-revertible. Shadow mode means the entire policy milestone can be deployed and observed with zero
behavioural change before enforcement is enabled.

---

## 20. Test plan

### 20.1 Automated

Per `.ai/TEST_PLAN.md` §A for every PR (build, tests, admin build where relevant, read-only real-data
check, side-effect/guardrail review, money check), plus:

- **Precedence:** every level, including permanent-block-beats-specific-eligible; fail-closed on DB
  error, missing row and unresolvable scope.
- **Scoped inheritance:** a `location:bengaluru` row setting only `outreach_eligibility='paused'`
  leaves inherited `relationship_type='existing_client'` and the company-wide `external_hiring_policy`
  unchanged; each dimension reports its supplying `scope_key`; the ladder resolves signal → location →
  BU → region → entire_company; an all-null scoped row is rejected; an `entire_company` row with any
  null dimension is rejected; a company with no root row resolves DENY and is counted as missing.
- **Scope key:** normalisation; malformed keys rejected; two business units coexist; a duplicate active
  business unit is rejected.
- **Immutability:** the trigger fires on any decision-column UPDATE.
- **Block class:** `company_removal_request` is `compliance` + non-overridable and **not** `legal`;
  L1 keys on `is_non_overridable`; `block_class <> 'standard'` on a non-blocked row is rejected.
- **Routing matrix:** all 8 hiring policies × 8 relationship types.
- **Campaign types:** `msp_vms_only` yields `['msp_vms']` and never a staffing type;
  `preferred_vendors_only` yields `['vendor_empanelment']` and is rejected for `fte_permanent` /
  `contract` / `c2h`; a `review` decision without `approved_by` is refused at create and at export.
- **Overlap / mode:** a second active `cold_email` enrolment for a company is rejected **regardless of
  family**; a second active enrolment for a contact is rejected in any mode; `research_only` and
  `account_managed` may coexist for one company; `msp_vms_only` and `existing_client` never return
  `cold_email`; the batch API rejects a mode absent from the resolver's list; **the resolver returns
  identical decisions across all five campaign families for identical policy inputs**, proving family
  grants no permission.
- **Cold-start confidence:** high → Ready; medium → Needs Review; low/unverified cannot be queued or
  exported, checked at both points.
- **Suppression split:** hard bounce suppresses the email/channel and does **not** set
  `contacts.do_not_contact`; unsubscribe sets it and does **not** block the company; removal request
  creates a permanent compliance block and withdraws all active enrolments.
- **A-1 regression:** a contact marked do-not-contact through the generic CRM UI is refused by the
  WizMatch path.
- **Duplicates:** `Acme Inc` / `acme inc` flagged; double-space variant flagged; same-domain
  different-name flagged; `Acme Inc` / `Acme Incorporated` **not** flagged; two null-domain
  differently-named companies not flagged; a pending pair blocks queue and export for both while still
  allowing preparation.
- **Account owner:** a cross-tenant assignment is rejected by the composite FK; every change writes
  both an `audit_events` row and a `company_owner_changed` staffing event.
- **Mailbox config:** `provider_config` containing a secret-like key is rejected; a `secret_ref`
  without a known scheme prefix is rejected; no fixture contains a real credential.
- **CSV:** export shape; re-import of the same file is a no-op; the provider-ID tier is selected
  correctly and `key_source` is recorded.
- **Provider seam:** swapping in `mock.provider` via `setOutreachProvider()` changes no caller.
- **Smartlead isolation:** grep for Smartlead header literals outside the adapter file fails review.
- **Zero-spend:** `prepareCompaniesJob` asserts no provider call and no cost row.
- **Playwright:** four queue labels, contextual actions, bulk selection, axe scan. Today is currently
  touched only by `wizmatch-a11y` and `wizmatch-e2e-hardening-navigation`, neither of which asserts
  bucket contents — new assertions are required, not assumed.

### 20.2 Manual — add to `.ai/TEST_PLAN.md` §C

- Today shows exactly four queues with correct counts; each of the six actions works and is audited.
- Block a company → it leaves Ready, appears in Blocked with reason, scope and evidence, and is omitted
  from a fresh export with the omission reported.
- Mark a contact do-not-contact via the generic CRM UI → the WizMatch path refuses it.
- Hard-bounce one channel → the contact is **not** marked do-not-contact; the channel is.
- Unsubscribe one contact → their employer is **not** blocked.
- Close a role → the signal drops; the company and contact stay active.
- Pause `location:bengaluru` on an `existing_client` → the relationship and hiring policy are unchanged.
- Re-import the same result CSV → zero new events, zero duplicate suppressions.
- Confirm `/health` 200 and zero 5xx after each deploy; new routes 401 unauthenticated.

---

## 21. Rollout plan and gates

Each gate requires explicit owner approval.

| G | Gate | Precondition |
|---|---|---|
| **G0** | Merge PR 1 (docs) | Reason-code taxonomy §9 ratified |
| **G1** | Apply `0037` to production | PR 2 reviewed; migration diffed for destructive statements; fresh-DB apply verified |
| **G2** | Run backfill `--apply` | Dry-run report reviewed; ~131 companies expected; count-first |
| **G3** | Deploy shadow enforcement | PR 3 merged; zero behavioural change confirmed post-deploy |
| **G4** | **Promote `shadow` → `enforce`** | Readiness report reviewed and approved, plus §21.2 |
| **G5** | Enable `WIZMATCH_AUTO_PREP_ENABLED` | Zero-spend assertion green; verified read-only against real data |
| **G6** | Enable `WIZMATCH_OUTREACH_ADAPTER_ENABLED` | Fixtures supplied (§25.2 U-6); round-trip re-import no-op verified |
| **G7** | Sending | **Out of scope of this PRD.** No milestone modifies either sending flag |

### 21.1 Cold-start readiness report

`GET /api/wizmatch/policy/readiness` and `npm run wizmatch:policy-readiness`, shipped in PR 4 so
evidence accumulates across the whole shadow period.

| Metric | Purpose |
|---|---|
| Total companies | denominator |
| Policy coverage (count + %) | backfill completeness |
| Companies still missing an effective policy | G4 condition 4 |
| Companies classified (eligibility × hiring policy × relationship type) | distribution sanity |
| Contacts reviewed | human throughput |
| Contact confidence distribution (high / medium / low / unverified) | how much is actually queueable |
| Duplicate suspects: pending / merged / confirmed separate, pending-with-active-enrolment, pending-in-pilot-batch | G4 conditions 1–3 |
| Shadow would-have-blocked count | blast radius of enabling enforcement |
| Reason-code distribution | taxonomy validation |
| Export omissions (count + reason) | export correctness |
| Policy resolver errors | G4 condition 5 |

### 21.2 G4 hard preconditions

Requiring zero pending duplicates database-wide would block enforcement on stale suspects unrelated to
active work. The gate targets **containment**, not global cleanliness:

1. Every pending duplicate is denied from Ready, from queueing and from export — **verified by query**.
2. **No pending duplicate has an active outreach enrolment** (`state IN ('queued','exported','sent')`).
3. All duplicate conflicts **within the active pilot batch** are resolved.
4. **Zero companies missing an effective policy** — no company lacking an `entire_company` root row.
5. **Zero policy-resolver errors** over the shadow window.

Conditions 1, 2, 4 and 5 come from the readiness report; condition 3 is scoped by the pilot batch id.

---

## 22. Milestones and stacked-PR dependency map

Each branch is created **from its parent**, never from `main`, and its PR description names the parent.
As a parent merges, children rebase forward.

```
origin/main
 └─ 1  ge/outbound-01-prd-adrs .................. docs only  ← THIS PR
    └─ 2  ge/outbound-02-policy-schema-service ... schema.ts + 0037 + resolver, no callers
       └─ 3  ge/outbound-03-policy-enforcement ... shadow wiring, A-1/A-4 fixes, mailer fail-closed
          └─ 4  ge/outbound-04-policy-ui-backfill  policy UI, duplicate review, dry-run backfill, readiness
             └─ 5  ge/outbound-05-lifecycle-consolidation ... 5 eligibility computations → one resolver
                └─ 6  ge/outbound-06-decision-workbench ..... queues API + Today re-bucket + bulk bar
                   └─ 7  ge/outbound-07-free-prep ........... prepareCompaniesJob
                      └─ 8  ge/outbound-08-outreach-adapter . interface + mock + factory, no Smartlead
                         └─ 9  ge/outbound-09-smartlead-csv . GATED on fixtures
                            └─ 10 ge/outbound-10-reply-ingestion ... mailbox registry + /classify-reply

independent, off origin/main:
      ge/fix-ensure-table-skill ................... corrects the inaccurate skill (§5.3 A-7)
```

### 22.1 Clean-start requirement

The 2026-07-26 audit ran from a dirty `feat/seo-indexing-status` tree. Implementation must not reuse
it. Every outbound branch is cut from `origin/main` (or its parent), verified clean before commit, and
checked for `docs/seo/`, `scripts/seo-*` and `src/services/seo*` in its diff. The dirty audit worktree
is preserved untouched per the `AGENTS.md` dirty-worktree rule.

---

## 23. File-by-file impact estimate

**PR 1 (this PR) — documentation only.** No code path changes.

| Area | Files | Change |
|---|---|---|
| Schema | `src/db/schema.ts`, `src/db/migrations/0037_*.sql` | 7 new tables, 2 additive ALTERs, 1 unique index, 1 composite FK |
| Policy service | `src/services/wizmatchCompanyPolicy.ts` (new) | resolver, writer, scope-key builder, inheritance walk |
| Enforcement | `wizmatchContactIntelligenceRepo.ts`, `wizmatchSourcing.ts`, `wizmatchOutreachService.ts` | call the resolver; union suppression |
| Suppression | `wizmatchOutreachService.ts:183`, `wizmatchBounceParser.ts:57-77` | fix A-1, enable A-4, split bounce/unsubscribe |
| Mailer | `multiDomainMailer.ts:71-75` | fail closed + emergency override |
| Lifecycle | `wizmatchClientDiscovery.ts`, `wizmatchCandidateIntelligence.ts`, `wizmatchCommandCenter.ts`, `wizmatchRequirementPriority.ts`, `wizmatchContactIntelligence.ts` | migrate onto `resolveCompanyStatus()` |
| Workbench API | `src/routes/wizmatch.ts` or a new `wizmatchOutbound.ts` | queues + actions |
| Worker | `src/worker.ts` | register `prepareCompaniesJob` |
| Adapter | `src/modules/outreach/**` (new) | types, interface, mock, smartlead-csv, factory |
| Reply | `src/services/imapService.ts` | mailbox registry + WizMatch matching |
| UI | `WizmatchTodayPage.jsx`, `WizmatchCompaniesPage.jsx`, `StatusBadge.jsx`, new bulk bar | queues, policy section, badges |
| UI removals | `WizmatchReviewQueuePage.jsx`, `WizmatchCommandCenterPage.jsx` | delete (dead) |
| Tests | `src/__tests__/wizmatch*Policy*.test.ts` and others (new); `e2e/wizmatch-*.spec.ts` | per §20 |

---

## 24. FUTURE parking lot

Promote one only through a new PRD or ADR with evidence that the core workflow is stable.

- **Privacy / GDPR erasure workflow** — identify, erase and evidence PII across all stores and provider
  systems. Explicitly **not** satisfied by a removal-request policy row (§18.4). Highest-priority item
  on this list.
- Assisted Mode — graduated automation of decisions the system has learned.
- Machine-learning models consuming the §9 learning labels.
- Automatic production scoring-weight changes.
- Smartlead paid API provider (`capabilities.sends = true`).
- Paid enrichment automation.
- Fully automatic sending.
- Automatic permanent company blocks inferred from text.
- Removal of legacy outreach tables; full company-identity migration.
- Consolidation of Growth `prospects/*` and n8n `outreach_leads`.
- Repairing the dead `sequence_step` job loop, or replacing n8n.

---

## 25. Open decisions

### 25.1 Settled — do not re-ask

| # | Decision |
|---|---|
| A-1 | Policy model: new `wizmatch_company_policies` + `wizmatch_company_policy_events` |
| A-2 | Consolidation scope: WizMatch only |
| A-3 | Smartlead: CSV export + result import behind a provider-neutral adapter; no API, keys or cost |
| A-4 | Replies: extend existing IMAP ingestion; IMAP authoritative for bodies |
| A-5 | Editing `schema.ts` + forward-only migration `0037` approved for the policy milestone |
| A-6 | Fix the `contacts.do_not_contact` suppression gap |
| A-7 | Dead `sequence_step` / n8n workflow stays out of scope |
| A-8 | Ship enforcement in shadow mode first |
| A-9 | Backfill via a separate dry-run-first, `--apply`-gated process |
| A-10 | Pilot exposure limited to Jatin and Kanishk |
| A-11 | Correct the `ge-add-ensure-table` skill |
| A-12 | Remove the two dead unrouted WizMatch pages |
| A-13 | Full company-identity migration out of scope |
| A-14 | Suspected duplicates block outreach pending review |
| A-15 | Automatic sending and paid discovery remain disabled |
| A-16 | Account owner: nullable `account_owner_user_id` on `wizmatch_companies`, DB-enforced tenancy |
| A-17 | `region:` scope constrained to `india\|us`, extendable by later migration |
| A-18 | Campaign families + types as §10.5, plus `outreach_mode` as the company-overlap key |
| A-19 | Duplicate rule: exact domain **or** normalised name; no fuzzy scoring, no `pg_trgm` |
| A-20 | Non-cold overlap constraint (§10.6 constraint 3) approved |
| A-21 | Reason-code taxonomy (§9) ratified 2026-07-26, including: `policy_accepts_external_vendors` requires evidence; `contact_role_mismatch` split into `contact_role_uncertain` (review, no evidence) and `contact_role_confirmed_mismatch` (deny contact, evidence required, permanent only for the applicable employment relationship) |

### 25.2 Still open

| # | Question | Blocks |
|---|---|---|
| **U-6** | **Smartlead fixtures — an input, not a decision.** Required before PR 9: a sanitised lead-import sample, a sanitised campaign-results sample, and bounce / unsubscribe / reply examples. Without them the header-alias map and the idempotency tier are guesses. | PR 9 |

---

## 26. Handoff contract

An agent picking this up cold must:

1. Read §0.3 in order.
2. Confirm the reason-code taxonomy (§9) has been ratified before starting PR 2.
3. Work in a worktree cut from `origin/main` or the parent branch — never from the dirty audit tree
   (§22.1).
4. Treat `src/db/schema.ts` and `src/db/migrations/` as guarded: generate with `npm run db:generate`,
   never hand-edit, never touch an applied migration.
5. Run the `.ai/TEST_PLAN.md` §A gate for every PR and report real results.
6. Append to `.ai/HANDOFF_LOG.md` and update `.ai/CURRENT_TASK.md` after each completed unit.
7. **Stop and ask** before: applying `0037` to production, running the backfill with `--apply`,
   promoting `WIZMATCH_POLICY_ENFORCEMENT_MODE` to `enforce`, any Railway variable change, any
   paid-provider call, any send, and any push to `main`.

Nothing in this PRD authorises a production change. Every gate in §21 is an explicit owner decision.
