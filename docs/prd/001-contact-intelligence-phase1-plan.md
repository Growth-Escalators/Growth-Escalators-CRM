# PRD 001 Phase 1 Plan: Wizmatch Contact Intelligence

Status: Draft implementation plan for review
Owner: Growth Escalators / Wizmatch
Date: 2026-07-06
Scope: Documentation and planning only. No schema, API, UI, worker, cron, enrichment-provider,
or production logic changes in this PR.

Source PRD: `docs/prd/001-contact-intelligence.md` on `main`.

## 1. Phase 1 Goal

Phase 1 should create the safest possible first implementation path for Wizmatch Contact
Intelligence: deterministic company qualification, internal CRM reuse, and manual review
planning, with paid enrichment fully disabled.

The output of Phase 1 planning is a buildable blueprint, not working code. It defines what the
later implementation should calculate, what statuses it should move through, which functions and
tests should exist, and which files are likely to change after approval.

## 2. Non-Negotiable Boundaries

Phase 1 is zero-paid-enrichment.

Rules:

- Paid enrichment is disabled by default.
- Max paid discovery per company = 0.
- Apollo, Snov, Reacher, Google, and any other provider must not be called.
- Hunter is not part of the approved stack and must not be introduced.
- Manual approval remains required before outreach.
- No automatic sending can happen from Contact Intelligence.
- Internal Growth Escalators/Wizmatch use only.
- IT/Tech staffing only.
- India-first priority: India 80%, US 20%.

This planning PR must not change source code, schema, migrations, API routes, admin/client UI,
deployment config, package files, or production behavior.

## 3. Deterministic Company Qualification Logic

Qualification should classify a company into one of four tiers:

| Tier | Meaning | Phase 1 action |
|---|---|---|
| A | Strong IT/Tech fit, active/recent technical signal, usable domain, India or strong US relevance, candidate supply, no suppression risk | Eligible for internal reuse and manual review; paid discovery remains blocked in Phase 1 |
| B | Plausible IT/Tech fit but incomplete evidence or weaker candidate/signal match | Internal reuse only; paid discovery blocked and later requires manual approval |
| C | Weak/unclear fit, stale signal, poor candidate supply, or low confidence | Watchlist or reject recommendation; no discovery |
| Reject | Non-tech, suppressed, duplicate, bad domain, do-not-contact, or clear negative history | Reject/block from discovery |

Qualification should be explainable. Every score should produce a reason list, not just a number.

### Qualification Inputs

Use cheap/internal signals first:

- Company domain exists and is not obviously invalid.
- Job signal title/skills are IT/Tech.
- Signal score and recency.
- Region fit: India preferred; US selective.
- Candidate match availability.
- Existing company record quality.
- Existing CRM contacts or contact channels.
- Prior replies, placements, prime status, or account relationship.
- Suppression, bounce, unsubscribe, do-not-contact, or negative reply history.
- Domain health and cooldown state.
- Duplicate/active outreach state.

## 4. Exact Scoring Components And Weights

Phase 1 company qualification score should be 0-100.

| Component | Weight | Positive evidence | Negative evidence |
|---|---:|---|---|
| IT/Tech fit | 25 | Technical role title, technical skills, IT services/product/GCC/vendor company | Non-tech role/company, generic staffing, HRMS/payroll/attendance use case |
| Signal quality | 20 | Recent signal, high existing signal score, clear role need | Stale, vague, duplicate, low confidence |
| Region priority | 15 | India signal/company/contact path; selective high-value US signal | Region mismatch or weak US-only signal |
| Candidate supply | 15 | Matching candidates available for the role/skills/location | No candidate match or unavailable supply |
| Relationship value | 15 | Prior positive reply, placement, prime status, known account/contact | Negative reply, cooldown, no relationship |
| Safety and deliverability | 10 | Healthy domain, no suppression, no active duplicate outreach | Suppression, bounce, do-not-contact, paused domain, active duplicate |

Suggested tier thresholds:

| Score | Tier |
|---:|---|
| 80-100 | A |
| 60-79 | B |
| 40-59 | C |
| 0-39 | Reject unless a reviewer manually overrides later |

Hard blocks override score:

- Suppressed company/contact/domain.
- Do-not-contact marker.
- Non-tech company or signal.
- No usable company domain when the future workflow requires domain-based contact discovery.
- Duplicate company already in an active outreach path.
- Domain health paused or unsafe.

## 5. Zero-Paid-Enrichment Rules

Phase 1 should never call paid providers.

Implementation rules for later code:

- A central config/constant should represent `paidDiscoveryEnabled = false` for Phase 1.
- A central cap should represent `maxPaidDiscoveryPerCompany = 0`.
- Any future provider adapter should be unreachable from Phase 1 qualification paths.
- Discovery runs created in Phase 1 should be internal/free-only and cost `0`.
- Tier B paid discovery must remain unavailable until a later phase and explicit manual approval.
- The review surface should show at most 3 contact candidates per company.
- Rediscovery cooldown should be 30 days unless a reviewer explicitly overrides it in a later phase.

## 6. Internal CRM Reuse Strategy

Phase 1 should favor relationship memory already in the CRM/Wizmatch system.

Reuse sources:

- Existing `contacts`.
- Existing `contact_channels`.
- Prior Wizmatch signal contacts.
- Prior positive replies.
- Prior placements.
- Prime company/account information.
- Suppression and do-not-contact records.
- Domain health records.
- Existing requirement/upload metadata where it identifies a human source.

Matching strategy:

- Match by tenant and company/domain first.
- Reuse exact normalized email/phone channels where available.
- Prefer contacts with recent positive activity.
- Prefer contacts tied to hiring, delivery, vendor management, procurement, MSP/VMS, or technical TA.
- Penalize generic inboxes unless no person-level candidate exists.
- Never create a new CRM contact automatically in Phase 1 planning; linking/creation needs implementation approval.

Contact candidate ranking should return at most 3 reviewable recommendations.

## 7. Manual Review Workflow

Manual review is the center of Phase 1.

Reviewer sees:

- Company qualification tier.
- Company qualification score.
- Reason list for every score component.
- Active signal/requirement summary.
- Candidate supply summary.
- Existing relationship facts.
- Suppression/domain-health warnings.
- Up to 3 internal CRM contact candidates.
- Discovery cost: always `0` in Phase 1.

Reviewer actions to plan:

- Approve company for future contact review.
- Reject company.
- Mark company as watchlist/needs review.
- Approve an internal contact candidate for later outreach preparation.
- Reject a contact candidate.
- Mark do-not-contact.
- Request future discovery, with paid discovery still blocked in Phase 1.

Approval does not send outreach. It only prepares the next workflow step for a later approved
implementation.

## 8. Exact Status Transitions

These statuses mirror the hardened PRD and should be preserved unless Claude/human review changes
the model.

### Company Intelligence Status

Allowed statuses:

- `new`
- `qualified`
- `needs_review`
- `ready_for_discovery`
- `discovery_blocked`
- `discovered`
- `rejected`
- `suppressed`
- `cooldown`

Phase 1 transitions:

| From | Event | To |
|---|---|---|
| `new` | deterministic qualification starts | `needs_review` |
| `needs_review` | hard block found: suppression/do-not-contact/domain paused | `suppressed` |
| `needs_review` | hard block found: cooldown/active duplicate | `cooldown` |
| `needs_review` | score maps to Reject | `rejected` |
| `needs_review` | score maps to C | `needs_review` |
| `needs_review` | score maps to B | `qualified` |
| `needs_review` | score maps to A | `qualified` |
| `qualified` | reviewer approves internal-only review path | `discovery_blocked` |
| `qualified` | reviewer rejects | `rejected` |
| `discovery_blocked` | Phase 1 internal reuse produces candidates | `discovered` |

Notes:

- `ready_for_discovery` should not mean paid discovery in Phase 1.
- `discovery_blocked` is expected when paid discovery would otherwise be requested.
- Paid discovery transitions must wait for Phase 3 or later.

### Contact Candidate Status

Allowed statuses:

- `new`
- `needs_review`
- `approved`
- `rejected`
- `do_not_contact`
- `linked_to_crm`
- `stale`

Phase 1 transitions:

| From | Event | To |
|---|---|---|
| `new` | internal candidate generated | `needs_review` |
| `needs_review` | reviewer approves candidate | `approved` |
| `needs_review` | reviewer rejects candidate | `rejected` |
| `needs_review` | suppression/do-not-contact applies | `do_not_contact` |
| `approved` | future approved implementation links existing CRM contact | `linked_to_crm` |
| `needs_review` | source/title/channel becomes old or invalid | `stale` |

### Discovery Run Status

Allowed statuses:

- `queued`
- `running`
- `succeeded`
- `partial`
- `failed`
- `skipped`
- `blocked_by_cap`

Phase 1 transitions:

| From | Event | To |
|---|---|---|
| `queued` | internal/free discovery starts | `running` |
| `running` | internal candidates found | `succeeded` |
| `running` | some data found but not enough for recommendation | `partial` |
| `running` | reusable/internal lookup error | `failed` |
| `queued` | company rejected/suppressed/cooldown | `skipped` |
| `queued` | paid discovery requested while cap is 0 | `blocked_by_cap` |

## 9. Proposed Service Functions

These functions are proposals only. Do not create them until implementation is explicitly
approved.

Likely service file later:

- `src/services/wizmatch/contactIntelligenceService.ts`

Proposed functions:

- `qualifyCompanyForContactIntelligence(input)` - returns tier, score, component scores,
  hard blocks, and reasons.
- `scoreCompanyItTechFit(input)` - evaluates IT/Tech staffing relevance.
- `scoreSignalQuality(input)` - evaluates signal score, recency, and clarity.
- `scoreRegionPriority(input)` - applies India 80% / US 20% priority.
- `scoreCandidateSupply(input)` - checks candidate availability and fit.
- `scoreRelationshipValue(input)` - evaluates replies, placements, prime status, and known contacts.
- `scoreSafetyAndDeliverability(input)` - checks suppression, domain health, and duplicate outreach.
- `findReusableInternalContacts(input)` - reads existing CRM/Wizmatch relationship data only.
- `rankInternalContactCandidates(input)` - ranks and caps candidates at 3.
- `buildManualReviewPayload(input)` - creates the explainable data shape for future UI/API.
- `transitionCompanyIntelligenceStatus(input)` - centralizes allowed company status changes.
- `transitionContactCandidateStatus(input)` - centralizes allowed candidate status changes.
- `transitionDiscoveryRunStatus(input)` - centralizes allowed run status changes.
- `assertPhase1CostCaps(input)` - blocks all paid discovery requests in Phase 1.

Function output should be deterministic and testable without network calls.

## 10. Proposed Tests

These tests are proposals only. Do not create them until implementation is explicitly approved.

Likely test file later:

- `src/services/wizmatch/contactIntelligenceService.test.ts`

Test groups:

- Tier A qualification for strong India IT/Tech signal with candidates and no risk.
- Tier B qualification for plausible fit with weaker evidence.
- Tier C or Reject for weak/non-tech signal.
- Hard reject for non-tech, HRMS/payroll/attendance, suppressed, or do-not-contact cases.
- Region scoring: India favored; US allowed only for high-value/selective evidence.
- Candidate supply scoring: available matches improve score; no supply lowers score.
- Relationship scoring: prior replies/placements/prime status improve score.
- Safety scoring: domain health, suppression, negative reply, and cooldown reduce/block score.
- Paid discovery request returns `blocked_by_cap` when Phase 1 cap is 0.
- Contact ranking caps visible recommendations at 3.
- Status transition tests for company intelligence, contact candidates, and discovery runs.
- Explainability tests: every qualification result includes reasons and component scores.

No test should require network access, provider credentials, paid enrichment, or production data.

## 11. Files Likely To Change Later

Do not change these files in this planning PR. They are listed only to guide a later approved
implementation.

Likely backend files:

- `src/services/wizmatch/contactIntelligenceService.ts`
- `src/services/wizmatch/contactIntelligenceService.test.ts`
- Existing Wizmatch service files if internal reuse needs shared helpers.
- Existing Wizmatch route files only after API plan approval.

Likely schema files after Claude/human approval:

- `src/db/schema.ts`
- generated Drizzle migration under `src/db/migrations/`

Likely admin files after UI approval:

- Wizmatch admin routes/navigation.
- Future Contact Intelligence review page.
- Future shared score/reason components.

Likely docs/context files:

- `.ai/CURRENT_TASK.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md`
- future ADR for schema/API implementation.

## 12. Risks And Guardrails

Risks:

- Accidentally building paid enrichment too early.
- Treating generic HR contacts as strong decision makers.
- Creating duplicate outreach paths.
- Ignoring suppression, bounce, unsubscribe, or do-not-contact state.
- Joining `contacts` with Wizmatch tables without aliasing ambiguous columns.
- Updating contacts without preserving email/phone normalization and `lastActivityAt`.
- Adding schema/API/UI before the data model and review workflow are approved.

Guardrails:

- Keep Phase 1 deterministic and network-free.
- Keep paid discovery caps at 0.
- Keep contact recommendations capped at 3.
- Keep manual approval before outreach.
- Preserve tenant isolation in all future queries.
- Alias joined columns when `contacts` appears with Wizmatch tables.
- Reuse existing CRM contact normalization rules.
- Do not touch migrations or schema without explicit approval and `db:generate`.

## 13. What Codex Can Safely Implement While Claude Is Unavailable

Codex can safely do:

- Documentation and planning updates.
- Deterministic scoring plan refinements.
- Test-case design.
- Type/interface sketches in docs.
- TypeScript service skeleton only if explicitly approved later.
- Tests only if explicitly approved later.

Codex should keep work small, reviewable, and within existing patterns.

## 14. What Must Wait For Claude

Wait for Claude/human architecture approval before:

- Database schema changes.
- Drizzle migrations.
- API routes.
- Admin/client UI changes.
- Paid enrichment integrations.
- Provider adapters for Apollo, Snov, Reacher, Google, or any other vendor.
- Worker/cron changes.
- Outreach sending changes.
- Automatic CRM contact creation/linking.
- Production logic changes.
- Deployment or Railway/Vercel config changes.

## 15. Phase 1 Acceptance Criteria

For this planning PR:

- This Phase 1 plan exists at `docs/prd/001-contact-intelligence-phase1-plan.md`.
- The plan covers deterministic qualification, zero-paid-enrichment, internal CRM reuse,
  manual review, exact scoring weights, exact status transitions, proposed service functions,
  proposed tests, likely later files, risks, guardrails, Codex-safe work, and Claude-gated work.
- `.ai/CURRENT_TASK.md`, `.ai/HANDOFF_LOG.md`, and `.ai/AI_BRIEF.md` are updated.
- No production files changed.
- No schema, migration, API, admin/client UI, package, lockfile, or deployment config changed.

For a future implementation PR:

- Qualification is deterministic and explainable.
- Paid enrichment cannot run in Phase 1.
- Internal CRM reuse is attempted before any future external discovery.
- Contact candidates are capped at 3.
- Status transitions are centralized and tested.
- Manual approval remains required before outreach.
