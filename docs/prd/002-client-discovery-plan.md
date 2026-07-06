# PRD 002: Wizmatch Client Discovery / Company Signals Plan

Status: Draft plan
Owner: Growth Escalators / Wizmatch
Date: 2026-07-06
Scope: Planning only. No provider integration, schema change, worker change, or outreach change is
approved by this document.

## Goal

Build a low-cost Client Discovery layer that finds and ranks IT/Tech staffing opportunities before
Contact Intelligence spends time or enrichment budget on them.

The business goal is simple: get more qualified IT requirements from companies that are likely to
hire, likely to accept staffing/vendor help, and likely to match Growth Escalators candidate supply.

## Boundaries

- Internal Growth Escalators/Wizmatch use only.
- IT/Tech staffing only.
- India 80%, US 20%.
- Deterministic scoring before AI.
- No paid enrichment until company qualification passes.
- No auto-outreach.
- No generic recruitment SaaS, HRMS, payroll, attendance, or non-tech staffing workflows.

## Inputs

- Existing `wizmatch_companies`.
- Existing `wizmatch_job_signals`.
- Existing `wizmatch_requirements`.
- Existing candidate supply from `wizmatch_candidates`.
- Domain health and suppression state.
- Prime/MSA/placement/reply history.
- Manual company seeds from the team.
- Later, approved free/low-cost sources such as company careers pages, Naukri-relevant signals, and
  carefully capped search inputs.

## Scoring Model

Score each company/signal path from 0-100:

| Component | Weight | Meaning |
|---|---:|---|
| IT/Tech fit | 25 | Technical role/company vocabulary, IT services/product/GCC/vendor fit |
| Signal strength | 20 | Recency, score, volume, reposting, requirement quality |
| India-first priority | 15 | India signals and India hiring paths get full weight; US is selective |
| Candidate supply | 15 | Available matching candidates for role/skills/location |
| Relationship value | 15 | Prime, MSA, prior reply, placement, known account |
| Safety | 10 | Domain health, suppression, duplicate/cooldown checks |

Priority:

- `hot`: 80-100
- `warm`: 60-79
- `watch`: 40-59
- `blocked`: hard block or under 40

## Workflow

1. Collect cheap/internal company and signal facts.
2. Score company/signal pairs deterministically.
3. Filter out non-tech, suppressed, unsafe, duplicate, and stale opportunities.
4. Put hot/warm companies into the Command Center.
5. Send qualified companies into Contact Intelligence snapshot/review.
6. Keep manual approval before contact discovery or outreach.

## Proposed Future Functions

- `scoreClientDiscoveryOpportunity(input)`
- `rankClientDiscoveryQueue(inputs)`
- `explainClientDiscoveryScore(result)`
- `detectClientDiscoveryHardBlocks(input)`
- `selectCompaniesForContactIntelligence(results)`

## Proposed Future API

- `GET /api/wizmatch/client-discovery/queue`
- `GET /api/wizmatch/client-discovery/companies/:companyId`
- `POST /api/wizmatch/client-discovery/companies/:companyId/qualify`
- `POST /api/wizmatch/client-discovery/companies/:companyId/send-to-contact-intelligence`

## Proposed Future UI

- Company signals queue.
- Hot/warm/watch/blocked filters.
- Company/signal detail drawer.
- Candidate supply summary.
- Relationship and safety warnings.
- "Send to Contact Intelligence" action.

## Acceptance Criteria For First Implementation

- Uses existing tables first.
- Produces explainable score, priority, reasons, and blockers.
- Blocks non-tech and unsafe companies.
- Does not call paid providers.
- Does not send outreach.
- Feeds qualified companies into Contact Intelligence review.

## Must Wait

- Paid discovery/enrichment.
- Worker/cron automation.
- New external scraping at scale.
- Any production sending changes.
- New schema beyond explicit approval.
