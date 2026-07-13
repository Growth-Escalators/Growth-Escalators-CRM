# Wizmatch Staffing OS — Owner Inputs

- **Status:** Owner-maintained template; incomplete fields are `TBD`
- **Updated:** 2026-07-13
- **Product contract:** [`../prd/004-wizmatch-staffing-operating-system.md`](../prd/004-wizmatch-staffing-operating-system.md)

This file stores business decisions that cannot be inferred safely from code. Claude or another agent
may propose options, but the human owner decides them. A blank field blocks only work whose behavior
materially depends on that decision.

## Safety and privacy

Do not put any of the following in this file:

- Passwords, tokens, API keys, private keys, database URLs or environment values
- Candidate resumes, personal emails, phone numbers, compensation details or other PII
- Confidential client JDs, contracts, rate cards or production exports
- Production login instructions

Use fictional examples or internal record IDs only when necessary. Keep sensitive operating data in
the approved CRM, password manager or secure document system.

## 1. Product owner and decision process

| Decision | Value |
|---|---|
| Product owner | TBD |
| Engineering approver | TBD |
| Operations owner | TBD |
| PRD 004 product direction approved? | Approved for phased local implementation on 2026-07-13 |
| Approved current implementation phase | Phase 1 Gate A local implementation and additive migration generation approved; migration apply, production data, push and deployment remain separately gated |
| Local commit approver | TBD |
| Final schema/migration approver | TBD |
| Final production/deployment approver | TBD |
| Git-history rewrite approver/coordinator | TBD |
| How unresolved decisions are approved | TBD |

## 2. Pilot scope

| Input | Owner decision |
|---|---|
| Pilot start date | TBD |
| Pilot duration | 60–90 days proposed |
| Pilot companies | Use internal CRM IDs or fictional labels; TBD |
| Number of accepted requirements | 5–10 proposed |
| Pilot skill families | SAP and Java proposed |
| Number of vetted candidates | 20–30 proposed |
| India/US operating priority | India-first, selective US proposed; confirm |
| Permanent, contract, or mixed | TBD |
| Explicit pilot exclusions | TBD |

## 3. Team roles

Record role ownership without credentials or sensitive contact details.

| Role | Assigned owner/team | Responsibilities confirmed? |
|---|---|---|
| Sales / business development | TBD | TBD |
| Account management | TBD | TBD |
| TA / delivery lead | TBD | TBD |
| Recruiter(s) | TBD | TBD |
| Operations / data quality | TBD | TBD |
| Commercial / finance | TBD | TBD |
| Product/system administration | TBD | TBD |

## 4. Workflow and stage decisions

| Decision | Owner choice |
|---|---|
| Minimum facts required for a confirmed requirement | TBD |
| Minimum facts required to accept a requirement | TBD |
| Who can accept/reject requirements | TBD |
| Who can shortlist candidates | TBD |
| Who approves candidate submissions | TBD |
| Consent/RTR policy | TBD |
| Duplicate-submission handling | TBD |
| Interview feedback ownership | TBD |
| Offer and joining confirmation owner | TBD |
| Placement/invoice closure owner | TBD |

Use PRD 004 state machines as the default proposal. Record only approved deviations here.

## 5. SLA decisions

| Activity | Proposed default | Approved target |
|---|---:|---:|
| Inbound client reply acknowledgement | 2 working hours | TBD |
| Complete requirement intake | 4 working hours | TBD |
| Requirement acceptance/recruiter assignment | Same business day | TBD |
| First shortlist, common role | 24 hours | TBD |
| First shortlist, niche/SAP role | 48 hours | TBD |
| Submission feedback follow-up | 24 working hours | TBD |
| Interview scheduling | Same business day | TBD |
| Interview feedback request | Within 2 hours | TBD |
| Requirement inactivity risk threshold | 3 business days | TBD |
| Client no-response escalation | 5 business days | TBD |

## 6. Commercial decisions

Do not store confidential client-specific terms here. Record only approved policy or non-sensitive
planning ranges.

| Decision | Owner choice |
|---|---|
| Permanent placement fee policy | TBD |
| Replacement/refund reserve policy | TBD |
| Contract bill/pay/margin policy | TBD |
| Loaded pay-cost definition | TBD |
| Currency conversion policy/source | TBD |
| Invoice trigger | TBD |
| Collection/DSO owner | TBD |
| Revenue versus gross-margin reporting priority | TBD |

## 7. Permissions and privacy

| Decision | Owner choice |
|---|---|
| Roles allowed to view candidate PII | TBD |
| Roles allowed to view commercial terms | TBD |
| Export/bulk-action permissions | TBD |
| Candidate consent retention | TBD |
| Candidate data retention/deletion policy | TBD |
| Client JD/document access policy | TBD |
| Resume/RTR/contract access policy | TBD |
| Audit-log retention | TBD |

## 8. Automation and cost gates

| Capability | Initial decision |
|---|---|
| Automatic client outreach | Disabled unless separately approved |
| Automatic candidate submission | Disabled |
| Paid contact discovery | Preview-first and manually approved; exact caps TBD |
| Automatic matching recalculation | Future phase; TBD |
| Next-action reminders | Future safe automation; TBD |
| Candidate availability reminders | Future safe automation; TBD |
| Cold-email sending enablement | Separate go-live approval required |

## 9. Reporting targets

| Metric | Initial target/decision |
|---|---|
| Accepted workable requirements per pod/month | Base proposal: 6; confirm |
| Qualified submissions per requirement | Base proposal: 4; confirm |
| Submission-to-interview | Base proposal: 33%; confirm after baseline |
| Interview-to-offer | Base proposal: 37.5%; confirm after baseline |
| Offer-to-start | Base proposal: 67%; confirm after baseline |
| Expected starts per pod/month after ramp | Base proposal: about 2; confirm |
| Primary north-star metrics | Accepted requirements, SLA coverage, starts, gross margin proposed |

Planning numbers are not guarantees. Calibrate them with 60–90-day cohorts and rolling averages.

## 10. Open architecture/product decisions

| Decision | Status | Owner note or decision record |
|---|---|---|
| Existing events/tasks versus dedicated staffing timeline | Gate A direction approved for local implementation | `docs/decisions/ADR-004-wizmatch-staffing-domain-spine.md` |
| Requirement-contact persistence model | Gate A direction approved for local implementation | `docs/decisions/ADR-004-wizmatch-staffing-domain-spine.md` |
| Skill taxonomy ownership | TBD | |
| Submission/interview/offer table boundaries | TBD | |
| Private/signed document policy | TBD | |
| Historical attribution/backfill policy | TBD | |
| Feature-flag/dual-read strategy | Additive compatibility direction approved for Gate A local implementation | `docs/decisions/ADR-004-wizmatch-staffing-domain-spine.md` |
| Post-pilot geography and operating mix | TBD | |

Non-obvious approved architecture decisions should be recorded in a numbered ADR under
`docs/decisions/`, then linked here.

## 11. Approval log

Use this only as an index to an explicit human decision; do not place secrets or production payloads
here.

| Date | Proposed guarded action | Proposal/ADR | Decision | Approver |
|---|---|---|---|---|
| 2026-07-13 | Implement Phase 1 Gate A locally and generate one additive migration | ADR-004 / PRD 004 Phase 1 | Approved by the user through “Please plan the next phase and get them done as well”; does not approve applying the migration, production writes, push, deployment, sending or paid providers | Product owner (chat instruction) |
