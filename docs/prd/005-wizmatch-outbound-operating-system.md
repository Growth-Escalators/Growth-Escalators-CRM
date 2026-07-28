# PRD 005: WizMatch Outbound Operating System

- **Status:** Approved. Reason-code taxonomy (§9) ratified 2026-07-26. **Spec-repair pass applied
  2026-07-26** against the overnight Opus review — eight owner decisions D-1…D-8 recorded as §25.1
  A-22…A-30, resolving all six CRITICAL findings. **PR 2 may proceed against the §22.2 acceptance
  criteria.** No open decision blocks PR 2.
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
2. Approved owner decisions (§25.1), most recent first — the 2026-07-26 spec-repair decisions
   D-1…D-8 (A-22…A-30) supersede any earlier text in this document that contradicts them
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
| **A-10** | P1 | **Suppression is written lowercased but read raw.** The single enforcing read compares `wizmatch_suppression_list.email` to `contact_channels.channel_value` with no `LOWER()` on either side. It works only because `normalizeChannelValue` lowercases channels written through `findOrCreateContact`; any direct `contact_channels` insert defeats it. A direct violation of the repo's contact-normalisation invariant. | `wizmatchOutreachService.ts:183-189`; write sites `routes/wizmatch.ts:3543`, `wizmatchBounceParser.ts:68`; normaliser `contactService.ts:19` | **Fixed** — PR 3, the gate lowercases both sides (§8.10) |
| **A-11** | P1 | **`classify-reply` writes suppression un-normalised.** `contact_email` goes from `req.body` straight into the insert with no `toLowerCase()`, unlike the other three write sites. | `routes/wizmatch.ts:3692`, `:3743-3748` | **Fixed** — PR 3, single `suppress()` write path |
| **A-12** | P1 | **Unsubscribe writes to the wrong tenant.** The write uses `process.env.WIZMATCH_TENANT_ID` rather than the sending tenant, so a multi-tenant unsubscribe lands in the wrong tenant and is invisible to the tenant that sent. | `routes/wizmatch.ts:3644`, insert `:3651` | **Fixed** — PR 3 |
| **A-13** | P1 | **The unsubscribe HMAC is unverifiable for any mixed-case recipient.** It is minted over the un-lowercased `toEmail` but verified over the lowercased address, so every mixed-case recipient receives a permanently 403-ing unsubscribe link — a compliance-relevant break, not a cosmetic one. | mint `wizmatchOutreachService.ts:200-203`; verify `routes/wizmatch.ts:3612`, `:3630-3632`, 403 at `:3639` | **Fixed** — PR 3 |
| **A-14** | P1 | **WizMatch already writes `sequence_enrolments`**, bypassing `enrolContact` and therefore bypassing the repo's only enforcing read of `contacts.do_not_contact`. The rows enter the dead `sequence_step` loop and sit `pending` forever. ADR-007 D-8's "does not use `sequence_enrolments`" was aspirational. | `wizmatchOutreachService.ts:17`, `:243`; DNC read `sequenceService.ts:41` | **Fixed** — PR 3 deletes or gates it (§8.10.1 row 3) |
| **A-15** | P2 | **`wizmatch_suppression_list.reason` documents a `do_not_contact` value** — a contact-grain reason inside what D-4 declares an exact-email table. | `schema.ts:1513` | **Deprecated** — never written by new code; existing rows untouched |
| **A-16** | P2 | **`sendWarmupEmails` reads no domain health.** It sends from the same Purelymail inboxes as `sendColdEmail`, which does check health, so warm-up keeps sending from a `paused` or `blacklisted` domain. | `multiDomainMailer.ts:131-148`; contrast `:61-71` | **Fixed** — PR 3 (§8.10) |
| **A-17** | P2 | **Four send paths honour neither kill-switch**, two of them accepting an arbitrary recipient or a caller-supplied `tenantId`. | `emailService.ts:67`, `:261`; `routes/email.ts:69`; `routes/emailTemplates.ts:198`, `:255` | **Contained** — PR 3 gates or rejects WizMatch-linked contacts (§8.10.1 rows 20–23) |

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
   an existing non-overridable `entire_company` block on the company (from `wizmatch_company_policies`,
   **not** from a suppression row — there is no company or domain grain in
   `wizmatch_suppression_list`, §10.9), self/competitor domain allowlist match. Everything else is
   `needs_review`. No block is ever inferred from free text.
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
specific_signal:<uuid> / specific_requirement:<uuid>  →  location:<x>  →  business_unit:<x>  →  region:<x>  →  entire_company
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

A company with **no active** `entire_company` row resolves to **DENY** (fail closed) with
`reasonCode = 'policy_missing_root'`, and is counted by the readiness report's *companies missing an
effective policy* metric, which must be zero before enforce.

**There is no fallback.** No legacy status — `wizmatch_company_intelligence.status` included — may
supply an outreach decision for a company that has no root policy row. Owner decision D-1, 2026-07-26
(§25.1 A-22). See §11.3 for the corrected compatibility adapter.

> **Do not confuse `unknown` with "missing".** `external_hiring_policy = 'unknown'` is a **decided**
> value on an existing root row and yields REVIEW. **No root row at all** is L0 DENY. Every statement
> in this document that says `unknown` is "never automatically blocked" (§1, §7) applies only when a
> root row exists.

**A root policy row is created with the company, not only by the backfill.** Every insert path for
`wizmatch_companies` writes the cold-start `entire_company` row in the **same transaction**
(`needs_review` / `unknown` / `new_prospect`, `source='deterministic_rule'`,
`reason_code='policy_unknown_cold_start'`). Without this, "zero companies missing an effective policy"
(§21.2 condition 4) is satisfiable only for the instant after the backfill, and every company
discovered afterwards immediately re-breaks it (resolves review M-5).

### 8.1.1 Scope applicability — where region, business unit and location come from

A scope row only participates in the inheritance walk if the **request context** can resolve a label
for that scope type. The sources are named, not assumed:

| Scope | Source of the request-context label | Always resolvable? |
|---|---|---|
| `region` | `deriveSignalRegion()` over `wizmatch_job_signals.location`, using the existing `isIndiaLocation` / `isConfidentUsLocation` helpers in `src/config/constants.ts`; company-level fallback `wizmatch_company_intelligence.target_region` | yes — `india`, `us`, or unresolved |
| `location` | `normaliseLocationLabel()` over the same `wizmatch_job_signals.location` free-text field | only when the context carries a signal or requirement |
| `business_unit` | **explicitly supplied by the caller** — the policy API, the batch API or the workbench action. **There is no automatic derivation in v1**; no table maps a signal, contact or requirement to a business unit | no |

**Fail closed on unresolvable applicability.** If an active policy row exists at a scope type the
request context **cannot** resolve, the resolver returns **DENY** with `reasonCode='scope_unresolvable'`.
It never silently treats the row as inapplicable.

This is the fix for review H-4. The failure it prevents is specific: an operator pauses
`location:bengaluru`, the resolver has no signal→location mapping, the row is never considered
"applicable", and the pause silently does nothing. A pause that silently does nothing is worse than no
pause. Under this rule the same situation denies and names the unresolvable scope, so the operator sees
it immediately.

`business_unit` is retained rather than cut because the policy and batch APIs can supply it explicitly
and the business case is real; but because nothing derives it, a `business_unit` row will deny every
request that does not carry an explicit label. §13 surfaces that on the policy card so it is not
discovered at send time.

### 8.2 Enforcement hierarchy

Resolution is two phases. **Phase 0** builds the effective policy by §8.1 inheritance. **Phase 1**
applies the gates below to that composite, in strict order, first terminal DENY wins.

A non-overridable block, or `no_external_agencies`, **always** overrides a more-specific `eligible`
value. "Most specific wins" is a Phase-0 inheritance rule only — it never lets a narrow row defeat a
hard block in Phase 1.

**Company-wide blocks come from `wizmatch_company_policies`, never from a suppression row.**
`wizmatch_suppression_list` has exact email/channel grain only and carries no company or domain
concept (§10.9, D-4). ADR-006 already rejected a domain-suppression table for exactly this reason; an
earlier draft of this section contradicted its own ADR.

| L | Gate | Terminal | Notes |
|---|---|---|---|
| **L0** | **Missing root policy** — no active `scope_key='entire_company'` row for the company | **DENY** | `reasonCode='policy_missing_root'`. Evaluated before every other gate. No legacy-status fallback (§11.3, D-1) |
| **L1** | Non-overridable entire-company block — `scope_key='entire_company'` AND `blocked` AND `is_non_overridable` | **DENY** | Not overridable by any narrower `eligible` row. `block_class` classifies it (§8.3) |
| **L1b** | Relationship hard exclusion — `competitor`, `irrelevant` | **DENY** | `irrelevant` additionally **stops free preparation** |
| **L1c** | **Non-overridable block at a narrower scope** — `blocked` AND `is_non_overridable` at `region`/`business_unit`/`location`/`specific_*` | **DENY for that scope** | New. Makes a `compliance` obligation narrower than the whole company enforceable (resolves review H-7). No admin override at any scope |
| **L2** | Overridable entire-company block | **DENY** | Admin-overridable via a superseding policy row. **No suppression-row clause** — `wizmatch_suppression_list` has no company or domain grain (§10.9) |
| **L3** | Region / business-unit / location restriction | DENY when the inherited eligibility is `blocked`/`paused` **and** was supplied by a region/BU/location scope | Provenance comes from Phase 0, not a second specificity contest |
| **L4** | Signal / requirement restriction | DENY **for that signal or requirement only** | Company and contact remain active |
| **L5** | Pause · needs-review · duplicate-suspected | `paused`→DENY (resume path); `needs_review`→REVIEW; pending duplicate→DENY for queue and export, **preparation still allowed** | |
| **L6** | Campaign compatibility | DENY if requested **type** ∉ `allowedCampaignTypes`, **or** requested **mode** ∉ `allowedOutreachModes` | `campaign_family` is **never** consulted (§8.6) |
| **L6b** | Company cold-email lock | DENY when mode = `cold_email` and a **live** cold-email enrolment exists for the company | "Live" = the eight lock-holding states in §10.6.1 — `queued`, `exported`, `sent`, `replied`, `awaiting_action`, `positive_reply`, `referral_received`, `conversation_open`. **A reply does not release the lock** (D-6). Mirrors the DB constraint so the UI names the holder rather than surfacing a constraint violation |
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
| Hard bounce / invalid email | that email/channel only | the contact's other channels, the company |
| Spam complaint | that email **and** that contact | the company, colleagues |
| Company-wide removal request | the company (permanent, compliance) | — |
| `no_external_agencies` | the company: no enrich, no export, no enrol, no follow-up | the company **record**, which remains valid |

**Do not delete valid companies merely because they are unsuitable for outreach.** Reclassification is
a policy write, never a row delete.

### 8.5 Bounce, unsubscribe and removal semantics

**Revised 2026-07-26 (owner decision D-4).** The full model, including the third grain and the
append-only history stream, is §10.9. Summary:

| Event | Suppression write (exact email/channel grain) | `contacts.do_not_contact` | Company policy | Enrolments |
|---|---|---|---|---|
| **Hard bounce** | upsert that exact email, `reason='hard_bounce'`, `contact_channel_id` set, `channel_invalid=true` | **not set** | untouched | that enrolment → `contact_invalid` |
| **Invalid email / unresolvable domain** | upsert, `reason='invalid_email'`, `channel_invalid=true` | **not set** | untouched | that enrolment → `contact_invalid` |
| **Spam complaint** | upsert, `reason='spam_complaint'` | **set true** | untouched | that enrolment → `unsubscribed` |
| **Personal unsubscribe** | upsert **when the exact email is known**, `reason='unsubscribe'` | **set true** | **untouched** | that enrolment → `unsubscribed` |
| **Company-wide removal request** | — | — | new `entire_company` row: `blocked`, `is_permanent`, `block_class='compliance'`, `is_non_overridable`, `reason_code='company_removal_request'`, evidence required | **all live** enrolments → `company_blocked`; future follow-ups stopped |

Every one of these also appends a `wizmatch_suppression_events` row (§10.9.1) — that stream, not
multiple effective rows, is where suppression history lives.

`suppression_scope` is **not** a column. `wizmatch_suppression_list` is unconditionally exact
email/channel grain, so there is nothing for a scope discriminator to discriminate, and the existing
`UNIQUE (tenant_id, email)` index is retained rather than replaced.

A hard bounce is a channel-quality fact, not a stated preference — it must not silently mark a whole
person do-not-contact. An unsubscribe is a stated personal preference — it must not silently block
their employer. A spam complaint is both, so it sets both, and is never overridable.

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
  readonly __brand: 'WizmatchPolicyDecision';  // constructible only by the resolver (§8.10)
  decision:             'allow' | 'review' | 'deny';
  recommendedRoute:     RouteCode;
  allowedCampaignTypes: CampaignType[];      // [] when none permitted
  allowedOutreachModes: OutreachMode[];
  reasonCodes:          ReasonCode[];        // §9, ordered by the level that produced them
  effectiveLevel:       0|1|2|3|4|5|6|7|8;   // which gate was terminal; 0 = missing root policy

  effective: {                                // per-dimension provenance; null when L0 denied
    outreachEligibility:  { value: Eligibility;      scopeKey: string; policyId: string } | null;
    externalHiringPolicy: { value: HiringPolicy;     scopeKey: string; policyId: string } | null;
    relationshipType:     { value: RelationshipType; scopeKey: string; policyId: string } | null;
  };
  blockClass:               'standard' | 'compliance' | 'legal' | null;
  isNonOverridable:         boolean;
  preparationAllowed:       boolean;         // false for exactly the §9 codes whose Prep cell is ⬜
  requiresExplicitApproval: boolean;         // true when decision === 'review'
  accountOwnerUserId:       string | null;
  evidence: {
    kind?: EvidenceKind;                     // §10.1, the six D-7 evidence classes
    text?: string; url?: string; ref?: string;
    source: string; actorUserId?: string;
  };
}
```

**`preparationAllowed` is derived, not enumerated** (resolves review H-1). It is `false` for exactly
the six §9 reason codes whose `Prep` cell is ⬜ — `policy_no_external_agencies`,
`relationship_irrelevant`, and the four `compliance` codes other than `contractual_restriction`. The
previous comment said *"false only for no_external_agencies and irrelevant"*, which, implemented
literally, would have continued to enrich and prepare a company that formally asked to be removed —
continued PII processing on a compliance-blocked company. §20.1 pins the derived set against the
tables rather than against a second hand-written list.

`effectiveLevel: 0` is L0, the missing-root case. `effective` is `null` on every dimension there,
because there is nothing to inherit from — that is why a caller must never read `effective` without
first checking `decision`.

### 8.10 The mandatory outreach chokepoint — **owner decision D-5**

The gate model is only as strong as its narrowest entry point. The previous draft specified a
fail-closed resolver and then named no function that anything was required to call, so enforcement was
convention. Two canonical functions now exist, and they are the **only** sanctioned way to reach a
policy or suppression decision:

```ts
// Evaluates. Returns a structured decision. Never throws for a policy outcome.
export async function evaluateWizmatchOutreachGate(
  ctx: OutreachGateContext,
): Promise<PolicyDecision>;

// Asserts. Fails closed. Throws OutreachBlockedError carrying the PolicyDecision.
export async function assertWizmatchOutreachAllowed(
  ctx: OutreachGateContext,
): Promise<PolicyDecision>;   // resolves only when decision === 'allow'

interface OutreachGateContext {
  tenantId:     string;
  action:       'enrol' | 'queue' | 'export' | 'send' | 'follow_up' | 'retry' | 're_enrol';
  companyId?:   string;
  contactId?:   string;
  email?:       string;        // normalised by the gate: .trim().toLowerCase()
  signalId?:    string;
  requirementId?: string;
  campaignType?: CampaignType;
  outreachMode?: OutreachMode;
  region?: string; businessUnit?: string; location?: string;   // §8.1.1
  actorUserId?: string;
}
```

**What the gate does, in one place:** L0–L8 policy resolution (§8.2); the suppression union — the
exact email/channel row **and** `contacts.do_not_contact` (§10.9), both sides lowercased at read; the
cold-start confidence gate (§7); the live-enrolment locks (§10.6.2); and the `WIZMATCH_SENDING_ENABLED`
/ `AUTOMATED_EMAILS_ENABLED` kill-switch reads for send actions.

**Rules.**

1. `assertWizmatchOutreachAllowed` is **required before every** WizMatch enrolment, queue action,
   export, direct send, follow-up, retry and re-enrolment.
2. **No WizMatch service or route may duplicate its own partial policy check.** The inline suppression
   query at `wizmatchOutreachService.ts:183-189` is deleted, not supplemented — a second check that
   disagrees is worse than no second check.
3. `PolicyDecision` is a **branded type constructible only inside the gate module**, so a caller cannot
   fabricate an allow. Senders accept a `PolicyDecision`, not a boolean.
4. The gate is also the **only** write path for suppression (`suppress()`), so normalisation and the
   append-only event are guaranteed rather than remembered.
5. **Fail closed.** Any error inside the gate — DB, timeout, partially-read ladder, malformed
   persisted enum — resolves to DENY with `policy_resolver_error`, never to last-known-good.
6. Every DENY at a send or export boundary writes a `wizmatch_outreach_events` row with
   `event_type='gate_denied'`.

**Mailbox warm-up is not company outreach.** `sendWarmupEmails` does **not** call company policy — it
targets `WIZMATCH_WARMUP_CONTACTS`, not prospects. But warm-up and normal sending **both** go through
the shared mailbox-health and global sending-safety controls: warm-up currently reads **no**
`wizmatch_domain_health` row at all (`multiDomainMailer.ts:131-148`, contrast `sendColdEmail` at
`:61-71`), so it will happily keep sending from a `paused` or `blacklisted` domain. PR 3 fixes that.

**`POST /api/contacts/bulk-email` must not be an alternate path around WizMatch policy.** For any
contact linked to a WizMatch company it must either invoke the canonical gate or reject that contact,
counting it in the response's skipped list. It may not silently send. The link is resolved through the
real join paths in §8.10.2 — not guessed.

#### 8.10.1 Caller migration checklist — PR 3 must prove every row

Audited against `origin/main` on 2026-07-26. This table is the acceptance evidence for PR 3: each row
is either migrated onto the gate or explicitly classified out of scope, and each carries a test.

**Must call the gate — WizMatch send and enrolment core**

| # | Path | Evidence | Action | State today |
|---|---|---|---|---|
| 1 | `sendColdEmail` | `multiDomainMailer.ts:47` | send | `AUTOMATED_EMAILS_ENABLED` only; **no suppression check**; does not read `WIZMATCH_SENDING_ENABLED` |
| 2 | `sendSignalDraftEmail` | `wizmatchOutreachService.ts:151` | send + follow-up enrol | inline un-normalised suppression query at `:183-189` — **delete it** |
| 3 | WizMatch follow-up enrolment | `wizmatchOutreachService.ts:243` | re-enrol | raw `db.insert(sequenceEnrolments)`, bypasses `enrolContact`, **no check of any kind** |
| 4 | `generateSignalDraftEmails` | `wizmatchOutreachService.ts:31` | queue | no check |
| 5 | `POST /signals/:id/send` | `routes/wizmatch.ts:2861` | send | `WIZMATCH_SENDING_ENABLED` at `:2867` — the only enforcing read of that flag in the repo |
| 6 | `POST /signals/:id/draft` | `routes/wizmatch.ts:2839` | queue | no kill-switch, no suppression |
| 7 | `POST /signals/:id/enrich` | `routes/wizmatch.ts:2808` | enrol | none |
| 8 | `POST /signals/:id/discover-poc` | `routes/wizmatch.ts:2562` | enrol | none |
| 9 | `POST /signals/ingest` | `routes/wizmatch.ts:2759` | queue | internal token only |
| 10 | `POST /classify-reply` | `routes/wizmatch.ts:3690` | retry / re-enrol + suppression write | `NOT_NOW` resets to `sent` at `:3750`; suppression insert at `:3743` **not lowercased** |
| 11 | `POST /contact-intelligence/contacts/:id/link-crm-contact` | `routes/wizmatch.ts:2240` | enrol | none |
| 12 | `POST /contact-intelligence/contacts/:id/review` | `routes/wizmatch.ts:2170` | queue | advisory scoring only |
| 13 | `POST /contact-intelligence/companies/:id/discover` | `routes/wizmatch.ts:2066` | enrol | none |
| 14 | `POST /contact-intelligence/companies/:id/contacts/manual` | `routes/wizmatch.ts:2105` | enrol | none |
| 15 | `POST /companies/:companyId/contacts` | `wizmatchStaffing.ts:154` → `wizmatchStaffingDomain.ts:410` | enrol | none |
| 16 | `POST /requirements/:id/contacts` | `wizmatchStaffing.ts:182` | enrol | none |
| 17 | `POST /requirements/:id/next-action` | `wizmatchStaffing.ts:222` | follow-up | none |
| 18 | `startSequenceWorker` | `workers/sequenceWorker.ts:15`, `:61` | follow-up dispatch | **no check of any kind**; must gate per enrolment and cancel on DENY |

**Must call the gate or reject — shared CRM paths reachable for the WizMatch tenant**

| # | Path | Evidence | Requirement |
|---|---|---|---|
| 19 | `POST /api/contacts/bulk-email` | route `routes/contacts.ts:589`, loop `:645-666`, Brevo call `:651` | Per recipient: resolve the WizMatch link (§8.10.2); if linked, gate or hard-reject and report in `skipped`. Today it reads neither `doNotContact` nor any suppression table |
| 20 | `POST /api/contacts/export` | `routes/contacts.ts:684` | export action — gate, or exclude suppressed rows and stamp the export |
| 21 | `POST /api/email-templates/:id/send-test` | `routes/emailTemplates.ts:198`, send `:255` | arbitrary recipient from the request body, **honours neither kill-switch** — gate on `toEmail` |
| 22 | `POST /api/email/manual` → `sendManualEmail` | `routes/email.ts:69`; `emailService.ts:261` | **honours neither kill-switch** — gate when the contact is WizMatch-linked |
| 23 | `POST /api/email/send` → `sendSequenceEmail` | `routes/email.ts:13`; `emailService.ts:145` | `tenantId` comes from the request body, so a WizMatch tenant id is accepted — gate or reject when `tenantId === WIZMATCH_TENANT_ID` |
| 24 | `POST /api/sequences/enrol` → `enrolContact` | `routes/sequences.ts:86`; `sequenceService.ts:41` | already throws on `do_not_contact` — the repo's only enforcing read of that column. Add the gate alongside it |

**Suppression write paths — must route through the gate's `suppress()`**

| # | Path | Evidence | Defect to fix in the same PR |
|---|---|---|---|
| 25 | Bounce suppression write | `wizmatchBounceParser.ts:63-77`; caller `imapService.ts:144-145` | flag `WIZMATCH_BOUNCE_SUPPRESSION_ENABLED` defaults **off** (A-4); write is correctly `LOWER()`ed |
| 26 | Unsubscribe write | `routes/wizmatch.ts:3611`, tenant at `:3644`, insert `:3651` | writes to `process.env.WIZMATCH_TENANT_ID` rather than the sending tenant; **and the HMAC is minted over the un-lowercased address (`wizmatchOutreachService.ts:200-203`) but verified over the lowercased one (`routes/wizmatch.ts:3612`, `:3630-3632`) — every mixed-case recipient gets a permanently broken unsubscribe link** |
| 27 | `POST /api/wizmatch/suppression` | `routes/wizmatch.ts:3532`, normalise `:3543` | correct today; route through `suppress()` so there is one write path |
| 28 | `GET /api/wizmatch/suppression` | `routes/wizmatch.ts:3504`, filter `:3514` | filter uses the raw query param — lowercase it |
| 29 | The single enforcing suppression **read** | `wizmatchOutreachService.ts:183-189` | neither side is `LOWER()`ed; it works only because `normalizeChannelValue` (`contactService.ts:19`) lowercases channels written through `findOrCreateContact`. Any direct `contact_channels` insert defeats it. **The gate lowercases both sides** |

**Warm-up — company-policy-exempt, mailbox-health-required**

| # | Path | Evidence | Requirement |
|---|---|---|---|
| 30 | `sendWarmupEmails` + its cron | `multiDomainMailer.ts:131`; `worker.ts:1575` | Not company outreach → no company-policy call. But it reads **no** `wizmatch_domain_health` row and honours only `AUTOMATED_EMAILS_ENABLED`. Must skip any inbox whose domain health is not `healthy`, and must honour the same global sending-safety controls as normal sending |

**Explicitly out of tenant — no WizMatch policy applies, recorded so the list is exhaustive**

| Path | Evidence | Why |
|---|---|---|
| `/api/outbound/prospects/*` | `routes/outbound.ts:224+` | Growth prospecting; contains **no send path** — verified by grep, and PR 3 asserts it stays that way |
| `outreach_leads`, Saleshandy upload + stats | `outreachEnrichmentService.ts:205`, `:265`; `saleshandyStatsService.ts:29`; `worker.ts:801` | Growth tenant; the table has **no `tenant_id` at all**. Sending is performed by Saleshandy, not this repo |
| `imapService` **reply-matching** half | `imapService.ts:239-244` | matches Growth `outreach_leads` only |
| SEO / D2C / deals / billing / Cashfree / auth / e-sign email | `seoWeeklyEmailService.ts:99`; `assetDeliveryService.ts:308`; `routes/deals.ts:235`; `routes/billing.ts:528`; `cashfreeEventProcessor.ts:314`, `:331`; `routes/auth.ts:207`; `esign.service.ts:36`, `:52` | transactional or Growth-tenant; correctly exempt |

**Two in-scope surprises found by the audit, recorded so PR 3 does not miss them:**

- The `imapService` **bounce** half is **not** out of tenant. `imapService.ts:142-145` calls
  `recordHardBounce`, which writes `wizmatch_suppression_list` under `WIZMATCH_TENANT_ID`
  (`wizmatchBounceParser.ts:64`, `:68`). One IMAP poller serves both tenants; the WizMatch suppression
  writer rides inside a Growth-tenant service.
- **There is no in-repo `sequence_step` consumer** (grep: only `sequenceWorker.ts:59,63` and
  `systemHealth.ts:292`) and **no WizMatch CSV/export endpoint today**. The follow-up send actually
  happens off-process via `POST /api/email/send`, which is row 23. That is why row 23 is in scope
  despite looking like a Growth route.

#### 8.10.2 Resolving "is this contact WizMatch-linked?"

Four real mechanisms exist. A sound gate needs 1 ∨ 3 ∨ 4; 2 is an unindexed convenience marker.

| # | Mechanism | Evidence | Use |
|---|---|---|---|
| 1 | `wizmatch_company_contacts (tenant_id, company_id, contact_id)` | `schema.ts:1591-1617`; unique `:1615`; `(tenant_id, contact_id)` index `:1613` | **canonical** — indexed reverse lookup |
| 2 | `contacts.metadata->>'wizmatch_company_id'` | written `wizmatchClientLeadLink.ts:20`, `:38`, `:76-84` | unindexed jsonb marker; nothing reads it back today |
| 3 | `wizmatch_contact_candidates.crm_contact_id` + `.company_id` | `schema.ts:1853-1854`, index `:1883` | fallback |
| 4 | `wizmatch_job_signals.contact_id` + `.company_id` | `schema.ts:1349`, `:1368` | fallback — **no index on `contact_id`**, so PR 3 adds one or accepts a scan |

---

## 9. Reason-code taxonomy — ratified 2026-07-26, **corrected 2026-07-26 (spec-repair pass)**

**This section is documentation only.** No database enum and no rows are created by PR 1.

**Freeze rule (owner decision D-8, §25.1 A-29).** The taxonomy is **still correctable during this
documentation PR** — a correction here costs nothing because no row exists. It becomes **stable only
when PR 2 lands database-backed values**. After PR 2:

- Adding a new code is additive and permitted.
- **Renaming or reusing a machine-readable value requires its own migration plus a compatibility
  mapping** from the old value to the new one, because rows, `policy_snapshot` jsonb and the learning
  label set all carry the literal string.
- Labels (the human-readable text) may be reworded freely at any time.

The corrections applied in this pass are the evidence-invariant repairs (D-7) and the preparation-flag
repairs required by §9.11; both are listed in §25.1 A-28 and A-24.

Column meanings — **Scope**: what the code can attach to. **Decision**: what it produces.
**Prep**: whether free preparation may still run. **Evid**: evidence required. **Perm**: may be marked
permanent. **Ovr**: admin override permitted. **Learn**: suitable as a future learning label.

**Cell values are now defined, because three columns were silently three-valued and D-7 cannot be
checked against an undefined cell:**

| Column | Value | Means |
|---|---|---|
| **Evid** | ✅ | Evidence required, supplied by a human — `evidence_kind='human_text'` / `'source_url'` / `'legal_document_ref'` |
| | `auto` | Evidence required and satisfied **automatically**: `evidence_kind='automated_detection'`, `'provider_event_ref'` or `'email_reply_ref'`. Admissible under D-7 for any **deterministic, re-runnable detection whose inputs and output artefact are persisted** — a bounce event, a provider complaint event, an HMAC unsubscribe token, a cost-guard audit row, a confidence-grader output, a duplicate-detection row, a resolver error trace. `auto` **is** evidence; it is never an exemption |
| | ⬜ | No evidence required. **Permitted only when the code is neither permanent nor non-overridable** (invariant 4 and new invariant 7) |
| **Perm** | ✅ / ⬜ | May / may not be marked permanent |
| **Ovr** | ✅ | Admin may override, by writing a superseding policy row (§10.1) |
| | ⬜ | **Non-overridable.** D-7 applies: evidence is required |
| | `n/a` | The code is a **derived decision, not a stored block** — there is no row to override. D-7 does not apply |

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
| `contact_confidence_low` | Low-confidence contact | contact | deny (contact) | ✅ | **auto** | ⬜ | ⬜ | ✅ |
| `contact_unverified` | Unverified contact | contact | deny (contact) | ✅ | **auto** | ⬜ | ⬜ | ✅ |
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

> **Evidence correction (D-7).** `signal_closed`, `signal_expired` and `signal_filled_internally` were
> `Perm ✅ / Evid ⬜` — permanent blocks with no evidence, which invariant 4 forbids and which made the
> block unfalsifiable, since a permanent block never comes up for scheduled review. They are now
> `Evid auto`: the persisted artefact is the posting's source URL plus the ATS/board state that
> produced the inference, both of which the ingest path already stores.

| Code | Label | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|
| `signal_closed` | Role closed | deny (signal) | ✅ | **auto** | ✅ | ✅ | ✅ |
| `signal_expired` | Posting expired | deny (signal) | ✅ | **auto** | ✅ | ✅ | ✅ |
| `signal_filled_internally` | Filled internally | deny (signal) | ✅ | **auto** | ✅ | ✅ | ✅ |
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

> **Preparation correction (H-3).** `policy_resolver_error`, `policy_missing_root` and
> `scope_unresolvable` were `Prep ⬜`, which contradicted invariant 3, contradicted §8.9's
> `preparationAllowed`, and had a concrete operational cost: every newly discovered company begins
> without a root row for as long as it takes the insert transaction to write one, and any resolver
> hiccup would have frozen the free pipeline that exists precisely to surface companies for a human
> decision. They are now **`Prep ✅`**. These codes are fail-closed for every **outbound** action —
> enrol, queue, export, send, follow-up — and preparation is none of those: it spends ₹0, sends
> nothing, and is asserted zero-spend by test (§20.1, O-4). The three now agree.

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `policy_resolver_error` | Policy could not be evaluated | any | deny | **✅** | auto | ⬜ | ⬜ | ⬜ |
| `policy_missing_root` | No company-wide policy exists | company | deny | **✅** | auto | ⬜ | ⬜ | ⬜ |
| `scope_unresolvable` | Policy scope could not be resolved | any | deny | **✅** | auto | ⬜ | ⬜ | ⬜ |
| `preparation_incomplete` | Preparation has not finished | company | review | ✅ | auto | ⬜ | n/a | ⬜ |
| `cost_guard_block` | Blocked by a cost cap | company | deny | ✅ | auto | ⬜ | ⬜ | ⬜ |

### 9.10 `manual_review`

| Code | Label | Scope | Decision | Prep | Evid | Perm | Ovr | Learn |
|---|---|---|---|---|---|---|---|---|
| `manual_approved_by_operator` | Approved by operator | any scope | allow | ✅ | ⬜ | ⬜ | n/a | ✅ |
| `manual_block_by_operator` | Blocked by operator | any scope | deny | ✅ | ✅ | ✅ | ✅ | ✅ |
| `manual_pause_by_operator` | Paused by operator | any scope | deny (temp) | ✅ | ⬜ | ⬜ | ✅ | ⬜ |
| `manual_skip_for_now` | Skipped for now | any scope | review | ✅ | ⬜ | ⬜ | n/a | ✅ |
| `manual_reclassified` | Reclassified by operator | any scope | per new policy | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `manual_admin_override` | Admin override of a standard block | any scope | per new policy | ✅ | ✅ | ⬜ | ✅ | ✅ |
| `manual_lock_release` | Company cold-email lock released manually | company | n/a — informational | ✅ | ✅ | ⬜ | n/a | ⬜ |
| `awaiting_owner_assignment` | Awaiting account-owner assignment | company | review | ✅ | ⬜ | ⬜ | n/a | ⬜ |

Two codes added in the 2026-07-26 spec-repair pass, both because a behaviour existed with no code to
record it: `manual_admin_override` is what an admin override writes now that it is a **superseding
policy row** rather than a mutable `admin_override` boolean (§10.1); `manual_lock_release` is what the
`manually_released` enrolment state writes (§10.6.1), which D-6 requires to carry an actor, a reason
and an audit event.

`manual_block_by_operator`'s `Perm` cell was the non-boolean value `optional`, which contradicted
invariant 1. It is `✅` — "may be marked permanent" already means the operator chooses at write time,
and `Evid ✅` means D-7 is satisfied either way.

### 9.11 Taxonomy invariants

1. Values are **stable and machine-readable**; labels may be reworded freely, values may not. Every
   cell in every table takes one of the values defined in the legend above — there are no ad-hoc cell
   values. Correctability until PR 2 is governed by the freeze rule at the head of §9.
2. Every `compliance` code is non-overridable and permits no preparation except
   `contractual_restriction`.
3. Only two codes stop preparation outside `compliance`: `policy_no_external_agencies` and
   `relationship_irrelevant`. The complete `Prep ⬜` set is therefore exactly **six** codes:
   those two plus `company_removal_request`, `legal_notice`, `regulator_request` and
   `privacy_request_pending`. §8.9's `preparationAllowed` is derived from this set, not from a second
   hand-written list.
4. Every code producing a **permanent** block requires evidence (`Evid` ✅ or `auto`).
5. **Every code producing a non-overridable block (`Ovr` ⬜) requires evidence** (`Evid` ✅ or `auto`).
   *New in the 2026-07-26 pass.* Invariant 4 covered only the permanent half of D-7, so
   `contact_confidence_low` and `contact_unverified` — non-overridable with no evidence — were
   invisible to every invariant and to every test.
6. `email_unsubscribed` and `email_spam_complaint` are never overridable and never used to re-target.
7. Codes marked **Learn ✅** are the label set a future model may consume. Nothing consumes them in
   this release (§2.2).

**Invariants 1–5 are machine-checkable and §20.1 requires a test that parses this section and asserts
them**, rather than a reviewer re-reading ten tables. All five hold as of 2026-07-26; three of them did
not before this pass.

---

## 10. Database schema proposal — migration `0037`, forward-only

Next free migration is **0037**: the journal has 37 entries (idx 0–36), latest
`0036_seo_content_calendar_link`, `when: 1784464092263`. `0037`'s journal `when` **must exceed**
`1784464092263` or the timestamp-ordered migrator silently skips it. All new tables carry
`tenant_id uuid NOT NULL REFERENCES tenants(id)`, UUID PKs, and indexes leading with `tenant_id`,
matching all 32 existing `wizmatch_*` tables.

**`src/db/schema.ts` and `src/db/migrations/` are guarded paths.** Owner approval for this migration
is recorded (§25.1 A-5).

**Generation route.** The migration is produced by the repository's approved generator,
`npm run db:generate`. Where — and **only** where — drizzle-kit cannot express a required construct,
the minimum necessary raw SQL is appended inside a marked guard block, under the process in §10.11.
This is an owner-approved exception (D-3, §25.1 A-24), not a licence to hand-write the migration.

**"Additive" is a claim that must be proven, not asserted.** §10.11 requires the generated SQL to be
read line by line for `DROP`, `ALTER … TYPE`, `SET NOT NULL` and any other destructive statement
before it is committed, because adopting drizzle's `check()` for the first time can make drizzle-kit
propose dropping the three pre-existing hand-written CHECK constraints on Growth's `prospects` and
`signals` tables (`0017_left_war_machine.sql:30-63`), which `schema.ts` does not declare.

### 10.1 `wizmatch_company_policies`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL FK → `tenants` | |
| `company_id` | uuid NOT NULL | **composite FK** `(tenant_id, company_id)` → `wizmatch_companies (tenant_id, id)` |
| `scope_type` | text NOT NULL | `entire_company`,`region`,`business_unit`,`location`,`specific_signal`,`specific_requirement` |
| `scope_key` | text NOT NULL | canonical, normalised — the sole carrier of scope identity |
| `signal_id` | uuid NULL | **composite FK** `(tenant_id, signal_id)` → `wizmatch_job_signals (tenant_id, id)`. Set **only** for `specific_signal` |
| `requirement_id` | uuid NULL | **composite FK** `(tenant_id, requirement_id)` → `wizmatch_requirements (tenant_id, id)`. Set **only** for `specific_requirement` |
| `scope_ref_label` | text NULL | region/BU/location only — normalised text, no FK (these are labels, not entities) |
| `outreach_eligibility` | text NULL | `eligible`,`needs_review`,`paused`,`blocked`. NULL on a scoped row = inherit |
| `external_hiring_policy` | text NULL | the 8 spec values. NULL = inherit |
| `relationship_type` | text NULL | the 8 spec values. NULL = inherit |
| `reason_code` | text NULL | §9 |
| `reason` | text NULL | |
| `evidence_kind` | text NULL | `human_text`,`source_url`,`email_reply_ref`,`provider_event_ref`,`legal_document_ref`,`automated_detection` — the six kinds approved in D-7 |
| `evidence_text` | text NULL | human-entered |
| `evidence_url` | text NULL | SSRF-scrubbed via existing `normalizeDomain()` |
| `evidence_ref` | text NULL | opaque scheme-prefixed pointer: `reply:<uuid>`, `outreach_event:<uuid>`, `provider_event:<id>`, `document:<ref>`, `auto:<detector>` |
| `source` | text NOT NULL | `human`,`import`,`deterministic_rule`,`provider` |
| `actor_user_id` | uuid NULL | **composite FK** `(tenant_id, actor_user_id)` → `users (tenant_id, id)`, `ON DELETE SET NULL` |
| `is_permanent` | boolean NOT NULL default false | blocks scheduled review |
| `block_class` | text NOT NULL default `'standard'` | `standard`,`compliance`,`legal` |
| `is_non_overridable` | boolean NOT NULL default false | what L1/L1c key on |
| `review_date` | date NULL | |
| `created_at` | timestamptz NOT NULL default now() | |
| `superseded_at` | timestamptz NULL | supersession metadata only |
| `superseded_by_policy_id` | uuid NULL | **self composite FK** `(tenant_id, superseded_by_policy_id)` → self `(tenant_id, id)`. Supersession metadata only |

**`admin_override` is deleted from the design** (resolves review H-8). It was a mutable boolean on a
row the same section declares immutable, no gate in §8.2 consulted it, and no CHECK tied it to
`block_class='standard'`. Under D-3 an override *is* a state change, so it must be expressed the same
way every other state change is: **a new superseding policy row** carrying
`reason_code='manual_admin_override'` (§9.10), an actor, and evidence. The service refuses to write a
superseding row over a predecessor with `is_non_overridable = true`. Dropping the column before it
acquires data costs nothing; leaving it would have created a second, unconstrained override path.

**Canonical `scope_key`.** Built only by `buildScopeKey(scopeType, ref)`; lowercased, trimmed,
internal whitespace → `-`:

```
entire_company
region:india                    region:us
business_unit:cloud             location:bengaluru
specific_signal:<uuid>          specific_requirement:<uuid>
```

The UUID in a `specific_*` key is the **lowercased canonical text form** of the referenced UUID, and
must equal the corresponding FK column. That agreement is CHECK-enforced below, so an importer cannot
create a second active row for the same signal under a differently-cased key (resolves review H-5).

```sql
UNIQUE (tenant_id, company_id, scope_key) WHERE superseded_at IS NULL

-- scope identity
CHECK ((scope_type = 'entire_company') = (scope_key = 'entire_company'))
CHECK ((scope_type = 'specific_signal')      = (signal_id      IS NOT NULL))
CHECK ((scope_type = 'specific_requirement') = (requirement_id IS NOT NULL))
CHECK ((scope_type IN ('region','business_unit','location')) = (scope_ref_label IS NOT NULL))
CHECK (scope_type = 'entire_company' OR scope_key LIKE scope_type || ':%')
-- scope_key ↔ FK agreement (H-5)
CHECK (scope_type <> 'specific_signal'      OR scope_key = 'specific_signal:'      || signal_id::text)
CHECK (scope_type <> 'specific_requirement' OR scope_key = 'specific_requirement:' || requirement_id::text)
-- scope_key ↔ label agreement, both already normalised by buildScopeKey()
CHECK (scope_type NOT IN ('region','business_unit','location')
       OR scope_key = scope_type || ':' || scope_ref_label)

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
CHECK (is_non_overridable = false OR outreach_eligibility = 'blocked')
CHECK (block_class = 'standard'   OR outreach_eligibility = 'blocked')
-- §8.3 says compliance and legal are overridable by nobody — make that expressible AND enforced
CHECK (block_class = 'standard'   OR is_non_overridable = true)

-- D-7: every permanent or non-overridable block carries evidence
CHECK ((is_permanent = false AND is_non_overridable = false)
       OR (evidence_kind IS NOT NULL
           AND (evidence_text IS NOT NULL OR evidence_url IS NOT NULL OR evidence_ref IS NOT NULL)))
```

**Non-overridability is no longer confined to `entire_company`** (resolves review H-7). The previous
CHECK forced `is_non_overridable = false` on any narrower row, which made §9.2's
`contractual_restriction` — explicitly scoped to *"company, region, BU"* — inexpressible: a binding
contractual restriction covering one business unit would have been written as an ordinary overridable
restriction and an admin could have overridden a contractual obligation. The gate ladder gains **L1c**
(§8.2) so a non-overridable block at a narrower scope denies within that scope. L1 remains the
company-wide case.

**Evidence is enforced by the database, not only by the service.** The last CHECK is the D-7 invariant.
A permanent or non-overridable block without evidence is rejected by Postgres.

Indexes: `UNIQUE (tenant_id, id)` — **non-partial**, required as the FK target for the self-reference
and for `wizmatch_company_policy_events` (§10.10); `(tenant_id, outreach_eligibility) WHERE superseded_at IS NULL`;
`(tenant_id, company_id) WHERE superseded_at IS NULL`;
`(tenant_id, review_date) WHERE review_date IS NOT NULL AND superseded_at IS NULL`.

`business_unit:cloud` and `business_unit:data` are distinct `scope_key`s, so both stay active; a
second active `business_unit:cloud` is rejected by the database.

**Known limitation, service-enforced.** `wizmatch_job_signals.company_id` and
`wizmatch_requirements.company_id` are both nullable, so the composite FKs guarantee that a
`specific_signal` / `specific_requirement` policy names a signal or requirement **in the same tenant**,
but cannot guarantee it belongs to the **same company** as `company_id`. That agreement is a
service-layer invariant with its own test (§20.1), not an FK.

**Immutability.** Policy *decision content* is immutable; a change is a new superseding row. The only
columns ever updated are `superseded_at` and `superseded_by_policy_id`, enforced three ways: a
service-layer invariant, a DB trigger, and a test asserting the trigger fires. drizzle-kit cannot emit
a trigger (§10.11 proves this against the pinned version), so the trigger is the one construct that
ships as appended raw SQL inside the §10.11 guard block. Rationale and the two-column exception are in
ADR-006 D-10.

### 10.2 `wizmatch_company_policy_events` — append-only

`id, tenant_id, company_id, policy_id, previous_policy_id, from_state jsonb, to_state jsonb,
reason_code, reason, evidence_kind, evidence_text, evidence_url, evidence_ref, actor_user_id, source,
created_at`. No UPDATE or DELETE path.

Composite FKs: `(tenant_id, company_id)` → `wizmatch_companies`; `(tenant_id, policy_id)` and
`(tenant_id, previous_policy_id)` → `wizmatch_company_policies`; `(tenant_id, actor_user_id)` →
`users` `ON DELETE SET NULL`. See §10.10.

### 10.3 `wizmatch_company_duplicates`

`id, tenant_id, company_a_id, company_b_id, similarity numeric, detection_rule text
CHECK IN ('domain','normalised_name'), resolution text NOT NULL default 'pending'
CHECK IN ('pending','merged','confirmed_separate'), resolved_by uuid NULL, resolved_at, created_at`.
`CHECK (company_a_id < company_b_id)`, `UNIQUE (tenant_id, company_a_id, company_b_id)`.

Composite FKs: `(tenant_id, company_a_id)` and `(tenant_id, company_b_id)` → `wizmatch_companies`;
`(tenant_id, resolved_by)` → `users` `ON DELETE SET NULL`.

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
approved_by uuid NULL, approved_at timestamptz NULL,
exported_at, exported_row_count, omitted_row_count, created_by uuid NULL, created_at`.

Composite FKs: `(tenant_id, approved_by)` and `(tenant_id, created_by)` → `users`, both
`ON DELETE SET NULL`. Both columns are **nullable for that reason** — a `RESTRICT`/`NO ACTION`
reference into `users` would block the existing teammate-offboarding path. Who approved and who created
is preserved permanently in the append-only event stream, so nulling the pointer loses no audit fact.
Additive `UNIQUE (tenant_id, id)`, non-partial, as the FK target for
`wizmatch_outreach_enrolments.batch_id` and `wizmatch_outreach_events.batch_id`.

Campaign types cover empanelment, MSP/VMS and re-engagement so **no workflow is ever assigned a fake
staffing type**: an MSP research batch is `campaign_type='msp_vms'`, never `'contract'`.

`approved_by`/`approved_at` back the explicit-approval requirement: when the resolver returns
`review`, the batch API refuses create **and** export until a `team_lead`+ sets them.

### 10.6 `wizmatch_outreach_enrolments`

`id, tenant_id, company_id, contact_id uuid NULL, enrolment_email_key text NULL, batch_id,
campaign_family, campaign_type, outreach_mode, external_lead_ref, state, state_at,
released_by_user_id uuid NULL, release_reason text NULL, policy_snapshot jsonb, created_by uuid NULL,
created_at, updated_at`.

`contact_id` is nullable — `research_only` work is company-level and may have no contact yet.
`enrolment_email_key` is the **lowercased, trimmed** email the enrolment targets, captured at
enrolment time; NULL when there is no contact.

Composite FKs: `(tenant_id, company_id)` → `wizmatch_companies`; `(tenant_id, contact_id)` →
`contacts`; `(tenant_id, batch_id)` → `wizmatch_outreach_batches`; `(tenant_id, created_by)` and
`(tenant_id, released_by_user_id)` → `users` `ON DELETE SET NULL`. Additive `UNIQUE (tenant_id, id)`,
non-partial, as the FK target for `wizmatch_outreach_events.enrolment_id`. See §10.10.

#### 10.6.1 State machine — **revised 2026-07-26 (owner decision D-6)**

```sql
state text NOT NULL CHECK (state IN (
  -- LIVE states: all of these HOLD the company cold-email lock
  'queued','exported','sent','replied','awaiting_action',
  'positive_reply','referral_received','conversation_open',
  -- TERMINAL states: only these RELEASE the lock
  'completed','closed','disqualified','company_blocked',
  'unsubscribed','contact_invalid','manually_released'
))
```

**A reply does not release the lock.** `replied` and every downstream conversation state are LIVE. The
lock is released **only** by an explicit terminal transition. A company must not enter another
cold-email campaign while a live reply or conversation is awaiting action.

Two states from the previous draft are renamed, not deleted — no row exists, so this costs nothing:

| Previous draft | Now | Why |
|---|---|---|
| `bounced` | `contact_invalid` | The enrolment ends because the channel is unusable; the *reason* lives in the suppression row and the event stream, not in the enrolment state name |
| `withdrawn` | `closed`, or `company_blocked` when a company-level block caused it | "Withdrawn" hid *why*; the two causes have different downstream meaning and different reason codes |

`manually_released` **requires** `released_by_user_id`, `release_reason`, and a
`wizmatch_outreach_events` row — it is the only operator-driven lock release, and it is auditable by
construction:

```sql
CHECK (state <> 'manually_released'
       OR (released_by_user_id IS NOT NULL AND release_reason IS NOT NULL))
```

#### 10.6.2 Overlap constraints

```sql
UNIQUE (tenant_id, batch_id, contact_id)
-- 1. ONE live cold-email enrolment per company, across ALL families
UNIQUE (tenant_id, company_id)
  WHERE outreach_mode = 'cold_email' AND state IN (
    'queued','exported','sent','replied','awaiting_action',
    'positive_reply','referral_received','conversation_open')
-- 2. ONE live enrolment per contact row, any mode
UNIQUE (tenant_id, contact_id)
  WHERE contact_id IS NOT NULL AND state IN (
    'queued','exported','sent','replied','awaiting_action',
    'positive_reply','referral_received','conversation_open')
-- 2b. ONE live enrolment per human, keyed on the normalised email (fixes review H-12)
UNIQUE (tenant_id, enrolment_email_key)
  WHERE enrolment_email_key IS NOT NULL AND state IN (
    'queued','exported','sent','replied','awaiting_action',
    'positive_reply','referral_received','conversation_open')
-- 3. no duplicate live non-cold work for the same company + family + mode
UNIQUE (tenant_id, company_id, campaign_family, outreach_mode)
  WHERE state IN (
    'queued','exported','sent','replied','awaiting_action',
    'positive_reply','referral_received','conversation_open')
```

All four predicates use the **same LIVE state list**. Any future state addition must be added to all
four in the same migration; §20.1 pins this with a test that derives the predicate from a single
exported constant rather than repeating the literal.

Constraint 1 is the company-level cold-email lock and is deliberately **family-agnostic**. Constraint
**2b** is new: constraint 2 keys on the contact *row*, so `john@acme.com` and `j.doe@acme.com` as two
contact rows would have let one human receive two cold sequences. Keying additionally on the
normalised email closes that at the database, matching the repo's existing contact-normalisation
invariant (`.trim().toLowerCase()`). Constraint 3 keeps family in the overlap picture for non-cold
modes. Constraints 1 and 3 are non-contradictory — 1 is strictly narrower for `cold_email`. Duplicate
outreach by different team members is caught by the same constraints; the API pre-flights and names the
`created_by` holding the conflict.

`policy_snapshot` records the decision at export time, so a later policy change never retroactively
rewrites what was true then.

### 10.7 `wizmatch_outreach_events`

`id, tenant_id, enrolment_id, batch_id, provider, event_type, event_at, actor_user_id uuid NULL,
external_event_id, external_message_id, external_lead_ref, idempotency_key text NOT NULL,
key_source text CHECK IN
('provider_event_id','provider_message_id','lead_ref_composite','fallback_hash','internal_transition'),
raw jsonb, created_at`.

```sql
event_type text NOT NULL CHECK (event_type IN (
  -- provider-sourced (ADR-007 D-2 result CSV)
  'sent','bounced','replied','unsubscribed','completed',
  -- internal lifecycle transitions (D-6 conversation and terminal states)
  'awaiting_action','positive_reply','referral_received','conversation_open',
  'closed','disqualified','company_blocked','contact_invalid','manually_released',
  -- gate outcomes worth an audit row
  'gate_denied'
))
CHECK (event_type <> 'manually_released' OR actor_user_id IS NOT NULL)
```

`UNIQUE (tenant_id, provider, idempotency_key)` — the idempotent re-import guarantee. Internal
transitions use `key_source='internal_transition'` with a deterministic
`enrolment_id:event_type:event_at` key, so a retried transition is a no-op by constraint, exactly as a
re-imported provider event is.

Composite FKs: `(tenant_id, enrolment_id)` → `wizmatch_outreach_enrolments`; `(tenant_id, batch_id)` →
`wizmatch_outreach_batches`; `(tenant_id, actor_user_id)` → `users` `ON DELETE SET NULL`.

Key derivation, first non-null wins: `external_event_id` → `external_message_id` →
`external_lead_ref:event_type:event_at` → `sha256(batch_ref|email|event_type|event_at)`. Which tier is
actually available is determined by the fixture gate (§25.2 U-6), not assumed. `key_source` is stored
per row so import quality is observable.

### 10.8 Additive ALTERs on existing tables

**`wizmatch_suppression_list`** — add `contact_channel_id uuid NULL` (composite FK
`(tenant_id, contact_channel_id)` → `contact_channels`) and
`channel_invalid boolean NOT NULL default false`. This marks a channel invalid inside the
WizMatch-owned table rather than adding columns to the shared core CRM `contact_channels`, which
Growth also uses — though a composite FK does require an additive **index** on `contact_channels`
(§10.10), which the previous draft did not acknowledge.

> **`suppression_scope` is deleted from the design.** The previous draft added
> `suppression_scope IN ('email','contact')` so one table could hold two grains. Owner decision D-4
> rejects that: `wizmatch_suppression_list` stays an **exact email/channel** suppression table. See
> §10.9 for the revised three-grain model. This is what makes `0037` **additive again** — the
> existing `UNIQUE (tenant_id, email)` index is not dropped, not replaced, and needs no production
> dedup dry-run (resolves review C-5).

**`wizmatch_companies`** — add `account_owner_user_id uuid NULL`. Tenancy is enforced by the database,
not only the service, because a plain `REFERENCES users(id)` would permit a cross-tenant owner:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_id_id_uniq ON users (tenant_id, id);
ALTER TABLE wizmatch_companies
  ADD COLUMN IF NOT EXISTS account_owner_user_id uuid;
ALTER TABLE wizmatch_companies
  ADD CONSTRAINT wizmatch_companies_account_owner_fk
  FOREIGN KEY (tenant_id, account_owner_user_id) REFERENCES users (tenant_id, id)
  ON DELETE SET NULL;
```

`ON DELETE SET NULL` is required on **every** reference into `users`. Without it the constraint
defaults to `NO ACTION`, and the first teammate offboarding would be blocked by a WizMatch foreign key
— a guarded-path operation broken by a WizMatch-local design choice.

**Defensive guards are mandatory on both ALTERs** (resolves review H-11). `0036_seo_content_calendar_link.sql:8-14`
records the `0035` lesson verbatim: production tables had drifted, `db:generate` diffs against
`0036_snapshot.json` rather than production, so an unguarded statement applied cleanly locally and
failed mid-migration in production. Every §10.8 statement uses `IF NOT EXISTS` / `IF EXISTS`, and
§10.11 requires the generated SQL to be diffed against production `information_schema` before G1.

Every ownership change writes an `audit_events` row via the existing `auditLogger` **and** a
`wizmatch_staffing_events` row (`event_type='company_owner_changed'`, carrying previous and new owner)
so it appears on the company timeline beside policy history.

**No column changes to `wizmatch_company_intelligence`.** Its `status` keeps its current writer during
transition. It is **not** consulted for any outreach decision (§11.3, D-1); it is displayed as legacy
historical context only. Nothing legacy is dropped.

### 10.9 Revised suppression model — **owner decision D-4**

Suppression has three grains. They are **not** forced into one database grain. Each grain has exactly
one home for its *effective* state, and one shared append-only stream for its *history*.

| Grain | Effective state lives in | What sets it | What it blocks |
|---|---|---|---|
| **exact email / channel** | a `wizmatch_suppression_list` row, `UNIQUE (tenant_id, email)` retained | hard bounce · invalid email · spam complaint · unsubscribe where the exact email is known | that email / channel **only** |
| **contact (person)** | `contacts.do_not_contact = true` **plus** an audit row and a suppression event | personal unsubscribe · spam complaint · operator DNC · the generic CRM `PATCH /api/contacts/:id` | every cold email to that person, on every channel |
| **company** | a `wizmatch_company_policies` `entire_company` row: `blocked`, `block_class='compliance'`, `is_non_overridable`, `is_permanent`, with evidence | company removal request | the whole company (§8.2 L1) |

**One effective row per email.** The existing `UNIQUE (tenant_id, email)` index is retained, not
dropped. A second suppression event for the same address is an **idempotent upsert onto the same row**:
it may strengthen the row — set `channel_invalid`, attach `contact_channel_id`, record a later
`suppressed_at` — but it never creates a second effective row, and it never silently discards the
earlier fact, because every cause is appended to `wizmatch_suppression_events` in order.

Reason precedence on the row is a **reporting** question, not a permission question: every reason this
table can hold yields the identical effect — deny for that email — so the row keeps the first cause and
the event stream carries all of them.

| Event | `wizmatch_suppression_list` | `contacts.do_not_contact` | Company policy | Enrolments |
|---|---|---|---|---|
| **Hard bounce** | upsert that exact email, `reason='hard_bounce'`, `contact_channel_id` set, `channel_invalid=true` | **not set** | untouched | that enrolment → `contact_invalid` |
| **Invalid email / unresolvable domain** | upsert, `reason='invalid_email'`, `channel_invalid=true` | **not set** | untouched | that enrolment → `contact_invalid` |
| **Spam complaint** | upsert, `reason='spam_complaint'` | **set true** | untouched | that enrolment → `unsubscribed` |
| **Personal unsubscribe** | upsert when the exact email is known, `reason='unsubscribe'` | **set true** | **untouched** | that enrolment → `unsubscribed` |
| **Company removal request** | — | — | new `entire_company` compliance block, non-overridable, permanent, evidence required | **all live** enrolments → `company_blocked`; future follow-ups stopped |

A hard bounce is a channel-quality fact, not a stated preference — it must not silently mark a whole
person do-not-contact. An unsubscribe is a stated personal preference — it must not silently block
their employer. A spam complaint is both a channel fact and a stated preference, so it sets both, and
is never overridable.

#### 10.9.1 `wizmatch_suppression_events` — append-only history

`id, tenant_id, grain text CHECK IN ('email','contact','company'), email text NULL, contact_id uuid NULL,
contact_channel_id uuid NULL, company_id uuid NULL, enrolment_id uuid NULL, reason_code text NOT NULL,
evidence_kind, evidence_text, evidence_url, evidence_ref, source text NOT NULL, actor_user_id uuid NULL,
external_event_ref text NULL, created_at`. No UPDATE and no DELETE path.

```sql
CHECK (grain <> 'email'   OR email      IS NOT NULL)
CHECK (grain <> 'contact' OR contact_id IS NOT NULL)
CHECK (grain <> 'company' OR company_id IS NOT NULL)
```

Composite FKs on `contact_id`, `contact_channel_id`, `company_id`, `enrolment_id` and `actor_user_id`
(§10.10). **This table is history and is never consulted as effective state** — a resolver that read it
would reintroduce the multi-row-per-email ambiguity D-4 exists to prevent.

`email` here is stored lowercased and trimmed, matching the repo's contact-normalisation invariant.

### 10.10 Tenant-reference matrix

**Every new cross-table reference that names a real entity uses a composite foreign key
`(tenant_id, <ref_id>) → parent (tenant_id, id)`.** The repo has zero composite FKs today
(`foreignKey(` appears 0 times in `schema.ts`), so PR 2 pays the cost of introducing the pattern
regardless; applying it to one column instead of all of them buys almost none of the benefit
(resolves review C-3).

All 22 entity references below are composite-FK-feasible — **none** falls back to service-layer-only
validation. Verified against `src/db/schema.ts` on 2026-07-26.

| New column | In table | References | Parent `tenant_id` | Mechanism | `ON DELETE` |
|---|---|---|---|---|---|
| `company_id` | `wizmatch_company_policies` | `wizmatch_companies` | `schema.ts:1313` | composite FK | CASCADE |
| `signal_id` | `wizmatch_company_policies` | **`wizmatch_job_signals`** | `schema.ts:1348` | composite FK | CASCADE |
| `requirement_id` | `wizmatch_company_policies` | `wizmatch_requirements` | `schema.ts:1534` | composite FK | CASCADE |
| `actor_user_id` | `wizmatch_company_policies` | `users` | `schema.ts:450` | composite FK | SET NULL |
| `superseded_by_policy_id` | `wizmatch_company_policies` | self | new | self composite FK | SET NULL |
| `company_id` | `wizmatch_company_policy_events` | `wizmatch_companies` | `schema.ts:1313` | composite FK | CASCADE |
| `policy_id` | `wizmatch_company_policy_events` | `wizmatch_company_policies` | new | composite FK | RESTRICT |
| `previous_policy_id` | `wizmatch_company_policy_events` | `wizmatch_company_policies` | new | composite FK | SET NULL |
| `actor_user_id` | `wizmatch_company_policy_events` | `users` | `schema.ts:450` | composite FK | SET NULL |
| `company_a_id` | `wizmatch_company_duplicates` | `wizmatch_companies` | `schema.ts:1313` | composite FK | CASCADE |
| `company_b_id` | `wizmatch_company_duplicates` | `wizmatch_companies` | `schema.ts:1313` | composite FK | CASCADE |
| `resolved_by` | `wizmatch_company_duplicates` | `users` | `schema.ts:450` | composite FK | SET NULL |
| `approved_by` | `wizmatch_outreach_batches` | `users` | `schema.ts:450` | composite FK | SET NULL |
| `created_by` | `wizmatch_outreach_batches` | `users` | `schema.ts:450` | composite FK | SET NULL |
| `company_id` | `wizmatch_outreach_enrolments` | `wizmatch_companies` | `schema.ts:1313` | composite FK | CASCADE |
| `contact_id` | `wizmatch_outreach_enrolments` | `contacts` | `schema.ts:38` | composite FK | SET NULL |
| `batch_id` | `wizmatch_outreach_enrolments` | `wizmatch_outreach_batches` | new | composite FK | RESTRICT |
| `created_by`, `released_by_user_id` | `wizmatch_outreach_enrolments` | `users` | `schema.ts:450` | composite FK | SET NULL |
| `enrolment_id` | `wizmatch_outreach_events` | `wizmatch_outreach_enrolments` | new | composite FK | CASCADE |
| `batch_id` | `wizmatch_outreach_events` | `wizmatch_outreach_batches` | new | composite FK | RESTRICT |
| `actor_user_id` | `wizmatch_outreach_events` | `users` | `schema.ts:450` | composite FK | SET NULL |
| `contact_id`, `contact_channel_id`, `company_id`, `enrolment_id`, `actor_user_id` | `wizmatch_suppression_events` | `contacts`, `contact_channels`, `wizmatch_companies`, `wizmatch_outreach_enrolments`, `users` | `:38`, `:72`, `:1313`, new, `:450` | composite FK | SET NULL |
| `contact_channel_id` | `wizmatch_suppression_list` (ALTER) | `contact_channels` | `schema.ts:72` | composite FK | SET NULL |
| `account_owner_user_id` | `wizmatch_companies` (ALTER) | `users` | `schema.ts:450` | composite FK | SET NULL |

**Non-entity references — deliberately not FKs:**

| Reference | Mechanism | Why no FK |
|---|---|---|
| `scope_key` | canonical string built only by `buildScopeKey()`, CHECK-tied to `scope_type` and to the FK column or label (§10.1) | It is scope *identity*, not a row pointer. Two business units must both be able to hold active policies |
| `scope_ref_label` for `region` / `business_unit` / `location` | normalised text, CHECK-constrained (`region IN ('india','us')`), agreement with `scope_key` CHECK-enforced | These are labels with no source table (see §8.1.1) |
| `enrolment_email_key` | lowercased/trimmed email captured at enrolment | Denormalised on purpose — it must survive the contact row being merged or re-pointed |

**`scope_ref_id` is deleted.** A single nullable uuid that might point at `wizmatch_job_signals`, at
`wizmatch_requirements`, or at nothing, cannot carry a foreign key in any dialect — which is precisely
why the previous draft left it with none, and why a `specific_signal` policy could have named a signal
in another tenant, or no signal at all. It is replaced by two typed, tenant-safe columns (D-2).

**Naming trap.** The signals table is **`wizmatch_job_signals`** (`schema.ts:1344`). The table called
`signals` (`schema.ts:1241`) is Growth's prospect-scoped table and **has no `tenant_id` at all** — a
composite FK to it is impossible and a reference to it would be cross-product. PR 2 must name
`wizmatch_job_signals` explicitly in `schema.ts` and in the migration.

#### 10.10.1 Additive parent indexes required

A composite FK needs a **plain, non-partial** UNIQUE index on the parent. Six additive indexes on
existing tables, three shipped inline with the new tables:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_id_id_uniq            ON users            (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_id_id_uniq         ON contacts         (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS contact_channels_tenant_id_id_uniq ON contact_channels (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS wizmatch_companies_tenant_id_id_uniq    ON wizmatch_companies    (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS wizmatch_job_signals_tenant_id_id_uniq  ON wizmatch_job_signals  (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS wizmatch_requirements_tenant_id_id_uniq ON wizmatch_requirements (tenant_id, id);
-- new tables carry theirs in their own CREATE:
--   wizmatch_company_policies, wizmatch_outreach_batches, wizmatch_outreach_enrolments
```

**None of these can fail or reject a write** — `id` is already the primary key, so `(tenant_id, id)` is
trivially unique on every existing row. Three of them (`users`, `contacts`, `contact_channels`) are on
**core CRM tables shared with the Growth tenant**, which makes them a guarded-path change requiring
explicit owner sign-off at G1, not a WizMatch-local detail (resolves review M-3). The index build takes
a brief write lock; at current row counts that is sub-second, and the G1 checklist (§10.11) requires it
to be measured on a production-sized restore rather than assumed.

**Do not add `.where(...)` to any of them.** Postgres rejects a partial unique index as a foreign-key
target, and this repo uses partial unique indexes heavily enough (`0025:138,142`, `0026:3,4`,
`0028:205,215`, `0034:131`) that copying an existing one is a live trap.

#### 10.10.2 What composite FKs do **not** guarantee

Stated explicitly so PR 2 does not over-trust them:

- `wizmatch_outreach_enrolments.(company_id, contact_id)` are each tenant-consistent, but nothing
  forces the contact to belong to that company. That link lives in `wizmatch_company_contacts`
  (`schema.ts:1591-1617`) and is a service-layer invariant with its own test.
- `wizmatch_job_signals.company_id` and `wizmatch_requirements.company_id` are both **nullable**, so a
  `specific_signal` / `specific_requirement` policy is guaranteed same-tenant but not same-company.
  Service-layer invariant plus test.
- `contact_channels_unique_idx` (`schema.ts:84-88`) is on `(contact_id, channel_type, channel_value)`
  and **excludes `tenant_id`**. It is not reusable as an FK target and must not be mistaken for one.

### 10.11 Migration generation, the raw-SQL exception, and fresh-database verification

#### 10.11.1 What drizzle-kit can and cannot emit

Verified 2026-07-26 against the pinned `drizzle-kit@0.31.10` / `drizzle-orm@0.45.2`:

| Construct | Emittable by `db:generate`? | Evidence |
|---|---|---|
| Composite FK `(tenant_id, x_id) → parent(tenant_id, id)` | **yes** — `foreignKey()` takes multi-column `columns`/`foreignColumns` | `drizzle-orm/pg-core/foreign-keys.d.ts:39`. No repo precedent (0 uses) — new but supported |
| Partial UNIQUE index with `WHERE` | **yes**, with repo precedent | `schema.ts:1379-1384` → `0026_flashy_sersi.sql:3-4`; `schema.ts:2338` → `0034_lame_proemial_gods.sql:131` |
| CHECK constraint | **yes** technically — `check()` exists at `drizzle-orm/pg-core/checks.d.ts:18` | **but zero repo precedent**: 0 `check(` in `schema.ts`; the only CHECKs in the repo are hand-written DO blocks in `0017_left_war_machine.sql:30-63`. See the drift warning below |
| **`CREATE TRIGGER`** | **no** — drizzle-kit has no trigger primitive | 0 `CREATE TRIGGER` and 0 `CREATE OR REPLACE FUNCTION` across all 37 migrations |

So exactly **one** required construct — the policy-immutability trigger — cannot be generated. That is
the whole of the exception (resolves review C-4).

#### 10.11.2 The raw-SQL exception — owner-approved process (D-3)

Hand-authored SQL is approved for `0037` **only** where drizzle-kit cannot generate the required
construct. The process is fixed and all six steps are mandatory:

1. **Generate** the migration with the repository's approved generator, `npm run db:generate`.
2. **Append the minimum required raw SQL** — nothing that drizzle-kit could have produced.
3. **Place it in a clearly marked guard block** at the end of the file:
   ```sql
   -- >>> BEGIN MANUAL GUARD BLOCK (0037) — NOT GENERATED BY drizzle-kit
   -- Reason: drizzle-kit 0.31.10 has no trigger primitive (PRD-005 §10.11.1).
   -- Scope: policy-immutability trigger only. No DDL below this line touches any other object.
   ...
   -- <<< END MANUAL GUARD BLOCK (0037)
   ```
4. **Test it on a fresh local database** — full `0000 → 0037` replay, §10.11.4.
5. **Verify it contains no destructive statements** — §10.11.3.
6. **Document why drizzle-kit could not generate it**, in the block comment and in the PR description,
   citing §10.11.1.

The previous draft's *"Generation goes through `npm run db:generate` — never a hand-written SQL file"*
was both unachievable (it forbade the trigger the same document requires) and factually wrong as a
description of the repo: 22 of 37 migrations contain hand-authored SQL, and `0017_left_war_machine.sql:30-31`
says so in a comment. It is restated above as a **standard with one documented exception**, not as a
description of the status quo (resolves review C-4 and M-9).

**What the immutability trigger does.** Raises on any `UPDATE` to `wizmatch_company_policies` that
touches any column other than `superseded_at` and `superseded_by_policy_id`. Policy decision columns
are immutable; a changed decision is a **new policy row plus a policy event** (D-3, ADR-006 D-10).
Enforced three ways: service-layer invariant, this trigger, and a test asserting the trigger fires.

#### 10.11.3 Destructive-statement verification — blocking before commit

The generated SQL is read line by line and the following must all be **zero occurrences** outside an
explicitly approved, separately reviewed hunk:

`DROP TABLE` · `DROP COLUMN` · `DROP CONSTRAINT` · `DROP INDEX` · `ALTER COLUMN … TYPE` ·
`SET NOT NULL` · `TRUNCATE` · `DELETE FROM` · `UPDATE …` (data DML)

**The specific, non-theoretical risk:** adopting drizzle's `check()` for the first time makes
drizzle-kit start managing `checkConstraints`, and it may propose **dropping the three pre-existing
hand-written CHECK constraints** on Growth's `prospects` and `signals` tables
(`prospects_icp_segment_chk`, `prospects_status_chk`, `signals_signal_type_chk` —
`0017_left_war_machine.sql:32-63`), because `schema.ts` does not declare them. That is the concrete
mechanism by which an "additive" WizMatch migration could silently damage Growth. PR 2 must either
declare those three constraints in `schema.ts` so drizzle-kit sees no drift, or prove on a scratch
schema that no DROP is emitted — and say which, with the generated diff, in the PR description.

`0037` is expected to contain **no destructive statement at all**. §10.8's suppression change is
additive again now that `suppression_scope` is gone (§10.9), so the existing
`UNIQUE (tenant_id, email)` index is not dropped and no production dedup dry-run is needed.

#### 10.11.4 Fresh-database verification requirements — blocking before G1

All of the following are run and their real output recorded in the PR before `0037` is proposed for
production:

1. **Fresh replay.** Drop and recreate an empty local database; apply `0000 → 0037` in order; exit 0.
2. **Incremental apply.** Restore a local database at `0036`; apply `0037` alone; exit 0.
3. **Re-apply idempotency.** Run the migrator twice against the same database; the second run is a
   no-op.
4. **Journal ordering.** `0037`'s `when` **exceeds `1784464092263`** (the `0036` value). The migrator is
   timestamp-ordered with no hash integrity — a lower value is silently skipped.
5. **Drift diff against production DDL.** Diff the generated SQL against production
   `information_schema` — **not** against `0036_snapshot.json`, which is what `db:generate` compares to
   and is exactly how `0035` broke (`0036_seo_content_calendar_link.sql:8-14`). Read-only query; no
   production write.
6. **Destructive-statement scan** (§10.11.3) — zero hits.
7. **Guard-block audit** — every raw statement is inside the marked block, and the block contains
   nothing drizzle-kit could have generated.
8. **Round-trip proof.** `check()` and `foreignKey()` round-trip through the pinned drizzle-kit on a
   scratch schema, with the generated SQL attached to the PR (resolves review M-8).
9. **Lock measurement.** The six `(tenant_id, id)` index builds are timed on a production-sized
   restore, including the three on shared core tables (§10.10.1).
10. **Trigger test.** An `UPDATE` to a decision column raises; an `UPDATE` to `superseded_at` /
    `superseded_by_policy_id` succeeds.

Local `db:migrate` targets a local or scratch database only. **`0037` is never applied to production
from a developer machine** — production migrates on Railway boot, and applying it at all is gate G1
(§21), an explicit owner decision.

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

   Two machine guards, because "~131 expected" is a human eyeball (resolves review M-6): the script
   **aborts before writing** if the live count deviates from the dry-run count by more than a
   configurable tolerance, and a second `--apply` is a **no-op by construction** — it inserts only
   where no active `entire_company` row exists, so re-running writes zero rows. Both are asserted by
   test (§20.1).

   The backfill is a **safety net, not the primary mechanism**: §8.1 requires the root row to be
   written in the same transaction as every company insert, so the backfill only covers companies that
   predate PR 2. The dry-run report and the §21.1 readiness report measure the same quantity — policy
   coverage — and G2 requires their counts to agree before `--apply` (resolves review L-3).
3. **Compatibility adapter — fail-closed, no legacy fallback.** `resolveCompanyStatus(companyId)`
   returns the policy-derived status **only**. When a company has no active `entire_company` policy
   row it returns `decision = 'deny'` with `reasonCode = 'policy_missing_root'`. It **never** falls
   back to `wizmatch_company_intelligence.status`, or to any other legacy status, for an outreach
   decision. All five existing eligibility computations (§5.2 C-2) migrate onto it. Legacy writers
   stay live and untouched, but their output is no longer authoritative.

   **Legacy intelligence status is historical context for display only.** `wizmatch_company_intelligence.status`
   may be rendered on a company card, in a timeline, or in a migration report, labelled as legacy. It
   must never grant preparation, enrolment, export, sending or follow-up permission. Owner decision
   D-1, 2026-07-26 (§25.1 A-22). The corrected behaviour is pinned by the test in §20.1
   ("compatibility adapter — missing root").
4. **Constraints are tightened only after clean production evidence.** Nothing is made stricter
   retroactively.
5. **Forward-only.** ADR-005's `0008`/`0014` exception is explicitly not a precedent; no already-applied
   migration is edited.

---

## 12. API contracts

All routes tenant-scoped from `req.user.tenantId`, RBAC-gated per §4, and audited. **Every route that
enrols, queues, exports, sends, follows up, retries or re-enrols calls
`assertWizmatchOutreachAllowed` (§8.10) — no route implements its own partial check.**

**Policy**
```
GET    /api/wizmatch/companies/:id/policy
       → { effective: {...}, scoped: [...], history: [...] }
POST   /api/wizmatch/companies/:id/policy
       body { scopeType, signalId?, requirementId?, scopeRefLabel?, outreachEligibility?,
              externalHiringPolicy?, relationshipType?, reasonCode, reason?,
              evidenceKind?, evidenceText?, evidenceUrl?, evidenceRef?,
              isPermanent?, isNonOverridable?, reviewDate?, blockClass? }
       → supersedes the matching row + writes a policy event.                       team_lead+
POST   /api/wizmatch/companies/:id/policy/override                                  admin, evidence required
       → writes a NEW superseding row with reasonCode='manual_admin_override'.
         Refused when the predecessor has is_non_overridable = true.
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

**Export re-evaluates policy per row at export time** through the canonical gate, and omits any DENY,
recording each omission with its reason code in the batch report. The export is never a stale snapshot
of an earlier decision.

**Lock release is an explicit, audited action, not a side effect.**

```
POST   /api/wizmatch/outreach/enrolments/:id/transition
       body { toState, reasonCode, reason?, evidenceKind?, evidenceText?, evidenceRef? }
       → writes the state + a wizmatch_outreach_events row.                         team_lead+
         toState='manually_released' additionally requires reason and records the actor.
```

An import may move an enrolment between **live** states (§10.6.1) but may **never** write a
lock-releasing terminal state — releasing a company for a second cold-email campaign is a human
decision, not a CSV row (D-6).

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
| **Replies Needing Action** | `wizmatch_outreach_enrolments.state IN ('replied','awaiting_action','positive_reply','referral_received','conversation_open')` — every live conversation state, since all of them hold the company lock (§10.6.1) |
| **Paused or Blocked** | policy `paused` or `blocked`, grouped by block class |

Six actions, presented contextually:

| Company state | Primary | Secondary | More menu |
|---|---|---|---|
| `eligible`, prepared, high-confidence | **Approve & Queue** | Skip for Now | Pause · Block/Reclassify · Assign Owner · Set Review Date |
| `needs_review` | **Approve & Queue** | Skip for Now | Pause · Block/Reclassify · Assign Owner · Set Review Date |
| `paused` | **Resume** | Set Review Date | Block/Reclassify · Assign Owner |
| `blocked`, `is_non_overridable = false` | **Reclassify** (admin) | Assign Owner | Set Review Date |
| `blocked`, `is_non_overridable = true` | *(none)* | Assign Owner | Set Review Date |
| duplicate suspected | **Merge** | Confirm Separate | Assign Owner · Set Review Date |
| routed (`msp_vms_only`, `preferred_vendors_only`, `existing_client`, …) | **Open Route** | Skip for Now | Pause · Block/Reclassify · Assign Owner · Set Review Date |

Approve & Queue is **disabled with an inline reason** — never silently hidden — when
`allowedCampaignTypes` is empty or contact confidence is below the cold-start threshold.

Blocking and reclassifying require a structured reason code; evidence is required for `block` and for
any admin override. **A row with `is_non_overridable = true` shows neither an override nor a Reclassify
affordance, at any scope** — the previous draft removed only the *override* button while still offering
Reclassify as the primary action on every `blocked` company, so the UI advertised an action the
resolver must refuse on a `company_removal_request` (resolves review H-10).

**State precedence, because a company can be in two states at once** (resolves review M-10). The rows
above are evaluated top-down, first match wins, and the ordering is: non-overridable block → overridable
block → pending duplicate → paused → routed → `needs_review` → `eligible`. A duplicate-suspected company
is L5-denied for queue and export, so it must never render the `eligible` row and offer Approve & Queue.
`needs_review` renders Approve & Queue as primary, but the action opens the approval capture that sets
`approved_by`/`approved_at` — a `review` decision cannot be queued or exported without them (§8.6,
§10.5).

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

**Shadow-mode semantics, specified rather than implied** (resolves review M-4 and L-4):

1. Shadow **always evaluates the full gate ladder**, L0 through L8. It never short-circuits — a
   short-circuiting shadow would under-report exactly the deep-ladder blocks the readiness report
   exists to measure.
2. Shadow logs the decision and, for a would-block, writes a `gate_denied` observation. It blocks
   nothing.
3. **Any value of `WIZMATCH_POLICY_ENFORCEMENT_MODE` other than the exact string `enforce` is treated
   as `shadow`** — unset, misspelled, empty, mixed-case. Fail safe, not fail open.
4. The mode is read **per request**, not cached at boot, so a flip takes effect without a restart and
   the observed log is never stale.
5. **A mode flip is audited.** It is an env change, so §18.2's "every policy mutation writes an audit
   row" does not otherwise cover it: the resolver records the mode on every decision, and a change in
   the observed value emits a Slack alert to `WIZMATCH_SYSTEM_CHANNEL`.

`OUTREACH_PROVIDER` defaults to `smartlead_csv`, which is a **real** provider name, safe today only
because `WIZMATCH_OUTREACH_ADAPTER_ENABLED=false`. Two independent gates are required: if the adapter
flag is on and `OUTREACH_PROVIDER` is unset or unrecognised, the factory **throws at startup** rather
than silently selecting a default (resolves review M-7).

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
inboxes"*, and **that code is unchanged today** — `WIZMATCH_MAILER_EMERGENCY_OVERRIDE` does not exist
in the repo yet. This PRD reverses the behaviour **in PR 3**: with no healthy inbox the sender will
fail closed unless `WIZMATCH_MAILER_EMERGENCY_OVERRIDE=true`, which will log and Slack-alert on every
use.

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
- **Suppression split (D-4):** hard bounce suppresses the exact email/channel, sets `channel_invalid`,
  and does **not** set `contacts.do_not_contact`; unsubscribe sets `do_not_contact` **and** writes the
  exact-email suppression row when the email is known, and does **not** block the company; spam
  complaint sets both and is not overridable; removal request creates a permanent, non-overridable
  compliance block with evidence and moves all **live** enrolments to `company_blocked`.
- **One effective row per email:** a bounce followed by an unsubscribe for the same address produces
  **one** `wizmatch_suppression_list` row (upsert, no unique-index violation, neither fact lost) and
  **two** `wizmatch_suppression_events` rows. This is the C-5 regression test.
- **Suppression normalisation:** a mixed-case `channel_value` is matched by its own suppression row —
  both sides lowercased at read; the `classify-reply` write path lowercases; the unsubscribe HMAC is
  minted and verified over the same lowercased address.
- **Compatibility adapter — missing root (C-2 regression):** a company with **no** policy row and a
  legacy `wizmatch_company_intelligence.status='approved'` resolves `deny` /`policy_missing_root`.
  Pin `resolveCompanyStatus()` directly; this is the test whose absence let C-2 through.
- **Gate chokepoint (D-5):** every path in the §8.10.1 checklist has a test proving it calls the gate
  or is explicitly out of scope; a `PolicyDecision` cannot be constructed outside the gate module;
  `POST /contacts/bulk-email` with one WizMatch-linked and one Growth contact performs exactly one
  provider call and reports the other as skipped; `sendWarmupEmails` skips an inbox whose domain health
  is not `healthy`; a suppression written **between** enrolment and send is honoured at the send
  boundary (the TOCTOU case).
- **Replied lock (D-6):** a company in `replied`, `awaiting_action`, `positive_reply`,
  `referral_received` or `conversation_open` **cannot** be enrolled in a second cold-email campaign;
  each of the seven terminal states releases the lock; `manually_released` without an actor or reason
  is rejected by the CHECK; an import cannot write a lock-releasing terminal state; all four partial
  indexes derive their predicate from one exported constant.
- **Two contact rows, one human (H-12):** `john@acme.com` and `j.doe@acme.com` normalising to distinct
  keys both enrol; the **same** address on two contact rows is rejected by constraint 2b.
- **Evidence invariants (D-7):** a permanent or non-overridable policy row without evidence is rejected
  by the database CHECK; a test parses §9 and asserts invariants 1–5 mechanically, including the new
  invariant 5 (non-overridable ⇒ evidence) and the derived `preparationAllowed` set.
- **Scope applicability (H-4):** a `location:bengaluru` pause denies a Bengaluru signal; a
  `business_unit` row denies a request that carries no business-unit label, with
  `scope_unresolvable` — it is never silently ignored.
- **Scope-key ↔ FK agreement (H-5):** an uppercase-UUID `specific_signal` key is rejected by the CHECK;
  `"Cloud Ops"` and `"cloud-ops"` are the same key by construction and the second write is rejected as
  a duplicate rather than silently shadowing the first.
- **Tenant isolation of the resolver:** resolving company X as tenant B never returns tenant A's policy;
  the readiness report is tenant-scoped; a bulk policy write cannot span tenants; each of the 22
  composite FKs rejects a cross-tenant reference.
- **Fail-closed on partial failure:** resolver timeout; root row readable but the `location` row read
  fails; a malformed enum already persisted. Each asserts DENY, never last-known-good.
- **Shadow-vs-enforce equivalence:** a fixture corpus run through both modes produces identical
  decision logs and identical side effects except the block itself. This is what makes G3's "zero
  behavioural change confirmed" mechanical rather than an eyeball.
- **Concurrency:** two concurrent enrolment writes for one company; two simultaneous policy
  supersessions (one loses cleanly); backfill `--apply` racing company creation; duplicate resolution
  racing an enrolment.
- **Backfill:** a second `--apply` writes zero rows; a count deviation beyond tolerance aborts before
  writing.
- **Readiness correctness:** a company created after the backfill still has a root policy row, because
  §8.1 requires it in the insert transaction (M-5).
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
| **G1** | Apply `0037` to production | PR 2 reviewed; **all ten §10.11.4 verification requirements run with real output recorded**; zero destructive statements (§10.11.3); guard block audited; owner sign-off on the three shared-table indexes (§10.10.1) |
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
2. **No pending duplicate has a live outreach enrolment** — `state` in any of the eight lock-holding
   states of §10.6.1, **including the five conversation states**. Using the old three-state predicate
   would have let a duplicate with an open conversation pass the gate.
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

`package-lock.json` is modified in the audit worktree by unrelated local churn and **must not be
staged** — committing it reverts CI hotfix `492a6a8` and re-breaks `npm ci`.

### 22.2 PR 2 acceptance criteria — **revised 2026-07-26**

PR 2 is `schema.ts` + migration `0037` + the policy resolver and gate module. **No callers migrate in
PR 2.** It is done when every one of these is true and evidenced in the PR description:

**Schema**

1. Seven new tables per §10.1–§10.7 and §10.9.1, each with `tenant_id uuid NOT NULL REFERENCES tenants(id)`
   and indexes leading with `tenant_id`.
2. **All 22 cross-table entity references are composite FKs** per the §10.10 matrix. Zero naked
   single-column FKs to an entity. `scope_ref_id` does not exist; `signal_id` and `requirement_id` do,
   and `signal_id` references **`wizmatch_job_signals`**, not Growth's `signals`.
3. The six additive `(tenant_id, id)` unique indexes of §10.10.1 exist, are **non-partial**, and use
   `IF NOT EXISTS`.
4. Every reference into `users` is `ON DELETE SET NULL` and its column is nullable.
5. Every CHECK in §10.1, §10.6.1, §10.6.2, §10.7 and §10.9.1 exists, including the D-7 evidence CHECK
   and the `manually_released` actor/reason CHECK.
6. `admin_override` and `suppression_scope` do **not** exist.
7. The existing `wizmatch_suppression_list` `UNIQUE (tenant_id, email)` index is **untouched** — not
   dropped, not replaced.
8. The enrolment state CHECK carries all 15 states of §10.6.1, and all four partial-index predicates
   derive from **one** exported constant listing the eight live states.

**Migration**

9. Generated by `npm run db:generate`; any raw SQL is confined to a single marked guard block
   containing only the immutability trigger, with the §10.11.2 six-step process evidenced.
10. All ten §10.11.4 verification requirements run, with **real output** in the PR — including the
    fresh `0000→0037` replay, the production `information_schema` drift diff, and the destructive-statement
    scan returning zero.
11. Journal `when` exceeds `1784464092263`.
12. **Not applied to production.** Application is G1.

**Service**

13. `evaluateWizmatchOutreachGate` and `assertWizmatchOutreachAllowed` exist in one module;
    `PolicyDecision` is branded and constructible only there.
14. The resolver implements L0–L8 including the new L0 and L1c, per-dimension inheritance, the §8.1.1
    applicability rules, and fails closed on every error path.
15. `resolveCompanyStatus()` has **no** legacy fallback and returns `deny`/`policy_missing_root` for a
    company with no root row.
16. Every company insert path writes the cold-start root policy row in the same transaction.
17. `buildScopeKey()` is the only producer of `scope_key`.

**Gates**

18. `npm run build` exits 0 and `npm test` is green — **after `npm run admin:install`**, since two
    suites currently fail to load on `lucide-react` in a fresh worktree and a red baseline cannot gate
    anything.
19. Zero behavioural change: no caller migrated, no flag flipped, no route changed.
20. Every §20.1 test listed under schema, resolver, evidence, scope and tenancy passes.

### 22.3 PR 3 acceptance criteria — **revised 2026-07-26**

PR 3 is shadow enforcement plus the A-1 / A-4 / mailer fixes. It is done when:

1. **Every row of the §8.10.1 caller-migration checklist is closed** — migrated onto the gate, or
   explicitly classified out-of-tenant with the classification recorded in the PR. Rows 1–18 migrated;
   19–24 gated or rejecting; 25–29 routed through `suppress()`; 30 on mailbox health; the out-of-tenant
   list asserted unchanged.
2. **Zero duplicate policy checks remain.** The inline suppression query at
   `wizmatchOutreachService.ts:183-189` is deleted. A review grep for a second suppression or policy
   read outside the gate module fails the PR.
3. `POST /api/contacts/bulk-email` either gates or rejects every WizMatch-linked contact, resolved
   through §8.10.2, and reports rejections rather than silently dropping them.
4. Warm-up honours mailbox health and global sending safety; it does **not** call company policy.
5. A-1 fixed: the suppression union reads both grains, both sides lowercased.
6. A-4 fixed: hard bounces are written, not discarded.
7. The mailer fails closed with no healthy inbox, behind `WIZMATCH_MAILER_EMERGENCY_OVERRIDE`, which
   logs and Slack-alerts on every use.
8. The unsubscribe HMAC is minted and verified over the same normalised address, and the unsubscribe
   write uses the **sending** tenant, not `process.env.WIZMATCH_TENANT_ID`.
9. `WIZMATCH_POLICY_ENFORCEMENT_MODE=shadow` is the shipped default and the §16 shadow semantics hold,
   including "anything not `enforce` is `shadow`".
10. The **shadow-vs-enforce equivalence harness** exists and passes, so G3's "zero behavioural change"
    is mechanically checkable.
11. Both kill-switches remain off and unmodified. Nothing in PR 3 enables sending.

---

### 22.4 PR 4 acceptance criteria — **added 2026-07-26 (D-39, post-checkpoint-review)**

PR 4 is the policy read/write API + RBAC, company-drawer Policy UI, duplicate-company review,
dry-run-first backfill, and the §21.1 readiness report/CLI — all behind `WIZMATCH_COMPANY_POLICY_ENABLED`
(default `false`). It is done when:

1. `GET`/`POST /api/wizmatch/companies/:id/policy`, `POST .../policy/override` (admin), `POST .../owner`,
   `GET /api/wizmatch/policy/companies`, and `POST /api/wizmatch/companies/bulk/policy` (admin) exist,
   RBAC-gated per §4 (write `team_lead`+, override/bulk `admin` only), and all 404 while the flag is off.
   The bulk route is registered so it is never shadowed by the parameterised single-company route (H-1).
2. `writeCompanyPolicy` supersedes the predecessor **before** inserting the new row, in the order the
   non-deferrable partial unique index `wizmatch_company_policies_active_scope_uniq` requires — a
   supersession must not raise `23505` against a real database (C-2).
3. Every write validates all five enum dimensions (`outreachEligibility`, `externalHiringPolicy`,
   `relationshipType`, `blockClass`, `evidenceKind`) against their full vocabulary and rejects an unknown
   value — no dimension may fail open by matching none of the gate's literal comparisons (H-8/D-37).
4. `evidence_url` passes the existing SSRF-safety utility (`normalizeDomain`'s `isSafeFetchHost` check)
   before a write is accepted (H-9).
5. A `specific_signal`/`specific_requirement` scoped write is rejected when the referenced signal's or
   requirement's `company_id` does not match the company the policy is being written against — a
   service-layer invariant, since no FK can express it (H-10).
6. Duplicate-company review (`GET /api/wizmatch/companies/duplicates`, `POST .../duplicates/:id/resolve`,
   `team_lead`+) persists `reasonCode`/`evidence` to a `wizmatch_staffing_events` row and an `audit_events`
   row rather than discarding them, and the resolving `UPDATE` itself carries a `resolution = 'pending'`
   predicate so two concurrent resolutions cannot both succeed (H-14).
7. Backfill (`scripts/onboarding/wizmatch-policy-backfill.ts`) is dry-run by default, idempotent under
   `--apply` via `ON CONFLICT ... DO NOTHING` on the real partial index, and tenant-scoped throughout.
8. The readiness report/CLI (`GET /api/wizmatch/policy/readiness`, `npm run wizmatch:policy-readiness`)
   reports policy coverage, classification distributions, duplicate-suspect counts, reason-code
   distribution, and the shadow-would-block count — both as a live snapshot AND as a cumulative,
   persisted, tenant-scoped count sourced from `audit_events` (D-34) — honestly marking any metric it
   cannot yet measure (`export omissions`, `policy resolver errors`) as `unavailable: true` rather than
   fabricating a number.
9. The company-drawer Policy section and the Duplicate Companies admin page (nav entry, route, and the
   page itself) are ALL unavailable while `WIZMATCH_COMPANY_POLICY_ENABLED` is off — not only the API
   (H-11/D-38). A flag-off render produces no functional UI and no API call.
10. No guardrail file touched; no send or paid-provider capability enabled; migration `0037` and backfill
    `--apply` remain unapplied/unrun by this PR.

### 22.5 PR 5 acceptance criteria — **added 2026-07-26 (D-39, post-checkpoint-review)**

PR 5 is lifecycle consolidation: migrating the five legacy `hot|warm|watch|blocked`/9-value eligibility
computations named in §5.2 C-2 onto the canonical resolver via `src/modules/outreach/legacyEligibilityAdapter.ts`.
It is done when:

1. **D-31: the adapter is mode-aware.** The exact string `enforce` is the only
   `WIZMATCH_POLICY_ENFORCEMENT_MODE` value that lets a canonical decision override a legacy
   `priority`/`nextAction`/`companyStatus`/`hardBlocks` value. In `shadow` (or any other value, per §16
   rule 3), the legacy behavioural output is returned byte-for-byte as the un-migrated scorer would have
   produced it — canonical decision metadata (`canonicalDecision`/`canonicalReasonCode`/`canonicalBlockerCode`)
   is still always computed and attached for display. No write path this PR touches (including
   `send-to-contact-intelligence` and `requirement-priority/:id/review-plan`) may return `409` on the
   strength of a canonical decision alone while shadow is active (C-1).
2. A canonical DENY, once acting (per #1), always forces the legacy bucket to its most restrictive value
   AND folds every field that gates a live action in lockstep — `priority` **and** `nextAction` move
   together; a canonically-denied company must never render an enabled send/queue/approve action (H-4).
3. The canonical REVIEW branch for contact intelligence is reachable: it keys on the value
   `statusForTier` (`wizmatchContactIntelligence.ts`) actually produces for a non-rejected,
   non-suppressed company (`'qualified'`), not a value that function never returns (H-3).
4. A `null`/missing `companyId` on a company-scoped caller (client discovery, requirement priority) is
   treated as a hard blocker forcing the most restrictive bucket — never silently scored as if no
   company-level policy applied (H-2).
5. Every scope-out disclosure (a legacy computation NOT migrated onto the adapter) states its true,
   current reason — verified against the file's own input types, not asserted once and left stale as the
   file evolves (H-6).
6. The regression-test suite for this module captures real `where()` predicates rather than discarding
   them, so deleting a tenant/company/`isNull(supersededAt)` filter fails a test (H-7, M-5/L-6).
7. §5.2's own test-fixture requirement holds: a "caps a locally-hot result to watch" test must use a
   fixture that genuinely scores `hot`/`warm` before any policy fold, not one that already scored
   `watch` on its own (H-13).
8. A write-time status freeze may only protect a genuine terminal human decision (a `reject_company`
   review outcome) — it must not otherwise let a stale legacy status silently outlive a fresh
   canonical-folded status forever (ADR-006 D-13, H-5).
9. `PRIORITY_UNION_PATTERN`-style guard test(s) exist proving no sixth independent eligibility
   computation exists undisclosed, and that every company-scoped migrated file actually imports the
   adapter.
10. No guardrail file touched; no migration/backfill/enforcement-promotion/sending/paid-provider change;
    `.ai/OUTBOUND_PR5_CODE_READY` is created only by an independent reviewer, never self-reported.

---

## 23. File-by-file impact estimate

**PR 1 (this PR) — documentation only.** No code path changes.

| Area | Files | Change |
|---|---|---|
| Schema | `src/db/schema.ts`, `src/db/migrations/0037_*.sql` | 8 new tables, 2 additive ALTERs, 6 additive `(tenant_id, id)` unique indexes, 22 composite FKs, ~20 CHECKs, 1 guard-block trigger |
| Policy service | `src/services/wizmatchCompanyPolicy.ts` (new) | resolver, writer, scope-key builder, inheritance walk |
| **Outreach gate** | `src/services/wizmatchOutreachGate.ts` (new) | `evaluateWizmatchOutreachGate`, `assertWizmatchOutreachAllowed`, `suppress()`, branded `PolicyDecision`, the live-state constant. **The single chokepoint (§8.10)** |
| Enforcement | every path in the §8.10.1 checklist — `wizmatchOutreachService.ts`, `multiDomainMailer.ts`, `routes/wizmatch.ts`, `routes/wizmatchStaffing.ts`, `routes/contacts.ts`, `routes/email.ts`, `routes/emailTemplates.ts`, `routes/sequences.ts`, `workers/sequenceWorker.ts`, `wizmatchBounceParser.ts`, `imapService.ts` | call the gate; delete every duplicate partial check |
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

**Spec-repair pass, 2026-07-26.** Eight owner decisions (D-1 … D-8) resolving the CRITICAL and HIGH
findings in [`docs/reviews/wizmatch-outbound-overnight-opus-review.md`](../reviews/wizmatch-outbound-overnight-opus-review.md):

| # | Decision | Resolves |
|---|---|---|
| **A-22** | **D-1 — Missing root policy fails closed.** A company with no active `entire_company` row is `deny` / `policy_missing_root`. Every specification statement permitting fallback to `wizmatch_company_intelligence.status` for an outreach decision is deleted. Legacy intelligence status is historical display context only and grants no preparation, enrolment, export, sending or follow-up permission (§8.1, §8.2 L0, §11.3) | C-2 |
| **A-23** | **D-2 — Tenant-safe references.** Every new cross-table reference to a real entity uses a composite FK `(tenant_id, ref_id)`. `scope_ref_id` is deleted; scope identity is the canonical `scope_key`, with `signal_id` / `requirement_id` as typed composite-FK columns and normalised text keys for region, business unit and location (§10.10) | C-3, H-5 |
| **A-24** | **D-3 — Immutability trigger and the raw-SQL exception.** Hand-authored SQL is approved for `0037` **only** where drizzle-kit cannot generate the construct, under the six-step guard-block process in §10.11.2. Policy decision columns are immutable; only supersession metadata may be updated; a changed decision is a new row plus a policy event. `admin_override` is deleted (§10.1, §10.11) | C-4, H-8, M-9 |
| **A-25** | **D-4 — Suppression grains.** `wizmatch_suppression_list` stays exact email/channel grain with its existing `UNIQUE (tenant_id, email)` retained; contact-level suppression stays `contacts.do_not_contact` plus an event; company-level is a non-overridable compliance policy block; history is append-only `wizmatch_suppression_events`. `suppression_scope` is deleted, which makes `0037` additive again (§10.9) | C-5 |
| **A-26** | **D-5 — Mandatory outreach chokepoint.** `evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed` are the sole sanctioned path for every enrolment, queue action, export, send, follow-up, retry and re-enrolment. No service or route duplicates a partial check. `POST /contacts/bulk-email` must gate or reject WizMatch-linked contacts. Warm-up is exempt from company policy but not from mailbox health (§8.10, §8.10.1) | C-6, H-9 |
| **A-27** | **D-6 — Replied company lock.** A reply does **not** release the cold-email lock. Eight live states hold it, including every conversation state; seven explicit terminal states release it; `manually_released` requires actor, reason and an audit event (§10.6.1, §10.6.2) | H-6 |
| **A-28** | **D-7 — Evidence invariants.** Every permanent **or** non-overridable block requires evidence from one of six named classes, CHECK-enforced in the database. Taxonomy rows contradicting this are corrected; §9.11 gains invariant 5 for the non-overridable half (§9, §10.1) | H-2, H-7 |
| **A-29** | **D-8 — Taxonomy freeze.** The taxonomy is correctable during this documentation PR and becomes stable when PR 2 lands database-backed values. After PR 2, renaming a machine-readable value requires a migration plus a compatibility mapping (§9 head) | — |
| **A-30** | Derived in the same pass, from the decisions above: `business_unit` scope is retained but has **no** automatic derivation, and an unresolvable scope denies rather than being ignored (§8.1.1); a root policy row is written in the same transaction as every company insert (§8.1); `bounced` → `contact_invalid` and `withdrawn` → `closed` / `company_blocked` (§10.6.1); enrolment uniqueness gains an email-normalised predicate (§10.6.2) | H-4, H-12, M-5 |

### 25.2 Still open

| # | Question | Blocks |
|---|---|---|
| **U-6** | **Smartlead fixtures — an input, not a decision.** Required before PR 9: a sanitised lead-import sample, a sanitised campaign-results sample, and bounce / unsubscribe / reply examples. Without them the header-alias map and the idempotency tier are guesses. | PR 9 |
| **U-7** | **Owner sign-off on three shared-table indexes.** `users`, `contacts` and `contact_channels` are core CRM tables shared with the Growth tenant; the additive `(tenant_id, id)` unique indexes cannot fail or reject a write, but the index build takes a brief write lock on Growth's tables. This is an operational call, not an engineering one. **Blocks G1, not PR 2** — PR 2 writes the schema and measures the lock; applying it is G1. | G1 |

**Nothing in §25.2 blocks PR 2.** U-6 blocks PR 9; U-7 blocks G1.

---

## 26. Handoff contract

An agent picking this up cold must:

1. Read §0.3 in order.
2. Confirm the reason-code taxonomy (§9) has been ratified **and** that the 2026-07-26 spec-repair
   decisions (§25.1 A-22 … A-30) are present, before starting PR 2. Build to §22.2, not to memory.
3. Work in a worktree cut from `origin/main` or the parent branch — never from the dirty audit tree
   (§22.1).
4. Treat `src/db/schema.ts` and `src/db/migrations/` as guarded: generate with `npm run db:generate`,
   **never hand-edit an already-applied migration**, and hand-author new SQL only inside the §10.11.2
   guard block, only for a construct drizzle-kit cannot emit, and only with the six-step process
   evidenced.
5. Run the `.ai/TEST_PLAN.md` §A gate for every PR and report real results.
6. Append to `.ai/HANDOFF_LOG.md` and update `.ai/CURRENT_TASK.md` after each completed unit.
7. **Stop and ask** before: applying `0037` to production, running the backfill with `--apply`,
   promoting `WIZMATCH_POLICY_ENFORCEMENT_MODE` to `enforce`, any Railway variable change, any
   paid-provider call, any send, and any push to `main`.

Nothing in this PRD authorises a production change. Every gate in §21 is an explicit owner decision.
