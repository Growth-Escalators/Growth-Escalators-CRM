# PRD 003: Wizmatch Candidate Intelligence Plan

Status: Draft plan
Owner: Growth Escalators / Wizmatch
Date: 2026-07-06
Scope: Planning only. No schema, API, UI, worker, enrichment, or outreach change is approved by
this document.

## Goal

Build a Candidate Intelligence layer that turns the internal candidate pool into ranked,
explainable supply for active IT/Tech requirements and company signals.

The business goal is to fill qualified requirements faster by knowing which candidates are ready,
which skills they match, what risks exist, and which requirements they should be used for first.

## Boundaries

- Internal Growth Escalators/Wizmatch use only.
- IT/Tech staffing only.
- India 80%, US 20%.
- Deterministic scoring before AI.
- No candidate outreach automation from this module.
- No HRMS, payroll, attendance, generic ATS, or non-tech recruitment features.

## Inputs

- Existing `wizmatch_candidates`.
- Existing CRM `contacts` and `contact_channels`.
- Existing `wizmatch_requirements`.
- Existing `wizmatch_job_signals`.
- Existing `wizmatch_placements`.
- Skills, location, availability, rate, visa, source, certification, resume/profile URLs.
- Manual reviewer notes and relationship history.

## Scoring Model

Score candidate readiness from 0-100:

| Component | Weight | Meaning |
|---|---:|---|
| Skill fit | 30 | Required skill overlap, seniority relevance, adjacent stack fit |
| Availability | 20 | Available now, notice period, current placement status |
| Region/work mode fit | 15 | India-first supply, location, onsite/hybrid/remote feasibility |
| Rate/budget fit | 10 | Candidate rate aligns with requirement budget |
| Profile quality | 10 | Verified contact channel, resume/profile present, source confidence |
| Relationship/outcome | 10 | Prior submission, interview, placement, positive history |
| Risk controls | 5 | Suppression, duplicate submission, stale profile, incomplete data |

Priority:

- `hot`: 85-100
- `warm`: 70-84
- `watch`: 50-69
- `blocked`: hard block or under 50

## Hard Blocks

- Candidate/contact marked do-not-contact.
- Candidate already placed or actively submitted where duplicate submission would create risk.
- Missing usable contact channel.
- Non-tech skill profile.
- Suppression or negative compliance state.

## Workflow

1. Normalize candidate facts from existing CRM/Wizmatch rows.
2. Score candidate readiness.
3. Match candidate supply against active requirements and company signals.
4. Explain why each candidate is recommended or blocked.
5. Show best-use requirements/signals in the Command Center.
6. Keep manual review before any outreach, submission, or candidate action.

## Proposed Future Functions

- `scoreCandidateIntelligence(input)`
- `rankCandidatesForRequirement(requirement, candidates)`
- `rankRequirementsForCandidate(candidate, requirements)`
- `detectCandidateHardBlocks(input)`
- `explainCandidateMatch(result)`

## Proposed Future API

- `GET /api/wizmatch/candidate-intelligence/queue`
- `GET /api/wizmatch/candidate-intelligence/candidates/:candidateId`
- `GET /api/wizmatch/candidate-intelligence/requirements/:requirementId/matches`
- `POST /api/wizmatch/candidate-intelligence/candidates/:candidateId/review`

## Proposed Future UI

- Candidate Intelligence queue.
- Candidate readiness cards.
- Skill-gap and match explanations.
- Best-fit requirements/signals.
- Blocker warnings.
- Manual review actions.

## Acceptance Criteria For First Implementation

- Uses existing tables first.
- Produces score, priority, reasons, concerns, and blockers.
- Shows top requirement/signal fit.
- Preserves tenant isolation.
- Does not send outreach.
- Does not create submissions automatically.
- Tests cover scoring, hard blocks, India priority, skill fit, availability, and duplicate risk.

## Must Wait

- New schema for candidate intelligence state.
- Automated candidate outreach/submission.
- Paid profile enrichment.
- Worker/cron automation.
- AI ranking that replaces deterministic rules.
