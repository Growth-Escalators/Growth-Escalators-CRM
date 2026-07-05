# PRD 001: Wizmatch Contact Intelligence

Status: Draft for review
Owner: Growth Escalators / Wizmatch
Date: 2026-07-06
Scope: Documentation and planning only. No schema, API, UI, worker, or production changes in this PR.

## 1. Business Goal

Build a cost-controlled Contact Intelligence layer for Wizmatch that turns qualified IT staffing company signals into a ranked, reviewable list of real decision-maker contacts.

The outcome should be simple: when Wizmatch finds a good company or job signal, the team should know who to contact, why that person is likely relevant, how confident we are, what it cost to find them, and whether a human has approved outreach.

This is for internal Growth Escalators use only. It is not a public SaaS feature.

## 2. Why Contact Intelligence Matters For Growth Escalators

Wizmatch already captures job signals, scores them, matches candidates, drafts outreach, and tracks replies/placements. The weak point is the human/company contact layer between a good opportunity and a good outreach recipient.

Contact Intelligence matters because:

- Good candidates and strong job signals are wasted if outreach goes to generic inboxes or the wrong person.
- Paid enrichment can burn budget quickly if every company is enriched before qualification.
- Manual SDR review is only useful when the system explains why a company and contact were selected.
- Growth Escalators needs an internal repeatable operating system, not another disconnected enrichment spreadsheet.
- Better relationship memory can compound over time: prior replies, placements, prime companies, suppressions, and domain health should influence the next contact decision.

## 3. IT/Tech-Only Scope

This feature is only for IT and technology staffing workflows.

In scope:

- Software engineering, data, cloud, DevOps, QA, AI/ML, ERP, cybersecurity, product, and adjacent technical roles.
- IT services firms, product companies, GCCs, consultancies, prime vendors, systems integrators, and end clients hiring technical talent.
- Contacts involved in technical hiring, delivery, vendor management, procurement for staffing vendors, or talent acquisition for IT roles.

Out of scope:

- Non-tech recruitment.
- Healthcare, retail, hospitality, construction, manufacturing, blue-collar, finance-only, or generic staffing use cases unless the signal is explicitly for IT/Tech hiring.
- HRMS, payroll, attendance, timesheets, onboarding systems, or generic SaaS workflows.

## 4. India 80% / US 20% Priority

Contact Intelligence should bias discovery and scoring toward India first.

Priority split:

- India: 80%
- US: 20%

India priority means:

- Prefer India job signals, India hiring teams, India delivery centers, GCCs, and India-based staffing/vendor relationships.
- Treat Naukri/India requirement signals as first-class inputs.
- Rank India-relevant contacts higher when candidate supply and role fit are strong.
- Keep enrichment costs low by using company qualification before paid discovery.

US priority means:

- Enrich US companies selectively when the signal is high value: strong job signal score, H-1B/tech hiring evidence, prime/vendor potential, active matching candidates, or prior relationship.
- Avoid broad US enrichment sweeps.
- Prefer US contacts tied to technical hiring, vendor management, MSP/VMS, or staffing partnership decisions.

## 5. Current Wizmatch Baseline

Current repo docs and code show this baseline:

- Wizmatch runs inside the existing Growth Escalators CRM as an internal staffing module.
- The current flow is: Signal -> Score -> Enrich -> Match -> Draft -> Review -> Send -> Reply -> Classify -> Placement.
- Current Wizmatch tables include companies, job signals, candidates, placements, domain health, suppression list, and requirements.
- Current routes live under `/api/wizmatch/*`.
- Current admin pages include Signals, Candidates, Review Queue, Domains, Compliance, Placements, Primes, Analytics, and Requirements.
- Scoring and matching are intentionally low-cost: TypeScript/SQL first, AI only where it adds value.
- Email outreach already has manual review before send.
- Enrichment currently appears centered around turning a signal/company domain into one outreach contact; it does not yet describe a durable company-level contact intelligence layer.

Contact Intelligence should build on this baseline rather than replace it.

## 6. Company Qualification Before Contact Discovery

Never run expensive enrichment for every company.

Before discovering contacts, the company must be qualified. Qualification should be deterministic and cheap first.

Qualification inputs:

- Company domain exists and is usable.
- Company appears to be in IT/Tech hiring or IT staffing/vendor ecosystem.
- Signal score and signal recency.
- Job title and skills are technical.
- Region priority: India preferred, US selective.
- Candidate match availability.
- Existing company record quality.
- Prior replies, placements, prime status, or relationship history.
- Suppression, bounce, do-not-contact, or negative reply history.
- Domain health and sending risk.

Suggested qualification tiers:

| Tier | Meaning | Discovery action |
|---|---|---|
| A | Strong IT/Tech fit, active signal, candidate supply, good region fit | Allow paid discovery within caps |
| B | Plausible fit but weaker evidence | Free/internal discovery first; paid only after manual approval |
| C | Weak or unclear fit | No paid discovery; keep as watchlist or reject |
| Reject | Non-tech, generic, suppressed, duplicate, bad domain, or low confidence | No discovery |

The system should record why a company was qualified or rejected so reviewers can trust the queue.

## 7. Contact Discovery Waterfall

The discovery waterfall should move from cheapest and most reliable to paid and uncertain.

Recommended waterfall:

1. Internal CRM reuse
   - Existing `contacts` and `contact_channels`.
   - Prior Wizmatch signal contacts.
   - Prior positive replies.
   - Prior placements, primes, and account relationships.

2. Existing company metadata
   - Company domain.
   - ATS metadata.
   - Careers page.
   - Job posting source.
   - Requirement upload metadata.

3. Free or low-cost public discovery
   - Company website leadership/team/careers pages.
   - Public job page contact hints.
   - Search snippets where already available.
   - LinkedIn profile URLs if discoverable without high-cost calls.

4. Role-targeted paid enrichment for qualified companies only
   - Apollo first for role-based people search.
   - Hunter/domain pattern as fallback.
   - Email verification before any outreach.
   - Stop after enough valid contacts are found; do not keep spending to maximize quantity.

5. Manual seed/import
   - Allow humans to add a known contact, LinkedIn URL, email, or note.
   - Mark manually supplied contacts separately from vendor-enriched contacts.

6. Manual review
   - No outreach can be sent from discovery alone.
   - A human must approve the contact and the selected outreach path.

## 8. Contact Ranking Logic

Contacts should be ranked on a 0-100 score with explainable components.

Proposed scoring:

| Component | Weight | Examples |
|---|---:|---|
| Role fit | 30 | Hiring manager, engineering leader, TA for tech roles, vendor management, procurement/MSP |
| Company qualification | 20 | Tier A company, strong IT fit, active technical openings |
| Signal relevance | 15 | Contact likely connected to the active role, business unit, location, or skill family |
| Region fit | 10 | India-first ranking, US only when signal quality justifies it |
| Relationship score | 15 | Prior reply, prime status, placement history, known contact, warm account |
| Deliverability/confidence | 10 | Verified email, non-role inbox, source confidence, no suppression |

Ranking rules:

- Prefer specific decision makers over generic mailboxes.
- Prefer contacts tied to technical hiring over generic HR.
- Prefer known/warm contacts over newly enriched contacts when role fit is comparable.
- Penalize contacts with unverifiable emails, stale titles, generic inboxes, or weak source evidence.
- Penalize contacts at companies with recent negative replies, suppression, or domain risk.
- Keep the top recommendations small: usually 1-3 contacts per company/signal.

## 9. Relationship Scoring

Relationship scoring should make Wizmatch smarter over time.

Positive signals:

- Prior positive reply from the company or contact.
- Existing placement with the company or prime.
- Prime company status.
- Known MSA/vendor relationship.
- Prior manual approval by the team.
- Recent relevant conversation.
- Contact already exists in CRM with healthy channel data.

Negative signals:

- Unsubscribe, bounce, spam complaint, or do-not-contact.
- Prior negative reply.
- Recent outreach with no response inside cooldown period.
- Domain health degraded or paused.
- Duplicate contact already in another active outreach path.
- Company marked as non-fit or non-tech.

Relationship scoring should be explainable in review UI. A reviewer should see "why this contact" without digging into raw metadata.

## 10. Manual Review Workflow

Manual approval remains mandatory before outreach.

Proposed workflow:

1. Company enters Contact Intelligence queue after qualification.
2. Reviewer opens company/signal detail.
3. System shows:
   - Company qualification tier and reasons.
   - Active signals/requirements.
   - Matching candidates.
   - Ranked contact candidates.
   - Source and confidence for each contact.
   - Estimated and actual discovery cost.
   - Relationship history and suppression warnings.
4. Reviewer chooses one action:
   - Approve contact for outreach.
   - Reject contact.
   - Reject company.
   - Request more discovery.
   - Add manual contact.
   - Mark do-not-contact.
5. Only approved contacts can move into draft/review/send workflow.
6. Sending still uses the existing outreach review queue and compliance checks.

## 11. Data Model Proposal, But No Schema Changes Yet

No database schema changes are part of this PRD.

Future implementation can consider these entities after review:

### `wizmatch_company_intelligence`

Purpose: durable qualification and discovery state for a company.

Potential fields:

- `id`
- `tenant_id`
- `company_id`
- `qualification_tier`
- `qualification_score`
- `target_region`
- `is_it_staffing_fit`
- `discovery_status`
- `last_qualified_at`
- `last_discovered_at`
- `next_refresh_at`
- `cost_cents_total`
- `source_summary`
- `metadata`
- timestamps

### `wizmatch_contact_candidates`

Purpose: ranked possible contacts for a company before CRM contact creation or approval.

Potential fields:

- `id`
- `tenant_id`
- `company_id`
- `crm_contact_id` nullable
- `name`
- `title`
- `role_category`
- `email`
- `phone`
- `linkedin_url`
- `location`
- `region`
- `source`
- `source_url`
- `deliverability_status`
- `ranking_score`
- `relationship_score`
- `confidence_score`
- `status` (`new`, `needs_review`, `approved`, `rejected`, `do_not_contact`)
- `approved_by`
- `approved_at`
- `rejection_reason`
- `metadata`
- timestamps

### `wizmatch_discovery_runs`

Purpose: audit trail and cost control for discovery attempts.

Potential fields:

- `id`
- `tenant_id`
- `company_id`
- `run_type`
- `source`
- `status`
- `cost_cents`
- `input_snapshot`
- `result_counts`
- `error_message`
- timestamps

### `wizmatch_contact_company_edges`

Purpose: relationship memory between a contact and a company/account.

Potential fields:

- `id`
- `tenant_id`
- `contact_candidate_id`
- `company_id`
- `relationship_type`
- `relationship_score`
- `last_interaction_at`
- `metadata`
- timestamps

Implementation note: approved contacts should eventually reuse existing CRM `contacts` and `contact_channels` patterns, including email/phone normalization and `lastActivityAt` updates on writes.

## 12. API Proposal, But No Route Changes Yet

No API route changes are part of this PRD.

Future endpoints could live under `/api/wizmatch/contact-intelligence/*`.

Potential routes:

- `GET /companies` - list qualified companies and queue state.
- `GET /companies/:companyId` - company intelligence detail.
- `POST /companies/:companyId/qualify` - run deterministic qualification.
- `POST /companies/:companyId/discover` - run the approved discovery waterfall.
- `GET /companies/:companyId/contacts` - list ranked contact candidates.
- `POST /contacts/:contactCandidateId/approve` - approve for outreach.
- `POST /contacts/:contactCandidateId/reject` - reject with reason.
- `POST /contacts/:contactCandidateId/link-crm-contact` - link to or create a CRM contact after approval.
- `GET /queue` - review queue for companies/contacts needing manual action.
- `GET /runs` - discovery run audit/cost log.

Guardrails for future API implementation:

- Tenant scope every query.
- Require auth for review/admin routes.
- Internal-token auth only for background jobs.
- Never expose secrets or raw provider payloads unnecessarily.
- Alias columns when joining `contacts` and Wizmatch tables to avoid ambiguous Postgres columns.

## 13. UI Proposal, But No UI Changes Yet

No UI changes are part of this PRD.

Future admin UI could add a Wizmatch "Contact Intelligence" page with:

- Queue of companies needing qualification, discovery, or review.
- Company detail drawer showing signals, requirements, candidates, qualification reasons, and relationship history.
- Ranked contact cards with source, title, confidence, deliverability, score explanation, and cost.
- Review actions: approve, reject, request more discovery, add manual contact, mark do-not-contact.
- Cost panel: per-company spend, daily spend, remaining budget.
- Filters: region, tier, status, source, score, stale/discovery needed.
- Audit timeline: qualification, discovery, approval, outreach, reply, placement.

UI should keep manual review central. It should not become a one-click mass-enrichment or mass-send tool.

## 14. Cost-Control Rules

Cost control is a core feature, not an implementation detail.

Rules:

- Do not run paid enrichment for every company.
- Paid enrichment only for Tier A companies by default.
- Tier B paid enrichment requires manual approval or a very strong active signal.
- Tier C and rejected companies receive no paid enrichment.
- Reuse CRM/internal data before vendor calls.
- Cache discovery results and avoid re-enriching the same company/contact inside a cooldown window.
- Cap contacts discovered per company.
- Cap paid provider calls per company, per day, and per month.
- Stop the waterfall after enough verified contacts are found.
- Log provider, cost estimate, result count, and failure reason for every paid run.
- Prefer deterministic scoring/ranking before AI.
- Use AI only for summarization or explanation where it materially helps review.

## 15. Failure Cases

Expected failure cases:

- Company has no usable domain.
- Company is not IT/Tech or signal is not technical.
- Company is a duplicate or already in an active outreach path.
- Company/contact is suppressed or do-not-contact.
- Contact title is stale or unverifiable.
- Paid provider returns irrelevant people.
- Paid provider returns unverifiable or catch-all emails.
- Email verification fails.
- Rate limits or provider outage.
- Company has a valid signal but no available matching candidates.
- Region mismatch: US contact for India-only requirement, or India contact for US-only vendor path.
- Manual reviewer rejects all contacts.
- Domain health is paused or degraded.
- Existing relationship indicates a cooldown or negative history.

Failures should produce explicit statuses and reasons, not silent drops.

## 16. Guardrails

Product guardrails:

- Internal Growth Escalators/Wizmatch use only.
- IT/Tech staffing only.
- India-first priority with selective US enrichment.
- Manual approval before outreach.
- No mass enrichment without qualification.
- No automatic sending directly from discovery.
- Respect suppression, unsubscribe, bounce, and do-not-contact state.

Engineering guardrails for future implementation:

- No schema changes without explicit migration planning.
- No route/UI changes until PRD and technical plan are accepted.
- Preserve tenant isolation.
- Preserve CRM contact normalization rules.
- Bump `lastActivityAt` on future contact writes.
- Alias joined columns between `contacts` and Wizmatch tables.
- Log costs and provider failures.
- Do not put provider credentials in code or docs.

## 17. Implementation Phases

Phase 0 - Planning

- Approve this PRD.
- Decide whether Contact Intelligence should extend existing Wizmatch tables or use new dedicated tables.
- Create implementation ADR before schema/API work.

Phase 1 - Company qualification

- Add deterministic qualification scoring.
- Classify companies into Tier A/B/C/Reject.
- Keep it zero-cost and explainable.

Phase 2 - Internal and free discovery

- Reuse CRM contacts and previous Wizmatch relationships.
- Add free/company-source discovery where practical.
- Create reviewable contact candidates without paid calls.

Phase 3 - Paid discovery waterfall

- Enable Apollo/Hunter/MillionVerifier only behind qualification and caps.
- Add audit/cost logging.
- Add retry and cooldown rules.

Phase 4 - Manual review workflow

- Add queue and review actions.
- Require approval before outreach.
- Link approved contact candidates to CRM contacts/channels.

Phase 5 - Outreach integration

- Feed approved contacts into existing draft/review/send flow.
- Preserve suppression and domain health checks.
- Track replies and placement outcomes back into relationship score.

Phase 6 - Analytics and feedback loop

- Report cost per approved contact, reply, positive reply, and placement.
- Improve qualification/ranking based on outcomes.
- Add stale-contact refresh rules.

## 18. Acceptance Criteria

For this documentation PR:

- PRD exists at `docs/prd/001-contact-intelligence.md`.
- PRD explicitly states internal-only, IT/Tech-only, India 80% / US 20%, no paid enrichment for every company, and manual approval before outreach.
- PRD includes data model/API/UI proposals without implementing them.
- No source, schema, route, UI, package, migration, or deployment file changes.

For the future implementation:

- System qualifies companies before contact discovery.
- Paid enrichment only runs for qualified companies and within budget caps.
- Contact ranking is explainable and uses relationship history.
- Manual reviewer can approve/reject contacts before outreach.
- Suppression/do-not-contact/domain-health guardrails block unsafe outreach.
- India-first prioritization is visible in qualification and ranking.
- Tests cover qualification, ranking, cost caps, suppression, and approval gates.

## 19. Explicitly Out Of Scope

- Any code implementation in this PR.
- Database schema changes in this PR.
- API route changes in this PR.
- Admin/client UI changes in this PR.
- Railway/Vercel/deployment changes.
- Non-tech staffing.
- HRMS, payroll, attendance, timesheets, onboarding, or generic SaaS features.
- Automatic outreach without manual approval.
- Expensive enrichment across all companies.
- Replacing the existing Wizmatch signal/candidate/placement pipeline.
- Candidate sourcing changes unrelated to contact intelligence.
- Public SaaS packaging or multi-customer billing.
