# PRD 004: Wizmatch Staffing Operating System

- **Status:** Draft implementation brief for product approval
- **Owner:** Growth Escalators / Wizmatch
- **Date:** 2026-07-13
- **Last source review:** 2026-07-13
- **Canonical path:** `docs/prd/004-wizmatch-staffing-operating-system.md` — do not duplicate
- **Scope:** Target product contract, operating model, and phased implementation blueprint
- **Pilot:** Internal IT/Tech staffing; SAP and Java first; India-first with selective US work

This document does **not** itself approve a database migration, production data change, deployment,
paid-provider call, cold-email send, or candidate submission. Those actions remain subject to the
guardrails in `AGENTS.md` and the approval gates in this PRD.

Its product direction remains draft until confirmed in
`docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md`. Phase 0 repairs that restore truthful existing
behavior may proceed independently when they do not cross another approval gate. Dated audit
observations are evidence; their suggested fixes are not automatically approved architecture.

## 0. How to use this document

This is the canonical product brief for turning the current Wizmatch modules into a connected
staffing operating system. It is intended to survive individual chats, tools, and implementation
sessions.

Implementation entry points:

- Documentation/source-of-truth index: `docs/wizmatch/README.md`
- Reusable Claude Code prompt: `docs/wizmatch/WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md`
- Current audit-remediation status: `docs/wizmatch/WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md`
- Human-owned decisions: `docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md`

The PRD lives only at the canonical path above. Link to it; never copy it to the repository root or
create another “final”, “latest”, “master”, or “v2” version.

The three labels used throughout are:

- **AS-IS:** Confirmed current behavior or a dated audit finding.
- **TARGET:** Behavior that the implementation must deliver.
- **FUTURE:** Deliberately deferred concepts that must not expand the first implementation without
  a new decision.

### Source precedence

When sources conflict, use this order:

1. Current code and current environment evidence.
2. A newer dated audit or verified dataflow trace.
3. This PRD for desired product behavior.
4. Older PRDs, design notes, operator guides, and generated summaries.

Never change the target silently because the current code behaves differently. Record the gap and
either implement the target or raise a product decision. Never trust a dated operational fact
without re-verifying it before a production-sensitive action.

### Required startup reading for an implementation agent

1. `AGENTS.md`
2. `CLAUDE.md` when using Claude Code
3. `docs/wizmatch/README.md` and its safe required-reading allowlist
4. `docs/wizmatch/WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md`
5. This PRD
6. `.ai/CURRENT_TASK.md`
7. `.ai/CURRENT_STATE.md`
8. `.ai/REVIEW_CHECKLIST.md`
9. `docs/reviews/wizmatch-client-funnel-audit-2026-07-12.md`
10. `docs/wizmatch/DATAFLOW.md`
11. `docs/PRODUCT_SYSTEM_BRIEF.md`
12. The relevant source files and tests

Some current documents have drifted. For example, `docs/wizmatch/DATAFLOW.md` says several
Wizmatch tables are not in `src/db/schema.ts`, while the current schema does define candidates,
placements, requirements, company intelligence, contact candidates, and discovery runs. Code wins;
the conflicting document should be corrected as part of the appropriate implementation unit.

## 1. Executive summary

Wizmatch should become the team's staffing control room. It should connect one traceable business
chain:

```text
Hiring signal
  -> company
  -> named hiring contact
  -> confirmed requirement
  -> candidate match
  -> recruiter-verified shortlist
  -> candidate consent / right-to-represent (RTR)
  -> client submission
  -> interview and feedback
  -> offer
  -> joining / placement
  -> invoice, collection, revenue, and margin
```

Every active item must answer:

- Who owns it?
- What is its current stage?
- What happened most recently?
- What is the next action?
- When is that action due?
- Who supplied or approved the work?
- What evidence supports its score or recommendation?
- What operational and commercial outcome did it produce?

The principal product requirement is simple:

> At Company A, the system must show that Person A supplied the SAP role and Person B supplied the
> Java role, with separate candidates, communication, submissions, interviews, outcomes, and
> economics for each requirement.

## 2. Business outcomes and non-goals

### Outcomes

- Convert public hiring evidence into relationships with named hiring people.
- Preserve which person supplied, manages, approves, or interviews for each requirement.
- Give recruiters exact, explainable candidate-to-requirement matches.
- Reduce time to first qualified shortlist.
- Prevent duplicate or unapproved candidate submissions.
- Make client feedback, interviews, offers, and starts visible and actionable.
- Retain relationship and delivery history when team ownership changes.
- Forecast starts, permanent fees, contract billings, gross margin, and collections from real
  pipeline stages.
- Learn which companies, contacts, requirements, skills, sources, and team members actually convert.

### Non-goals for the first release

- Generic HRMS, payroll, attendance, or employee-performance management.
- Non-technical mass-market recruitment.
- Fully autonomous client outreach or candidate submission.
- A public multi-tenant SaaS product.
- Replacing human screening or client qualification with one AI score.
- Building every future integration before the core staffing chain works.

## 3. Strict business vocabulary

These definitions must be used in the database, API, UI, analytics, tests, and team SOPs.

| Term | Strict definition |
|---|---|
| Hiring signal | Public or imported evidence that a company may be hiring. It is not a client requirement. |
| Hiring contact | A named TA, HR, hiring manager, vendor manager, procurement person, or other person involved in staffing. |
| Engaged contact | A named person with a human two-way response. Bounces, auto-replies, and out-of-office messages do not qualify. |
| Confirmed requirement | A role supplied or explicitly confirmed by a named person, with enough information to qualify it. |
| Accepted requirement | A confirmed requirement that the team has decided is workable and assigned an owner, recruiter, SLA, and next action. |
| Candidate match | A system recommendation for one candidate–requirement pair. It is not a human decision. |
| Shortlist | A recruiter-verified candidate–requirement decision with evidence and notes. It is not a client submission. |
| Consent / RTR | The candidate agreed to be represented for the exact client/requirement under the recorded terms. |
| Submission | A unique, consented candidate–requirement pair actually sent to a named client contact. |
| Interview | A client interview round linked to one submission, with schedule, participants, status, and feedback. |
| Offer | A specific actionable offer linked to one submission. It is not a start. |
| Start / joining | The candidate started work. This is the operational placement close. |
| Invoice | A bill raised under the applicable commercial terms. It is not cash collection. |
| Collection | The invoice has been paid. This is the financial close. |

Raw sends, scraped profiles, AI scores, internal matches, and generated PDFs are activity, not
business outcomes.

## 4. Personas, ownership, and permissions

Small teams may combine roles, but ownership remains explicit.

| Role | Primary responsibility |
|---|---|
| Sales / business development | Target companies, identify contacts, perform first outreach, qualify interest. |
| Account manager | Own client relationship, requirement intake, commercial details, feedback, and client-side coordination. |
| TA / delivery lead | Accept or reject requirements, set search strategy and SLA, assign recruiters, review coverage and quality. |
| Recruiter | Source, screen, verify, obtain consent, prepare submissions, and coordinate the candidate side. |
| Operations | Data quality, deduplication, stage hygiene, documentation, SLA exceptions, placement administration. |
| Business owner | Priorities, capacity, exceptions, client concentration, revenue, gross margin, and collections. |

### Ownership rules

- Every company account has one accountable owner.
- Every accepted requirement has one account owner and one delivery owner; it may have multiple
  assigned recruiters.
- Every candidate has a current talent owner, without preventing other authorized recruiters from
  using the profile.
- Every submission records the submitting recruiter and client-facing owner.
- Reassignment writes an audit event and creates a My Work item for the new owner.
- No handoff may exist only in WhatsApp, Slack, email, or a private spreadsheet.

## 5. AS-IS baseline

### Useful foundations to preserve

The repository already contains valuable components:

- Multi-tenant CRM contacts and channels.
- Wizmatch companies and job signals.
- Requirement intake and requirement-sheet generation.
- Company qualification, contact discovery, and cost guardrails.
- Candidate records, intake, deterministic scoring, and candidate matching.
- Placements and commercial fields.
- Review Workbench, analytics, readiness, and environment-health surfaces.
- Manual review gates for contact use, paid discovery, sending, and candidate actions.

The July 2026 live audit specifically found strong patterns worth preserving:

- Honest Analytics / ROI diagnostics.
- Environment checks that never expose secret values.
- Manual and cost guardrails.
- Inline review-action results.
- Transparent score components.
- Requirement Priority when supplied with meaningful data.
- Requirement-sheet generation.
- Contact Intelligence review-state transitions.

### Structural gaps to resolve

The current product is largely company-and-signal-first rather than person-and-requirement-first.
Source review and the dated live audit identify these gaps:

1. Requirements can reference a company, but do not reliably identify the person who supplied the
   role, all coordinating contacts, the accountable owner, stage age, or a persisted next action.
2. Contact candidates belong to a company and are not tied to the requirements each person supplied
   or manages.
3. Placements reference candidates and companies/signals, but not a first-class submission chain
   back to the exact requirement and source contact.
4. There is no durable first-class submission and interview-round model.
5. Candidate review currently stores one latest JSON review intent and top requirement; a later
   review can overwrite the prior candidate–requirement decision.
6. Candidate and requirement skills are mostly free-text arrays without a canonical taxonomy,
   alias model, evidence, recency, or verification.
7. Matching can treat substrings and broad labels as equivalence. This creates risks such as Java
   versus JavaScript and SAP family versus SAP specialization confusion.
8. Rate comparisons are not consistently normalized for currency and hourly/monthly/annual periods.
9. Requirement prioritization can use tenant-wide contact readiness rather than a contact path for
   the specific company/requirement.
10. Authenticated pages can fall back to plausible demo data, which makes failures appear healthy.
11. Activity, reply, message, and event paths require a source-level repair pass so sends, replies,
    last activity, and requirement/contact timelines agree.
12. Existing live and demo Contact Intelligence surfaces contain complementary features; a simple
    route swap would lose functionality. They must be consolidated deliberately.

The 2026-07-12 live audit covered the client-acquisition side. Candidate-side findings above are
source-review findings and target-design conclusions until a separate authenticated candidate-side
live audit is completed.

## 6. TARGET domain graph

```text
Tenant
  -> Company
      -> Hiring contacts
          -> Requirements supplied / managed / approved
              -> Requirement skills and terms
              -> Candidate matches
                  -> Recruiter shortlists
                      -> Candidate consent / RTR
                          -> Submissions
                              -> Interview rounds and feedback
                                  -> Offer
                                      -> Start / placement
                                          -> Invoice / collection / margin

Across every level:
  owner + stage + last activity + next action + due date + complete timeline
```

### Required relationship behavior

- One company can have many hiring contacts.
- One contact can supply or coordinate many requirements.
- One requirement can involve several contacts with different roles.
- One candidate can match and be shortlisted independently for many requirements.
- One candidate–requirement pair can have at most one active client submission, with a complete
  immutable transition history.
- One submission can have several interview rounds and one or more offer revisions.
- One start/placement must trace to the exact submission, requirement, candidate, company, and
  relevant hiring contact.
- Historical records remain visible after ownership or status changes.

## 7. Target data contracts

Exact table and API names require an architecture decision and schema approval. The contracts below
describe required behavior, not permission to edit guarded files.

### 7.1 Company and hiring-contact relationship

Use the canonical CRM contact after a discovered contact is approved and linked. Preserve discovery
provenance separately.

Required company-contact facts:

- Company and CRM contact IDs
- Relationship role: source, hiring manager, TA, coordinator, approver, interviewer, procurement,
  vendor manager, or other
- Seniority and business unit
- Verified email/phone/LinkedIn channels
- Relationship stage
- Contacted/replied/qualified state
- Last activity and next action
- Owner
- Source and confidence
- Do-not-contact and suppression state

### 7.2 Requirement

Required facts:

- Tenant, company, and immutable requirement ID
- Primary source contact; mandatory before moving from draft to confirmed
- Additional requirement contacts and their roles
- Account owner, delivery owner, assigned recruiters
- Original JD, parsed version, attachments, and version history
- Title, family, seniority, required and preferred skills
- Experience, location, work mode, employment type, vacancies
- Budget/rate, currency, period, fee/markup terms, priority, urgency
- Received date/channel, acceptance decision, SLA target
- Current stage, stage-entered date, last activity, next action, due date
- Loss/hold/closure reason
- Data-quality and fillability flags

If the source person is unknown for a historical requirement, store `unknown`/`needs_attribution`.
Never infer a person from tenant-wide contacts.

### 7.3 Canonical skills

Recommended concepts:

- Skill family: SAP, Java, Salesforce, Data Engineering
- Specialization: SAP ABAP, SAP FICO, Java Backend
- Version/platform: S/4HANA, ECC, Java 17
- Alias: raw phrases mapped to a canonical skill
- Requirement type: mandatory or preferred
- Candidate experience years and last-used date
- Evidence: project, employer, certification, resume excerpt, recruiter verification
- Confidence and verification status

Examples:

- JavaScript must not satisfy mandatory Java.
- SAP FICO must not satisfy mandatory SAP ABAP.
- SAP ABAP may satisfy a deliberately broad SAP-family preference, but the UI must explain that it
  is a family-level match rather than claim specialization equivalence.
- `S/4 HANA Finance`, `SAP FI/CO`, and `SAP FICO` may map through reviewed aliases without losing the
  raw source phrase.

### 7.4 Candidate

Required facts:

- Canonical CRM contact and candidate IDs
- Name and normalized contact channels
- Resume and profile provenance
- Canonical skill passport with evidence
- Total and skill-specific experience
- Location, work authorization, preferred mode
- Current compensation/rate with currency and period
- Expected compensation/rate with currency and period
- Availability, notice period, and last-confirmed date
- Current owner and last/next action
- Consent preferences, suppression state, and retention status
- Full shortlist, submission, interview, offer, and placement history

Profile readiness is separate from fit to any particular role.

### 7.5 Candidate–requirement match

Persist a distinct record or immutable snapshot for every evaluated pair:

- Candidate and requirement IDs
- Match score and score-model version
- Mandatory skills matched/missing
- Preferred skills matched/missing
- Experience, recency, location, work-mode, availability, and rate comparisons
- Hard blockers
- Human decision: unreviewed, shortlisted, watch, rejected, blocked
- Reviewer, notes, reason, and timestamp
- Recalculation history or sufficient inputs to explain a later score change

An internal match must never be counted as a submission.

### 7.6 Submission

Submission is a first-class business record, not a placement status or a message side effect.

Required facts:

- Tenant, requirement, candidate, company
- Primary client recipient and other copied contacts
- Account owner and recruiter
- Shortlist evidence and consent/RTR state
- Submitted timestamp, channel, version of profile sent
- Current stage and stage-entered timestamp
- Client feedback, rejection/withdrawal reason, next action, due date
- Duplicate/idempotency key
- Complete transition history

Recommended uniqueness: one active submission for a tenant + requirement + candidate pair. A resend
updates the history; it does not manufacture another candidate.

### 7.7 Interviews, offers, placement, and finance

Interview rounds must capture:

- Submission, round number/type, date/time/time zone
- Interviewers and meeting details
- Confirmation state for client and candidate
- Feedback from both sides
- Outcome, reason, next action, due date

Offers must capture compensation/rate, start date, status, revisions, and acceptance/decline reason.

Placements must trace to submission and requirement and retain permanent/contract economics. Finance
must distinguish booking, invoicing, collection, refund/replacement exposure, contract billing, and
gross margin.

### 7.8 Work items and activity timeline

Prefer extending the existing task/event infrastructure when it can provide strict tenant scoping,
entity references, and auditability. Introduce a new staffing activity model only when an ADR proves
the existing model cannot meet the contract.

Every material event should identify applicable entities:

- Company
- Contact
- Requirement
- Candidate
- Submission/interview/placement
- Actor, channel, direction, timestamp, and source

Every active company opportunity, accepted requirement, and open submission must have a dated next
action. Completing, reassigning, or changing a stage should update My Work and write a timeline event.

## 8. State machines

Exact transition enforcement belongs in domain services, not only in UI labels.

### 8.1 Client relationship

```text
target -> contact_ready -> contacted -> engaged -> qualified
       -> requirement_received -> active_client

Any non-terminal stage -> dormant / closed_lost / suppressed
```

### 8.2 Requirement

```text
draft -> qualifying -> accepted -> sourcing -> covered
      -> submitted -> interviewing -> offer -> filled

qualifying/accepted/... -> on_hold / closed_lost / cancelled
on_hold -> accepted or closed_lost
```

`Accepted` requires complete minimum intake, owner, recruiter/SLA, and next action. `Covered` means at
least one qualified, available, consent-ready candidate within the applicable SLA.

### 8.3 Candidate global readiness

```text
unverified -> verified -> available
available -> unavailable / benched / placed
any active state -> suppressed / archived
```

This state is global. Shortlist and submission stages remain requirement-specific.

### 8.4 Submission

```text
shortlisted -> consent_pending -> rtr_confirmed -> submitted
            -> client_shortlisted -> interview_scheduled
            -> interview_completed -> offered -> accepted -> joined
```

Terminal or exception states:

- Rejected
- Withdrawn
- No-show
- Duplicate
- Role closed
- Offer declined
- Did not join

Every terminal state requires a reason code and optional notes.

### 8.5 Commercial close

```text
joined -> placement_confirmed -> invoice_ready -> invoiced -> collected
                                  -> disputed / replacement / refunded
```

Contract work also needs active, extended, ending, ended, and early-termination states.

## 9. Matching and scoring

### 9.1 Four separate scores

Never collapse these into one opaque “success” number:

| Score | Question |
|---|---|
| Relationship / conversion chance | Is this company/contact likely and permitted to work with us? |
| Requirement fillability | Can this requirement be filled at the stated skills, budget, location, and timeline? |
| Candidate readiness | Is the candidate verified, reachable, available, and willing to proceed? |
| Candidate–requirement fit | Does this candidate match this exact role? |

### 9.2 Match order

1. Apply hard blockers.
2. Resolve canonical skills and mandatory-skill coverage.
3. Compare years, recency, evidence, and seniority.
4. Compare location, work mode, work authorization, and availability.
5. Normalize and compare compensation/rate.
6. Calculate an explainable weighted score.
7. Store model version and component explanation.
8. Require human shortlist approval.

Hard blockers include suppression, missing consent when submitting, incompatible authorization,
missing mandatory skills, unavailable candidate, or a prohibited duplicate submission.

Urgency may prioritize recruiter work, but it must not artificially increase technical candidate fit.

### 9.3 Compensation normalization

Never compare a candidate hourly rate directly with a requirement monthly or annual budget.

Store and display:

- Amount
- Currency
- Period: hourly, daily, monthly, annual, fixed fee
- Employment/engagement type
- Conversion assumptions and date/rate source when normalization is shown

Commercial feasibility and candidate fit should remain separate when currency or terms are unknown.

### 9.4 Calibration

- Start with deterministic, explainable rules.
- Store outcomes and rejection reasons.
- Calibrate weights only after sufficient 60–90-day cohorts exist.
- Show sample size and model version.
- Allow human override only with a reason.
- Never promote a score as probability unless it has been calibrated against outcomes.

## 10. Information architecture

### 10.1 My Work / Today

A personalized action queue grouped into:

- Due today
- Overdue
- Waiting on client
- Waiting on candidate
- Needs internal review
- Blocked or at risk

Each row shows company, hiring contact, requirement, candidate/submission where applicable, owner,
age, last activity, next action, and due time. My Work is a view over real records and tasks, not a
separate unconnected database.

### 10.2 Company 360

- Account owner, relationship stage, qualification, and account health
- All hiring contacts and their roles/channels
- Contacted/replied/qualified state and last/next action for each person
- Requirements supplied or managed by each person
- Active and closed requirements
- Submission, interview, offer, placement, revenue, and margin totals
- One chronological activity timeline

This page must answer: “Priya supplied SAP; Rahul supplied Java.”

### 10.3 Hiring Contact 360

- Contact identity, role, company, and channels
- Relationship/provenance and permission state
- Requirements supplied/managed
- Communication timeline
- Open next actions
- Outcomes and revenue influenced

### 10.4 Requirement 360

- Company and source hiring person, both mandatory for a confirmed role
- All coordinating/decision contacts
- Owners, recruiters, SLA, priority, and stage age
- Original JD, structured terms, and version history
- Required versus preferred skills
- Explainable ranked candidates and coverage gaps
- Shortlist and submission board
- Calls, messages, notes, interviews, feedback, decisions, and next action
- Commercial potential and final result

### 10.5 Talent / Candidate 360

- Contact information, resume, and profiles
- Skill passport and verification evidence
- Experience, compensation, location, availability, and last confirmation
- Matching requirements with explanations
- Contact/consent/RTR state per requirement
- Complete submission, interview, offer, and placement history
- Owner and next action

### 10.6 Submissions and interviews

A requirement-specific operational board:

```text
Shortlisted -> Consent/RTR -> Submitted -> Client shortlist
            -> Interview rounds -> Offer -> Accepted -> Joined
```

Support terminal exception states with reason codes. Do not use a generic placement row as the only
record of the entire delivery funnel.

### 10.7 Analytics and System

- Analytics: true funnel totals, cohorts, SLA, conversion, capacity, revenue, and margin.
- System: readiness, environment presence, domain health, suppression, cost guards, audit, and
  integration failures.

Keep diagnostics out of daily operating screens except when a specific blocker affects the work.

### 10.8 UX trust requirements

- Authenticated API failures must show an honest error/retry state, never plausible demo records.
- Empty states explain why the queue is empty and how to create the next valid record.
- Headline counts are true totals, not the current page size.
- Action feedback appears next to the control that produced it.
- Scores show scale, components, evidence, and blockers.
- Deep links open the exact item, not a generic list where the user must search again.
- Preserve the best current live and newer/demo Contact Intelligence behaviors in one production
  component; do not route-swap away discovery or review functionality.

## 11. End-to-end workflows

### 11.1 Hiring signal to confirmed requirement

1. Ingest or add a verified IT/Tech hiring signal.
2. Qualify the company without paid enrichment first.
3. Find, approve, and link one or more named hiring contacts.
4. Contact the person and record delivery/reply state.
5. Qualify authority, hiring need, vendor process, urgency, and commercial openness.
6. Create a requirement only after a named person supplies or confirms it.
7. Complete intake, accept/reject the requirement, assign owners/recruiters, and set SLA/next action.

### 11.2 Requirement to first shortlist

1. Parse or enter the JD and verify structured facts.
2. Normalize required/preferred skills and commercial units.
3. Calculate fillability and identify missing intake information.
4. Search reusable verified candidates first, then source additional candidates.
5. Screen candidates and record skill evidence, availability, compensation, and concerns.
6. Persist recruiter shortlist decisions per exact requirement.
7. Deliver the first qualified shortlist within SLA.

### 11.3 Shortlist to submission

1. Explain the exact opportunity to the candidate.
2. Confirm current availability and terms.
3. Obtain and record consent/RTR for that requirement.
4. Perform internal quality control where required.
5. Create a unique submission and record what was sent, to whom, by whom, and when.
6. Create the client-feedback next action automatically.

### 11.4 Interview to joining

1. Record client shortlist decision and feedback.
2. Schedule interview with time zone and confirmations.
3. Capture client and candidate feedback the same day.
4. Record each additional round.
5. Record offer, revisions, acceptance/decline, notice handling, and joining risk.
6. Confirm start, placement economics, invoice trigger, and ownership.
7. Update candidate availability and close/recalculate other active submissions safely.

### 11.5 Exception workflows

Explicit flows are required for:

- Incomplete or unworkable requirement
- Client no response
- Candidate no response or withdrawal
- Duplicate submission
- Interview no-show/reschedule
- Role on hold/reopened/closed
- Offer decline/counter-offer/did-not-join
- Replacement/refund
- Contract extension or early termination
- Reusing one candidate for another requirement without overwriting history

## 12. Team operating model

### Daily rhythm

**Morning, 15 minutes**

- Operations flags system/data issues, unowned work, and SLA breaches.
- Account owners review replies and client follow-ups.
- TA lead accepts and prioritizes new complete requirements.
- Recruiters confirm top roles and expected shortlist delivery.
- Owner handles only high-value, blocked, or capacity exceptions.

**Production work**

- Sales/account performs targeted outreach, qualification, intake, and feedback follow-up.
- Recruiters source, screen, verify, obtain consent, submit, and update candidates.
- TA lead adjusts search strategy and reviews weak coverage or critical shortlists.
- Operations fixes duplicates, missing fields, delivery failures, and stage hygiene.

**End of day**

- Log every call, message, decision, interview, and rejection reason.
- Set a dated next action for every active requirement and submission.
- Escalate overdue client feedback and inactive requirements.
- Send the owner an exception digest rather than a long activity report.

### Initial service levels

| Activity | Starting target |
|---|---|
| Acknowledge inbound client reply | Within 2 working hours |
| Complete new requirement intake | Within 4 working hours |
| TA acceptance and recruiter assignment | Same business day |
| Recruiter kickoff | Same business day |
| First shortlist, common role | Within 24 hours |
| First shortlist, niche/SAP role | Within 48 hours |
| Candidate consent before submission | Mandatory |
| Client feedback follow-up | Within 24 working hours, then every 2 business days |
| Interview scheduling | Same business day |
| Interview feedback request | Within 2 hours; escalate after 24 hours |
| Log calls/messages/decisions | Same business day |
| No requirement activity | At risk after 3 business days |
| No client response | Escalate after 5 business days |

### Weekly rhythm

- Monday: requirement priorities, recruiter capacity, shortlist/submission targets.
- Wednesday: scarce skills, weak coverage, overdue feedback, slow clients.
- Friday: submissions, interviews, offers, starts, rejection reasons, stale work.
- Monthly: conversion and economics by company, person, skill, source, and team member.

## 13. Metrics, closing, and economics

### 13.1 Three linked funnels

**Employer acquisition**

```text
target account -> contact ready -> contacted -> engaged -> qualified client
               -> requirement received -> active client
```

**Requirement delivery**

```text
received -> qualified -> accepted -> sourcing -> covered
         -> submitted -> interviewing -> offer -> filled
```

**Candidate submission**

```text
shortlisted -> consent -> submitted -> client shortlisted
            -> interviewed -> offered -> accepted -> joined
```

### 13.2 Required formulas

- Contact coverage = approved named contacts / qualified target accounts
- Touch coverage = unique approved contacts contacted / approved contacts
- Positive engagement = human positive/two-way engagements / delivered first-touch contacts
- Workable requirement rate = accepted requirements / requirements received
- SLA coverage = accepted requirements with at least one qualified submission within SLA /
  accepted requirements
- Submission-to-interview = scheduled or completed client interviews / unique submissions
- Interview-to-offer = offers / completed interviews
- Offer acceptance = accepted offers / offers
- Join rate = starts / accepted offers
- Fill rate = placements / accepted requirements, reported by 60–90-day requirement cohort
- Time to first shortlist = first qualified shortlist time - requirement accepted time
- Time to fill = start date - requirement accepted date
- Next-action hygiene = open work with dated next action / all open work

Page sizes, repeated sends, auto-replies, and internal matches must not inflate these metrics.

### 13.3 Illustrative one-pod planning model

These are internal planning assumptions, not guarantees or external industry benchmarks. Assumptions:
one account lead, two recruiters, 20 working days/month, India-first IT staffing, quality-controlled
outreach, and a 60–90-day ramp.

| Stage | Conservative | Base | Strong |
|---|---:|---:|---:|
| Target accounts with verified hiring signal | 100 | 150 | 220 |
| Approved named hiring contacts | 60 | 105 | 165 |
| Unique contacts reached | 50 | 90 | 145 |
| Positive human engagements | 5 | 12 | 23 |
| Qualified client accounts | 2 | 5 | 10 |
| Requirements received | 3 | 8 | 18 |
| Requirements accepted to work | 2 | 6 | 14 |
| Qualified candidate submissions | 6 | 24 | 63 |
| Client interviews | 2 | 8 | 22 |
| Offers | 1 | 3 | 8 |
| Expected starts | Usually 0–1 | About 2 | About 5 |

Base-case equation:

```text
6 accepted requirements x 4 submissions = 24 submissions
24 x 33% submission-to-interview = about 8 interviews
8 x 37.5% interview-to-offer = about 3 offers
3 x 67% offer-to-start = about 2 starts
```

Use rolling three-month averages and requirement cohorts. Small monthly samples will be volatile.
Report referral/inbound and cold outbound separately.

### 13.4 Commercial formulas

Permanent placement:

```text
fee revenue = annual CTC x agreed fee percentage
```

Contract staffing:

```text
monthly billing = active consultants x bill rate x billable hours
monthly gross margin = active consultants x (bill rate - loaded pay rate) x billable hours
gross margin percentage = gross margin / billing
```

Loaded pay cost must include statutory burden, vendor costs, bench exposure, and expected bad debt.
Permanent revenue needs replacement/refund exposure. Booking, invoicing, and collection are separate.

### 13.5 North-star measures

- Accepted workable requirements
- Requirements covered within SLA
- Starts
- Gross margin and collected cash

Raw profile volume, scraped emails, provider calls, and AI scores are supporting activity measures.

## 14. Phased implementation roadmap

Do not implement this PRD as one rewrite. Each phase must be split into coherent, independently
testable vertical slices with a clear compatibility plan.

### Phase 0: Trust and correctness

Goal: operators can trust what they see and what the system records.

- Remove plausible demo-data fallback from authenticated production paths.
- Fix requirement parse authentication through the canonical tenant-aware auth helper.
- Correct message/event/activity field usage and verify conversation queries.
- Make outreach/reply paths update the correct contact activity and timeline.
- Consolidate live and newer Contact Intelligence behavior without losing discovery, approval,
  manual-add, CRM-link, or cost-guard functionality.
- Fix true totals versus fetch limits and misleading success/queue messages.
- Add honest loading, error, retry, and empty states.
- Re-verify the P0/P1 findings in the dated live audit before editing code.

Exit criteria:

- Authenticated failures never show fabricated records.
- Requirement parsing works with a Wizmatch session.
- Contacted/replied/last-activity facts reconcile across screens and API.
- Queue totals are truthful.
- No safe current workflow regresses.

### Phase 1: Core staffing domain spine

Goal: connect company, people, requirements, ownership, and activity.

- Requirement-contact attribution and roles.
- Requirement owner, delivery owner, recruiters, stage, stage date, SLA, last/next action.
- Requirement activity timeline.
- Company 360 and Hiring Contact 360 APIs.
- Backfill historical rows without inventing missing people.

This phase requires a schema/architecture approval gate before guarded-file edits.

### Phase 2: Candidate intelligence and persistent decisions

- Canonical skill family/specialization/alias model.
- Candidate and requirement skill evidence.
- Compensation normalization.
- Persisted, versioned candidate–requirement matches.
- Persistent recruiter shortlist decisions.
- Candidate readiness and availability refresh.
- SAP/Java pilot taxonomy and edge-case tests.

### Phase 3: Delivery pipeline

- Consent/RTR records.
- First-class submissions and duplicate protection.
- Interview rounds, feedback, offers, joining, and placement traceability.
- Candidate/client next actions.
- Requirement and candidate availability derived safely from outcomes.

### Phase 4: Operating workspaces

- My Work / Today.
- Company 360.
- Requirement 360.
- Talent 360.
- Submissions/interviews workspace.
- SLA, aging, workload, and exception views.
- Retire duplicate/demo/orphaned pages only after production replacements pass QA.

### Phase 5: Analytics and forecasting

- True acquisition, delivery, and submission funnels.
- Cohort conversion, SLA, time-to-fill, and rejection reasons.
- Account/recruiter/skill/source performance.
- Permanent fee, contract billing, gross margin, replacement exposure, invoice, and collection.
- Separate relationship, fillability, readiness, and fit scores.

### Phase 6: Controlled automation

Only after manual workflows and outcome data are reliable:

- Next-action reminders and stale-work escalation.
- Match recalculation when requirements/candidates change.
- Candidate availability refresh prompts.
- Safe client/candidate drafts.
- Paid discovery only through the existing preview, cost, and approval guards.
- Sending only through the explicit sending go-live process.
- Outcome-based scoring calibration with versioning and sample-size disclosure.

## 15. Migration and historical-data strategy

Before any schema edit, the implementation agent must present and receive explicit approval for:

- Proposed tables, columns, relationships, indexes, and uniqueness constraints
- Tenant-scoping rules
- Generated migration plan
- Backfill and compatibility plan
- Rollback strategy
- Tests and environment verification

Required migration behavior:

- Prefer additive, backward-compatible changes.
- Never edit already-applied SQL.
- Use the repository-approved Drizzle generation path and inspect generated SQL.
- Never bypass an approval gate with raw SQL, an ad hoc ensure-table hook, or opaque JSON state.
- Preserve IDs, notes, messages, documents, and activity history.
- Mark unknown source contacts as `needs_attribution`; never invent them.
- Treat legacy candidate review JSON as legacy review evidence, not proof of client submission.
- Mark legacy placements without a traceable requirement/submission as `legacy_unattributed` until
  evidence supports a link.
- Backfill raw skills to an alias-review queue; do not silently mark inferred skills as verified.
- Use feature flags or dual-read compatibility where partial rollout could create mixed states.
- Provide a dry run and data-quality report before production backfill.

## 16. Security, compliance, and reliability

- Preserve strict tenant isolation in every query and uniqueness constraint.
- Define RBAC for candidate PII, commercial terms, exports, bulk actions, and administration.
- Normalize email with `.trim().toLowerCase()`.
- Normalize phone to digits and apply the repository's `91` prefix rule where applicable.
- Bump `lastActivityAt` on every contact write.
- Enforce suppression and do-not-contact across all channels.
- Keep cold-email sending manual-gated until the separate go-live process is approved.
- Keep candidate submissions human-approved and consented.
- Keep paid discovery preview-first and cost-guarded.
- Store secret presence only; never expose secret values.
- Make submission and outbound-message writes idempotent.
- Protect candidate and client documents with deliberate access control. The dated audit found
  requirement-sheet PDFs accessible by public URL; record and resolve that security/product decision
  before real sensitive JDs are treated as private.
- Define PII retention, export, correction, deletion, and consent policies before external portals.
- Add structured logs and metrics for failed sends, reply matching, stale SLAs, duplicate blocks,
  score calculation, and background job failures.
- Verify actual Railway process topology before changing any worker/deployment assumption.

## 17. Acceptance scenarios

The first complete release must pass all applicable scenarios.

### Relationship and requirement attribution

- Priya and Rahul work at the same company. Priya supplies SAP and Rahul supplies Java. Company 360,
  both contact pages, each Requirement 360, and analytics preserve the distinction.
- One requirement may have a source contact, hiring manager, coordinator, and interviewer without
  changing who originally supplied it.
- Every accepted requirement has owner, assigned delivery, stage date, SLA, and next action.
- A historical requirement with no known source person says `needs attribution`; it does not borrow
  an unrelated approved contact.

### Candidate matching

- JavaScript does not satisfy mandatory Java.
- SAP FICO does not satisfy mandatory SAP ABAP.
- Missing a mandatory skill prevents a misleading high-fit recommendation.
- A candidate can be shortlisted independently for two requirements without overwriting either
  decision.
- Years, recency, evidence, location, availability, and work mode affect the explanation.
- Rate comparison respects currency and hourly/monthly/annual periods.
- Recalculation preserves the prior model version and decision history.

### Submission and delivery

- A candidate cannot be submitted without requirement-specific consent/RTR when required.
- A duplicate candidate–requirement submission is blocked or handled as a resend history event.
- Submission records exactly who sent what to which contact and when.
- Client feedback updates the correct submission, candidate, requirement, contact, and next action.
- Multiple interview rounds, an offer revision, acceptance, and joining remain auditable.
- A withdrawal or rejection requires a reason and does not erase history.
- Placement traces back to company, source contact, requirement, candidate, and submission.

### Trust, security, and analytics

- Authenticated API failure never displays fabricated demo data.
- Pagination does not alter headline totals.
- Cross-tenant access fails.
- Unauthorized users cannot access candidate PII or commercial terms.
- Every contact write follows identity normalization and updates last activity.
- Public/signed document behavior matches the approved policy.
- Funnel definitions use correct denominators and cohort windows.
- Permanent fee and contract margin calculations pass exact unit tests.
- Existing historical records remain accessible during and after migration.

## 18. Verification and definition of done

Every implementation unit must provide:

- Requirement-to-code/test traceability
- Targeted unit and integration tests
- `npm run build`
- `npm test` when appropriate to the unit
- `npm run admin:build` when admin UI changes
- `git diff --check`
- Authenticated manual QA for changed high-value workflows
- Tenant and permission checks
- Error, loading, empty, and retry-state checks
- Honest report of pre-existing failures versus regressions
- Updated `.ai/CURRENT_TASK.md` and `.ai/CURRENT_STATE.md` when relevant
- Append-only `.ai/HANDOFF_LOG.md` entry
- Regenerated `.ai/AI_BRIEF.md` using `npm run ai:brief`

No unit is done because code exists. It is done when its acceptance criteria are demonstrated and
the next agent can resume from the repository alone.

## 19. Pilot and 30/60/90 rollout

### Pilot scope

- Three to five companies
- Five to ten real accepted requirements
- SAP and Java skill families
- Twenty to thirty vetted candidates
- One account lead, one TA lead where available, and two recruiters
- Manual client and candidate actions

### Days 1–30: control and trust

- Complete Phase 0.
- Standardize vocabulary, owners, stages, next actions, and SLAs.
- Establish current funnel and data-quality baselines.
- Clean only pilot records, not the entire database.
- Success: any active pilot item can be opened and its owner, provenance, state, and next action are
  immediately clear.

### Days 31–60: connected delivery

- Deliver the core domain spine, persistent candidate decisions, and submission workflow.
- Train the team with live pilot work.
- Success: no pilot requirement, candidate submission, or interview is tracked only in chat or a
  private spreadsheet.

### Days 61–90: intelligence and scale decision

- Deliver explainable matching, SLA alerts, cohort analytics, and initial commercial forecasting.
- Review outcomes and adjust taxonomies, thresholds, SLAs, and capacity.
- Success: management can trace and explain starts and economics from company/contact through the
  entire delivery chain.

Do not scale account volume or automation until data discipline and conversion quality are proven.

## 20. FUTURE concepts parking lot

These ideas are intentionally recorded so they survive future sessions. They are not current scope.
Promote one only through a new PRD/ADR with evidence that the core workflow is stable.

- Client portal for requirements, submissions, interview scheduling, and feedback
- Candidate portal for profile updates, availability, documents, consent, and interview status
- Gmail/Outlook and calendar synchronization
- ATS, VMS, MSP, and vendor-management integrations
- E-signature for RTR, contracts, and offer documentation
- Prime/sub-vendor network and controlled requirement distribution
- Referral and talent-community programs
- Skill knowledge graph and semantic/embedding-based retrieval after canonical taxonomy exists
- Outcome-calibrated match and conversion models
- Automated next-best-action recommendations
- Recruiter capacity and assignment optimization
- Contract timesheets, extensions, ending alerts, and redeployment
- Invoice collection and cash-flow forecasting
- AI-assisted JD/resume extraction with human verification
- Interview transcription and structured feedback with consent
- Multilingual client/candidate communication
- External API/webhooks for approved partners
- Privacy center, candidate data requests, and configurable retention
- Multi-tenant commercial SaaS packaging only after internal operating proof

Promotion criteria should include real user need, sufficient clean data, measurable expected value,
security/privacy review, cost model, rollback plan, and a named owner.

## 21. Open decisions and required ADRs

Before or during Phase 1, decide and record:

1. Whether activity uses enhanced existing `events`/`tasks` or a dedicated staffing timeline.
2. Exact requirement-contact and company-contact persistence model.
3. Exact skills/taxonomy model and ownership of alias review.
4. Submission/interview/offer table boundaries and transition enforcement.
5. Private/signed document access policy for JDs, resumes, RTRs, contracts, and offers.
6. Role-level permissions for candidate PII and commercial fields.
7. Permanent versus contract commercial rules, invoicing triggers, and replacement reserves.
8. Historical backfill and legacy attribution policy.
9. Feature-flag and compatibility strategy during page consolidation.
10. Geography and operating mix after the SAP/Java pilot.

Suggested first architecture record after code verification:

`docs/decisions/ADR-004-wizmatch-staffing-domain-model.md`

Do not create an ADR as a substitute for human approval of guarded schema/migration work.

## 22. Related source material

### Agent and review rules

- `AGENTS.md`
- `CLAUDE.md`
- `docs/wizmatch/README.md`
- `docs/wizmatch/WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md`
- `docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/AI_BRIEF.md` — generated; never hand-edit
- `.ai/TOOL_ROLES.md`
- `.ai/REVIEW_CHECKLIST.md`
- `.ai/HANDOFF_LOG.md`

### Current architecture and product

- `docs/PRODUCT_SYSTEM_BRIEF.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/CONVENTIONS.md`
- `docs/SECURITY.md`
- `docs/DEPLOYMENT.md`
- `CRM_SYSTEM_DOCS.md`
- `docs/wizmatch-staffing-module.md`

### Wizmatch evidence and operations

- `docs/reviews/wizmatch-client-funnel-audit-2026-07-12.md`
- `docs/wizmatch/DATAFLOW.md`
- `docs/wizmatch/CLIENT_FUNNEL_TEST_PLAN.md`

### Phase-gated supporting material

- `docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md`
- `docs/wizmatch/GO-LIVE-PLAYBOOK.md`
- `docs/wizmatch/DEMAND-SOURCING-PLAN.md`
- `docs/wizmatch-daily-operations.md`
- `docs/wizmatch-operational-readiness.md`

Read phase-gated material only when the selected unit needs it. `docs/wizmatch/README.md` contains
the restricted-path policy. In particular, `docs/wizmatch/OPERATOR-GUIDE.md` is not startup context
and must not be opened or shared without explicit approval.

### Prior product and architecture inputs

- `docs/prd/001-contact-intelligence.md`
- `docs/prd/001-contact-intelligence-phase1-plan.md`
- `docs/prd/002-client-discovery-plan.md`
- `docs/prd/003-candidate-intelligence-plan.md`
- `docs/decisions/ADR-001-ai-collaboration-workflow.md`
- `docs/decisions/ADR-002-contact-intelligence-phase1-architecture.md`
- `docs/decisions/ADR-003-contact-intelligence-review-persistence.md`

## 23. Handoff contract

An agent implementing this PRD must:

1. Inspect current code and dirty worktree before editing.
2. Produce a requirement-to-code gap and dependency map.
3. Split work into small vertical slices.
4. Stop at the exact approval gates defined in `AGENTS.md` and this PRD.
5. Preserve unrelated user changes.
6. Never push, deploy, send, spend, or mutate production without the specific required approval.
7. Prove each unit with tests and user-path verification.
8. Leave `.ai/` and relevant docs accurate for the next cold start.

The repository, not a private chat, is the long-term memory of this product.
