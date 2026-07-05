# ADR-002: Wizmatch Contact Intelligence Phase 1 Architecture

Status: Proposed for review
Date: 2026-07-06
Owner: Growth Escalators / Wizmatch

## Context

Wizmatch Contact Intelligence now has an approved product direction in
`docs/prd/001-contact-intelligence.md` and a Phase 1 implementation plan in
`docs/prd/001-contact-intelligence-phase1-plan.md`.

The Phase 1 boundary is intentionally conservative:

- Internal Growth Escalators/Wizmatch use only.
- IT/Tech staffing only.
- India-first priority: India 80%, US 20%.
- Deterministic qualification before contact discovery.
- Zero paid enrichment.
- Manual approval before outreach.
- No schema, API, admin/client UI, worker/cron, outreach-sending, deployment, or provider
  integration changes without a later approval.

Claude is temporarily unavailable, so Codex can help move the repo forward only where the work is
well-scoped, deterministic, and low-risk. This ADR records the smallest safe architecture for the
first implementation slice.

## Decision

Phase 1 should begin as a pure TypeScript domain/service module with unit tests only.

The first implementation slice should not write to the database, expose API routes, render admin UI,
call external providers, schedule jobs, send outreach, or create/link CRM contacts. It should produce
deterministic qualification and ranking outputs from explicit input objects.

Approved Phase 1 implementation shape, after this ADR is reviewed:

- Add a pure service module:
  - `src/services/wizmatch/contactIntelligenceService.ts`
- Add a focused unit test file:
  - `src/services/wizmatch/contactIntelligenceService.test.ts`
- Keep all inputs as plain typed objects assembled by tests for now.
- Return explainable outputs: total score, component scores, tier, hard blocks, reason codes,
  recommended statuses, and capped contact candidates.
- Keep cost controls as constants or exported config inside the service:
  - `paidDiscoveryEnabled = false`
  - `maxPaidDiscoveryPerCompany = 0`
  - `maxContactCandidatesShown = 3`
  - `rediscoveryCooldownDays = 30`
- Treat all paid discovery requests as blocked by cap in Phase 1.
- Do not create provider adapters yet.

## Phase 1 Service Responsibilities

The service may implement deterministic logic for:

- Company qualification scoring.
- IT/Tech fit scoring.
- Signal quality scoring.
- India-first region priority scoring.
- Candidate supply scoring.
- Relationship value scoring.
- Safety and deliverability hard blocks.
- Internal contact candidate ranking from already-provided CRM/Wizmatch facts.
- Company intelligence status recommendations.
- Contact candidate status recommendations.
- Discovery run status recommendations for internal/free-only attempts and paid-blocked attempts.
- Manual-review payload shaping for future API/UI work.

The service must be deterministic, side-effect-free, and network-free.

## Phase 1 Data Inputs

Phase 1 should use explicit input structures rather than DB queries.

Suggested input groups:

- `company`: id/domain/name/region/company type hints.
- `signal`: score/title/skills/location/source/recency.
- `candidateSupply`: matching candidate count and fit summary.
- `relationships`: prior replies, placements, prime status, known account/contact facts.
- `safety`: suppression, bounce, unsubscribe, do-not-contact, domain health, active duplicate/cooldown.
- `internalContacts`: existing CRM/Wizmatch contacts already known to the caller/test.

This keeps Phase 1 independent of schema/API decisions while preserving a clear path to wire real
queries later.

## Scoring Contract

Company qualification score remains 0-100:

| Component | Weight |
|---|---:|
| IT/Tech fit | 25 |
| Signal quality | 20 |
| Region priority | 15 |
| Candidate supply | 15 |
| Relationship value | 15 |
| Safety and deliverability | 10 |

Tier thresholds:

| Score | Tier |
|---:|---|
| 80-100 | A |
| 60-79 | B |
| 40-59 | C |
| 0-39 | Reject |

Hard blocks override the score:

- Non-tech company or signal.
- Suppression/do-not-contact.
- Unsafe or paused domain.
- Active duplicate outreach path.
- Cooldown state where outreach should wait.

Every score must include reasons. No future UI/API should have to infer why a company was ranked.

## Status Contract

The service should centralize status recommendations using the enums from the PRD:

Company intelligence:

- `new`
- `qualified`
- `needs_review`
- `ready_for_discovery`
- `discovery_blocked`
- `discovered`
- `rejected`
- `suppressed`
- `cooldown`

Contact candidate:

- `new`
- `needs_review`
- `approved`
- `rejected`
- `do_not_contact`
- `linked_to_crm`
- `stale`

Discovery run:

- `queued`
- `running`
- `succeeded`
- `partial`
- `failed`
- `skipped`
- `blocked_by_cap`

Phase 1 must not use `ready_for_discovery` to imply paid discovery. Paid discovery remains blocked.

## Test Strategy

The first implementation PR should include unit tests for:

- Tier A India IT/Tech signal with candidate supply and no safety risk.
- Tier B plausible fit with incomplete evidence.
- Tier C/Reject for weak, stale, or non-tech signals.
- Hard blocks for suppression, do-not-contact, unsafe domain, and active duplicate outreach.
- India-first region scoring with selective high-value US support.
- Candidate supply positive/negative scoring.
- Relationship scoring from replies, placements, prime status, and known contacts.
- Contact candidate ranking capped at 3.
- Paid discovery request returning `blocked_by_cap`.
- Status transition recommendations for company, contact candidate, and discovery run statuses.
- Explainability: every result includes component scores and reasons.

Tests must not need network access, provider credentials, node-cron, production data, or database
state.

## Deferred Decisions

These are explicitly not part of Phase 1 implementation:

- New tables:
  - `wizmatch_company_intelligence`
  - `wizmatch_contact_candidates`
  - `wizmatch_discovery_runs`
- Drizzle migrations.
- API routes under `/api/wizmatch/contact-intelligence/*`.
- Admin/client UI.
- Worker/cron orchestration.
- Provider adapters or paid discovery calls for Apollo, Snov, Reacher, Google, or any other vendor.
- CRM contact creation/linking.
- Outreach sending changes.
- Production deployment config changes.

Each deferred area needs a later ADR or explicit human/Claude approval before implementation.

## Consequences

Benefits:

- Phase 1 can be tested without touching production data.
- The scoring/ranking contract becomes reviewable before schema/API/UI work.
- Cost-control and manual-review guardrails are enforced early.
- Later database/API/UI work can consume a stable service contract.

Trade-offs:

- No persistent Contact Intelligence state exists yet.
- No reviewer UI exists yet.
- No live CRM reuse queries are wired yet.
- The first implementation proves logic correctness, not end-to-end workflow.

This trade-off is intentional. It keeps the first code change small enough for Codex to implement
and for Claude/human review to verify.

## Acceptance Criteria For The Next Implementation PR

- Adds only the pure service module and unit tests unless explicitly approved otherwise.
- Does not change schema, migrations, API routes, admin/client UI, workers, provider integrations,
  package files, or deployment config.
- `npm test` passes.
- `npm run build` passes.
- No network calls or provider credentials are required.
- Paid discovery is impossible in Phase 1 because the cap is 0.
- Contact candidate ranking is capped at 3.
- Outputs include component scores and reason codes.
- Contact normalization and `lastActivityAt` invariants are documented for future DB wiring, but
  no CRM contact writes happen in this slice.
